-- P1027 — Connect carrier emails. Builds on P885/P888 (238 + 240): the per-agent forwarding address, the reader
-- (payment_intake_receive), matching, the Payment missed event → lapse-save step → "Client's payment failed" (agent,
-- "Our team is on it") + "save call" (VA) from 282's payment_missed_notify trigger.
--
-- What this adds:
--   1. Name-style addresses on notices.ohvara.com: dana-7k2f@notices.ohvara.com (the old pay+<token>@ still works).
--   2. The agent's carrier list (name + the email domain their notices come from), used for the Gmail/Outlook filter
--      and to tell which carrier a forwarded notice is from. carriers.notice_senders holds known sender domains
--      (admin-filled); otherwise the domain of the carrier's portal is suggested.
--   3. Gmail's forwarding confirmation: we receive it and show the code (and link) in the agent's setup.
--   4. A Test check: the agent taps Test, forwards / sends any email to the address, the app sees it arrive.
--   5. Finer notice reading: parsed.category = failed | returned | grace | pending_lapse | lapsed | login | paid |
--      ignore | other. Payment ones open the save call as before. "Log in to view" notices open a carrier_call step
--      ("look at this notice in the portal") for the matched client, or the agent's only client at that carrier.
--      Not-a-notice email (newsletters, marketing) is set aside quietly. Anything unclear waits in the admin
--      "Needs a look" list (admin_payment_emails_to_match), never dropped.
--   6. Retention: email text is kept payment_settings.email_keep_days (60) days, then cleared; set-aside email rows
--      are deleted then; Gmail codes after 7 days. Daily cron.
--
-- Additive: new columns, new functions, replaced bodies of payment_intake_address_for / rotate / receive (same
-- signatures). Nothing dropped. RUN TESTS: npm run test:sql (supabase/tests/p1027_carrier_emails.sql).

do $$
begin
  if to_regprocedure('public.payment_intake_receive(text,text,text,text,text,jsonb)') is null then
    raise exception 'p1027 needs 238 applied first';
  end if;
end $$;

-- ── 1. Settings + columns ───────────────────────────────────────────────────
alter table public.payment_settings add column if not exists email_keep_days int not null default 60
  check (email_keep_days between 7 and 365);
alter table public.payment_settings alter column intake_domain set default 'notices.ohvara.com';
update public.payment_settings set intake_domain = 'notices.ohvara.com' where intake_domain = 'in.ohvara.com';
grant update (email_keep_days) on public.payment_settings to authenticated;

alter table public.payment_intake_addresses
  add column if not exists local_part      text unique check (local_part ~ '^[a-z]{1,20}-[a-z0-9]{4}$'),
  add column if not exists carriers        jsonb not null default '[]'::jsonb check (jsonb_typeof(carriers) = 'array'),
  add column if not exists gmail_code      text check (gmail_code ~ '^[0-9]{6,12}$'),
  add column if not exists gmail_link      text check (char_length(gmail_link) <= 600 and gmail_link ~ '^https://(mail-settings|mail|isolated\.mail)\.google\.com/'),
  add column if not exists gmail_code_at   timestamptz,
  add column if not exists gmail_from      text check (char_length(gmail_from) <= 200),
  add column if not exists test_started_at timestamptz,
  add column if not exists last_email_at   timestamptz,
  add column if not exists last_notice_at  timestamptz;

alter table public.carriers add column if not exists notice_senders text[] not null default '{}';

-- ── 2. Addresses ────────────────────────────────────────────────────────────
-- "dana-7k2f": the agent's first name (letters only, up to 20) + 4 random letters/digits.
create or replace function public.payment_intake_local_part(p_agent uuid) returns text language plpgsql volatile
set search_path = public as $$
declare
  v_name text := lower(regexp_replace(split_part(btrim(coalesce((select full_name from profiles where id = p_agent), '')), ' ', 1), '[^A-Za-z]', '', 'g'));
  v text;
begin
  v_name := left(coalesce(nullif(v_name, ''), 'agent'), 20);
  loop
    v := v_name || '-' || (select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + floor(random() * 31)::int, 1), '')
                             from generate_series(1, 4));
    exit when not exists (select 1 from payment_intake_addresses where local_part = v);
  end loop;
  return v;
end; $$;
revoke all on function public.payment_intake_local_part(uuid) from public, anon, authenticated;

create or replace function public.payment_intake_address_for(p_agent uuid) returns text language plpgsql
security definer set search_path = public as $$
declare v_local text; v_domain text;
begin
  select local_part into v_local from payment_intake_addresses where agent_id = p_agent;
  if v_local is null then
    insert into payment_intake_addresses (agent_id, token, local_part)
    values (p_agent, payment_intake_token(), payment_intake_local_part(p_agent))
    on conflict (agent_id) do update set local_part = coalesce(payment_intake_addresses.local_part, excluded.local_part);
    select local_part into v_local from payment_intake_addresses where agent_id = p_agent;
  end if;
  select intake_domain into v_domain from payment_settings where id;
  return v_local || '@' || coalesce(v_domain, 'notices.ohvara.com');
end; $$;
revoke all on function public.payment_intake_address_for(uuid) from public, anon, authenticated;

create or replace function public.rotate_my_payment_intake_address() returns text language plpgsql
security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_fulfillment() or public.is_admin() then
    raise exception 'Only an agent has a forwarding address' using errcode = '42501';
  end if;
  perform public.payment_intake_address_for(auth.uid());
  update payment_intake_addresses
     set token = payment_intake_token(), local_part = payment_intake_local_part(auth.uid()), rotated_at = now(),
         gmail_code = null, gmail_link = null, gmail_code_at = null, gmail_from = null, test_started_at = null
   where agent_id = auth.uid();
  return public.payment_intake_address_for(auth.uid());
end; $$;
revoke all on function public.rotate_my_payment_intake_address() from public, anon;
grant execute on function public.rotate_my_payment_intake_address() to authenticated;

-- The agent: address, carriers, Gmail code, test, recent notices. Made the first time they ask.
create or replace function public.carrier_notice_domain(p_carrier text) returns text language sql stable
set search_path = public as $$
  select coalesce(c.notice_senders[1],
           nullif(regexp_replace(substring(lower(c.portal_url) from '^https?://([^/:]+)'), '^(.*\.)?([a-z0-9-]+\.[a-z]{2,})$', '\2'), ''))
    from carriers c where lower(c.name) = lower(btrim(p_carrier)) limit 1
$$;
revoke all on function public.carrier_notice_domain(text) from public, anon;
grant execute on function public.carrier_notice_domain(text) to authenticated;

create or replace function public.my_carrier_emails() returns jsonb language plpgsql
security definer set search_path = public as $$
declare v_addr text; a payment_intake_addresses%rowtype;
begin
  if auth.uid() is null or public.is_fulfillment() or public.is_admin() then
    raise exception 'Only an agent has a forwarding address' using errcode = '42501';
  end if;
  v_addr := public.payment_intake_address_for(auth.uid());
  select * into a from payment_intake_addresses where agent_id = auth.uid();
  return jsonb_build_object(
    'address', v_addr,
    'carriers', a.carriers,
    -- The agent's carriers from their book, with a suggested sender domain, for the picker.
    'suggested', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'domain', public.carrier_notice_domain(x.name)) order by x.name)
                    from (select distinct carrier_name as name from policies
                           where agent_id = auth.uid() and archived_at is null and coalesce(carrier_name, '') <> '') x), '[]'::jsonb),
    'all', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'domain', public.carrier_notice_domain(c.name)) order by c.is_core_carrier desc, c.name)
               from carriers c where c.is_active), '[]'::jsonb),
    'gmail', case when a.gmail_code_at > now() - interval '7 days'
                  then jsonb_build_object('code', a.gmail_code, 'link', a.gmail_link, 'at', a.gmail_code_at, 'for', a.gmail_from) end,
    'test_started_at', a.test_started_at,
    'test_ok', coalesce(a.test_started_at is not null and a.last_email_at >= a.test_started_at, false),
    'last_email_at', a.last_email_at,
    'last_notice_at', a.last_notice_at,
    'recent', coalesce((select jsonb_agg(r order by r->>'at' desc) from (
                select jsonb_build_object('id', e.id, 'at', e.received_at, 'subject', e.subject, 'status', e.status,
                         'category', e.parsed->>'category',
                         'client', nullif(btrim(coalesce(p.client_first_name, '') || ' ' || coalesce(left(p.client_last_name, 1) || '.', '')), '')) r
                  from payment_intake_emails e left join policies p on p.id = e.policy_id
                 where e.agent_id = auth.uid() and e.status <> 'not_a_notice'
                 order by e.received_at desc limit 8) q), '[]'::jsonb));
end; $$;
revoke all on function public.my_carrier_emails() from public, anon;
grant execute on function public.my_carrier_emails() to authenticated;

-- p: [{"name": "Ethos", "domain": "ethoslife.com"}, ...]; up to 30; domain optional (we can't filter without one).
create or replace function public.set_my_notice_carriers(p jsonb) returns jsonb language plpgsql
security definer set search_path = public as $$
declare v jsonb := '[]'::jsonb; r jsonb; v_name text; v_dom text;
begin
  if auth.uid() is null or public.is_fulfillment() or public.is_admin() then
    raise exception 'Only an agent has a forwarding address' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 30 then
    raise exception 'Send up to 30 carriers' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p) loop
    v_name := btrim(coalesce(r->>'name', ''));
    v_dom  := lower(btrim(regexp_replace(coalesce(r->>'domain', ''), '^.*@', '')));
    if v_name = '' or char_length(v_name) > 80 then raise exception 'Each carrier needs a name' using errcode = '22023'; end if;
    if v_dom <> '' and v_dom !~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
      raise exception '"%" isn''t an email domain (like carrier.com)', v_dom using errcode = '22023';
    end if;
    if not exists (select 1 from jsonb_array_elements(v) x where lower(x->>'name') = lower(v_name)) then
      v := v || jsonb_build_object('name', v_name, 'domain', nullif(v_dom, ''));
    end if;
  end loop;
  perform public.payment_intake_address_for(auth.uid());
  update payment_intake_addresses set carriers = v where agent_id = auth.uid();
  return v;
end; $$;
revoke all on function public.set_my_notice_carriers(jsonb) from public, anon;
grant execute on function public.set_my_notice_carriers(jsonb) to authenticated;

create or replace function public.start_my_carrier_email_test() returns timestamptz language plpgsql
security definer set search_path = public as $$
declare v timestamptz := now();
begin
  if auth.uid() is null or public.is_fulfillment() or public.is_admin() then
    raise exception 'Only an agent has a forwarding address' using errcode = '42501';
  end if;
  perform public.payment_intake_address_for(auth.uid());
  update payment_intake_addresses set test_started_at = v where agent_id = auth.uid();
  return v;
end; $$;
revoke all on function public.start_my_carrier_email_test() from public, anon;
grant execute on function public.start_my_carrier_email_test() to authenticated;

-- ── 3. Called by the payment-intake function (service role) ─────────────────
-- An address part (local part "dana-7k2f" or old token) → the agent.
create or replace function public.payment_intake_agent(p_key text) returns uuid language sql stable
set search_path = public as $$
  select agent_id from payment_intake_addresses where local_part = lower(btrim(p_key)) or token = lower(btrim(p_key)) limit 1
$$;
revoke all on function public.payment_intake_agent(text) from public, anon, authenticated;

-- Gmail's "confirm forwarding" email: keep the code for the agent's setup screen. Never a notice.
create or replace function public.payment_intake_gmail_code(p_token text, p_code text, p_link text, p_for text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_agent uuid := public.payment_intake_agent(p_token);
begin
  if v_agent is null then return jsonb_build_object('status', 'unknown_address'); end if;
  update payment_intake_addresses
     set gmail_code = case when p_code ~ '^[0-9]{6,12}$' then p_code end,
         gmail_link = case when char_length(p_link) <= 600 and p_link ~ '^https://(mail-settings|mail|isolated\.mail)\.google\.com/' then p_link end,
         gmail_from = left(p_for, 200), gmail_code_at = now(), last_email_at = now()
   where agent_id = v_agent;
  return jsonb_build_object('status', 'gmail_code');
end; $$;
revoke all on function public.payment_intake_gmail_code(text, text, text, text) from public, anon, authenticated;

-- Which carrier sent it: the sender domain against the agent's list, then known sender domains / portal domains.
create or replace function public.payment_intake_carrier(p_agent uuid, p_domain text, p_hint text) returns text
language sql stable set search_path = public as $$
  with d as (select lower(btrim(coalesce(p_domain, ''))) dom, lower(btrim(coalesce(p_hint, ''))) hint)
  select coalesce(
    (select x->>'name' from payment_intake_addresses a, jsonb_array_elements(a.carriers) x, d
      where a.agent_id = p_agent and d.dom <> '' and coalesce(x->>'domain', '') <> ''
        and (d.dom = x->>'domain' or d.dom like '%.' || (x->>'domain')) limit 1),
    (select c.name from carriers c, d where d.dom <> '' and c.is_active
        and (d.dom = any(c.notice_senders) or exists (select 1 from unnest(c.notice_senders) s where d.dom like '%.' || s)
             or d.dom = public.carrier_notice_domain(c.name) or d.dom like '%.' || public.carrier_notice_domain(c.name)) limit 1),
    (select c.name from carriers c, d where d.hint <> '' and c.is_active
        and (lower(c.name) = d.hint or d.hint like lower(c.name) || '%' or d.hint = any(select lower(a) from unnest(c.aliases) a)) limit 1),
    -- A carrier name only the agent's book knows (not in the carriers list).
    (select p.carrier_name from policies p, d where d.hint <> '' and p.agent_id = p_agent and p.archived_at is null
        and coalesce(p.carrier_name, '') <> '' and (lower(p.carrier_name) = d.hint or d.hint like lower(p.carrier_name) || '%') limit 1))
$$;
revoke all on function public.payment_intake_carrier(uuid, text, text) from public, anon, authenticated;

-- The reader. Same signature as 238. p_token = local part or old token. p_parsed (from the function):
--   category (failed|returned|grace|pending_lapse|lapsed|login|paid|ignore|other), kind (238's: missed|lapsed|paid|other),
--   policy_number, client_name, due_date, amount, carrier_hint, sender_domain, is_test.
create or replace function public.payment_intake_receive(p_token text, p_message_id text, p_from text, p_subject text, p_body text, p_parsed jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_agent   uuid := public.payment_intake_agent(p_token);
  v_intake  uuid;
  v_cat     text := coalesce(p_parsed->>'category', '');
  v_kind    text;
  v_number  text := payment_norm_policy(p_parsed->>'policy_number');
  v_client  text := lower(trim(regexp_replace(coalesce(p_parsed->>'client_name', ''), '\s+', ' ', 'g')));
  v_carrier text;
  v_last    text;
  v_due     date;
  v_policy  uuid;
  v_hits    int := 0;
  v_why     text;
  v_event   uuid;
  v_task    uuid;
  v_status  text;
  v_parsed  jsonb;
  r         record;
begin
  if v_agent is null then return jsonb_build_object('status', 'unknown_address'); end if;
  if coalesce(p_message_id, '') = '' then raise exception 'message_id is needed' using errcode = '22023'; end if;
  update payment_intake_addresses set last_email_at = now() where agent_id = v_agent;

  select id, status, event_id into r from payment_intake_emails where agent_id = v_agent and message_id = left(p_message_id, 300);
  if found then return jsonb_build_object('status', 'duplicate', 'intake_id', r.id, 'event_id', r.event_id); end if;

  -- 238's callers send only kind: map it.
  if v_cat not in ('failed', 'returned', 'grace', 'pending_lapse', 'lapsed', 'login', 'paid', 'ignore', 'other') then
    v_cat := case p_parsed->>'kind' when 'missed' then 'failed' when 'lapsed' then 'lapsed' when 'paid' then 'paid' else 'other' end;
  end if;
  if coalesce((p_parsed->>'is_test')::boolean, false) then v_cat := 'ignore'; end if;
  v_kind := case when v_cat in ('failed', 'returned', 'grace', 'pending_lapse') then 'missed'
                 when v_cat in ('lapsed', 'paid') then v_cat else 'other' end;
  v_carrier := public.payment_intake_carrier(v_agent, p_parsed->>'sender_domain', p_parsed->>'carrier_hint');
  v_parsed := coalesce(p_parsed, '{}'::jsonb) || jsonb_build_object('category', v_cat, 'carrier', v_carrier);

  -- Not a policy notice (a newsletter, a test): set aside quietly, nothing else.
  if v_cat = 'ignore' then
    insert into payment_intake_emails (agent_id, message_id, from_addr, subject, body_excerpt, parsed, notice_kind, status)
    values (v_agent, left(p_message_id, 300), left(p_from, 300), left(p_subject, 500), null, v_parsed, 'other', 'not_a_notice')
    returning id into v_intake;
    return jsonb_build_object('status', 'not_a_notice', 'intake_id', v_intake);
  end if;
  update payment_intake_addresses set last_notice_at = now() where agent_id = v_agent;

  begin v_due := (p_parsed->>'due_date')::date; exception when others then v_due := null; end;
  if v_due is not null and (v_due < current_date - 400 or v_due > current_date + 120) then v_due := null; end if;

  -- Match: policy number, then full name, then last name alone (exactly one policy each time). With several name
  -- hits, the carrier narrows it. A log-in notice with nothing else: the agent's only client at that carrier.
  if v_number is not null then
    select count(*), min(id::text)::uuid into v_hits, v_policy from policies
     where agent_id = v_agent and archived_at is null and payment_norm_policy(policy_number) = v_number;
  end if;
  if coalesce(v_hits, 0) = 0 and v_client <> '' then
    select count(*), min(id::text)::uuid into v_hits, v_policy from policies
     where agent_id = v_agent and archived_at is null
       and (lower(trim(coalesce(client_first_name, '') || ' ' || coalesce(client_last_name, ''))) = v_client
         or lower(trim(coalesce(client_last_name, '') || ', ' || coalesce(client_first_name, ''))) = v_client);
    if coalesce(v_hits, 0) = 0 then
      v_last := case when v_client like '%,%' then trim(split_part(v_client, ',', 1)) else regexp_replace(v_client, '^.*\s', '') end;
      if length(v_last) >= 2 then
        select count(*), min(id::text)::uuid into v_hits, v_policy from policies
         where agent_id = v_agent and archived_at is null and lower(trim(coalesce(client_last_name, ''))) = v_last;
      end if;
    end if;
    if coalesce(v_hits, 0) > 1 and v_carrier is not null then
      select count(*), min(id::text)::uuid into v_hits, v_policy from policies
       where agent_id = v_agent and archived_at is null and lower(carrier_name) = lower(v_carrier)
         and (lower(trim(coalesce(client_first_name, '') || ' ' || coalesce(client_last_name, ''))) = v_client
           or lower(trim(coalesce(client_last_name, '') || ', ' || coalesce(client_first_name, ''))) = v_client
           or lower(trim(coalesce(client_last_name, ''))) = v_last);
    end if;
  end if;
  if coalesce(v_hits, 0) = 0 and v_cat = 'login' and v_number is null and v_client = '' and v_carrier is not null then
    select count(*), min(id::text)::uuid into v_hits, v_policy from policies
     where agent_id = v_agent and archived_at is null and lower(carrier_name) = lower(v_carrier);
  end if;
  if coalesce(v_hits, 0) <> 1 then v_policy := null; end if;
  v_why := case when v_cat = 'other' then 'unclear' when coalesce(v_hits, 0) > 1 then 'several_policies'
                when v_policy is null then 'no_policy' end;

  v_status := case when v_cat = 'paid' then 'paid_notice'
                   when v_cat in ('failed', 'returned', 'grace', 'pending_lapse', 'lapsed', 'login') and v_policy is not null then 'matched'
                   else 'unmatched' end;
  insert into payment_intake_emails (agent_id, message_id, from_addr, subject, body_excerpt, parsed, notice_kind, status,
                                     unmatched_why, policy_id)
  values (v_agent, left(p_message_id, 300), left(p_from, 300), left(p_subject, 500), left(p_body, 8000),
          v_parsed, v_kind, v_status, case when v_status = 'unmatched' then v_why end, v_policy)
  returning id into v_intake;

  if v_status = 'matched' and v_cat = 'login' then
    -- "Log in to view": a VA looks at the notice in the carrier portal (Q38: look only; changes go to the agent).
    select id into v_task from servicing_tasks
     where policy_id = v_policy and kind in ('carrier_call', 'lapse_save') and status in ('requested', 'scheduled', 'in_progress')
     order by created_at limit 1;
    if v_task is null then
      insert into servicing_tasks (agent_id, policy_id, kind, status, due_at, requested_by, note)
      values (v_agent, v_policy, 'carrier_call', 'requested', payment_save_deadline(now()), 'system',
              left(coalesce(v_carrier, 'The carrier') || ' sent a notice that says to log in to read it ("'
                   || coalesce(left(p_subject, 140), 'no subject') || '"). Look at it in the portal or call the carrier. '
                   || 'If it''s a missed payment, record it so the save call opens; anything to change goes to the agent.', 1000))
      returning id into v_task;
    end if;
    update payment_intake_emails set parsed = parsed || jsonb_build_object('task_id', v_task) where id = v_intake;
  elsif v_status = 'matched' then
    v_event := payment_missed_record(v_policy, coalesce(v_due, (now() at time zone 'America/Chicago')::date), 'email',
                                     null, left(case v_cat when 'returned' then 'Returned payment: ' when 'grace' then 'Grace period: '
                                       when 'pending_lapse' then 'Pending lapse: ' when 'lapsed' then 'Lapsed: ' else '' end
                                       || coalesce(p_subject, ''), 300), v_intake);
    update payment_intake_emails set event_id = v_event where id = v_intake;
  elsif v_status = 'paid_notice' and v_policy is not null then
    update payment_missed_events set resolved_at = now(), resolution = 'paid'
     where policy_id = v_policy and resolved_at is null
     returning id into v_event;
    update payment_intake_emails set event_id = v_event where id = v_intake;
  elsif v_status = 'unmatched' then
    -- Waits in the admin "Needs a look" list. The bell notice stays as 282 set it (off for admins).
    for r in select id from profiles where role::text = 'admin' and coalesce(is_active, true) loop
      perform public.notify(r.id, 'payment_intake_unmatched', 'A forwarded carrier email needs a look',
                            coalesce(left(p_subject, 140), 'No subject') || case v_why when 'several_policies' then ' (fits more than one policy)'
                              when 'unclear' then ' (not clear what it is)' else ' (no policy found)' end,
                            '/admin', true, 'payment_intake:' || v_intake || ':' || r.id);
    end loop;
  end if;
  return jsonb_build_object('status', v_status, 'intake_id', v_intake, 'event_id', v_event, 'task_id', v_task,
                            'why', v_why, 'category', v_cat, 'carrier', v_carrier);
end; $$;
revoke all on function public.payment_intake_receive(text, text, text, text, text, jsonb) from public, anon, authenticated;

-- ── 4. Admin "Needs a look": with the agent's policies to pick from ─────────
create or replace function public.admin_payment_emails_to_match() returns jsonb language plpgsql stable
security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can see this' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'agent_id', e.agent_id, 'agent', a.full_name,
             'received_at', e.received_at, 'from', e.from_addr, 'subject', e.subject, 'excerpt', left(e.body_excerpt, 600),
             'parsed', e.parsed, 'why', e.unmatched_why,
             'policies', coalesce((select jsonb_agg(jsonb_build_object('id', p.id,
                            'name', btrim(coalesce(p.client_first_name, '') || ' ' || coalesce(p.client_last_name, '')),
                            'carrier', p.carrier_name, 'number', p.policy_number) order by p.client_last_name, p.client_first_name)
                          from policies p where p.agent_id = e.agent_id and p.archived_at is null), '[]'::jsonb))
           order by e.received_at)
          from payment_intake_emails e join profiles a on a.id = e.agent_id where e.status = 'unmatched'), '[]'::jsonb);
end; $$;
revoke all on function public.admin_payment_emails_to_match() from public, anon;
grant execute on function public.admin_payment_emails_to_match() to authenticated;

-- ── 5. Retention ────────────────────────────────────────────────────────────
create or replace function public.payment_intake_purge() returns jsonb language plpgsql
security definer set search_path = public as $$
declare v_days int := coalesce((select email_keep_days from payment_settings where id), 60); n1 int; n2 int; n3 int;
begin
  update payment_intake_emails set body_excerpt = null,
         parsed = parsed - 'client_name' - 'amount'
   where received_at < now() - make_interval(days => v_days) and (body_excerpt is not null or parsed ? 'client_name');
  get diagnostics n1 = row_count;
  delete from payment_intake_emails where status = 'not_a_notice' and received_at < now() - make_interval(days => v_days);
  get diagnostics n2 = row_count;
  update payment_intake_addresses set gmail_code = null, gmail_link = null, gmail_from = null
   where gmail_code_at < now() - interval '7 days' and gmail_code is not null;
  get diagnostics n3 = row_count;
  return jsonb_build_object('cleared', n1, 'deleted', n2, 'gmail_cleared', n3);
end; $$;
revoke all on function public.payment_intake_purge() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'payment-intake-purge';
    perform cron.schedule('payment-intake-purge', '15 9 * * *', 'select public.payment_intake_purge()');
  end if;
end $$;
