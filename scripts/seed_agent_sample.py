"""Print ONE SQL transaction that fills the test agent's pages with sample data.

Generates SQL only. It never connects to the database, needs no key and has
no dependencies. Running the SQL is a separate, checked step at the door
(the Supabase SQL editor, as the service role); nothing here runs it.

  python scripts/seed_agent_sample.py --fulfillment-id <uuid> [--out seed.sql]
  python scripts/seed_agent_sample.py --check     # offline checks only

TEST AGENT ONLY. The agent is hard-coded (an allowlist of one); --agent-id
exists only to refuse any other account. Brayden's own account is out: fake
sales there would count in real leaderboards (090 excludes only the test
agent). --fulfillment-id is the test fulfillment account; every booking is
pre-assigned to it, so auto-assign (116/156) never hands one to a real rep.

What the transaction does, in order:
  begin; set local ohvara.skip_assign_notify = 'on' (no 'New call booked'
  bell or email, 146/116); stop if the fulfillment account is missing, not
  an active fulfillment account, or on the other demo side from the test
  agent (156's demo guard would drop the assignment); wipe earlier sample
  rows (the same statements as wipe_agent_sample.py, so a re-run never
  doubles up); insert with fixed uuid5 ids; mark the 12 P729 bookings
  is_sample; print row counts; commit.

Every insert sits in a block that runs only when its table (and its
parent) exists and has an is_sample column; otherwise the WHOLE table is
skipped with a NOTICE. Every inserted row sets is_sample = true.

Traps handled (read before changing):
  - policy_events is a permanent record (153): never deleted directly, only
    by the cascade from policies. The 'booked' row the insert trigger writes
    (118) has at = now(), the only moment it may be updated; the seed then
    backdates it and marks it is_sample in the same transaction.
  - 'rescheduling' is no longer an allowed policy_events kind (121, 134,
    142); the allowed kinds are seeded instead.
  - created_at is before this week's Monday, so the 16-a-week meter (146)
    doesn't move. The booking-rule trigger (147) is skipped for the SQL
    editor (no auth.uid()).
  - No recovery_next_kind / recovery_next_at and sms_consent stays false, so
    the recovery sweep (122) never picks a sample booking up to text it.
  - Every lead has assigned_rep_id = the test agent, so none reaches the VA
    queue (175). agent_status follows inbound_stage (180), so both are set to
    agree. lead_sms_replies all have handled_at (none in the VA reply queue).
  - A re-run's wipe also removes the 12 P729 bookings marked by the first
    run; they are sample data too.

Phones are +1555010xxxx (fiction range), no emails, fake names only.
Appointment days are Monday-Friday of the week the SQL runs in (computed in
SQL, America/Chicago week). Past calls are clamped before now() and upcoming
ones after it, so run it Monday-Friday for the intended mix.
"""
import argparse
import re
import sys
import uuid

from wipe_agent_sample import (
    WIPE_BODY, HELPERS, CASCADED, check_transaction, check_deletes,
    check_no_secrets, strip_comments,
)

TEST_AGENT = '3f2b2df7-40b1-4921-80e2-09981c819642'
AGENT_ALLOWLIST = {TEST_AGENT}
CHECK_FULFILLMENT_ID = '00000000-0000-4000-8000-00000000f001'  # placeholder for --check only
NS = uuid.UUID('6d1f6f0e-6a53-5c8e-9a4e-0a7a5e5a0001')
EVENT_KINDS = ['booked', 'in_progress', 'no_answer', 'cancelled', 'moved']
PHONE_RE = re.compile(r'^\+1555010\d{4}$')
SAMPLE_NOTE = 'SAMPLE DATA (seed_agent_sample.py) - fake client, safe to delete'
P729_WHERE = (f"agent_id = '{TEST_AGENT}' and client_first_name = 'Test Client' "
              "and notes like 'P729 SAMPLE DATA%'")


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


def wk(day, hhmm, tz):
    return Raw(f"pg_temp.wk_local({day}, '{hhmm}', '{tz}')")


# ── bookings ────────────────────────────────────────────────────────────────
# (key, first, last, city, st, tz, kind, day 0=Mon..4=Fri, local time, carrier)
POLICIES = [
    ('b1', 'Maria', 'Alvarez', 'San Antonio', 'TX', 'America/Chicago', 'booked', 3, '10:00', 'Mutual of Omaha'),
    ('b2', 'James', 'Whitfield', 'Columbus', 'OH', 'America/New_York', 'booked', 4, '11:30', 'Transamerica'),
    ('b3', 'Denise', 'Carter', 'Birmingham', 'AL', 'America/Chicago', 'booked', 2, '14:00', 'Americo'),
    ('b4', 'Robert', 'Nguyen', 'Phoenix', 'AZ', 'America/Phoenix', 'booked', 4, '13:00', 'Foresters'),
    ('l1', 'Angela', 'Brooks', 'Memphis', 'TN', 'America/Chicago', 'live', None, None, 'Mutual of Omaha'),
    ('n1', 'Kevin', 'Patterson', 'Jacksonville', 'FL', 'America/New_York', 'no_answer', 1, '10:30', 'Americo'),
    ('n2', 'Linda', 'Moreno', 'Tulsa', 'OK', 'America/Chicago', 'no_answer_plain', 2, '15:00', 'Transamerica'),
    ('c1', 'Gary', 'Simmons', 'Louisville', 'KY', 'America/New_York', 'confirm', 0, '13:30', 'Foresters'),
    ('a1', 'Theresa', 'Holt', 'Little Rock', 'AR', 'America/Chicago', 'attention', 1, '09:30', 'Mutual of Omaha'),
    ('x1', 'Michael', 'Reyes', 'El Paso', 'TX', 'America/Denver', 'cancelled', 0, '11:00', 'Americo'),
    ('x2', 'Patricia', 'Dunn', 'Richmond', 'VA', 'America/New_York', 'cancelled', 2, '16:00', 'Transamerica'),
]
BENEFICIARIES = ['Carlos Alvarez', 'Ruth Whitfield', 'Marcus Carter', 'Lily Nguyen', 'Dwayne Brooks',
                 'Sharon Patterson', 'Rosa Moreno', 'Diane Simmons', 'Paul Holt', 'Elena Reyes', 'Thomas Dunn']
RELATIONS = ['Spouse', 'Spouse', 'Son', 'Daughter', 'Spouse', 'Spouse', 'Daughter', 'Spouse', 'Son', 'Spouse', 'Spouse']


def build_policies(fid):
    cols = ['id', 'agent_id', 'client_first_name', 'client_last_name', 'client_phone', 'status', 'notes',
            'created_at', 'fulfillment_assigned', 'fulfillment_stage', 'scheduled_call_at', 'call_attempts',
            'client_city', 'state', 'client_timezone', 'assigned_fulfillment_id', 'fulfillment_claimed_at',
            'fulfillment_started_at', 'fulfillment_completed_at', 'call_live_since', 'last_call_outcome',
            'last_call_at', 'recovery_phase', 'recovery_step', 'recovery_text1_sent_at', 'recovery_text2_sent_at',
            'recovery_am_sent_at', 'recovery_pm_sent_at', 'recovery_handoff_at', 'cancellation_confirmation',
            'is_sample']
    rows, meta = [], []
    for i, (key, first, last, city, st, tz, kind, day, hhmm, carrier) in enumerate(POLICIES):
        created = Raw(f"pg_temp.wk_start() - interval '{30 + i * 5} hours'")
        r = dict(id=sid('policy', key), agent_id=TEST_AGENT, client_first_name=first, client_last_name=last,
                 client_phone=phone(100 + i), status='Submitted', notes=SAMPLE_NOTE, created_at=created,
                 fulfillment_assigned=True, fulfillment_stage='Pending', call_attempts=0, client_city=city,
                 state=st, client_timezone=tz, assigned_fulfillment_id=fid, fulfillment_claimed_at=created)
        if kind == 'booked':
            sched = Raw(f"greatest(now() + interval '{2 + i} hours', {wk(day, hhmm, tz)})")
        elif kind == 'live':
            sched = Raw("now() - interval '8 minutes'")
        else:
            sched = Raw(f"least(now() - interval '{3 + i} hours', {wk(day, hhmm, tz)})")
        r['scheduled_call_at'] = sched
        ended = Raw(f"({sched}) + interval '6 minutes'")
        if kind == 'live':
            r.update(fulfillment_stage='In Progress', call_attempts=1, call_live_since=Raw("now() - interval '6 minutes'"),
                     fulfillment_started_at=Raw("now() - interval '6 minutes'"))
        elif kind in ('no_answer', 'no_answer_plain', 'confirm', 'attention'):
            r.update(fulfillment_stage='In Progress', call_attempts=1 if kind != 'no_answer_plain' else 2,
                     fulfillment_started_at=Raw(f"({sched}) + interval '1 minute'"),
                     last_call_outcome='no_answer', last_call_at=ended)
            if kind != 'no_answer_plain':
                r.update(recovery_phase=1, recovery_text1_sent_at=Raw(f"({sched}) + interval '10 minutes'"))
            if kind == 'no_answer':
                r.update(recovery_step='followup', recovery_am_sent_at=Raw(f"({sched}) + interval '2 hours'"))
            if kind == 'confirm':
                r.update(recovery_step='number_check', recovery_text2_sent_at=Raw(f"({sched}) + interval '1 hour'"))
            if kind == 'attention':
                r.update(recovery_step='call_directly', recovery_am_sent_at=Raw(f"({sched}) + interval '1 hour'"),
                         recovery_pm_sent_at=Raw(f"({sched}) + interval '2 hours'"),
                         recovery_handoff_at=Raw(f"({sched}) + interval '2 hours 30 minutes'"))
        elif kind == 'cancelled':
            r.update(fulfillment_stage='Complete', call_attempts=1,
                     fulfillment_started_at=Raw(f"({sched}) + interval '1 minute'"),
                     fulfillment_completed_at=Raw(f"({sched}) + interval '24 minutes'"),
                     cancellation_confirmation=f'SAMPLE-CXL-{1001 + i}')
        r['is_sample'] = True
        rows.append(r)
        meta.append(dict(key=key, kind=kind, day=day, hhmm=hhmm, tz=tz, sched=sched, created=created,
                         row=r, carrier=carrier, name=f'{first} {last}', i=i))
    return cols, rows, meta


def build_details(meta):
    cols = ['policy_id', 'full_legal_name', 'state_of_residence', 'address_city', 'address_state',
            'current_carrier', 'beneficiary_name', 'beneficiary_relationship', 'draft_day', 'is_sample']
    rows = [dict(policy_id=m['row']['id'], full_legal_name=m['name'], state_of_residence=m['row']['state'],
                 address_city=m['row']['client_city'], address_state=m['row']['state'], current_carrier=m['carrier'],
                 beneficiary_name=BENEFICIARIES[m['i']], beneficiary_relationship=RELATIONS[m['i']],
                 draft_day=[1, 3, 5, 15, 20, 28][m['i'] % 6], is_sample=True) for m in meta]
    return cols, rows


def build_events(meta, fid):
    """Events beyond the trigger's 'booked' row. All in the past."""
    rep_name = Raw(f"(select coalesce(nullif(btrim(full_name), ''), 'Sample Rep') from public.profiles where id = '{fid}')")
    cols = ['id', 'policy_id', 'agent_id', 'kind', 'from_status', 'actor_id', 'actor_name', 'actor_role',
            'detail', 'at', 'is_sample']
    rows = []

    def ev(m, n, kind, frm, detail, at):
        rows.append(dict(id=sid('event', f"{m['key']}:{n}"), policy_id=m['row']['id'], agent_id=TEST_AGENT,
                         kind=kind, from_status=frm, actor_id=fid, actor_name=rep_name, actor_role='fulfillment',
                         detail=Raw(f"jsonb_build_object({detail})"),
                         at=Raw(f"least(now() - interval '1 minute', {at})"), is_sample=True))

    for m in meta:
        s, k = m['sched'], m['kind']
        if k == 'live':
            ev(m, 1, 'in_progress', 'booked', "'attempt', 1", "now() - interval '6 minutes'")
        elif k in ('no_answer', 'no_answer_plain', 'confirm', 'attention'):
            ev(m, 1, 'in_progress', 'booked', "'attempt', 1", f"({s}) + interval '1 minute'")
            ev(m, 2, 'no_answer', 'in_progress', "'attempt', 1", f"({s}) + interval '6 minutes'")
        elif k == 'cancelled':
            conf = m['row']['cancellation_confirmation']
            ev(m, 1, 'in_progress', 'booked', "'attempt', 1", f"({s}) + interval '1 minute'")
            ev(m, 2, 'cancelled', 'in_progress', f"'confirmation', '{conf}'", f"({s}) + interval '24 minutes'")
        elif m['key'] in ('b2', 'b4'):
            ev(m, 1, 'moved', None, f"'from', ({m['created']}) + interval '2 days', 'to', ({s})",
               f"({m['created']}) + interval '20 hours'")
    return cols, rows


MESSAGES = [
    ('b1', 'agent', 'Maria prefers mornings. Her daughter may join the call.'),
    ('b1', 'rep', 'Got it, I will call at the booked time and ask for Maria first.'),
    ('n1', 'rep', 'No answer at the booked time. Texts are going out to rebook.'),
    ('n1', 'agent', 'Thanks. He works nights, so after 2 PM is best.'),
    ('x1', 'rep', 'Old policy is cancelled. Confirmation number is in the client notes.'),
    ('c1', 'agent', 'I double checked his number with him today, it is right.'),
]


def build_messages(meta, fid):
    by_key = {m['key']: m for m in meta}
    cols = ['id', 'policy_id', 'sender_id', 'sender_name', 'sender_role', 'body', 'created_at', 'is_sample']
    rows = []
    for n, (key, who, body) in enumerate(MESSAGES):
        m = by_key[key]
        sender = TEST_AGENT if who == 'agent' else fid
        rows.append(dict(id=sid('message', n), policy_id=m['row']['id'], sender_id=sender,
                         sender_name=Raw(f"(select coalesce(full_name, '') from public.profiles where id = '{sender}')"),
                         sender_role='agent' if who == 'agent' else 'fulfillment', body=body,
                         created_at=Raw(f"least(now() - interval '{30 - n * 4} minutes', ({m['created']}) + interval '{4 + n} hours')"),
                         is_sample=True))
    return cols, rows


# ── leads (inbounds) ────────────────────────────────────────────────────────
# (key, contact, city, st, lead_type, inbound_stage, hours ago)
LEADS = [
    ('m1', 'Carla Jennings', 'Macon', 'GA', 'mortgage_protection', 'new', 3),
    ('m2', 'Darnell Price', 'Shreveport', 'LA', 'mortgage_protection', 'contacting', 26),
    ('m3', 'Wendy Castillo', 'Lubbock', 'TX', 'mortgage_protection', 'sold', 120),
    ('h1', 'Frank Osei', 'Akron', 'OH', 'policy_help', 'new', 1),
    ('h2', 'Bonnie Lyle', 'Mobile', 'AL', 'policy_help', 'contacting', 50),
    ('h3', 'Victor Hale', 'Wichita', 'KS', 'policy_help', 'lost', 140),
    ('r1', 'Irene Pruitt', 'Knoxville', 'TN', 'policy_review', 'contacting', 70),
    ('r2', 'Samuel Ortega', 'Fresno', 'CA', 'policy_review', 'sold', 200),
]
AGENT_STATUS = {'new': 'assigned', 'contacting': 'contacted', 'sold': 'closed', 'lost': 'bad'}
QUALIFIERS = {
    'mortgage_protection': "'home_value', '250k-350k', 'smoker', false, 'best_time', 'evenings'",
    'policy_help': "'question', 'premium went up', 'has_policy', true",
    'policy_review': "'current_coverage', 'term life', 'years_held', 6",
}


def build_leads():
    cols = ['id', 'business_name', 'contact_name', 'phone', 'city', 'state', 'lead_type', 'lead_source',
            'assigned_rep_id', 'delivered_at', 'inbound_stage', 'agent_status', 'qualifier_answers', 'notes',
            'created_at', 'is_sample']
    rows, meta = [], []
    for i, (key, name, city, st, lt, stage, hrs) in enumerate(LEADS):
        created = Raw(f"now() - interval '{hrs} hours'")
        r = dict(id=sid('lead', key), business_name=name, contact_name=name, phone=phone(200 + i), city=city,
                 state=st, lead_type=lt, lead_source='referral', assigned_rep_id=TEST_AGENT,
                 delivered_at=Raw(f"now() - interval '{hrs} hours' + interval '2 minutes'"),
                 inbound_stage=stage, agent_status=AGENT_STATUS[stage],
                 qualifier_answers=Raw(f"jsonb_build_object({QUALIFIERS[lt]})"),
                 notes=SAMPLE_NOTE.replace('client', 'lead'), created_at=created, is_sample=True)
        rows.append(r)
        meta.append(dict(key=key, row=r, hrs=hrs, stage=stage, i=i))
    return cols, rows, meta


def build_replies(lmeta):
    cols = ['id', 'from_phone', 'body', 'twilio_sid', 'lead_id', 'received_at', 'handled_by', 'handled_at', 'is_sample']
    texts = {'m2': 'Yes this is Darnell, can you call after 5?', 'h2': 'Thanks, Thursday works for me.',
             'r1': 'I got your text, what do I need to have ready?'}
    rows = []
    for n, m in enumerate([m for m in lmeta if m['key'] in texts], start=1):
        at = f"now() - interval '{m['hrs'] - 1} hours'"
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
                         created_at=Raw(f"now() - interval '{m['hrs']} hours' + interval '1 minute'"), is_sample=True))
        if m['stage'] != 'new':
            rows.append(dict(id=sid('followup', f"{m['key']}:2"), lead_id=m['row']['id'],
                             stage='reached' if m['stage'] == 'sold' else 'not_reached', status='skipped_quiet_hours',
                             to_phone=m['row']['phone'], from_number=None, twilio_sid=None,
                             created_at=Raw(f"now() - interval '{m['hrs'] - 2} hours'"), is_sample=True))
    return cols, rows


def build_inbound_events(lmeta):
    cols = ['id', 'lead_id', 'agent_id', 'kind', 'state', 'at', 'label', 'detail', 'actor_name', 'actor_role',
            'created_at', 'is_sample']
    rows = []

    def ev(m, n, kind, label, hrs_after):
        at = Raw(f"now() - interval '{m['hrs']} hours' + interval '{hrs_after} hours'")
        rows.append(dict(id=sid('inbound', f"{m['key']}:{n}"), lead_id=m['row']['id'], agent_id=TEST_AGENT,
                         kind=kind, state='done', at=at, label=label, detail=Raw("'{}'::jsonb"),
                         actor_name='Test Agent' if kind in ('note', 'outcome') else None,
                         actor_role='agent' if kind in ('note', 'outcome') else None, created_at=at, is_sample=True))

    for m in lmeta:
        ev(m, 1, 'came_in', 'Came in', 0)
        if m['stage'] in ('contacting', 'sold', 'lost'):
            ev(m, 2, 'note', 'Left a voicemail, will try again tomorrow', 1)
        if m['stage'] in ('sold', 'lost'):
            ev(m, 3, 'outcome', 'Sold' if m['stage'] == 'sold' else 'Not interested', 3)
    return cols, rows


def build_tasks(lmeta):
    cols = ['id', 'agent_id', 'lead_id', 'kind', 'status', 'due_at', 'note', 'created_at', 'is_sample']
    rows = []
    for m in lmeta:
        if m['stage'] != 'sold':
            continue
        sold = f"now() - interval '{m['hrs'] - 3} hours'"
        for kind, days, status in (('packet_check', 7, 'scheduled'), ('review_call', 30, 'scheduled'),
                                   ('chargeback_watch', 365, 'requested')):
            rows.append(dict(id=sid('task', f"{m['key']}:{kind}"), agent_id=TEST_AGENT, lead_id=m['row']['id'],
                             kind=kind, status=status, due_at=Raw(f"{sold} + interval '{days} days'"),
                             note='Sample task', created_at=Raw(sold), is_sample=True))
    return cols, rows


def build_help_calls(lmeta):
    cols = ['id', 'call_sid', 'caller_number', 'status', 'end_reason', 'transfer_agent_id', 'outcome', 'lead_id',
            'created_at', 'answered_at', 'transferred_at', 'ended_at', 'is_sample']
    rows = []
    for n, m in enumerate([m for m in lmeta if m['row']['lead_type'] == 'policy_help'], start=1):
        t = f"now() - interval '{m['hrs']} hours'"
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
    'policies': 'My Pipeline, Clients, Overview, Activity and the phone Clients tab stay empty',
    'policy_fulfillment_details': 'the client detail sheet shows no carrier or beneficiary',
    'policy_events': 'Activity shows only the backdated booked rows',
    'policy_messages': 'Messages (agent and rep chat) stays empty',
    'leads': 'Leads, Inbounds, Calendar and the inbound detail stay empty',
    'lead_sms_replies': 'no reply texts on the inbound detail (signed-in users cannot read this table today anyway)',
    'lead_followup_sms_log': 'no follow-up text rows (signed-in users cannot read this table today anyway)',
    'inbound_events': 'the inbound timeline stays empty',
    'servicing_tasks': 'servicing tasks on Calendar, Today and More stay empty',
    'help_calls': 'no live-call log rows (agent pages do not read this table)',
}


def build_seed(fid, agent_id=TEST_AGENT):
    if agent_id not in AGENT_ALLOWLIST:
        raise SystemExit(f'Refused: {agent_id} is not the test agent. Only {TEST_AGENT} may get sample data.')
    pcols, prows, pmeta = build_policies(fid)
    dcols, drows = build_details(pmeta)
    ecols, erows = build_events(pmeta, fid)
    mcols, mrows = build_messages(pmeta, fid)
    lcols, lrows, lmeta = build_leads()
    rcols, rrows = build_replies(lmeta)
    fcols, frows = build_followups(lmeta)
    icols, irows = build_inbound_events(lmeta)
    tcols, trows = build_tasks(lmeta)
    hcols, hrows = build_help_calls(lmeta)
    ids = ', '.join(q(r['id']) for r in prows)

    plan = [  # (guard tables, table, cols, rows, extra statements after the insert)
        (['policies'], 'policies', pcols, prows, f"""
    -- Pre-assigned to the test fulfillment account; nothing may have moved it.
    if exists (select 1 from public.policies where id in ({ids})
                and assigned_fulfillment_id is distinct from '{fid}') then
      raise exception 'Sample seed stopped: a sample booking was not held by the test fulfillment account.';
    end if;
    -- The insert trigger (118) wrote one 'booked' event per booking at now(),
    -- the only time it may be changed (153). Backdate it to the booking.
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
        (['leads'], 'leads', lcols, lrows, ''),
        (['leads', 'lead_sms_replies'], 'lead_sms_replies', rcols, rrows, ''),
        (['leads', 'lead_followup_sms_log'], 'lead_followup_sms_log', fcols, frows, ''),
        (['leads', 'inbound_events'], 'inbound_events', icols, irows, ''),
        (['leads', 'servicing_tasks'], 'servicing_tasks', tcols, trows, ''),
        (['leads', 'help_calls'], 'help_calls', hcols, hrows, ''),
    ]

    out = [
        '-- Generated by scripts/seed_agent_sample.py. One transaction. Do not edit by hand.',
        f'-- Test agent only ({TEST_AGENT}); bookings held by fulfillment {fid}.',
        'begin;',
        "set local ohvara.skip_assign_notify = 'on';",
        '',
        HELPERS,
        '',
        '-- Monday 00:00 of this week, America/Chicago.',
        'create or replace function pg_temp.wk_start() returns timestamptz language sql stable as $$',
        "  select date_trunc('week', now() at time zone 'America/Chicago') at time zone 'America/Chicago'",
        '$$;',
        '-- Day d of this week (0 = Monday) at a local time in the client\'s timezone.',
        'create or replace function pg_temp.wk_local(d integer, t text, tz text) returns timestamptz language sql stable as $$',
        "  select ((date_trunc('week', now() at time zone 'America/Chicago')::date + d) + t::time) at time zone tz",
        '$$;',
        '',
        '-- No bookings without the test fulfillment account.',
        f"""do $chk$
begin
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
    ]
    counts = {}
    for tables, table, cols, rows, extra in plan:
        counts[table] = len(rows)
        out.append(guarded(tables, insert_sql(table, cols, rows) + extra, SKIPPED_PAGES[table] + '.'))
        out.append('')

    out.append('-- The 12 P729 bookings (supabase/seed/p729_sample_bookings.sql) become sample rows.')
    out.append('-- Their old policy_events are not touched; the wipe cascade clears them.')
    out.append(guarded(['policies'], f"""    update public.policies
       set is_sample = true,
           assigned_fulfillment_id = coalesce(assigned_fulfillment_id, '{fid}')
     where {P729_WHERE} and is_sample is not true;
    if pg_temp.has_sample('policy_fulfillment_details') then
      update public.policy_fulfillment_details set is_sample = true
       where is_sample is not true and policy_id in (select id from public.policies where {P729_WHERE});
    end if;""", 'P729 rows stay unmarked.'))
    out.append('')
    out.append("""-- Row counts per table (sample rows only).
do $sum$
declare
  t text;
  n bigint;
begin
  foreach t in array array['policies', 'policy_fulfillment_details', 'policy_events', 'policy_messages', 'leads',
                           'lead_sms_replies', 'lead_followup_sms_log', 'inbound_events', 'servicing_tasks', 'help_calls'] loop
    if pg_temp.has_sample(t) then
      execute format('select count(*) from public.%I where is_sample', t) into n;
      raise notice 'sample %: %', t, n;
    else
      raise notice 'skipped %: no is_sample column', t;
    end if;
  end loop;
end $sum$;""")
    out += ['', 'commit;', '']
    return '\n'.join(out), dict(plan=plan, counts=counts, pmeta=pmeta)


# ── offline checks ──────────────────────────────────────────────────────────

def run_seed_checks(sql, info, fid):
    errors = []
    check_transaction(sql, errors)
    check_deletes(sql, errors)
    check_no_secrets(sql, errors)
    body = strip_comments(sql)
    if "set local ohvara.skip_assign_notify = 'on';" not in body:
        errors.append('skip_assign_notify is not set')
    if 'does not exist or is not an active fulfillment account' not in body:
        errors.append('missing-fulfillment-account raise is missing')
    if body.index('do $chk$') > body.index('insert into'):
        errors.append('the fulfillment check does not come before the inserts')
    if TEST_AGENT not in AGENT_ALLOWLIST or len(AGENT_ALLOWLIST) != 1:
        errors.append('agent allowlist is not exactly the test agent')

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
            if table == 'policies' and fid not in line:
                errors.append('policies row without the fulfillment id')
    # Structured checks on the rows the SQL was built from.
    for tables, table, cols, rows, _ in info['plan']:
        for r in rows:
            if r.get('is_sample') is not True:
                errors.append(f'{table} row without is_sample true')
            for c in ('agent_id', 'assigned_rep_id', 'transfer_agent_id'):
                if c in r and r[c] != TEST_AGENT:
                    errors.append(f'{table}.{c} is not the test agent')
            if table == 'policies' and r['assigned_fulfillment_id'] != fid:
                errors.append('policy not pre-assigned to the fulfillment account')
            if table == 'policies' and r['fulfillment_assigned'] is not True:
                errors.append('policy not fulfillment_assigned')
            if table == 'policies' and 'wk_start()' not in r['created_at']:
                errors.append('policy created_at is not before this week\'s Monday')
            if table == 'leads' and not (r.get('assigned_rep_id') and r.get('lead_type') and r.get('lead_source')
                                         and r.get('delivered_at')):
                errors.append('lead without assigned_rep_id, lead_type, lead_source or delivered_at')
            if table == 'lead_sms_replies' and (not r.get('handled_at') or not str(r['twilio_sid']).startswith('SAMPLE-')):
                errors.append('lead_sms_replies row without handled_at or a SAMPLE- sid')
            if table == 'policy_events' and r['kind'] not in EVENT_KINDS:
                errors.append(f"policy_events kind {r['kind']} not allowed")
            if table == 'policy_messages' and r['sender_id'] not in (TEST_AGENT, fid):
                errors.append('policy_messages sender is not the test agent or the fulfillment account')
    statuses = {r['agent_status'] for _, t, _, rows, _ in info['plan'] if t == 'leads' for r in rows}
    if statuses != {'assigned', 'contacted', 'closed', 'bad'}:
        errors.append(f'leads do not cover all four agent_status values: {statuses}')
    kinds = {r['kind'] for _, t, _, rows, _ in info['plan'] if t == 'policy_events' for r in rows} | {'booked'}
    if kinds != set(EVENT_KINDS):
        errors.append(f'policy_events do not cover every allowed kind: {kinds}')
    if re.search(r"'rescheduling'", body):
        errors.append("'rescheduling' is not an allowed policy_events kind")

    # Appointments: Monday-Friday of this week (or the live call, now).
    stages = set()
    for m in info['pmeta']:
        stages.add(m['kind'])
        if m['kind'] == 'live':
            if 'now()' not in m['sched']:
                errors.append('live call is not anchored on now()')
            continue
        if m['day'] not in range(0, 5) or 'pg_temp.wk_local(' not in m['sched']:
            errors.append(f"{m['key']} is not on Monday-Friday of this week")
        h = int(m['hhmm'][:2])
        if not 8 <= h < 20:
            errors.append(f"{m['key']} is outside 8 AM-8 PM for the client")
    for need in ('booked', 'live', 'no_answer', 'confirm', 'attention', 'cancelled'):
        if need not in stages:
            errors.append(f'stage {need} is not covered')

    # Phones and agent ids anywhere in the SQL.
    for p in re.findall(r"'(\+?\d[\d\-]{6,})'", body):
        if not PHONE_RE.match(p):
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


def print_summary(info, stream):
    print('Sample seed summary (rows written when every table has is_sample):', file=stream)
    for t, n in info['counts'].items():
        print(f'  {t:28} {n:3}', file=stream)
    print('  policies (P729, marked)        12  + their policy_fulfillment_details', file=stream)
    print('Skipped at run time if the table has no is_sample column (NOTICE in the SQL output), and what stays empty:',
          file=stream)
    for t, pages in SKIPPED_PAGES.items():
        print(f'  {t:28} {pages}', file=stream)
    print('Always empty, by design or by schema:', file=stream)
    print("  policy_events 'rescheduling'  not an allowed kind since migrations 121/134/142, so none is seeded", file=stream)
    print('  lead_sms_replies, lead_followup_sms_log  closed to signed-in users today: rows exist, the inbound '
          'detail texts stay empty', file=stream)
    print('  client texts                  no table to seed; policy_messages is agent-to-rep chat, not client texts',
          file=stream)


def main():
    ap = argparse.ArgumentParser(description='Generate the one-transaction sample seed for the test agent (SQL only).')
    ap.add_argument('--fulfillment-id', help='uuid of the test fulfillment account')
    ap.add_argument('--agent-id', default=TEST_AGENT, help='only the test agent is accepted')
    ap.add_argument('--out', help='write the SQL to this file instead of stdout')
    ap.add_argument('--check', action='store_true', help='build the SQL and run the offline checks')
    args = ap.parse_args()

    if args.agent_id not in AGENT_ALLOWLIST:
        ap.error(f'{args.agent_id} is not on the allowlist; only the test agent {TEST_AGENT} may get sample data')
    fid = args.fulfillment_id or (CHECK_FULFILLMENT_ID if args.check else None)
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
        errors = run_seed_checks(sql, info, fid)
        for e in errors:
            print('FAIL:', e)
        print_summary(info, sys.stdout)
        if errors:
            sys.exit(1)
        print('all checks passed')
        return
    if args.out:
        with open(args.out, 'w', encoding='utf-8', newline='\n') as f:
            f.write(sql)
        print(f'wrote {args.out}', file=sys.stderr)
    else:
        sys.stdout.write(sql)
    print_summary(info, sys.stderr)


if __name__ == '__main__':
    main()
