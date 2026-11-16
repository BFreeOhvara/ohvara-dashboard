-- 281_lead_coverage_types — agents pick the kind of life insurance leads they want (Prompt 1016, Brayden Nov 15).
--
-- Every ad is a static ad. An agent picks ONE lead type (mortgage protection, final expense, IUL, truckers, veterans,
-- term life); their one Meta campaign runs that type's creative and form. Everything else (routing, the first call,
-- texts, billing) is the same for every type. The AI caller names the type in its opening line.
--
-- Naming: leads.lead_type (cancellation / mortgage_protection / policy_help …) and GHL's `lead_type` (appts / live,
-- booked_appointment / live_call) already mean the delivery side, and "products" are the billing products (268). So
-- the new thing is a COVERAGE type: coverage_types, agent_coverage, leads.coverage_type. Screens say "Lead type".
--
--   1. coverage_types: the list (6 to start, one "Most popular"). Everyone signed in reads it; admins rename, add,
--      hide, reorder and move the tag through admin_coverage_type_* (audit-logged). Keys never change, never deleted.
--   2. agent_coverage: each agent's pick (types text[], ships single-choice: coverage_pick_max() = 1). A switch while
--      the agent's campaign runs takes effect the next day (Central); coverage_type_roll() flips it at 12:07 AM Central
--      and touches agent_campaign_control so ghl-push re-sends the campaign with the new type. Existing agents start on
--      mortgage protection (what every campaign runs today).
--   3. leads.coverage_type + lead_intake.coverage_type: ghl_intake_lead now reads `coverage_type` (or `product`) from
--      the ad link / form; unknown or missing = the agent's type. The P915 function is kept as ghl_intake_lead_p915.
--   4. agent_inbounds() returns coverage_type; ghl_claim_controls() returns coverage_type + coverage_label.
--   5. coverage_words_for_lead(lead): what the AI caller says ("final expense"); generic "life insurance" fallback.

do $$
begin
  if to_regclass('public.agent_campaign_control') is null then raise exception '281 needs 237 applied first'; end if;
  if to_regprocedure('public.ghl_intake_lead(jsonb)') is null then raise exception '281 needs 253 applied first'; end if;
  if to_regclass('public.coverage_types') is not null then raise exception '281: coverage_types already exists'; end if;
end $$;

-- ── 1. The list ─────────────────────────────────────────────────────────────
create table public.coverage_types (
  key           text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label         text not null check (char_length(btrim(label)) between 1 and 40),
  -- What the AI caller says in "…about the <words> coverage you looked at" (lower case).
  words         text not null check (char_length(btrim(words)) between 1 and 60),
  blurb         text not null default '' check (char_length(blurb) <= 160),
  sort          int not null default 100,
  hidden        boolean not null default false,
  most_popular  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null,
  check (not (hidden and most_popular))
);
create unique index coverage_types_one_popular on public.coverage_types (most_popular) where most_popular;
alter table public.coverage_types enable row level security;
revoke all on public.coverage_types from public, anon, authenticated;
grant select on public.coverage_types to authenticated;
create policy ct_read on public.coverage_types for select to authenticated using (true);
comment on table public.coverage_types is
  'P1016: the lead types agents pick (Settings → Lead types for admins). Keys are permanent; hide instead of delete.';

insert into public.coverage_types (key, label, words, blurb, sort, most_popular) values
  ('mortgage_protection', 'Mortgage protection', 'mortgage protection', 'Homeowners who want their mortgage paid off if they pass away.', 1, true),
  ('final_expense',       'Final expense',       'final expense',       'People 50 to 85 covering funeral costs and final bills.',        2, false),
  ('iul',                 'IUL',                 'indexed universal life', 'Lifelong cover that builds cash value tied to a market index.', 3, false),
  ('truckers',            'Truckers',            'trucker life insurance', 'CDL drivers and owner-operators, cover that fits life on the road.', 4, false),
  ('veterans',            'Veterans',            'veterans life insurance', 'Veterans and military families.',                         5, false),
  ('term_life',           'Term life',           'term life',           'Affordable cover for a set number of years.',                    6, false);

drop trigger if exists audit_coverage_types on public.coverage_types;
create trigger audit_coverage_types after insert or update or delete on public.coverage_types
  for each row execute function public.audit_row();

create or replace function public.coverage_types_block_delete() returns trigger language plpgsql
set search_path = public as $$
begin
  raise exception 'Lead types are never deleted; hide it instead' using errcode = '42501';
end; $$;
create trigger coverage_types_no_delete before delete on public.coverage_types
  for each row execute function public.coverage_types_block_delete();

-- How many types an agent may pick. Ships as 1; raising it is the only server change multi-pick needs.
create or replace function public.coverage_pick_max() returns int language sql immutable
set search_path = public as $$ select 1 $$;

create or replace function public.coverage_popular() returns text language sql stable
security definer set search_path = public as $$
  select key from coverage_types where most_popular limit 1
$$;

-- Admin: rename / add / hide (p_key new = add at the end).
create or replace function public.admin_coverage_type_save(p_key text, p_label text, p_words text,
                                                           p_blurb text default '', p_hidden boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_old coverage_types;
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if v_key !~ '^[a-z][a-z0-9_]{1,39}$' then raise exception 'bad key' using errcode = '22023'; end if;
  select * into v_old from coverage_types where key = v_key for update;
  if found then
    if coalesce(p_hidden, false) and v_old.most_popular then
      raise exception 'Move "Most popular" to another type before hiding this one' using errcode = '22023';
    end if;
    if coalesce(p_hidden, false) and not v_old.hidden
       and not exists (select 1 from coverage_types where not hidden and key <> v_key) then
      raise exception 'At least one lead type must stay visible' using errcode = '22023';
    end if;
    update coverage_types
       set label = btrim(p_label), words = lower(btrim(p_words)), blurb = btrim(coalesce(p_blurb, '')),
           hidden = coalesce(p_hidden, false), updated_at = now(), updated_by = auth.uid()
     where key = v_key;
  else
    insert into coverage_types (key, label, words, blurb, hidden, sort, updated_by)
    values (v_key, btrim(p_label), lower(btrim(p_words)), btrim(coalesce(p_blurb, '')), coalesce(p_hidden, false),
            coalesce((select max(sort) from coverage_types), 0) + 1, auth.uid());
  end if;
  return (select to_jsonb(c) from coverage_types c where key = v_key);
end; $$;

-- Admin: the order agents see (every key, top first; keys left out keep their place after the listed ones).
create or replace function public.admin_coverage_type_order(p_keys text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update coverage_types c set sort = o.n, updated_at = now(), updated_by = auth.uid()
    from unnest(p_keys) with ordinality o(key, n)
   where c.key = o.key and c.sort is distinct from o.n::int;
  update coverage_types c set sort = coalesce(array_length(p_keys, 1), 0) + 100 + c.sort
   where not (c.key = any (coalesce(p_keys, '{}'))) and c.sort <= coalesce(array_length(p_keys, 1), 0);
end; $$;

-- Admin: move the "Most popular" tag.
create or replace function public.admin_coverage_type_popular(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if not exists (select 1 from coverage_types where key = p_key and not hidden) then
    raise exception 'Pick a visible lead type' using errcode = '22023';
  end if;
  update coverage_types set most_popular = false, updated_at = now(), updated_by = auth.uid()
   where most_popular and key <> p_key;
  update coverage_types set most_popular = true, updated_at = now(), updated_by = auth.uid()
   where key = p_key and not most_popular;
end; $$;

-- ── 2. Each agent's pick ────────────────────────────────────────────────────
create table public.agent_coverage (
  agent_id    uuid primary key references public.profiles(id) on delete cascade,
  types       text[] not null check (cardinality(types) >= 1),
  next_types  text[] check (next_types is null or cardinality(next_types) >= 1),
  next_from   date,
  updated_at  timestamptz not null default now(),
  check ((next_types is null) = (next_from is null))
);
alter table public.agent_coverage enable row level security;
revoke all on public.agent_coverage from public, anon, authenticated;
grant select on public.agent_coverage to authenticated;
create policy ac_read on public.agent_coverage for select to authenticated using (agent_id = auth.uid() or is_admin());
comment on table public.agent_coverage is
  'P1016: the lead type(s) an agent takes (single-choice today). next_types start on next_from (Central) via coverage_type_roll.';

insert into public.agent_coverage (agent_id, types)
select p.id, array['mortgage_protection'] from public.profiles p where p.role = 'agent'
on conflict do nothing;

-- The agent's type in effect (first pick; the Most popular one while they've never picked).
create or replace function public.agent_coverage_of(p_agent uuid) returns text language sql stable
security definer set search_path = public as $$
  select coalesce((select types[1] from agent_coverage where agent_id = p_agent), public.coverage_popular())
$$;

-- The agent picks. First pick, or no campaign running: now. Otherwise from tomorrow (Central), so the day's Meta
-- budget isn't cut mid-day. Picking the type already in effect cancels a pending switch.
create or replace function public.coverage_type_set(p_types text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  v      text[];
  cur    agent_coverage;
  v_now  boolean;
  v_from date := (now() at time zone 'America/Chicago')::date + 1;
begin
  if me is null or not exists (select 1 from profiles where id = me and role = 'agent') then
    raise exception 'agents only' using errcode = '42501';
  end if;
  select array_agg(distinct t order by t) into v from unnest(p_types) t where t is not null;
  if v is null or cardinality(v) < 1 then raise exception 'Pick a lead type' using errcode = '22023'; end if;
  if cardinality(v) > coverage_pick_max() then
    raise exception 'Pick one lead type' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v) t where not exists (select 1 from coverage_types c where c.key = t and not c.hidden)) then
    raise exception 'That lead type isn''t offered' using errcode = '22023';
  end if;

  select * into cur from agent_coverage where agent_id = me for update;
  v_now := cur.agent_id is null
           or not exists (select 1 from agent_campaign_control c where c.agent_id = me and c.run);

  if cur.agent_id is null then
    insert into agent_coverage (agent_id, types) values (me, v);
  elsif v_now then
    update agent_coverage set types = v, next_types = null, next_from = null, updated_at = now() where agent_id = me;
  elsif cur.types = v then
    update agent_coverage set next_types = null, next_from = null, updated_at = now() where agent_id = me;
  else
    update agent_coverage set next_types = v, next_from = v_from, updated_at = now() where agent_id = me;
  end if;

  if v_now and (cur.agent_id is null or cur.types is distinct from v) then
    update agent_campaign_control set changed_at = now() where agent_id = me;
  end if;
  return (select jsonb_build_object('types', types, 'next_types', next_types, 'next_from', next_from)
            from agent_coverage where agent_id = me);
end; $$;

-- Cron: switches due today (Central) take effect; the campaign is re-sent to GoHighLevel with the new type.
create or replace function public.coverage_type_roll() returns int language plpgsql security definer
set search_path = public as $$
declare n int;
begin
  with due as (
    update agent_coverage set types = next_types, next_types = null, next_from = null, updated_at = now()
     where next_from is not null and next_from <= (now() at time zone 'America/Chicago')::date
    returning agent_id
  ), touched as (
    update agent_campaign_control c set changed_at = now() from due where c.agent_id = due.agent_id returning 1
  )
  select count(*) into n from due;
  return n;
end; $$;

-- ── 3. Leads carry their type ───────────────────────────────────────────────
alter table public.leads add column if not exists coverage_type text references public.coverage_types(key) on update cascade;
create index if not exists leads_coverage_type_idx on public.leads (coverage_type) where coverage_type is not null;
comment on column public.leads.coverage_type is 'P1016: the lead type the ad was for (from the ad link / form; else the agent''s type).';
alter table public.lead_intake add column if not exists coverage_type text;

-- "Final Expense", "final-expense", "final_expense", "trucker" → a key; null when nothing matches.
create or replace function public.coverage_key_of(p text) returns text language sql stable
security definer set search_path = public as $$
  with s as (select btrim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '_', 'g'), '_') as k)
  select c.key from coverage_types c, s
   where s.k <> '' and (c.key = s.k or c.key = s.k || 's' or lower(c.label) = lower(btrim(p))
                        or regexp_replace(lower(c.label), '[^a-z0-9]+', '_', 'g') = s.k)
   order by (c.key = s.k) desc limit 1
$$;

alter function public.ghl_intake_lead(jsonb) rename to ghl_intake_lead_p915;
revoke execute on function public.ghl_intake_lead_p915(jsonb) from public, anon, authenticated;
grant  execute on function public.ghl_intake_lead_p915(jsonb) to service_role;

create function public.ghl_intake_lead(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r      jsonb := public.ghl_intake_lead_p915(p);
  v_lead uuid := (r->>'lead_id')::uuid;
  v_type text;
begin
  if coalesce((r->>'duplicate')::boolean, false) or v_lead is null then return r; end if;
  v_type := coalesce(public.coverage_key_of(nullif(p->>'coverage_type', '')),
                     public.coverage_key_of(nullif(p->>'product', '')));
  if v_type is null and r->>'agent_id' is not null then
    v_type := public.agent_coverage_of((r->>'agent_id')::uuid);
  end if;
  -- A brand-new lead: the ad link's type wins over the agent's type the assign trigger may have filled in.
  update leads set coverage_type = v_type where id = v_lead and v_type is not null
     and coverage_type is distinct from v_type;
  update lead_intake set coverage_type = coalesce(v_type, left(coalesce(p->>'coverage_type', p->>'product'), 60))
   where intake_key = btrim(p->>'intake_key');
  return r || jsonb_build_object('coverage_type', v_type);
end; $$;
revoke execute on function public.ghl_intake_lead(jsonb) from public, anon, authenticated;
grant  execute on function public.ghl_intake_lead(jsonb) to service_role;

-- A lead assigned later (unmatched → admin picks) takes the agent's type if it had none.
create or replace function public.leads_coverage_on_assign() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if new.coverage_type is null and new.assigned_rep_id is not null
     and new.lead_type in ('mortgage_protection', 'policy_help') then
    new.coverage_type := public.agent_coverage_of(new.assigned_rep_id);
  end if;
  return new;
end; $$;
drop trigger if exists leads_coverage_on_assign on public.leads;
create trigger leads_coverage_on_assign before update of assigned_rep_id on public.leads
  for each row execute function public.leads_coverage_on_assign();

-- What the AI caller says for this lead.
create or replace function public.coverage_words_for_lead(p_lead uuid) returns text language sql stable
security definer set search_path = public as $$
  select coalesce(
    (select c.words from leads l join coverage_types c on c.key = l.coverage_type where l.id = p_lead),
    (select c.words from leads l join coverage_types c on c.key = public.agent_coverage_of(l.assigned_rep_id)
      where l.id = p_lead and l.assigned_rep_id is not null),
    'life insurance')
$$;

-- ── 4. Reads ────────────────────────────────────────────────────────────────
drop function public.agent_inbounds();
create function public.agent_inbounds()
returns table (
  lead_id uuid, lead_type text, inbound_product text, inbound_stage text,
  outcome text, outcome_at timestamptz, live_call_result text,
  contact_name text, phone text, city text, state text, lead_source text,
  qualifier_answers jsonb, transfer_status text, transferred_at timestamptz,
  va_outcome text, booking_id uuid, client_policy_id uuid,
  delivered_at timestamptz, created_at timestamptz,
  follow_up_at timestamptz, outcome_reason text, follow_up_due boolean,
  coverage_type text
)
language sql
stable security invoker
set search_path = public
as $$
  select l.id, l.lead_type, l.inbound_product, l.inbound_stage,
         l.outcome, l.outcome_at,
         case
           when l.inbound_product is distinct from 'live_call' then null
           when l.transfer_status in ('requested', 'connected') then 'transferred'
           when l.va_outcome = 'booked' then 'booked'
           when l.transfer_status = 'dropped' or l.va_outcome = 'not_reached' then 'missed'
         end,
         coalesce(l.contact_name, l.business_name), l.phone, l.city, l.state, l.lead_source,
         l.qualifier_answers, l.transfer_status, l.transferred_at,
         l.va_outcome, l.booking_id, l.client_policy_id,
         l.delivered_at, l.created_at,
         l.follow_up_at, l.outcome_reason,
         coalesce(l.outcome = 'follow_up' and l.follow_up_at <= now(), false),
         l.coverage_type
    from public.leads l
   where l.assigned_rep_id = auth.uid()
     and l.lead_type <> 'cancellation'
   order by coalesce(l.delivered_at, l.created_at) desc;
$$;
revoke all on function public.agent_inbounds() from public, anon;
grant execute on function public.agent_inbounds() to authenticated;

drop function public.ghl_claim_controls(int);
create function public.ghl_claim_controls(p_limit int default 25)
returns table (agent_id uuid, lead_type text, run boolean, daily_budget_cents int, cap_cents int, reason text,
               split_form_pct int, schedule jsonb, changed_at timestamptz, attempt int, agent_code text, agent_name text,
               campaign_id text, fb_campaign_id text, coverage_type text, coverage_label text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select c.agent_id, c.lead_type from agent_campaign_control c
     where (c.pushed_at is null or c.pushed_at < c.changed_at)
       and (c.push_next_at is null or c.push_next_at <= now())
     order by c.changed_at
     limit greatest(1, least(coalesce(p_limit, 25), 100))
     for update skip locked
  ), held as (
    update agent_campaign_control c set push_next_at = now() + interval '2 minutes'
      from due where c.agent_id = due.agent_id and c.lead_type = due.lead_type
    returning c.*
  )
  select h.agent_id, h.lead_type, h.run, h.daily_budget_cents, h.cap_cents, h.reason, h.split_form_pct, h.schedule,
         h.changed_at, h.push_attempts + 1, p.agent_code, p.full_name, g.campaign_id, g.fb_campaign_id,
         ct.key, ct.label
    from held h
    join profiles p on p.id = h.agent_id
    left join coverage_types ct on ct.key = public.agent_coverage_of(h.agent_id)
    left join lateral (select g0.campaign_id, g0.fb_campaign_id from ghl_campaign_agents g0
                        where g0.agent_id = h.agent_id and coalesce(g0.lead_type, 'appts') = h.lead_type
                        order by g0.mapped_at desc nulls last limit 1) g on true;
end; $$;
revoke execute on function public.ghl_claim_controls(int) from public, anon, authenticated;
grant  execute on function public.ghl_claim_controls(int) to service_role;

-- ── 5. Doors ────────────────────────────────────────────────────────────────
revoke execute on function public.coverage_types_block_delete() from public, anon, authenticated;
revoke execute on function public.coverage_pick_max() from public, anon;
grant  execute on function public.coverage_pick_max() to authenticated;
revoke execute on function public.coverage_popular() from public, anon;
grant  execute on function public.coverage_popular() to authenticated;
revoke execute on function public.admin_coverage_type_save(text, text, text, text, boolean) from public, anon;
grant  execute on function public.admin_coverage_type_save(text, text, text, text, boolean) to authenticated;
revoke execute on function public.admin_coverage_type_order(text[]) from public, anon;
grant  execute on function public.admin_coverage_type_order(text[]) to authenticated;
revoke execute on function public.admin_coverage_type_popular(text) from public, anon;
grant  execute on function public.admin_coverage_type_popular(text) to authenticated;
revoke execute on function public.agent_coverage_of(uuid) from public, anon, authenticated;
revoke execute on function public.coverage_type_set(text[]) from public, anon;
grant  execute on function public.coverage_type_set(text[]) to authenticated;
revoke execute on function public.coverage_type_roll() from public, anon, authenticated;
revoke execute on function public.coverage_key_of(text) from public, anon, authenticated;
revoke execute on function public.leads_coverage_on_assign() from public, anon, authenticated;
revoke execute on function public.coverage_words_for_lead(uuid) from public, anon, authenticated;
grant  execute on function public.coverage_words_for_lead(uuid) to service_role;

-- ── 6. Cron: 12:07 AM Central (6:07 UTC; 1:07 AM in daylight time) ─────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'coverage-type-roll';
    perform cron.schedule('coverage-type-roll', '7 6 * * *', 'select public.coverage_type_roll()');
  end if;
end $$;
