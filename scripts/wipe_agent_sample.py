"""Print ONE SQL transaction that removes the TEST AGENT's sample rows
(is_sample = true AND owned by the test agent).

Generates SQL only. It never connects to the database, needs no key and has
no dependencies. Running the SQL is a separate, checked step at the door
(the Supabase SQL editor, as the service role); nothing here runs it.

  python scripts/wipe_agent_sample.py                 # SQL to stdout
  python scripts/wipe_agent_sample.py --out wipe.sql  # SQL to a file
  python scripts/wipe_agent_sample.py --check         # offline checks only

Order inside the one transaction:
  1. collect the test agent's sample policy ids (is_sample and agent_id = TEST_AGENT);
  2. delete notification_emails queued for those policies' notifications,
     then the notifications whose data->>'policy_id' is one of them. These
     two are the ONLY deletes without an is_sample filter: the bell rows are
     written by triggers and carry no flag, so they are keyed on the ids;
  3. delete from lead_sms_replies, help_calls, leads, policies where is_sample
     AND the row belongs to the test agent: leads.assigned_rep_id,
     policies.agent_id, help_calls.transfer_agent_id, and lead_sms_replies
     whose lead is one of those sample leads. Sample rows of any other agent
     are never touched.

Never deleted directly, only by the foreign-key cascade from the rows above:
policy_events (a permanent record: a direct delete raises 42501, migration
153), policy_messages, policy_fulfillment_details, lead_followup_sms_log,
inbound_events and servicing_tasks.

admin_audit_log keeps one permanent row per wiped policy by design (153's
audit_policies_delete trigger). That row can't be removed and isn't meant to be.

A table without an is_sample column is skipped with a NOTICE, so the script
is safe to run before the is_sample migration is applied (it then removes
nothing from that table).
"""
import argparse
import re
import sys

# Same id as seed_agent_sample.py (copied: that file imports this one).
TEST_AGENT = '3f2b2df7-40b1-4921-80e2-09981c819642'
# Every delete here is filtered on is_sample AND the test agent, except
# NOTIFICATION_DELETES (keyed on the test agent's sample policy ids).
SAMPLE_DELETES = ['lead_sms_replies', 'help_calls', 'leads', 'policies']
NOTIFICATION_DELETES = ['notification_emails', 'notifications']
# The test-agent condition each is_sample delete must carry.
_A = re.escape(TEST_AGENT)
AGENT_FILTER = {
    'leads': rf"\bassigned_rep_id\s*=\s*'{_A}'",
    'policies': rf"\bagent_id\s*=\s*'{_A}'",
    'help_calls': rf"\btransfer_agent_id\s*=\s*'{_A}'",
    'lead_sms_replies': (rf"\blead_id\s+in\s*\(\s*select\s+id\s+from\s+public\.leads\s+"
                         rf"where\s+is_sample\s+and\s+assigned_rep_id\s*=\s*'{_A}'\s*\)"),
}
# Removed only by the cascade from the tables above.
CASCADED = ['policy_events', 'policy_messages', 'policy_fulfillment_details',
            'lead_followup_sms_log', 'inbound_events', 'servicing_tasks']

HELPERS = """\
-- True when public.<t> exists and has an is_sample column.
create or replace function pg_temp.has_sample(t text) returns boolean
language sql stable as $$
  select exists (
    select 1 from pg_attribute
     where attrelid = to_regclass('public.' || t)
       and attname = 'is_sample' and not attisdropped)
$$;"""

WIPE_BODY = """\
-- Wipe the test agent's sample rows only (is_sample and TEST_AGENT). Cascades take policy_events, policy_messages,
-- policy_fulfillment_details, lead_followup_sms_log, inbound_events and
-- servicing_tasks; none of them is deleted directly.
do $wipe$
declare
  v_ids text[] := '{}';
  n     integer;
begin
  -- 1. the test agent's sample policy ids
  if pg_temp.has_sample('policies') then
    select coalesce(array_agg(id::text), '{}') into v_ids from public.policies
       where is_sample and agent_id = '{TEST_AGENT}';
  end if;

  -- 2. bell rows and queued emails about those policies (keyed on the ids)
  if cardinality(v_ids) > 0 and to_regclass('public.notifications') is not null then
    if to_regclass('public.notification_emails') is not null then
      delete from public.notification_emails
       where notification_id in (select id from public.notifications where data->>'policy_id' = any (v_ids));
      get diagnostics n = row_count; raise notice 'wipe notification_emails: %', n;
    end if;
    delete from public.notifications where data->>'policy_id' = any (v_ids);
    get diagnostics n = row_count; raise notice 'wipe notifications: %', n;
  end if;

  -- 3. sample rows, children first where the link is ON DELETE SET NULL
  if pg_temp.has_sample('lead_sms_replies') then
    delete from public.lead_sms_replies
     where is_sample
       and lead_id in (select id from public.leads where is_sample and assigned_rep_id = '{TEST_AGENT}');
    get diagnostics n = row_count; raise notice 'wipe lead_sms_replies: %', n;
  else
    raise notice 'wipe skipped lead_sms_replies: no is_sample column';
  end if;

  if pg_temp.has_sample('help_calls') then
    delete from public.help_calls where is_sample and transfer_agent_id = '{TEST_AGENT}';
    get diagnostics n = row_count; raise notice 'wipe help_calls: %', n;
  else
    raise notice 'wipe skipped help_calls: no is_sample column';
  end if;

  if pg_temp.has_sample('leads') then
    delete from public.leads where is_sample and assigned_rep_id = '{TEST_AGENT}';
    get diagnostics n = row_count; raise notice 'wipe leads: %', n;
  else
    raise notice 'wipe skipped leads: no is_sample column';
  end if;

  if pg_temp.has_sample('policies') then
    delete from public.policies where is_sample and agent_id = '{TEST_AGENT}';
    get diagnostics n = row_count; raise notice 'wipe policies: % (one admin_audit_log row each, by design)', n;
  else
    raise notice 'wipe skipped policies: no is_sample column';
  end if;
end $wipe$;""".replace('{TEST_AGENT}', TEST_AGENT)


def build_wipe_sql():
    return '\n'.join([
        '-- Generated by scripts/wipe_agent_sample.py. One transaction. Do not edit by hand.',
        '-- admin_audit_log keeps one permanent row per wiped policy by design.',
        'begin;',
        '',
        HELPERS,
        '',
        WIPE_BODY,
        '',
        'commit;',
        '',
    ])


# ── offline checks (shared with seed_agent_sample.py) ───────────────────────

def strip_comments(sql):
    return re.sub(r'--[^\n]*', '', sql)


def check_transaction(sql, errors):
    body = strip_comments(sql).strip()
    if not body.lower().startswith('begin;'):
        errors.append('SQL does not start with begin;')
    if not body.lower().endswith('commit;'):
        errors.append('SQL does not end with commit;')
    if len(re.findall(r'^\s*begin\s*;', body, re.I | re.M)) != 1 or \
       len(re.findall(r'^\s*commit\s*;', body, re.I | re.M)) != 1:
        errors.append('SQL must hold exactly one begin; and one commit;')
    if re.search(r'^\s*(rollback|savepoint)\b', body, re.I | re.M):
        errors.append('SQL must not contain rollback or savepoint')


def check_deletes(sql, errors):
    """Every delete is filtered on is_sample AND the test agent, except the two
    notification deletes keyed on the test agent's sample policy ids. Cascaded
    tables never appear."""
    body = strip_comments(sql)
    stmts = re.findall(r'delete\s+from\s+(?:public\.)?(\w+)(.*?);', body, re.I | re.S)
    if not stmts:
        errors.append('no delete statements found')
    for table, rest in stmts:
        t = table.lower()
        if t in CASCADED:
            errors.append(f'direct delete from cascaded table {t}')
        elif t in NOTIFICATION_DELETES:
            if "data->>'policy_id' = any (v_ids)" not in rest:
                errors.append(f'delete from {t} is not keyed on the sample policy ids')
        elif t in SAMPLE_DELETES:
            r = rest.strip()
            if not re.search(r'\bwhere\s+is_sample\b', r, re.I):
                errors.append(f'delete from {t} is not filtered on is_sample')
            if not re.search(AGENT_FILTER[t], r, re.I):
                errors.append(f'delete from {t} is not filtered on the test agent ({TEST_AGENT})')
            if set(re.findall(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', r, re.I)) - {TEST_AGENT}:
                errors.append(f'delete from {t} names an agent other than the test agent')
        else:
            errors.append(f'unexpected delete from {t}')
    if re.search(r'delete\s+from\s+(public\.)?policy_events', body, re.I):
        errors.append('a statement deletes from policy_events')
    if re.search(r'\b(truncate|drop\s+table)\b', body, re.I):
        errors.append('truncate or drop table found')


# Built from pieces so a plain grep of this file for keys or URLs stays empty.
SECRET_PATTERN = '|'.join(['ey' + 'J', 'service' + '_role', 'ht' + 'tps?://'])


def check_no_secrets(sql, errors):
    if re.search(SECRET_PATTERN, sql):
        errors.append('SQL contains a key-like string or a URL')
    if re.search(r'[\w.+-]+@[\w-]+\.[\w.]+', sql):
        errors.append('SQL contains an email address')


def run_wipe_checks(sql):
    errors = []
    check_transaction(sql, errors)
    check_deletes(sql, errors)
    check_no_secrets(sql, errors)
    order = [m.lower() for m in re.findall(r'delete\s+from\s+public\.(\w+)', strip_comments(sql), re.I)]
    if order != ['notification_emails', 'notifications'] + SAMPLE_DELETES:
        errors.append(f'delete order is {order}')
    if f"from public.policies\n       where is_sample and agent_id = '{TEST_AGENT}';" not in sql:
        errors.append("v_ids select is not taken from the test agent's sample policies")
    if 'pg_temp.has_sample' not in sql:
        errors.append('is_sample guard helper missing')
    return errors


def run_negative_check(sql):
    """The checks must FAIL on a copy of the SQL with the agent filter removed
    (from every delete and from the v_ids select). Returns errors if they don't."""
    stripped = re.sub(r"\s+and\s+(assigned_rep_id|agent_id|transfer_agent_id)\s*=\s*'" + TEST_AGENT + "'",
                      '', sql)
    if stripped == sql:
        return ['negative check: no agent filter found to remove']
    if not run_wipe_checks(stripped):
        return ['negative check: SQL without the test-agent filter was NOT rejected']
    return []


def main():
    ap = argparse.ArgumentParser(description='Generate the one-transaction sample-data wipe (SQL only).')
    ap.add_argument('--out', help='write the SQL to this file instead of stdout')
    ap.add_argument('--check', action='store_true', help='build the SQL and run the offline checks')
    args = ap.parse_args()

    sql = build_wipe_sql()
    if args.check:
        errors = run_wipe_checks(sql) + run_negative_check(sql)
        for e in errors:
            print('FAIL:', e)
        if errors:
            sys.exit(1)
        print('wipe: one transaction; deletes in order: notification_emails, notifications, '
              + ', '.join(SAMPLE_DELETES) + '; cascaded only: ' + ', '.join(CASCADED))
        print('all checks passed')
        return
    if args.out:
        with open(args.out, 'w', encoding='utf-8', newline='\n') as f:
            f.write(sql)
        print(f'wrote {args.out}', file=sys.stderr)
    else:
        sys.stdout.write(sql)


if __name__ == '__main__':
    main()
