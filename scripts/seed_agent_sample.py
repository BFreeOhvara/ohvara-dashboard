"""Print ONE SQL transaction that fills the test agent's pages with 13 sample
clients across every stage of agent_clients (migration 193).

Generates SQL only. It never connects to the database, needs no key and has
no dependencies. Running the SQL is a separate, checked step at the door
(the Supabase SQL editor, as the service role); nothing here runs it.

  python scripts/seed_agent_sample.py --fulfillment-id <uuid> [--out seed.sql]
  python scripts/seed_agent_sample.py --fulfillment-id <uuid> --check   # offline checks only
  python scripts/seed_agent_sample.py [--fulfillment-id <uuid>] --door qa/servicing-seed/door-dry-run.sql

TEST AGENT ONLY. The agent is hard-coded (an allowlist of one); --agent-id
exists only to refuse any other account. Brayden's own account is out: fake
sales there would count in real leaderboards (090 excludes only the test
agent). --fulfillment-id is the test fulfillment account; every row that has a
rep has that one, so auto-assign (116/156) never hands one to a real rep.

What the transaction does, in order:
  begin; set local ohvara.skip_assign_notify = 'on' (no 'New call booked' bell
  or email, 146/116); stop if a table the 13 clients need is missing, or the
  fulfillment account is missing, not an active fulfillment account, or on the
  other demo side from the test agent (156's demo guard would drop the
  assignment); wipe earlier sample rows (the same statements as
  wipe_agent_sample.py, so a re-run never doubles up); disable the triggers in
  DISABLED_TRIGGERS; insert with fixed uuid5 ids; stop unless the flagged
  clients read 2/7/2/1/1; enable those triggers; print row counts; commit. A
  failure anywhere rolls all of it back, the disabled triggers too.

Every insert sits in a block that runs only when its table (and its parent)
exists and has an is_sample column; otherwise the WHOLE table is skipped with
a NOTICE. Every inserted row sets is_sample = true. The seed changes no row
it did not insert: rows without the flag are never touched.

Traps handled (read before changing):
  - All dates come from SQL at run time; this file reads no clock. Every
    policy's created_at is date_trunc('week', now()) minus MIN_AGE_DAYS or
    more. Two days would keep it out of the 16-a-week meter (119/146) whatever
    day or time zone the SQL runs in, but notify_hourly's Monday summary (146)
    counts every agent's bookings from last Monday, and that email reaches
    admins. 9 days keeps a seed run on Monday morning out of that too.
  - Nothing here may wake a sweep, by the data itself: no scheduled_call_at
    (notify_call_times, missed_sweep; the next date comes from task due_at), no
    recovery_* values (recovery_sweep), next_lapse_check_at null
    (notify-lapse-checkins), last_call_outcome never no_answer, sms_consent
    false.
  - A row with replaced_old_policy = false has no old policy to cancel, so
    policies_servicing_guard (187) refuses a rep, a call or carrier_name on it,
    and fulfillment_autoassign leaves it alone. Only rows with an old policy
    get assigned_fulfillment_id. The new carrier goes in new_carrier_name.
  - agent_clients counts a lapse_save as an open request when an agent or
    client opened it. The open lapse_save here is requested_by = system, so the
    two protected clients are the only ones with open_requests.
  - policy_events is a permanent record (153): never deleted directly, only by
    the cascade from policies. The 'booked' row the insert trigger writes (118)
    has at = now(), the only moment it may be updated; the seed then backdates
    it and marks it is_sample in the same transaction. A row with
    replaced_old_policy = false gets no 'booked' row from the trigger; it gets
    'submitted', as agent_submit_deal writes (187).
  - policies are inserted before leads, so client_policy_id is set on the
    insert and the leads update triggers (lead_booked_assign_closer) never run.
  - fulfillment_cancel_on_result (145, pay per cancel) fires on an UPDATE of
    fulfillment_stage. The old-policy-cancelled rows are inserted as Complete,
    so no fulfillment_cancels row and no pay.
  - lock_timeout: disabling a trigger takes a SHARE ROW EXCLUSIVE lock on the
    table until commit. Other sessions can still read, and any real insert waits
    instead of slipping through without the trigger. The seed gives up after 5
    seconds rather than queue behind a long writer.
  - Every lead has assigned_rep_id = the test agent, so none reaches the VA
    queue (175). agent_status follows inbound_stage (180), so both are set to
    agree. lead_sms_replies all have handled_at (none in the VA reply queue).

Phones are +1555010xxxx (fiction range), no emails, fake names only.
"""
import argparse
import os
import re
import sys
import uuid

sys.dont_write_bytecode = True  # a generator leaves nothing behind in the repo
from wipe_agent_sample import (
    WIPE_BODY, HELPERS, CASCADED, check_transaction, check_deletes,
    check_no_secrets, strip_comments,
)

TEST_AGENT = '3f2b2df7-40b1-4921-80e2-09981c819642'
AGENT_ALLOWLIST = {TEST_AGENT}
PLACEHOLDER_FULFILLMENT_ID = '00000000-0000-4000-8000-00000000f001'  # no such account: the seed stops until a real id replaces it
NS = uuid.UUID('6d1f6f0e-6a53-5c8e-9a4e-0a7a5e5a0001')
PHONE_RE = re.compile(r'^\+1555010\d{4}$')
UUID_RE = re.compile(r'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
SAMPLE_NOTE = 'SAMPLE DATA (seed_agent_sample.py) - fake client, safe to delete'
MIN_AGE_DAYS = 9
STAGES = ['setting_up', 'protected', 'needs_attention', 'ongoing', 'ended']
STAGE_TARGET = {'setting_up': 2, 'protected': 7, 'needs_attention': 2, 'ongoing': 1, 'ended': 1}
TARGET_TEXT = '/'.join(str(STAGE_TARGET[s]) for s in STAGES)
# Triggers with no skip setting that reach another person; off only inside the transaction.
DISABLED_TRIGGERS = [
    ('policies', 'policies_recompute_leaderboard'),
    ('policies', 'policies_check_goal_milestones'),
    ('policy_messages', 'policy_messages_notify_trigger'),
]
SEEDED_TABLES = ['policies', 'policy_fulfillment_details', 'policy_events', 'policy_messages', 'leads',
                 'lead_sms_replies', 'lead_followup_sms_log', 'inbound_events', 'servicing_tasks', 'help_calls']
# The 13 clients cannot exist without these; the other seeded tables are skipped with a notice.
CORE_TABLES = ['policies', 'policy_fulfillment_details', 'policy_events', 'policy_messages', 'leads', 'servicing_tasks']
AUDIT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'qa', 'servicing-seed', 'trigger-audit.md')


def sid(kind, key):
    return str(uuid.uuid5(NS, f'{kind}:{key}'))


def q(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


class Raw(str):
    """A SQL expression, written as is."""


def lit(v):
    return v if isinstance(v, Raw) else q(v)


def phone(n):
    return f'+1555010{n:04d}'


def ago(days):
    return f"now() - interval '{days} days'"


def ahead(days):
    return f"now() + interval '{days} days'"


def created_expr(age):
    return f"pg_temp.wk_start() - interval '{age} days'"


# ── clients ─────────────────────────────────────────────────────────────────
# A task: kind, status, requested_by, due / done (SQL, or 'watch' for 12 months
# from the policy, or 'after:N' for N days after the policy), and the rest.

def task(kind, status='scheduled', by='system', due=None, done=None, **extra):
    return dict(kind=kind, status=status, by=by, due=due, done=done, **extra)


WATCH = task('chargeback_watch', due='watch')
SETUP_DONE = [task('packet_check', 'done', due='after:7', done='after:6'),
              task('review_call', 'done', due='after:30', done='after:28')]
SETUP_OPEN = [task('packet_check', due=ahead(5)), task('review_call', due=ahead(28))]


def policy(age, carrier, product, premium, draft, beneficiary, relation, tasks=(), messages=(), best='morning',
           status='In Effect', replaced=False, old_carrier=None, cancelled=False, effective=True):
    return dict(age=age, carrier=carrier, product=product, premium=premium, draft=draft, beneficiary=beneficiary,
                relation=relation, tasks=list(tasks), messages=list(messages), best=best, status=status,
                replaced=replaced, old_carrier=old_carrier, cancelled=cancelled, effective=effective)


# stage is what agent_clients must read for the client. lead is the sample lead it came from, if any.
CLIENTS = [
    dict(key='maria', first='Maria', last='Alvarez', city='San Antonio', st='TX', tz='America/Chicago', stage='setting_up', policies=[
        policy(12, 'Mutual of Omaha', 'Term Life', '62.50', 1, 'Carlos Alvarez', 'Spouse', status='Submitted', effective=False,
               replaced=True, old_carrier='Transamerica', tasks=SETUP_OPEN + [WATCH], messages=[
                   ('agent', 'Maria prefers mornings. Her daughter may join the call.', 'after:1'),
                   ('rep', 'Got it. I will set up the call to cancel her old policy and confirm the time with you.', 'after:2')])]),
    dict(key='james', first='James', last='Whitfield', city='Columbus', st='OH', tz='America/New_York', stage='setting_up', lead='m4', policies=[
        policy(10, 'Americo', 'Mortgage Protection', '84.00', 3, 'Ruth Whitfield', 'Spouse', status='Submitted', effective=False,
               tasks=SETUP_OPEN + [WATCH], best='evening')]),
    dict(key='denise', first='Denise', last='Carter', city='Birmingham', st='AL', tz='America/Chicago', stage='protected', policies=[
        policy(75, 'Foresters', 'Whole Life', '48.25', 5, 'Marcus Carter', 'Son', replaced=True, old_carrier='Americo', cancelled=True,
               tasks=[WATCH], messages=[
                   ('rep', 'Her old policy is cancelled. The confirmation number is on her file.', 'after:2'),
                   ('agent', 'Thanks, I let her know.', 'after:3')])]),
    dict(key='robert', first='Robert', last='Nguyen', city='Phoenix', st='AZ', tz='America/Phoenix', stage='protected', policies=[
        policy(130, 'Foresters', 'Term Life', '55.00', 15, 'Lily Nguyen', 'Daughter', tasks=[WATCH]),
        policy(40, 'Transamerica', 'Whole Life', '31.75', 15, 'Lily Nguyen', 'Daughter', tasks=[WATCH], best='afternoon')]),
    dict(key='angela', first='Angela', last='Brooks', city='Memphis', st='TN', tz='America/Chicago', stage='protected', policies=[
        policy(200, 'Mutual of Omaha', 'Final Expense', '39.00', 20, 'Dwayne Brooks', 'Spouse', tasks=[WATCH])]),
    dict(key='wendy', first='Wendy', last='Castillo', city='Lubbock', st='TX', tz='America/Chicago', stage='protected', lead='m3', policies=[
        policy(60, 'Americo', 'Mortgage Protection', '71.50', 28, 'Hector Castillo', 'Spouse', tasks=SETUP_DONE + [WATCH])]),
    dict(key='gary', first='Gary', last='Simmons', city='Louisville', st='KY', tz='America/New_York', stage='protected', policies=[
        policy(160, 'Foresters', 'Term Life', '58.00', 1, 'Diane Simmons', 'Spouse', replaced=True, old_carrier='Transamerica', cancelled=True,
               tasks=[WATCH], messages=[('rep', 'His old policy is cancelled. The confirmation is in the notes.', 'after:2')]),
        policy(100, 'Mutual of Omaha', 'Final Expense', '27.50', 1, 'Diane Simmons', 'Spouse', tasks=[WATCH], best='afternoon')]),
    dict(key='samuel', first='Samuel', last='Ortega', city='Fresno', st='CA', tz='America/Los_Angeles', stage='protected', lead='r2', policies=[
        policy(95, 'Transamerica', 'Term Life', '66.00', 3, 'Elena Ortega', 'Spouse', tasks=SETUP_DONE + [WATCH, task(
            'beneficiary_change', 'requested', 'agent', due=ahead(3), best_time='afternoon',
            note='He wants to add his daughter as a second beneficiary.', asked=ago(2))], messages=[
                ('agent', 'Samuel wants to add his daughter as a beneficiary.', ago(2)),
                ('rep', 'On it. I will send the carrier form this week.', ago(1))])]),
    dict(key='linda', first='Linda', last='Moreno', city='Tulsa', st='OK', tz='America/Chicago', stage='protected', policies=[
        policy(150, 'Americo', 'Whole Life', '44.75', 5, 'Rosa Moreno', 'Daughter', tasks=[WATCH, task(
            'address_change', 'scheduled', 'client', due=ahead(4), best_time='morning',
            note='She moved. New address is with the carrier form.', asked=ago(1))], messages=[
                ('rep', 'Linda called about her new address. We are updating it with the carrier.', ago(1))])]),
    dict(key='kevin', first='Kevin', last='Patterson', city='Jacksonville', st='FL', tz='America/New_York', stage='needs_attention', policies=[
        policy(170, 'Americo', 'Term Life', '52.00', 15, 'Sharon Patterson', 'Spouse', tasks=[WATCH, task(
            'lapse_save', 'in_progress', 'system', due=ahead(1), note='The last draft failed.', asked=ago(2))], messages=[
                ('rep', 'The carrier says his last draft failed. We are working to save the policy.', ago(2)),
                ('agent', 'He changed banks. I told him to expect your call.', ago(1))])]),
    dict(key='theresa', first='Theresa', last='Holt', city='Little Rock', st='AR', tz='America/Chicago', stage='needs_attention', policies=[
        policy(220, 'Mutual of Omaha', 'Term Life', '46.50', 20, 'Paul Holt', 'Son', tasks=[WATCH, task(
            'lapse_save', 'done', 'system', due=ago(5), done=ago(3), outcome='saved', note='Saved: new draft date.', asked=ago(9))], messages=[
                ('rep', 'Policy saved. Her next draft cleared.', ago(3))])]),
    dict(key='patricia', first='Patricia', last='Dunn', city='Richmond', st='VA', tz='America/New_York', stage='ongoing', policies=[
        policy(430, 'Transamerica', 'Whole Life', '73.25', 28, 'Thomas Dunn', 'Spouse', tasks=[
            task('chargeback_watch', 'done', due='after:365', done='after:365'), task('annual_review', due=ahead(20), best_time='afternoon')], messages=[
                ('agent', 'Patricia would like her annual review in the afternoon.', ago(4))], best='afternoon')]),
    dict(key='michael', first='Michael', last='Reyes', city='El Paso', st='TX', tz='America/Denver', stage='ended', policies=[
        policy(300, 'Americo', 'Term Life', '49.00', 3, 'Elena Reyes', 'Spouse', status='Lapsed', tasks=[task(
            'lapse_save', 'done', 'system', due=ago(25), done=ago(20), outcome='lapsed', note='Could not reach him after three drafts failed.', asked=ago(35))], messages=[
                ('rep', 'We could not save this one. The carrier has closed it.', ago(20))])]),
]


def plan_policies():
    """Every policy with its client, ids and dates worked out."""
    out = []
    for i, c in enumerate(CLIENTS):
        for n, p in enumerate(c['policies']):
            created = created_expr(p['age'])
            out.append(dict(p, client=c, n=n, key=f"{c['key']}:{n}", id=sid('policy', f"{c['key']}:{n}"), created=created,
                            phone=phone(100 + i), name=f"{c['first']} {c['last']}"))
    return out


def when(expr, m):
    """A task or message date: SQL as written, or counted from the policy."""
    if expr == 'watch':
        return Raw(f"({m['created']}) + interval '12 months'")
    if expr and expr.startswith('after:'):
        return Raw(f"({m['created']}) + interval '{expr[6:]} days'")
    return Raw(expr) if expr else None


def build_policies(fid, plan):
    cols = ['id', 'agent_id', 'client_first_name', 'client_last_name', 'client_phone', 'status', 'notes', 'created_at',
            'policy_sold_date', 'effective_date', 'carrier_name', 'new_carrier_name', 'product_name', 'monthly_premium',
            'replaced_old_policy', 'best_time', 'fulfillment_assigned', 'fulfillment_stage', 'assigned_fulfillment_id',
            'fulfillment_claimed_at', 'fulfillment_started_at', 'fulfillment_completed_at', 'cancellation_confirmation',
            'call_attempts', 'last_call_at', 'client_city', 'state', 'client_timezone', 'sms_consent',
            'scheduled_call_at', 'next_lapse_check_at', 'last_call_outcome', 'recovery_phase', 'recovery_step',
            'recovery_next_kind', 'recovery_next_at', 'is_sample']
    rows = []
    for i, m in enumerate(plan):
        c = m['client']
        created = Raw(m['created'])
        r = dict(id=m['id'], agent_id=TEST_AGENT, client_first_name=c['first'], client_last_name=c['last'],
                 client_phone=m['phone'], status=m['status'], notes=SAMPLE_NOTE, created_at=created,
                 policy_sold_date=Raw(f"(({m['created']}) - interval '2 days')::date"),
                 effective_date=Raw(f"({m['created']})::date") if m['effective'] else None,
                 new_carrier_name=m['carrier'], product_name=m['product'], monthly_premium=Raw(m['premium']),
                 replaced_old_policy=m['replaced'], best_time=m['best'], fulfillment_assigned=True, fulfillment_stage='Pending',
                 call_attempts=0, client_city=c['city'], state=c['st'], client_timezone=c['tz'], sms_consent=False, is_sample=True)
        if m['replaced']:
            r.update(carrier_name=m['old_carrier'], assigned_fulfillment_id=fid, fulfillment_claimed_at=created)
        if m['cancelled']:
            done = Raw(f"({m['created']}) + interval '2 days'")
            r.update(fulfillment_stage='Complete', call_attempts=1, last_call_at=done,
                     fulfillment_started_at=Raw(f"({m['created']}) + interval '47 hours'"), fulfillment_completed_at=done,
                     cancellation_confirmation=f'SAMPLE-CXL-{1001 + i}')
        rows.append(r)
    return cols, rows


def build_details(plan):
    cols = ['policy_id', 'full_legal_name', 'state_of_residence', 'address_city', 'address_state',
            'current_carrier', 'beneficiaries', 'draft_day', 'is_sample']
    rows = []
    for m in plan:
        c = m['client']
        rows.append(dict(policy_id=m['id'], full_legal_name=m['name'], state_of_residence=c['st'], address_city=c['city'],
                         address_state=c['st'], current_carrier=m['old_carrier'],
                         beneficiaries=Raw(f"jsonb_build_array(jsonb_build_object('name', {q(m['beneficiary'])}, 'relationship', {q(m['relation'])}))"),
                         draft_day=m['draft'], is_sample=True))
    return cols, rows


def build_tasks(plan, lead_ids):
    """Every task on a client, with who asked. A sold lead's own three point at its lead too."""
    cols = ['id', 'agent_id', 'lead_id', 'policy_id', 'kind', 'status', 'due_at', 'done_at', 'requested_by', 'requested_by_id',
            'best_time', 'outcome', 'note', 'created_at', 'is_sample']
    rows, requests = [], []
    for m in plan:
        lead = lead_ids.get(m['client'].get('lead')) if m['n'] == 0 else None
        for t in m['tasks']:
            sold_seed = t['kind'] in ('packet_check', 'review_call', 'chargeback_watch')
            asked = when(t.get('asked'), m) or Raw(f"({m['created']}) + interval '1 hour'")
            r = dict(id=sid('task', f"{m['key']}:{t['kind']}"), agent_id=TEST_AGENT, lead_id=lead if sold_seed else None,
                     policy_id=m['id'], kind=t['kind'], status=t['status'], due_at=when(t['due'], m), done_at=when(t['done'], m),
                     requested_by=t['by'], requested_by_id=TEST_AGENT if t['by'] == 'agent' or (sold_seed and lead) else None,
                     best_time=t.get('best_time'), outcome=t.get('outcome'), note=t.get('note', 'Sample task'),
                     created_at=asked, is_sample=True)
            rows.append(r)
            if t['by'] != 'system' or t['kind'] == 'lapse_save':
                requests.append(dict(policy=m, task=r))
    return cols, rows, requests


def build_events(plan, requests, fid):
    """Events beyond the trigger's 'booked' row. All in the past."""
    rep_name = Raw(f"(select coalesce(nullif(btrim(full_name), ''), 'Sample Rep') from public.profiles where id = '{fid}')")
    agent_name = Raw(f"(select coalesce(nullif(btrim(full_name), ''), 'Test Agent') from public.profiles where id = '{TEST_AGENT}')")
    cols = ['id', 'policy_id', 'agent_id', 'kind', 'from_status', 'actor_id', 'actor_name', 'actor_role',
            'detail', 'at', 'is_sample']
    rows = []

    def ev(m, n, kind, frm, actor, detail, at):
        by_rep = actor == 'rep'
        rows.append(dict(id=sid('event', f"{m['key']}:{n}"), policy_id=m['id'], agent_id=TEST_AGENT, kind=kind, from_status=frm,
                         actor_id=fid if by_rep else TEST_AGENT, actor_name=rep_name if by_rep else agent_name,
                         actor_role='fulfillment' if by_rep else 'agent', detail=Raw(f"jsonb_build_object({detail})"),
                         at=Raw(f"least(now() - interval '1 minute', {at})"), is_sample=True))

    for m in plan:
        if not m['replaced']:
            ev(m, 'submitted', 'submitted', None, 'agent',
               f"'label', 'Submitted for servicing', 'replaced', false, 'best_time', {q(m['best'])}", m['created'])
        if m['cancelled']:
            conf = next(r for r in build_policies(fid, [m])[1])['cancellation_confirmation']
            ev(m, 'started', 'in_progress', 'booked', 'rep', "'attempt', 1", f"({m['created']}) + interval '47 hours'")
            ev(m, 'cancelled', 'cancelled', 'in_progress', 'rep', f"'confirmation', {q(conf)}", f"({m['created']}) + interval '2 days'")
    for x in requests:
        m, t = x['policy'], x['task']
        ev(m, f"request:{t['kind']}", 'service_request', None, 'agent',
           f"'label', 'Service request', 'request_id', '{t['id']}', 'request_kind', {q(t['kind'])}, 'best_time', {q(t['best_time'])}",
           t['created_at'])
    return cols, rows


def build_messages(plan, fid):
    cols = ['id', 'policy_id', 'sender_id', 'sender_name', 'sender_role', 'body', 'created_at', 'is_sample']
    rows = []
    for m in plan:
        for n, (who, body, at) in enumerate(m['messages']):
            sender = TEST_AGENT if who == 'agent' else fid
            rows.append(dict(id=sid('message', f"{m['key']}:{n}"), policy_id=m['id'], sender_id=sender,
                             sender_name=Raw(f"(select coalesce(full_name, '') from public.profiles where id = '{sender}')"),
                             sender_role='agent' if who == 'agent' else 'fulfillment', body=body,
                             created_at=Raw(f"least(now() - interval '{30 - n * 4} minutes', {when(at, m)})"),
                             is_sample=True))
    return cols, rows


# ── leads ───────────────────────────────────────────────────────────────────
# (key, contact, city, st, lead_type, inbound_stage, hours ago). A sold lead's
# client (CLIENTS' lead) has the same name and phone, and it came in 2 days before
# that client's policy, so its hours are counted from there instead.
LEADS = [
    ('m1', 'Carla Jennings', 'Macon', 'GA', 'mortgage_protection', 'new', 3),
    ('m2', 'Darnell Price', 'Shreveport', 'LA', 'mortgage_protection', 'contacting', 26),
    ('m3', 'Wendy Castillo', 'Lubbock', 'TX', 'mortgage_protection', 'sold', 0),
    ('m4', 'James Whitfield', 'Columbus', 'OH', 'mortgage_protection', 'sold', 0),
    ('h1', 'Frank Osei', 'Akron', 'OH', 'policy_help', 'new', 1),
    ('h2', 'Bonnie Lyle', 'Mobile', 'AL', 'policy_help', 'contacting', 50),
    ('h3', 'Victor Hale', 'Wichita', 'KS', 'policy_help', 'lost', 140),
    ('r1', 'Irene Pruitt', 'Knoxville', 'TN', 'policy_review', 'contacting', 70),
    ('r2', 'Samuel Ortega', 'Fresno', 'CA', 'policy_review', 'sold', 0),
]
AGENT_STATUS = {'new': 'assigned', 'contacting': 'contacted', 'sold': 'closed', 'lost': 'bad'}
OUTCOME = {'sold': 'sold', 'lost': 'not_interested'}
QUALIFIERS = {
    'mortgage_protection': "'home_value', '250k-350k', 'smoker', false, 'best_time', 'evenings'",
    'policy_help': "'question', 'premium went up', 'has_policy', true",
    'policy_review': "'current_coverage', 'term life', 'years_held', 6",
}


def lead_ids():
    return {l[0]: sid('lead', l[0]) for l in LEADS}


def build_leads(plan):
    first = {m['client'].get('lead'): m for m in plan if m['n'] == 0 and m['client'].get('lead')}
    cols = ['id', 'business_name', 'contact_name', 'phone', 'city', 'state', 'lead_type', 'lead_source',
            'assigned_rep_id', 'delivered_at', 'inbound_stage', 'agent_status', 'outcome', 'outcome_at', 'outcome_by',
            'client_policy_id', 'qualifier_answers', 'notes', 'created_at', 'is_sample']
    rows, meta = [], []
    for i, (key, name, city, st, lt, stage, hrs) in enumerate(LEADS):
        client = first.get(key)
        base = f"({client['created']}) - interval '2 days'" if client else f"now() - interval '{hrs} hours'"
        r = dict(id=sid('lead', key), business_name=name, contact_name=name, phone=client['phone'] if client else phone(200 + i),
                 city=city, state=st, lead_type=lt, lead_source='referral', assigned_rep_id=TEST_AGENT,
                 delivered_at=Raw(f"{base} + interval '2 minutes'"), inbound_stage=stage, agent_status=AGENT_STATUS[stage],
                 outcome=OUTCOME.get(stage), outcome_at=Raw(f"{base} + interval '3 hours'") if stage in OUTCOME else None,
                 outcome_by=TEST_AGENT if stage in OUTCOME else None, client_policy_id=client['id'] if client else None,
                 qualifier_answers=Raw(f"jsonb_build_object({QUALIFIERS[lt]})"),
                 notes=SAMPLE_NOTE.replace('client', 'lead'), created_at=Raw(base), is_sample=True)
        rows.append(r)
        meta.append(dict(key=key, row=r, base=base, stage=stage, i=i))
    return cols, rows, meta


def build_replies(lmeta):
    cols = ['id', 'from_phone', 'body', 'twilio_sid', 'lead_id', 'received_at', 'handled_by', 'handled_at', 'is_sample']
    texts = {'m2': 'Yes this is Darnell, can you call after 5?', 'h2': 'Thanks, Thursday works for me.',
             'r1': 'I got your text, what do I need to have ready?'}
    rows = []
    for n, m in enumerate([m for m in lmeta if m['key'] in texts], start=1):
        at = f"{m['base']} + interval '1 hour'"
        rows.append(dict(id=sid('reply', m['key']), from_phone=m['row']['phone'], body=texts[m['key']],
                         twilio_sid=f'SAMPLE-{n}', lead_id=m['row']['id'], received_at=Raw(at),
                         handled_by=TEST_AGENT, handled_at=Raw(f"{at} + interval '12 minutes'"), is_sample=True))
    return cols, rows


def build_followups(lmeta):
    cols = ['id', 'lead_id', 'stage', 'status', 'to_phone', 'from_number', 'twilio_sid', 'created_at', 'is_sample']
    rows = []
    for m in lmeta:
        if m['row']['lead_type'] != 'mortgage_protection':
            continue
        rows.append(dict(id=sid('followup', f"{m['key']}:1"), lead_id=m['row']['id'], stage='just_submitted',
                         status='skipped_gate', to_phone=m['row']['phone'], from_number=None, twilio_sid=None,
                         created_at=Raw(f"{m['base']} + interval '1 minute'"), is_sample=True))
        if m['stage'] != 'new':
            rows.append(dict(id=sid('followup', f"{m['key']}:2"), lead_id=m['row']['id'],
                             stage='reached' if m['stage'] == 'sold' else 'not_reached', status='skipped_quiet_hours',
                             to_phone=m['row']['phone'], from_number=None, twilio_sid=None,
                             created_at=Raw(f"{m['base']} + interval '2 hours'"), is_sample=True))
    return cols, rows


def build_inbound_events(lmeta):
    cols = ['id', 'lead_id', 'agent_id', 'kind', 'state', 'at', 'label', 'detail', 'actor_name', 'actor_role',
            'created_at', 'is_sample']
    rows = []

    def ev(m, n, kind, label, hrs_after, detail="'{}'::jsonb"):
        at = Raw(f"{m['base']} + interval '{hrs_after} hours'")
        by_agent = kind in ('note', 'outcome', 'became_client')
        rows.append(dict(id=sid('inbound', f"{m['key']}:{n}"), lead_id=m['row']['id'], agent_id=TEST_AGENT,
                         kind=kind, state='done', at=at, label=label, detail=Raw(detail),
                         actor_name='Test Agent' if by_agent else None,
                         actor_role='agent' if by_agent else None, created_at=at, is_sample=True))

    for m in lmeta:
        ev(m, 1, 'came_in', 'Came in', 0)
        if m['stage'] in ('contacting', 'sold', 'lost'):
            ev(m, 2, 'note', 'Left a voicemail, will try again tomorrow', 1)
        if m['stage'] in OUTCOME:
            ev(m, 3, 'outcome', 'Sold' if m['stage'] == 'sold' else 'Not interested', 3,
               f"jsonb_build_object('outcome', {q(OUTCOME[m['stage']])})")
        if m['stage'] == 'sold':
            ev(m, 4, 'became_client', 'Became a client', 3)
    return cols, rows


def build_help_calls(lmeta):
    cols = ['id', 'call_sid', 'caller_number', 'status', 'end_reason', 'transfer_agent_id', 'outcome', 'lead_id',
            'created_at', 'answered_at', 'transferred_at', 'ended_at', 'is_sample']
    rows = []
    for n, m in enumerate([m for m in lmeta if m['row']['lead_type'] == 'policy_help'], start=1):
        t = m['base']
        rows.append(dict(id=sid('help_call', m['key']), call_sid=f'SAMPLE-CALL-{n}', caller_number=m['row']['phone'],
                         status='ended', end_reason='completed', transfer_agent_id=TEST_AGENT, outcome='transferred',
                         lead_id=m['row']['id'], created_at=Raw(t), answered_at=Raw(f"{t} + interval '20 seconds'"),
                         transferred_at=Raw(f"{t} + interval '3 minutes'"),
                         ended_at=Raw(f"{t} + interval '14 minutes'"), is_sample=True))
    return cols, rows


# ── SQL assembly ────────────────────────────────────────────────────────────

def insert_sql(table, cols, rows):
    lines = [f'    insert into public.{table} ({", ".join(cols)}) values']
    for n, r in enumerate(rows):
        end = ';' if n == len(rows) - 1 else ','
        lines.append('      (' + ', '.join(lit(r.get(c)) for c in cols) + ')' + end)
    return '\n'.join(lines)


def guarded(tables, body, skip_note):
    cond = ' and '.join(f"pg_temp.has_sample('{t}')" for t in tables)
    return (f'do $s$\nbegin\n  if {cond} then\n{body}\n  else\n'
            f"    raise notice 'Skipped {tables[-1]}: no is_sample column on {', '.join(tables)}. {skip_note}';\n"
            f'  end if;\nend $s$;')


SKIPPED_PAGES = {
    'policies': 'Clients, Overview, Activity and the phone Clients tab stay empty',
    'policy_fulfillment_details': 'the client detail sheet shows no carrier or beneficiary',
    'policy_events': 'Activity shows only the backdated booked rows',
    'policy_messages': 'Messages (agent and rep chat) stays empty',
    'leads': 'Leads, Calendar and the lead detail stay empty',
    'lead_sms_replies': 'no reply texts on the lead detail (signed-in users cannot read this table today anyway)',
    'lead_followup_sms_log': 'no follow-up text rows (signed-in users cannot read this table today anyway)',
    'inbound_events': 'the lead timeline stays empty',
    'servicing_tasks': 'servicing tasks on Clients, Calendar and Today stay empty',
    'help_calls': 'no live-call log rows (agent pages do not read this table)',
}


def stage_counts_sql(where):
    """The five stage counts as one 2/7/2/1/1 text, in STAGES order."""
    parts = " || '/' || ".join(f"count(*) filter (where stage = '{s}')" for s in STAGES)
    return f"select {parts} from public.agent_clients where agent_id = '{TEST_AGENT}'{where}"


def build_seed(fid, agent_id=TEST_AGENT):
    if agent_id not in AGENT_ALLOWLIST:
        raise SystemExit(f'Refused: {agent_id} is not the test agent. Only {TEST_AGENT} may get sample data.')
    plan = plan_policies()
    pcols, prows = build_policies(fid, plan)
    dcols, drows = build_details(plan)
    lcols, lrows, lmeta = build_leads(plan)
    tcols, trows, requests = build_tasks(plan, lead_ids())
    ecols, erows = build_events(plan, requests, fid)
    mcols, mrows = build_messages(plan, fid)
    rcols, rrows = build_replies(lmeta)
    fcols, frows = build_followups(lmeta)
    icols, irows = build_inbound_events(lmeta)
    hcols, hrows = build_help_calls(lmeta)
    ids = ', '.join(q(r['id']) for r in prows)

    steps = [  # (guard tables, table, cols, rows, extra statements after the insert)
        (['policies'], 'policies', pcols, prows, f"""
    -- Every row with an old policy holds the test fulfillment account; nothing may have moved it.
    if exists (select 1 from public.policies where id in ({ids})
                and assigned_fulfillment_id is distinct from
                    case when replaced_old_policy then '{fid}'::uuid end) then
      raise exception 'Sample seed stopped: a sample policy was not held by the test fulfillment account.';
    end if;
    -- The insert trigger (118) wrote one 'booked' event per row with an old policy at now(),
    -- the only time it may be changed (153). Backdate it to the policy.
    if pg_temp.has_sample('policy_events') then
      update public.policy_events e set at = p.created_at, is_sample = true
        from public.policies p
       where p.id = e.policy_id and p.id in ({ids}) and e.kind = 'booked' and e.at = now();
    else
      update public.policy_events e set at = p.created_at
        from public.policies p
       where p.id = e.policy_id and p.id in ({ids}) and e.kind = 'booked' and e.at = now();
    end if;"""),
        (['policies', 'policy_fulfillment_details'], 'policy_fulfillment_details', dcols, drows, ''),
        (['policies', 'policy_events'], 'policy_events', ecols, erows, ''),
        (['policies', 'policy_messages'], 'policy_messages', mcols, mrows, ''),
        (['policies', 'leads'], 'leads', lcols, lrows, ''),
        (['leads', 'lead_sms_replies'], 'lead_sms_replies', rcols, rrows, ''),
        (['leads', 'lead_followup_sms_log'], 'lead_followup_sms_log', fcols, frows, ''),
        (['leads', 'inbound_events'], 'inbound_events', icols, irows, ''),
        (['policies', 'leads', 'servicing_tasks'], 'servicing_tasks', tcols, trows, ''),
        (['leads', 'help_calls'], 'help_calls', hcols, hrows, ''),
    ]
    core = ', '.join(q(t) for t in CORE_TABLES)
    out = [
        '-- Generated by scripts/seed_agent_sample.py. One transaction. Do not edit by hand.',
        f'-- Test agent only ({TEST_AGENT}); rows with an old policy held by fulfillment {fid}.',
        'begin;',
        "set local ohvara.skip_assign_notify = 'on';",
        "set local lock_timeout = '5s';",
        '',
        HELPERS,
        '',
        "-- Every policy date is counted back from this. It reads the clock when the SQL runs.",
        'create or replace function pg_temp.wk_start() returns timestamptz language sql stable as $$',
        "  select date_trunc('week', now())",
        '$$;',
        '',
        '-- No sample clients without the servicing tables and the test fulfillment account.',
        f"""do $chk$
declare
  t text;
begin
  if to_regclass('public.agent_clients') is null then
    raise exception 'Sample seed stopped: agent_clients does not exist, so migration 193 is not applied. Nothing was seeded.';
  end if;
  foreach t in array array[{core}] loop
    if not pg_temp.has_sample(t) then
      raise exception 'Sample seed stopped: public.% has no is_sample column, so a migration is missing. Nothing was seeded.', t;
    end if;
  end loop;
  if not exists (select 1 from public.profiles where id = '{TEST_AGENT}') then
    raise exception 'Sample seed stopped: the test agent profile does not exist.';
  end if;
  if not exists (select 1 from public.profiles
                  where id = '{fid}' and role::text = 'fulfillment' and coalesce(is_active, true)) then
    raise exception 'Sample seed stopped: fulfillment account {fid} does not exist or is not an active fulfillment account. Nothing was seeded.';
  end if;
  if (select coalesce(is_demo, false) from public.profiles where id = '{fid}')
     is distinct from (select coalesce(is_demo, false) from public.profiles where id = '{TEST_AGENT}') then
    raise exception 'Sample seed stopped: the fulfillment account and the test agent are on different demo sides.';
  end if;
end $chk$;""",
        '',
        '-- Wipe earlier sample rows first (same statements as wipe_agent_sample.py).',
        WIPE_BODY,
        '',
        '-- These have no skip setting and can reach another person. Off for this transaction only.',
    ]
    out += [f'alter table public.{t} disable trigger {g};' for t, g in DISABLED_TRIGGERS]
    out.append('')
    counts = {}
    for tables, table, cols, rows, extra in steps:
        counts[table] = len(rows)
        out.append(guarded(tables, insert_sql(table, cols, rows) + extra, SKIPPED_PAGES[table] + '.'))
        out.append('')

    out.append(f"""-- The flagged clients must read {TARGET_TEXT}, or nothing above is kept.
do $stages$
declare
  v_read text;
begin
  {stage_counts_sql(' and is_sample')} into v_read;
  if v_read is distinct from '{TARGET_TEXT}' then
    raise exception 'Sample seed stopped: the flagged clients read % (setting up/protected/needs attention/ongoing/ended), not {TARGET_TEXT}. Nothing was seeded.', v_read;
  end if;
end $stages$;""")
    out.append('')
    out += [f'alter table public.{t} enable trigger {g};' for t, g in DISABLED_TRIGGERS]
    out.append('')
    tables_sql = ', '.join(q(t) for t in SEEDED_TABLES)
    out.append(f"""-- Row counts per table (sample rows only).
do $sum$
declare
  t text;
  n bigint;
begin
  foreach t in array array[{tables_sql}] loop
    if pg_temp.has_sample(t) then
      execute format('select count(*) from public.%I where is_sample', t) into n;
      raise notice 'sample %: %', t, n;
    else
      raise notice 'skipped %: no is_sample column', t;
    end if;
  end loop;
end $sum$;""")
    out += ['', 'commit;', '']
    return '\n'.join(out), dict(steps=steps, counts=counts, plan=plan, requests=requests)


# ── the door file ───────────────────────────────────────────────────────────

CLIENT_KEY_SQL = ("md5(pol.agent_id::text || '|' || coalesce(nullif(right(regexp_replace(coalesce(pol.client_phone, ''), '\\D', '', 'g'), 10), ''), pol.id::text)\n"
                  "             || '|' || lower(btrim(regexp_replace(coalesce(pol.client_first_name, '') || ' ' || coalesce(pol.client_last_name, ''), '\\s+', ' ', 'g'))))")


def audit_names():
    """The table.trigger and cron.job names listed in trigger-audit.md."""
    if not os.path.exists(AUDIT_FILE):
        raise SystemExit(f'{AUDIT_FILE} is missing; the door file checks the live triggers against it.')
    with open(AUDIT_FILE, encoding='utf-8') as f:
        return sorted(set(f'{a}.{b}' for a, b in re.findall(r'^\| `([\w-]+)` \| `([\w-]+)` \|', f.read(), re.M)))


def pre_check_sql():
    return f"""with p as (
  select pol.id, pol.status::text as status, pol.client_first_name, pol.client_last_name, pol.created_at, pol.notes,
         coalesce((to_jsonb(pol) ->> 'is_sample')::boolean, false) as flagged,
         {CLIENT_KEY_SQL} as client_key
    from public.policies pol
   where pol.agent_id = '{TEST_AGENT}'
), flags(flagged) as (values (true), (false))
select 'a. all policies' as what, case when f.flagged then 'flagged' else 'unflagged' end as flag, '(all)' as status,
       count(p.id)::int as policies, count(distinct p.client_key)::int as clients, null::uuid as id, null::text as detail
  from flags f left join p on p.flagged = f.flagged
 group by f.flagged
union all
select 'b. by status', case when p.flagged then 'flagged' else 'unflagged' end, p.status,
       count(*)::int, count(distinct p.client_key)::int, null, null
  from p group by p.flagged, p.status
union all
select 'c. unflagged policy: survives the wipe, Brayden decides', 'unflagged', p.status, null, null, p.id,
       p.client_first_name || ' ' || p.client_last_name || ', created ' || p.created_at::date
  from p where not p.flagged
union all
select 'd. migrations', null, null, null, null, null,
       '186 is_sample: ' || (exists (select 1 from pg_attribute where attrelid = 'public.policies'::regclass and attname = 'is_sample' and not attisdropped))::text
       || ', 193 agent_clients: ' || (to_regclass('public.agent_clients') is not null)::text
union all
select 'e. active fulfillment account to pick from', case when pr.is_demo then 'demo side' else 'real side' end, null, null, null, pr.id, pr.full_name || ' <' || pr.email || '>'
  from public.profiles pr
 where pr.role::text = 'fulfillment' and pr.is_active
union all
select 'f. flagged policy with no sample note: stop, it may be real', 'flagged', p.status, null, null, p.id,
       p.client_first_name || ' ' || p.client_last_name || ', created ' || p.created_at::date
  from p where p.flagged and coalesce(p.notes, '') !~* 'sample'
 order by 1, 2, 3, 7;"""


def trigger_list_sql():
    names = ', '.join(q(n) for n in audit_names())
    tables = ', '.join(q(t) for t in SEEDED_TABLES)
    return f"""with audited(name) as (select unnest(array[{names}]))
select 'trigger' as kind, c.relname::text as on_table, t.tgname::text as name, t.tgenabled::text as enabled,
       pg_get_triggerdef(t.oid) as definition,
       case when exists (select 1 from audited a where a.name = c.relname || '.' || t.tgname) then 'in the audit'
            else 'NOT IN THE AUDIT: read it before running section 3' end as audit
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and not t.tgisinternal and c.relname = any (array[{tables}])
union all
select 'cron', null, j.jobname::text, j.active::text, j.command,
       case when exists (select 1 from audited a where a.name = 'cron.' || j.jobname) then 'in the audit'
            else 'NOT IN THE AUDIT: read it before running section 3' end
  from cron.job j
 order by 1, 2, 3;"""


def post_check_sql():
    return f"""with counts as (
  select ({stage_counts_sql('')}) as page_reads,
         ({stage_counts_sql(' and is_sample')}) as samples_read,
         (select count(*) from public.policies where agent_id = '{TEST_AGENT}' and not is_sample) as unflagged_policies,
         (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where not t.tgisinternal and t.tgenabled <> 'O' and c.relnamespace = 'public'::regnamespace
             and c.relname = any (array[{', '.join(q(t) for t in sorted(set(x for x, _ in DISABLED_TRIGGERS)))}])) as triggers_off
)
select case
         when samples_read <> '{TARGET_TEXT}' then 'FAILED: the sample clients read ' || samples_read || ', not {TARGET_TEXT}. Do not use these pages. Tell Brayden.'
         when triggers_off > 0 then 'FAILED: ' || triggers_off || ' trigger(s) are not enabled. Tell Brayden now.'
         when page_reads <> '{TARGET_TEXT}' then 'FAILED: the pages read ' || page_reads || ', not {TARGET_TEXT}, because ' || unflagged_policies || ' unflagged policies survived the wipe. The samples alone read ' || samples_read || '.'
         else 'PASS: the pages read {TARGET_TEXT} (setting up/protected/needs attention/ongoing/ended).'
       end as result,
       page_reads, samples_read, unflagged_policies, triggers_off
  from counts;"""


def build_door(fid):
    sql, _ = build_seed(fid)
    placeholder = fid == PLACEHOLDER_FULFILLMENT_ID
    return '\n'.join([
        "-- Replace the test agent's samples: the file behind the door item.",
        '-- Generated by: python scripts/seed_agent_sample.py --door qa/servicing-seed/door-dry-run.sql. Do not edit by hand.',
        '--',
        '-- NOT RUN. The robot that wrote it does not connect to Ohvara. Brayden said yes at the door: a manager reads the',
        '-- counts, then wipes and re-seeds the test agent only, stopping if anything unexpected shows up.',
        f'-- Test agent only ({TEST_AGENT}). Needs migrations 186 and 193 on live: section 3 stops by itself without them.',
        '-- Run one section at a time: the Supabase SQL editor shows only the last result of what it runs.',
        '-- Sections 1, 2 and 4 are one read-only statement each. Section 3 is one transaction.',
        '--',
        '-- Put the counts from section 1 on the door item. Do not run section 3, and tell Brayden, if:',
        '--   section 1 row a shows any unflagged policy. Row c lists the ids. They survive the wipe and spoil the 13, so he decides on them;',
        '--   section 1 row d reads false for 186 or 193;',
        '--   section 1 row f lists anything. is_sample is writable by anyone who can write the row, so that policy may be real;',
        '--   section 1 row e holds no account that is clearly the test fulfillment login. Never use a real rep;',
        '--   section 2 shows NOT IN THE AUDIT, or a trigger whose enabled column is not O. Section 3 would turn a disabled one back on.',
        '-- If section 4 does not start with PASS, stop and tell Brayden.',
        '--',
        *([f'-- BEFORE SECTION 3: replace every {PLACEHOLDER_FULFILLMENT_ID} with the test fulfillment account id (section 1, row e).',
           '-- Left as it is, section 3 stops at its first check and nothing changes.'] if placeholder else []),
        '',
        '-- ===== SECTION 1: read-only pre-check. These are the real live counts for the door item.',
        pre_check_sql(),
        '',
        '-- ===== SECTION 2: read-only list of live triggers and cron jobs. PGlite only replays migration files, so drift shows here.',
        trigger_list_sql(),
        '',
        '-- ===== SECTION 3: the wipe and the seed, in one transaction.',
        '-- Unflagged rows survive the wipe. The disable and enable lines for 3 triggers are in here, around the inserts.',
        sql.rstrip('\n'),
        '',
        f'-- ===== SECTION 4: read-only post-seed check. The result column must start with PASS and read {TARGET_TEXT}.',
        post_check_sql(),
        '',
    ])


# ── offline checks ──────────────────────────────────────────────────────────

def check_clients(errors):
    """The client set itself: the shape the spec asks for."""
    got = {s: sum(1 for c in CLIENTS if c['stage'] == s) for s in STAGES}
    if got != STAGE_TARGET or len(CLIENTS) != 13:
        errors.append(f'clients by stage are {got}, not {STAGE_TARGET}')
    if sum(1 for c in CLIENTS if len(c['policies']) >= 2) < 2:
        errors.append('fewer than 2 clients hold 2 policies')
    with_lead = [c for c in CLIENTS if c.get('lead')]
    if len(with_lead) < 3 or len(CLIENTS) - len(with_lead) < 3:
        errors.append('need at least 3 clients from leads and 3 existing clients with no lead')
    setup = [c['policies'][0] for c in CLIENTS if c['stage'] == 'setting_up']
    if not ({True, False} <= {p['replaced'] for p in setup}):
        errors.append('setting-up clients must cover replaced_old_policy true and false')
    if not any(p['cancelled'] for c in CLIENTS if c['stage'] == 'protected' for p in c['policies']):
        errors.append('no protected client has its old policy cancelled')
    requests = [c for c in CLIENTS if any(t['by'] != 'system' and t['status'] not in ('done', 'cancelled') for p in c['policies'] for t in p['tasks'])]
    if [c['stage'] for c in requests] != ['protected', 'protected']:
        errors.append(f"open requests must be on exactly 2 protected clients: {[c['key'] for c in requests]}")
    tasks = {c['key']: [t for p in c['policies'] for t in p['tasks']] for c in CLIENTS}
    outcomes = sorted(t['outcome'] for ts in tasks.values() for t in ts if t.get('outcome'))
    if outcomes != ['lapsed', 'saved']:
        errors.append(f'outcomes are {outcomes}, not one saved and one ended')
    if not any(t['kind'] == 'lapse_save' and t['status'] != 'done' for t in tasks['kevin']):
        errors.append('no client has an open lapse_save')
    if not {c.get('lead') for c in with_lead} <= {l[0] for l in LEADS}:
        errors.append('a client points at a lead that does not exist')


def run_seed_checks(sql, info, fid):
    errors = []
    check_transaction(sql, errors)
    check_deletes(sql, errors)
    check_no_secrets(sql, errors)
    check_clients(errors)
    body = strip_comments(sql)
    if "set local ohvara.skip_assign_notify = 'on';" not in body:
        errors.append('skip_assign_notify is not set')
    if 'does not exist or is not an active fulfillment account' not in body:
        errors.append('missing-fulfillment-account raise is missing')
    if 'insert into' not in body or body.index('do $chk$') > body.index('insert into'):
        errors.append('the fulfillment check does not come before the inserts')
    if TEST_AGENT not in AGENT_ALLOWLIST or len(AGENT_ALLOWLIST) != 1:
        errors.append('agent allowlist is not exactly the test agent')

    # The seed marks nothing it did not insert: the only update is the trigger's own events, by sample id.
    updates = re.findall(r'\bupdate\s+(?:public\.)?(\w+)', body, re.I)
    if set(updates) != {'policy_events'}:
        errors.append(f'the seed updates more than the booked events: {sorted(set(updates))}')
    if re.search(r'p729|test client', body, re.I):
        errors.append('the seed still names the old P729 rows')

    # Triggers: disabled after the wipe and before the first insert, enabled before commit.
    first_insert = body.index('insert into') if 'insert into' in body else -1
    for t, g in DISABLED_TRIGGERS:
        off, on = f'alter table public.{t} disable trigger {g};', f'alter table public.{t} enable trigger {g};'
        if body.count(off) != 1 or body.count(on) != 1:
            errors.append(f'{g} is not disabled and enabled exactly once')
        elif not (body.index('do $wipe$') < body.index(off) < first_insert) or not (body.rindex('insert into') < body.index(on) < body.rindex('commit;')):
            errors.append(f'{g} is disabled or enabled in the wrong place')
    if re.search(r'\bdisable\s+trigger\s+all\b|session_replication_role', body, re.I):
        errors.append('the seed turns off more than the named triggers')
    if len(re.findall(r'\bdisable\s+trigger\b', body, re.I)) != len(DISABLED_TRIGGERS):
        errors.append('the seed disables a trigger that is not on the list')

    # Dates: all from SQL at run time.
    if "date_trunc('week', now())" not in body:
        errors.append("dates do not come from date_trunc('week', now())")
    if re.search(r"\b\d{4}-\d{2}-\d{2}\b", body):
        errors.append('the SQL holds a literal date')
    with open(os.path.abspath(__file__), encoding='utf-8') as f:
        src = f.read()
    if re.search(r'^\s*(import|from)\s+(datetime|time|calendar)\b', src, re.M):
        errors.append("the generator imports a clock; dates must come from SQL")

    # Every insert sits in a block guarded on its own table's is_sample column.
    blocks = re.findall(r'do \$s\$(.*?)end \$s\$;', body, re.S)
    guarded_inserts = 0
    for b in blocks:
        cond = b.split('then', 1)[0]
        guards = set(re.findall(r"pg_temp\.has_sample\('(\w+)'\)", cond))
        for t in re.findall(r'insert into public\.(\w+)', b):
            guarded_inserts += 1
            if t not in guards:
                errors.append(f'insert into {t} is not behind its is_sample guard')
    if guarded_inserts != len(re.findall(r'insert into', body)):
        errors.append('an insert sits outside a guarded block')

    # Row-level checks on the text: every row ends with is_sample = true.
    for table, cols_txt, rows_txt in re.findall(r'insert into public\.(\w+) \(([^)]*)\) values\n(.*?;)\n', body, re.S):
        cols = [c.strip() for c in cols_txt.split(',')]
        if cols[-1] != 'is_sample':
            errors.append(f'{table} insert does not set is_sample')
        for line in rows_txt.strip().split('\n'):
            if not re.search(r', true\)[,;]$', line.strip()):
                errors.append(f'{table} row does not set is_sample true: {line.strip()[:60]}')
            if TEST_AGENT not in line and table in ('policies', 'leads'):
                errors.append(f'{table} row without the test agent id')

    # Structured checks on the rows the SQL was built from.
    sweep_null = ['scheduled_call_at', 'next_lapse_check_at', 'recovery_phase', 'recovery_step', 'recovery_next_kind', 'recovery_next_at']
    for tables, table, cols, rows, _ in info['steps']:
        for r in rows:
            if r.get('is_sample') is not True:
                errors.append(f'{table} row without is_sample true')
            for c in ('agent_id', 'assigned_rep_id', 'transfer_agent_id'):
                if c in r and r[c] != TEST_AGENT:
                    errors.append(f'{table}.{c} is not the test agent')
            if table == 'policies':
                who = f"{r['client_first_name']} {r['client_last_name']}"
                for c in sweep_null:
                    if c not in cols or r.get(c) is not None:
                        errors.append(f'{who}: {c} must be written as null')
                if r.get('last_call_outcome') is not None:
                    errors.append(f'{who}: last_call_outcome must be null')
                if r['sms_consent'] is not False:
                    errors.append(f'{who}: sms_consent is not false')
                if r['fulfillment_assigned'] is not True:
                    errors.append(f'{who}: not fulfillment_assigned')
                if r['replaced_old_policy'] is False:
                    if r.get('assigned_fulfillment_id') or r.get('carrier_name'):
                        errors.append(f'{who}: no old policy, so no rep or carrier_name (187 refuses them)')
                elif r.get('assigned_fulfillment_id') != fid:
                    errors.append(f'{who}: an old policy with no explicit --fulfillment-id rep, so autoassign could pick a real one')
                m = re.fullmatch(r"pg_temp\.wk_start\(\) - interval '(\d+) days'", r['created_at'])
                if not m or int(m.group(1)) < MIN_AGE_DAYS:
                    errors.append(f"{who}: created_at {r['created_at']} is not at least {MIN_AGE_DAYS} days before date_trunc('week', now())")
                elif r.get('fulfillment_completed_at') and int(m.group(1)) - 2 < MIN_AGE_DAYS:
                    errors.append(f'{who}: its cancel is dated inside last Monday summary')
            if table == 'leads' and not (r.get('assigned_rep_id') and r.get('lead_type') and r.get('lead_source')
                                         and r.get('delivered_at')):
                errors.append('lead without assigned_rep_id, lead_type, lead_source or delivered_at')
            if table == 'lead_sms_replies' and (not r.get('handled_at') or not str(r['twilio_sid']).startswith('SAMPLE-')):
                errors.append('lead_sms_replies row without handled_at or a SAMPLE- sid')
            if table == 'policy_events' and r['kind'] not in ('in_progress', 'cancelled', 'submitted', 'service_request'):
                errors.append(f"policy_events kind {r['kind']} should not be seeded")
            if table == 'policy_messages' and r['sender_id'] not in (TEST_AGENT, fid):
                errors.append('policy_messages sender is not the test agent or the fulfillment account')
            if table == 'servicing_tasks' and r.get('requested_by') not in ('agent', 'client', 'system'):
                errors.append('servicing_tasks row without requested_by')
            if table == 'servicing_tasks' and r['status'] == 'done' and not r.get('done_at'):
                errors.append('a done task without done_at')
    rows_of = {t: rows for _, t, _, rows, _ in info['steps']}
    statuses = {r['agent_status'] for r in rows_of['leads']}
    if statuses != {'assigned', 'contacted', 'closed', 'bad'}:
        errors.append(f'leads do not cover all four agent_status values: {statuses}')
    if sum(1 for r in rows_of['leads'] if r.get('client_policy_id')) < 3:
        errors.append('fewer than 3 leads are linked with client_policy_id')
    policy_ids = {r['id'] for r in rows_of['policies']}
    if not {r['client_policy_id'] for r in rows_of['leads'] if r.get('client_policy_id')} <= policy_ids:
        errors.append('a lead points at a policy that is not seeded')
    if re.search(r"'rescheduling'", body):
        errors.append("'rescheduling' is not an allowed policy_events kind")

    # Phones and agent ids anywhere in the SQL.
    for p in re.findall(r"'(\+?\d[\d\-]{6,})'", body):
        if not PHONE_RE.match(p) and not UUID_RE.match(p):
            errors.append(f'phone {p} is outside +1555010xxxx')
    for col in ('agent_id', 'assigned_rep_id', 'transfer_agent_id', 'handled_by'):
        for v in re.findall(col + r" = '([0-9a-f-]{36})'", body):
            if v != TEST_AGENT:
                errors.append(f'{col} = {v} is not the test agent')
    if re.search(r'\b(meta|facebook|google)\b', body, re.I):
        errors.append('SQL mentions Meta, Google or Facebook')
    for t in CASCADED:
        if re.search(rf'delete\s+from\s+(public\.)?{t}\b', body, re.I):
            errors.append(f'direct delete from {t}')
    return errors


def run_negative_checks(sql, info, fid):
    """The checks must FAIL on broken copies of the SQL. Returns errors if they don't."""
    errors = []
    breaks = {
        'an enable line removed': lambda s: s.replace(f'alter table public.{DISABLED_TRIGGERS[0][0]} enable trigger {DISABLED_TRIGGERS[0][1]};\n', '', 1),
        'a disable line removed': lambda s: s.replace(f'alter table public.{DISABLED_TRIGGERS[0][0]} disable trigger {DISABLED_TRIGGERS[0][1]};\n', '', 1),
        'a marking update added': lambda s: s.replace('commit;', "update public.policies set is_sample = true where agent_id = 'x';\ncommit;", 1),
        'a real phone added': lambda s: s.replace('+15550100100', '+12145550100', 1),
        'a literal date added': lambda s: s.replace("interval '12 days'", "interval '12 days' + date '2026-11-02' - date '2026-11-02'", 1),
    }
    for name, mutate in breaks.items():
        broken = mutate(sql)
        if broken == sql:
            errors.append(f'negative check: {name} changed nothing')
        elif not run_seed_checks(broken, info, fid):
            errors.append(f'negative check: SQL with {name} was NOT rejected')
    return errors


def print_summary(info, stream):
    print('Sample seed summary (rows written when every table has is_sample):', file=stream)
    for t, n in info['counts'].items():
        print(f'  {t:28} {n:3}', file=stream)
    print(f'  clients                      {len(CLIENTS):3}  stages {TARGET_TEXT} (' + ', '.join(STAGES) + ')', file=stream)
    print('Skipped at run time if the table has no is_sample column (NOTICE in the SQL output), and what stays empty:',
          file=stream)
    for t, pages in SKIPPED_PAGES.items():
        print(f'  {t:28} {pages}', file=stream)
    print('Always empty, by design or by schema:', file=stream)
    print("  policy_events 'rescheduling'  not an allowed kind since migrations 121/134/142, so none is seeded", file=stream)
    print('  lead_sms_replies, lead_followup_sms_log  closed to signed-in users today: rows exist, the lead '
          'detail texts stay empty', file=stream)
    print('  client texts                  no table to seed; policy_messages is agent-to-rep chat, not client texts',
          file=stream)


def main():
    ap = argparse.ArgumentParser(description='Generate the one-transaction sample seed for the test agent (SQL only).')
    ap.add_argument('--fulfillment-id', help='uuid of the test fulfillment account')
    ap.add_argument('--agent-id', default=TEST_AGENT, help='only the test agent is accepted')
    ap.add_argument('--out', help='write the SQL to this file instead of stdout')
    ap.add_argument('--check', action='store_true', help='build the SQL and run the offline checks')
    ap.add_argument('--door', help='write the door file (read-only checks around the seed) to this path')
    args = ap.parse_args()

    if args.agent_id not in AGENT_ALLOWLIST:
        ap.error(f'{args.agent_id} is not on the allowlist; only the test agent {TEST_AGENT} may get sample data')
    fid = args.fulfillment_id or (PLACEHOLDER_FULFILLMENT_ID if args.check or args.door else None)
    if not fid:
        ap.error('--fulfillment-id is required')
    try:
        fid = str(uuid.UUID(fid))
    except ValueError:
        ap.error('--fulfillment-id must be a uuid')
    if fid == TEST_AGENT:
        ap.error('--fulfillment-id must be the test fulfillment account, not the test agent')

    sql, info = build_seed(fid, args.agent_id)
    if args.check:
        errors = run_seed_checks(sql, info, fid) + run_negative_checks(sql, info, fid)
        for e in errors:
            print('FAIL:', e)
        print_summary(info, sys.stdout)
        if errors:
            sys.exit(1)
        print('all checks passed')
        return
    if args.door:
        with open(args.door, 'w', encoding='utf-8', newline='\n') as f:
            f.write(build_door(fid))
        print(f'wrote {args.door}', file=sys.stderr)
        return
    if args.out:
        with open(args.out, 'w', encoding='utf-8', newline='\n') as f:
            f.write(sql)
        print(f'wrote {args.out}', file=sys.stderr)
    else:
        sys.stdout.reconfigure(newline='\n')
        sys.stdout.write(sql)
    print_summary(info, sys.stderr)


if __name__ == '__main__':
    main()
