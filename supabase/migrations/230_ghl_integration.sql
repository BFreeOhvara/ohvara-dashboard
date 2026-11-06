-- 230 — GoHighLevel bridge (Prompt 850). WRITTEN, NOT APPLIED: applying goes
-- through Brayden's door (brain/ohvara/ghl-bridge.md in the vault).
--
-- Ohvara stays the face and system of record; Jordan's GoHighLevel (GHL)
-- sub-account is the texting engine (his A2P is approved). Agents never see
-- GHL: every table here is admin-only or service-role-only.
--
-- What it adds:
--   ghl_settings   one row: on/off switch (default OFF), location ID, one GHL
--                  workflow ID per event, last sync status. Admins read it and
--                  edit the switch, the location and the workflow IDs; nobody
--                  else sees it. The API key is NEVER stored in a table: it is
--                  the Supabase secret GHL_API_KEY (webhook secret:
--                  GHL_WEBHOOK_SECRET), set by Brayden.
--   ghl_contacts   lead -> GHL contact ID, so pushes update the same contact
--                  and webhooks find the lead. Service role only.
--   ghl_outbox     what ghl-push has to send. Filled by triggers ONLY while the
--                  switch is on, so turning it on never floods GHL with a
--                  backlog. Service role only.
--   triggers       leads insert / inbound_stage change (cancellation and sample
--                  leads have none, so are never sent), inbound_events no_show,
--                  sms_opt_outs opt-out -> one outbox row. A trigger failure
--                  never blocks the lead write (it warns and moves on).
--   functions      ghl_claim_outbox / ghl_finish_outbox (ghl-push),
--                  ghl_lead_for_contact / ghl_log_text (ghl-webhook). Service
--                  role only.
--
-- Webhook writes reuse what exists: replies -> lead_sms_replies (183; the VA
-- queue, contact_log 199 and activity feed 202 already read it), texts GHL
-- sent -> inbound_events kind text_sent, state done, detail.body (199 reads it
-- into the contact log; no detail.step, so lead-workflow-sms ignores it, see
-- 213's notes), opt-outs -> sms_set_opt (157) with source 'GHL'.
--
-- Cron (Brayden's door, after the functions are deployed; not in this file so
-- applying the migration starts nothing):
--   select cron.schedule('ghl-push', '* * * * *',
--     $$select public.fulfillment_cron_post('ghl-push', '{"action":"run"}'::jsonb)$$);

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception '230 needs 152_admin_role_paths applied first';
  end if;
  if to_regclass('public.inbound_events') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'leads' and column_name = 'inbound_stage') then
    raise exception '230 needs 180_agent_inbounds applied first';
  end if;
  if to_regclass('public.lead_sms_replies') is null or to_regprocedure('public.lead_sms_match(text)') is null then
    raise exception '230 needs 183_lead_sms_replies applied first';
  end if;
  if to_regclass('public.sms_opt_outs') is null or to_regprocedure('public.sms_e164(text)') is null then
    raise exception '230 needs 157_text_consent applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'is_sample')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'inbound_events' and column_name = 'is_sample') then
    raise exception '230 needs 186_is_sample_flag applied first';
  end if;
  if to_regprocedure('public.fulfillment_cron_ok(text)') is null then
    raise exception '230 needs 145_pay_per_cancel applied first (ghl-push is called by cron)';
  end if;
end $$;

-- ── ghl_settings ────────────────────────────────────────────────────────────
create table if not exists public.ghl_settings (
  id                             boolean primary key default true check (id),
  enabled                        boolean not null default false,
  location_id                    text check (location_id is null or location_id ~ '^[A-Za-z0-9]{6,64}$'),
  workflow_new_inbound           text check (workflow_new_inbound is null or workflow_new_inbound ~ '^[A-Za-z0-9-]{6,64}$'),
  workflow_appointment_reminder  text check (workflow_appointment_reminder is null or workflow_appointment_reminder ~ '^[A-Za-z0-9-]{6,64}$'),
  workflow_no_show               text check (workflow_no_show is null or workflow_no_show ~ '^[A-Za-z0-9-]{6,64}$'),
  workflow_opt_out               text check (workflow_opt_out is null or workflow_opt_out ~ '^[A-Za-z0-9-]{6,64}$'),
  last_sync_at                   timestamptz,
  last_sync_status               text check (last_sync_status in ('ok', 'error', 'off', 'not_configured')),
  last_sync_error                text check (char_length(last_sync_error) <= 500),
  updated_at                     timestamptz not null default now(),
  updated_by                     uuid references public.profiles(id) on delete set null
);
insert into public.ghl_settings (id) values (true) on conflict (id) do nothing;

comment on table public.ghl_settings is
  'GoHighLevel bridge settings (P850). One row. The API key is the Supabase secret GHL_API_KEY, never a column.';

alter table public.ghl_settings enable row level security;
revoke all on public.ghl_settings from public, anon, authenticated;
grant select on public.ghl_settings to authenticated;
-- Admins edit only these; last_sync_* is written by ghl-push (service role).
grant update (enabled, location_id, workflow_new_inbound, workflow_appointment_reminder,
              workflow_no_show, workflow_opt_out) on public.ghl_settings to authenticated;

drop policy if exists ghl_settings_admin_read on public.ghl_settings;
create policy ghl_settings_admin_read on public.ghl_settings
  for select to authenticated using (public.is_admin());
drop policy if exists ghl_settings_admin_write on public.ghl_settings;
create policy ghl_settings_admin_write on public.ghl_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.ghl_settings_stamp()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;
revoke execute on function public.ghl_settings_stamp() from public, anon, authenticated;
drop trigger if exists ghl_settings_stamp on public.ghl_settings;
create trigger ghl_settings_stamp
  before update on public.ghl_settings
  for each row execute function public.ghl_settings_stamp();

create or replace function public.ghl_enabled()
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  select coalesce((select enabled from public.ghl_settings where id), false)
$$;
revoke execute on function public.ghl_enabled() from public, anon, authenticated;
grant  execute on function public.ghl_enabled() to service_role;

-- ── ghl_contacts ────────────────────────────────────────────────────────────
create table if not exists public.ghl_contacts (
  lead_id     uuid primary key references public.leads(id) on delete cascade,
  contact_id  text not null unique,
  last_stage  text,
  updated_at  timestamptz not null default now()
);
alter table public.ghl_contacts enable row level security;
revoke all on public.ghl_contacts from public, anon, authenticated;

-- ── ghl_outbox ──────────────────────────────────────────────────────────────
create table if not exists public.ghl_outbox (
  id           bigint generated always as identity primary key,
  event        text not null check (event in ('new_inbound', 'stage', 'appointment_reminder', 'no_show', 'opt_out')),
  lead_id      uuid references public.leads(id) on delete cascade,
  phone        text,
  stage        text,
  created_at   timestamptz not null default now(),
  attempts     int not null default 0,
  next_try_at  timestamptz not null default now(),
  done_at      timestamptz,
  failed       boolean not null default false,
  last_error   text check (char_length(last_error) <= 500),
  check (lead_id is not null or phone is not null)
);
create index if not exists ghl_outbox_due_idx on public.ghl_outbox (next_try_at) where done_at is null;
alter table public.ghl_outbox enable row level security;
revoke all on public.ghl_outbox from public, anon, authenticated;

-- ── triggers: fill the outbox while the switch is on ────────────────────────
create or replace function public.ghl_enqueue_lead()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  if new.inbound_stage is null or coalesce(new.is_sample, false) or not public.ghl_enabled() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into ghl_outbox (event, lead_id, stage) values ('new_inbound', new.id, new.inbound_stage);
  elsif new.inbound_stage is distinct from old.inbound_stage then
    insert into ghl_outbox (event, lead_id, stage)
    values (case when new.inbound_stage = 'booked' then 'appointment_reminder' else 'stage' end,
            new.id, new.inbound_stage);
  end if;
  return new;
exception when others then
  raise warning 'ghl_enqueue_lead: %', sqlerrm;   -- never block the lead write
  return new;
end;
$$;
revoke execute on function public.ghl_enqueue_lead() from public, anon, authenticated;
drop trigger if exists leads_ghl_enqueue on public.leads;
create trigger leads_ghl_enqueue
  after insert or update of inbound_stage on public.leads
  for each row execute function public.ghl_enqueue_lead();

create or replace function public.ghl_enqueue_no_show()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  if new.kind = 'no_show' and new.state = 'done' and not coalesce(new.is_sample, false)
     and public.ghl_enabled() then
    insert into ghl_outbox (event, lead_id) values ('no_show', new.lead_id);
  end if;
  return new;
exception when others then
  raise warning 'ghl_enqueue_no_show: %', sqlerrm;
  return new;
end;
$$;
revoke execute on function public.ghl_enqueue_no_show() from public, anon, authenticated;
drop trigger if exists inbound_events_ghl_no_show on public.inbound_events;
create trigger inbound_events_ghl_no_show
  after insert on public.inbound_events
  for each row execute function public.ghl_enqueue_no_show();

-- An opt-out recorded in Ohvara (Twilio STOP etc.) is mirrored to GHL. One that
-- came FROM GHL (source 'GHL') is not sent back.
create or replace function public.ghl_enqueue_opt_out()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  if new.opted_out and (tg_op = 'INSERT' or not old.opted_out)
     and coalesce(new.source, '') <> 'GHL' and public.ghl_enabled() then
    insert into ghl_outbox (event, lead_id, phone)
    values ('opt_out', public.lead_sms_match(new.phone), new.phone);
  end if;
  return new;
exception when others then
  raise warning 'ghl_enqueue_opt_out: %', sqlerrm;
  return new;
end;
$$;
revoke execute on function public.ghl_enqueue_opt_out() from public, anon, authenticated;
drop trigger if exists sms_opt_outs_ghl on public.sms_opt_outs;
create trigger sms_opt_outs_ghl
  after insert or update of opted_out on public.sms_opt_outs
  for each row execute function public.ghl_enqueue_opt_out();

-- ── ghl-push: claim and finish ──────────────────────────────────────────────
-- Claims due rows (skip locked, 5-minute lease) with what GHL needs.
create or replace function public.ghl_claim_outbox(p_limit int default 25)
 returns table (id bigint, event text, lead_id uuid, stage text, contact_id text,
                contact_name text, phone text, email text, state text)
 language plpgsql
 volatile
 security definer
 set search_path to 'public'
as $$
begin
  return query
  with due as (
    select o.id
      from ghl_outbox o
     where o.done_at is null and o.next_try_at <= now()
     order by o.next_try_at, o.id
     limit greatest(1, least(coalesce(p_limit, 25), 100))
       for update skip locked
  ), claimed as (
    update ghl_outbox o
       set attempts = o.attempts + 1, next_try_at = now() + interval '5 minutes'
      from due
     where o.id = due.id
    returning o.id, o.event, o.lead_id, o.stage, o.phone
  )
  select c.id, c.event, c.lead_id, coalesce(c.stage, l.inbound_stage), gc.contact_id,
         nullif(btrim(coalesce(l.contact_name, '')), ''),
         coalesce(public.sms_e164(l.phone), public.sms_e164(c.phone), c.phone, l.phone),
         nullif(btrim(coalesce(l.email, '')), ''), l.state
    from claimed c
    left join leads l on l.id = c.lead_id
    left join ghl_contacts gc on gc.lead_id = c.lead_id
   order by c.id;
end;
$$;
revoke execute on function public.ghl_claim_outbox(int) from public, anon, authenticated;
grant  execute on function public.ghl_claim_outbox(int) to service_role;

-- ok: done, remember the contact. Not ok: retry with backoff; after 8 tries,
-- or when p_final (a 4xx GHL will never accept), stop and mark it failed.
create or replace function public.ghl_finish_outbox(p_id bigint, p_ok boolean, p_contact_id text default null,
                                                    p_error text default null, p_final boolean default false)
 returns void
 language plpgsql
 volatile
 security definer
 set search_path to 'public'
as $$
declare
  r ghl_outbox;
begin
  select * into r from ghl_outbox where id = p_id;
  if not found then
    return;
  end if;
  if p_ok then
    update ghl_outbox set done_at = now(), last_error = null where id = p_id;
    if r.lead_id is not null and nullif(btrim(coalesce(p_contact_id, '')), '') is not null then
      insert into ghl_contacts (lead_id, contact_id, last_stage, updated_at)
      values (r.lead_id, btrim(p_contact_id), r.stage, now())
      on conflict (lead_id) do update
        set contact_id = excluded.contact_id,
            last_stage = coalesce(excluded.last_stage, ghl_contacts.last_stage),
            updated_at = now();
    end if;
  elsif p_final or r.attempts >= 8 then
    update ghl_outbox set done_at = now(), failed = true, last_error = left(p_error, 500) where id = p_id;
  else
    update ghl_outbox
       set next_try_at = now() + make_interval(mins => least(60, 2 ^ r.attempts)::int),
           last_error = left(p_error, 500)
     where id = p_id;
  end if;
end;
$$;
revoke execute on function public.ghl_finish_outbox(bigint, boolean, text, text, boolean) from public, anon, authenticated;
grant  execute on function public.ghl_finish_outbox(bigint, boolean, text, text, boolean) to service_role;

create or replace function public.ghl_note_sync(p_status text, p_error text default null)
 returns void
 language sql
 volatile
 security definer
 set search_path to 'public'
as $$
  update ghl_settings
     set last_sync_at = now(), last_sync_status = p_status, last_sync_error = left(p_error, 500)
   where id
$$;
revoke execute on function public.ghl_note_sync(text, text) from public, anon, authenticated;
grant  execute on function public.ghl_note_sync(text, text) to service_role;

-- ── ghl-webhook: find the lead, log a text GHL sent ─────────────────────────
-- The lead for a GHL contact: the one we pushed it from, else the newest lead
-- with that phone (lead_sms_match). Returns no row when none.
create or replace function public.ghl_lead_for_contact(p_contact_id text, p_phone text)
 returns table (lead_id uuid, agent_id uuid, is_sample boolean)
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  select l.id, coalesce(l.assigned_rep_id, l.transfer_agent_id), coalesce(l.is_sample, false)
    from leads l
   where l.id = coalesce(
           (select gc.lead_id from ghl_contacts gc where gc.contact_id = nullif(btrim(p_contact_id), '')),
           case when nullif(btrim(p_phone), '') is not null then public.lead_sms_match(p_phone) end)
$$;
revoke execute on function public.ghl_lead_for_contact(text, text) from public, anon, authenticated;
grant  execute on function public.ghl_lead_for_contact(text, text) to service_role;

-- A text GHL sent, on the lead's timeline once per GHL message ID; a later
-- webhook for the same message only updates its status.
create or replace function public.ghl_log_text(p_lead uuid, p_agent uuid, p_message_id text, p_body text,
                                               p_status text, p_at timestamptz, p_is_sample boolean default false)
 returns text
 language plpgsql
 volatile
 security definer
 set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if p_lead is null or nullif(btrim(p_message_id), '') is null then
    return 'skipped';
  end if;
  perform pg_advisory_xact_lock(hashtext('ghl_log_text:' || p_message_id));
  select ev.id into v_id
    from inbound_events ev
   where ev.lead_id = p_lead and ev.kind = 'text_sent' and ev.detail->>'ghl_message_id' = p_message_id
   limit 1;
  if v_id is not null then
    update inbound_events
       set detail = detail || jsonb_strip_nulls(jsonb_build_object('status', p_status))
     where id = v_id;
    return 'updated';
  end if;
  insert into inbound_events (lead_id, agent_id, kind, state, at, label, detail, actor_name, actor_role, is_sample)
  values (p_lead, p_agent, 'text_sent', 'done', coalesce(p_at, now()), 'Text sent',
          jsonb_strip_nulls(jsonb_build_object(
            'source', 'ghl', 'ghl_message_id', p_message_id, 'status', p_status,
            'body', left(p_body, 1600), 'summary', 'Sent by the texting service.')),
          'Ohvara', 'system', coalesce(p_is_sample, false));
  return 'inserted';
end;
$$;
revoke execute on function public.ghl_log_text(uuid, uuid, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant  execute on function public.ghl_log_text(uuid, uuid, text, text, text, timestamptz, boolean) to service_role;
