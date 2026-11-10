-- 262 — P932: path of least resistance.
--   1. carrier_playbook: how each carrier does each change (cancel, beneficiary, bank, address, name): the easiest
--      allowed way (e-sign their form, the owner online, or the owner on a merge call), the form, where it goes, what
--      the client needs ready, the source and the date checked. Seeded from src/lib/servicing/playbookData.js
--      (researched Nov 10 2026). Admin and VAs edit an entry with playbook_save; every edit is logged.
--   2. servicing_path(carrier, change): the path the system takes ('esign' when a signed form goes by fax, email or
--      upload, else 'merge'); new change tasks get it stamped (servicing_tasks.path) so the VA's panel has it ready.
--   3. The hold line (hold_line_settings, admin): the hold music track (3 included, or an upload in bucket hold-music),
--      the AI front desk after ~20 s, an update every ~60 s, a callback past ~10 minutes.
--   4. front_desk_calls: what the AI front desk learned on an inbound call (who, the change, a 2–3 line summary, the
--      wait it told them, hold / callback / e-sign). help-voice writes it (service role); VAs and admin read it.
--      front_desk_state gives help-voice the live numbers for the estimated wait; front_desk_callback books the call
--      back and drafts the confirmation text (sending is the GoHighLevel slot; sms_live stays off).
--   5. route_tick: a caller on the hold line waits up to max_wait_min (10) before becoming a callback (was 2 minutes
--      for everyone). Everything voice stays behind recovery_config.voice_live / ai_caller_live.
-- Needs: 236 (calling engine), 239 (documents), 244 (ai_caller_live), 258 (client line).

-- ── 1. The carrier playbook ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.carrier_playbook (
  id             uuid primary key default gen_random_uuid(),
  carrier_key    text not null,                       -- the catalog id, e.g. 'cat-americo'
  carrier_name   text not null,
  names          text[] not null default '{}',        -- normalized name + aliases, for matching policies.carrier_name
  action         text not null check (action in ('cancel', 'beneficiary', 'bank', 'address', 'name')),
  method         text not null check (method in ('esign', 'online', 'merge', 'check')),
  esign_accepted text not null default 'unknown' check (esign_accepted in ('yes', 'no', 'unknown')),
  form_name      text,
  form_url       text check (form_url is null or form_url ~ '^https://'),
  send_via       text check (send_via is null or send_via in ('fax', 'email', 'upload', 'mail')),
  send_to        text,
  phone          text,
  have_ready     text[] not null default '{}',
  notes          text check (notes is null or char_length(notes) <= 400),
  source_url     text,
  checked_on     date,
  status         text not null default 'check' check (status in ('confirmed', 'check')),
  updated_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now(),
  unique (carrier_key, action)
);
create index if not exists carrier_playbook_names_idx on public.carrier_playbook using gin (names);
alter table public.carrier_playbook enable row level security;
revoke all on public.carrier_playbook from public, anon, authenticated;
grant select on public.carrier_playbook to authenticated;
drop policy if exists carrier_playbook_read on public.carrier_playbook;
create policy carrier_playbook_read on public.carrier_playbook for select to authenticated using (true);

create table if not exists public.carrier_playbook_log (
  id          bigserial primary key,
  carrier_key text not null,
  action      text not null,
  edited_by   uuid references public.profiles(id) on delete set null,
  edited_at   timestamptz not null default now(),
  before      jsonb,
  after       jsonb not null
);
create index if not exists carrier_playbook_log_idx on public.carrier_playbook_log (carrier_key, edited_at desc);
alter table public.carrier_playbook_log enable row level security;
revoke all on public.carrier_playbook_log from public, anon, authenticated;
grant select on public.carrier_playbook_log to authenticated;
drop policy if exists carrier_playbook_log_read on public.carrier_playbook_log;
create policy carrier_playbook_log_read on public.carrier_playbook_log for select to authenticated
  using (public.is_admin() or public.is_fulfillment());

create or replace function public.playbook_norm(p text) returns text language sql immutable set search_path = public as $$
  select trim(regexp_replace(lower(replace(coalesce(p, ''), '&', ' ')), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Admin or a VA saves one entry (a new carrier too: p_name names it). Logged with the row before and after.
create or replace function public.playbook_save(p_carrier_key text, p_action text, p jsonb, p_name text default null)
returns public.carrier_playbook language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  old public.carrier_playbook;
  v   public.carrier_playbook;
  m   text := coalesce(p ->> 'method', 'check');
  key text := coalesce(nullif(trim(p_carrier_key), ''), 'new-' || replace(public.playbook_norm(p_name), ' ', '-'));
begin
  if uid is null or not (public.is_admin() or public.is_fulfillment()) then
    raise exception 'Only admin and the team can edit the carrier playbook' using errcode = '42501';
  end if;
  if key is null or key = 'new-' then raise exception 'Which carrier?' using errcode = '22023'; end if;
  select * into old from public.carrier_playbook where carrier_key = key and action = p_action for update;
  if m = 'esign' and (coalesce(p ->> 'send_via', '') not in ('fax', 'email', 'upload') or coalesce(trim(p ->> 'send_to'), '') = '') then
    raise exception 'An e-sign entry needs where the form goes (fax, email or upload)' using errcode = '22023';
  end if;
  insert into public.carrier_playbook as c (carrier_key, carrier_name, names, action, method, esign_accepted, form_name, form_url,
      send_via, send_to, phone, have_ready, notes, source_url, checked_on, status, updated_by, updated_at)
  values (key, coalesce(old.carrier_name, nullif(trim(p_name), ''), key),
          coalesce(old.names, array[public.playbook_norm(coalesce(p_name, key))]),
          p_action, m, coalesce(p ->> 'esign_accepted', 'unknown'), nullif(trim(p ->> 'form_name'), ''), nullif(trim(p ->> 'form_url'), ''),
          nullif(p ->> 'send_via', ''), nullif(trim(p ->> 'send_to'), ''), coalesce(nullif(trim(p ->> 'phone'), ''), old.phone),
          coalesce(array(select jsonb_array_elements_text(p -> 'have_ready')), old.have_ready, '{}'),
          nullif(trim(p ->> 'notes'), ''), coalesce(nullif(trim(p ->> 'source_url'), ''), old.source_url, 'Learned on a call'),
          current_date, case when m = 'check' then 'check' else 'confirmed' end, uid, now())
  on conflict (carrier_key, action) do update set
    method = excluded.method, esign_accepted = excluded.esign_accepted, form_name = excluded.form_name, form_url = excluded.form_url,
    send_via = excluded.send_via, send_to = excluded.send_to, phone = excluded.phone, have_ready = excluded.have_ready,
    notes = excluded.notes, source_url = excluded.source_url, checked_on = excluded.checked_on, status = excluded.status,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into v;
  insert into public.carrier_playbook_log (carrier_key, action, edited_by, before, after)
  values (key, p_action, uid, case when old.id is null then null else to_jsonb(old) end, to_jsonb(v));
  return v;
end;
$$;
revoke execute on function public.playbook_save(text, text, jsonb, text) from public, anon;
grant execute on function public.playbook_save(text, text, jsonb, text) to authenticated;

-- ── 2. The easiest path for a change ───────────────────────────────────────────────────────────────────────────
create or replace function public.playbook_action(p_kind text) returns text language sql immutable set search_path = public as $$
  select case p_kind
    when 'beneficiary_change' then 'beneficiary' when 'payment_change' then 'bank' when 'draft_date_change' then 'bank'
    when 'address_change' then 'address' when 'name_change' then 'name' when 'cancel_old' then 'cancel'
    when 'cancellation_request' then 'cancel'
    else case when p_kind in ('cancel', 'beneficiary', 'bank', 'address', 'name') then p_kind end end
$$;

create or replace function public.servicing_path(p_carrier text, p_kind text)
returns jsonb language sql stable security definer set search_path = public as $$
  with a as (select public.playbook_action(p_kind) as action),
       e as (select c.* from public.carrier_playbook c, a
              where c.action = a.action and public.playbook_norm(p_carrier) = any (c.names) limit 1)
  select case
    when (select action from a) is null then null
    when not exists (select 1 from e) then jsonb_build_object('known', false, 'path', 'merge', 'learn', true, 'action', (select action from a))
    else (select jsonb_build_object('known', true, 'action', e.action, 'carrier_key', e.carrier_key, 'carrier', e.carrier_name,
            'method', e.method, 'path', case when e.method = 'esign' and e.send_via in ('fax', 'email', 'upload') then 'esign' else 'merge' end,
            'learn', e.method = 'check', 'form', e.form_name, 'form_url', e.form_url, 'via', e.send_via, 'to', e.send_to,
            'phone', e.phone, 'have', to_jsonb(e.have_ready), 'esign', e.esign_accepted) from e)
  end
$$;
revoke execute on function public.servicing_path(text, text) from public, anon;
grant execute on function public.servicing_path(text, text) to authenticated;

alter table public.servicing_tasks add column if not exists path jsonb;
create or replace function public.servicing_task_path() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.path is null and new.policy_id is not null and public.playbook_action(new.kind) is not null then
    new.path := public.servicing_path((select coalesce(new_carrier_name, carrier_name) from public.policies where id = new.policy_id), new.kind);
  end if;
  return new;
end;
$$;
revoke execute on function public.servicing_task_path() from public, anon, authenticated;
drop trigger if exists servicing_task_path on public.servicing_tasks;
create trigger servicing_task_path before insert on public.servicing_tasks for each row execute function public.servicing_task_path();

-- ── 3. The hold line ───────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.hold_line_settings (
  id               int primary key default 1 check (id = 1),
  track            text not null default 'calm' check (track in ('calm', 'warm', 'bright', 'custom')),
  custom_url       text check (custom_url is null or custom_url ~ '^https://'),
  custom_name      text,
  front_desk_on    boolean not null default true,     -- the AI front desk (still needs ai_caller_live)
  ai_after_sec     int not null default 20 check (ai_after_sec between 10 and 60),
  update_every_sec int not null default 60 check (update_every_sec between 30 and 180),
  max_wait_min     int not null default 10 check (max_wait_min between 3 and 30),
  updated_by       uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now()
);
insert into public.hold_line_settings (id) values (1) on conflict (id) do nothing;
alter table public.hold_line_settings enable row level security;
revoke all on public.hold_line_settings from public, anon, authenticated;
grant select on public.hold_line_settings to authenticated;
drop policy if exists hold_line_settings_read on public.hold_line_settings;
create policy hold_line_settings_read on public.hold_line_settings for select to authenticated using (public.is_admin());

create or replace function public.admin_set_hold_line(p jsonb)
returns public.hold_line_settings language plpgsql volatile security definer set search_path = public as $$
declare v public.hold_line_settings;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p ->> 'track' = 'custom' and coalesce(p ->> 'custom_url', (select custom_url from public.hold_line_settings where id = 1)) is null then
    raise exception 'Upload a track first' using errcode = '22023';
  end if;
  update public.hold_line_settings set
    track = coalesce(p ->> 'track', track),
    custom_url = case when p ? 'custom_url' then nullif(p ->> 'custom_url', '') else custom_url end,
    custom_name = case when p ? 'custom_name' then nullif(p ->> 'custom_name', '') else custom_name end,
    front_desk_on = coalesce((p ->> 'front_desk_on')::boolean, front_desk_on),
    ai_after_sec = coalesce((p ->> 'ai_after_sec')::int, ai_after_sec),
    update_every_sec = coalesce((p ->> 'update_every_sec')::int, update_every_sec),
    max_wait_min = coalesce((p ->> 'max_wait_min')::int, max_wait_min),
    updated_by = auth.uid(), updated_at = now()
  where id = 1 returning * into v;
  return v;
end;
$$;
revoke execute on function public.admin_set_hold_line(jsonb) from public, anon;
grant execute on function public.admin_set_hold_line(jsonb) to authenticated;

-- An uploaded track: public to read (Twilio plays it by URL), admins write. Audio only, 15 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hold-music', 'hold-music', true, 15728640, array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav'])
on conflict (id) do nothing;
drop policy if exists hold_music_admin_write on storage.objects;
create policy hold_music_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'hold-music' and public.is_admin());
drop policy if exists hold_music_admin_update on storage.objects;
create policy hold_music_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'hold-music' and public.is_admin());
drop policy if exists hold_music_admin_delete on storage.objects;
create policy hold_music_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hold-music' and public.is_admin());

-- ── 4. The AI front desk ───────────────────────────────────────────────────────────────────────────────────────
alter table public.help_calls add column if not exists hold_line boolean not null default false;   -- caller waits outside the conference

create table if not exists public.front_desk_calls (
  call_sid      text primary key,
  caller        text,
  policy_id     uuid references public.policies(id) on delete set null,
  name          text,
  known         boolean not null default false,
  dob           text,
  need          text check (need is null or need in ('cancel', 'beneficiary', 'bank', 'address', 'name', 'payment', 'question')),
  carrier       text,
  said          text check (said is null or char_length(said) <= 500),
  detail        text check (detail is null or char_length(detail) <= 500),
  summary       text check (summary is null or char_length(summary) <= 600),
  path          jsonb,
  estimate_min  int,
  choice        text check (choice is null or choice in ('hold', 'callback', 'esign')),
  status        text not null default 'greeting' check (status in ('greeting', 'qualifying', 'holding', 'with_va', 'callback', 'esign_requested', 'gone')),
  callback_at   timestamptz,
  callback_text text check (callback_text is null or char_length(callback_text) <= 320),
  va_id         uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists front_desk_calls_created_idx on public.front_desk_calls (created_at desc);
alter table public.front_desk_calls enable row level security;
revoke all on public.front_desk_calls from public, anon, authenticated;
grant select on public.front_desk_calls to authenticated;
drop policy if exists front_desk_calls_read on public.front_desk_calls;
create policy front_desk_calls_read on public.front_desk_calls for select to authenticated
  using (public.is_admin() or public.is_fulfillment());

-- help-voice (service role): everything the front desk and the hold line need, in one read.
create or replace function public.front_desk_state(p_call_sid text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  q  public.call_queue; h public.help_calls; s public.hold_line_settings; f public.front_desk_calls; pol public.policies;
  rc record; avg_min numeric; n int;
begin
  select * into h from public.help_calls where call_sid = p_call_sid;
  select * into q from public.call_queue where help_call_sid = p_call_sid order by created_at desc limit 1;
  select * into s from public.hold_line_settings where id = 1;
  select * into f from public.front_desk_calls where call_sid = p_call_sid;
  select voice_live, sms_live, ai_caller_live into rc from public.recovery_config limit 1;
  select * into pol from public.policies
   where public.sms_e164(client_phone) = public.sms_e164(coalesce(h.caller_number, f.caller)) and closed_at is null and archived_at is null
   order by created_at desc limit 1;
  select avg(extract(epoch from ended_at - live_at)) / 60, count(*) into avg_min, n from public.va_lines
   where kind = 'inbound' and live_at is not null and ended_at > now() - interval '14 days';
  return jsonb_build_object(
    'taken', exists (select 1 from public.va_lines v where v.help_call_sid = p_call_sid and v.status in ('open', 'live'))
             or coalesce(h.status, '') in ('live', 'transferring', 'transferred'),
    'gone', coalesce(h.status = 'ended', false),
    'queued', q.id is not null and q.status in ('waiting', 'offered', 'held'),
    'ahead', coalesce((select count(*) from public.call_queue o where o.kind = 'inbound' and o.status in ('waiting', 'offered', 'held')
                        and o.help_call_sid is distinct from p_call_sid and o.ready_at < coalesce(q.ready_at, now())), 0),
    'free', (select count(*) from public.va_presence where status = 'available'),
    'busy', (select count(*) from public.va_presence where status in ('on_call', 'wrap', 'on_hold_carrier', 'ringing')),
    'online', (select count(*) from public.va_presence where status not in ('offline', 'away')),
    'avg_min', case when n >= 5 then round(avg_min, 1) end,
    'waited_sec', coalesce(extract(epoch from now() - h.created_at)::int, 0),
    'desk_open', public.route_desk_open(),
    'voice_live', coalesce(rc.voice_live, false), 'sms_live', coalesce(rc.sms_live, false), 'ai_live', coalesce(rc.ai_caller_live, false),
    'settings', to_jsonb(s),
    'client', case when pol.id is null then null else jsonb_build_object('policy_id', pol.id,
                'name', trim(coalesce(pol.client_first_name, '') || ' ' || coalesce(pol.client_last_name, '')), 'carrier', coalesce(pol.new_carrier_name, pol.carrier_name)) end,
    'desk', to_jsonb(f));
end;
$$;
revoke execute on function public.front_desk_state(text) from public, anon, authenticated;

-- help-voice: the caller goes on the hold line (they wait outside the conference, so they can press 1 and talk to
-- the front desk). The queue item is marked so route_tick gives them up to max_wait_min.
create or replace function public.front_desk_start(p_call_sid text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare h public.help_calls; st jsonb;
begin
  update public.help_calls set hold_line = true where call_sid = p_call_sid returning * into h;
  if h.id is null then return null; end if;
  update public.call_queue set detail = detail || '{"hold_line": true}'::jsonb
   where help_call_sid = p_call_sid and status in ('held', 'waiting', 'offered');
  st := public.front_desk_state(p_call_sid);
  insert into public.front_desk_calls (call_sid, caller, policy_id, name, known, carrier, status)
  values (p_call_sid, h.caller_number, nullif(st #>> '{client,policy_id}', '')::uuid, nullif(st #>> '{client,name}', ''),
          st -> 'client' is not null and st -> 'client' <> 'null'::jsonb, st #>> '{client,carrier}', 'greeting')
  on conflict (call_sid) do nothing;
  return public.front_desk_state(p_call_sid);
end;
$$;
revoke execute on function public.front_desk_start(text) from public, anon, authenticated;

-- help-voice saves what the caller said; the queue item carries the summary so the VA who takes it sees it.
create or replace function public.front_desk_save(p_call_sid text, p jsonb)
returns public.front_desk_calls language plpgsql volatile security definer set search_path = public as $$
declare v public.front_desk_calls;
begin
  insert into public.front_desk_calls as f (call_sid, caller, policy_id, name, known, dob, need, carrier, said, detail, summary, path,
      estimate_min, choice, status, va_id)
  values (p_call_sid, p ->> 'caller', nullif(p ->> 'policy_id', '')::uuid, p ->> 'name', coalesce((p ->> 'known')::boolean, false),
          p ->> 'dob', p ->> 'need', p ->> 'carrier', left(p ->> 'said', 500), left(p ->> 'detail', 500), left(p ->> 'summary', 600),
          p -> 'path', (p ->> 'estimate_min')::int, p ->> 'choice', coalesce(p ->> 'status', 'greeting'), nullif(p ->> 'va_id', '')::uuid)
  on conflict (call_sid) do update set
    caller = coalesce(excluded.caller, f.caller), policy_id = coalesce(excluded.policy_id, f.policy_id), name = coalesce(excluded.name, f.name),
    known = f.known or excluded.known, dob = coalesce(excluded.dob, f.dob), need = coalesce(excluded.need, f.need),
    carrier = coalesce(excluded.carrier, f.carrier), said = coalesce(excluded.said, f.said), detail = coalesce(excluded.detail, f.detail),
    summary = coalesce(excluded.summary, f.summary), path = coalesce(excluded.path, f.path),
    estimate_min = coalesce(excluded.estimate_min, f.estimate_min), choice = coalesce(excluded.choice, f.choice),
    status = case when p ? 'status' then excluded.status else f.status end, va_id = coalesce(excluded.va_id, f.va_id), updated_at = now()
  returning * into v;
  if v.summary is not null then
    update public.call_queue set detail = detail || jsonb_build_object('front_desk', v.summary, 'need', v.need)
     where help_call_sid = p_call_sid and status in ('held', 'waiting', 'offered', 'taken');
    update public.va_lines set detail = detail || jsonb_build_object('front_desk', v.summary, 'need', v.need)
     where help_call_sid = p_call_sid and status <> 'ended';
  end if;
  return v;
end;
$$;
revoke execute on function public.front_desk_save(text, jsonb) from public, anon, authenticated;

-- The caller pressed 1, waited past max_wait_min, or nobody is on shift: book the callback (P907 callback on the
-- queue: now + the estimate while the desk is open, else 8 AM Central), end the wait, draft the confirmation text.
create or replace function public.front_desk_callback(p_call_sid text, p_reason text default 'asked')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  h public.help_calls; q public.call_queue; f public.front_desk_calls; due timestamptz; cb uuid; txt text;
begin
  select * into h from public.help_calls where call_sid = p_call_sid;
  if h.id is null then return jsonb_build_object('ok', false, 'why', 'no call'); end if;
  select * into f from public.front_desk_calls where call_sid = p_call_sid;
  if f.status = 'callback' then return jsonb_build_object('ok', true, 'duplicate', true, 'due', f.callback_at); end if;
  select * into q from public.call_queue where help_call_sid = p_call_sid and status in ('held', 'waiting', 'offered') limit 1;
  if q.id is not null then
    update public.call_queue set status = 'done', cancel_reason = 'callback_booked', offered_to = null where id = q.id;
    update public.va_presence set status = 'available', updated_at = now() where user_id = q.offered_to and status = 'ringing';
  end if;
  due := case when public.route_desk_open() then now() + make_interval(mins => greatest(coalesce(f.estimate_min, 10), 10))
              else public.route_desk_next(now()) end;
  cb := public.route_enqueue('callback', h.lead_id, p_phone => h.caller_number, p_name => coalesce(f.name, q.name), p_due => due,
          p_policy => f.policy_id,
          p_detail => jsonb_build_object('from', 'front_desk', 'reason', p_reason, 'help_call_sid', p_call_sid, 'front_desk', f.summary, 'need', f.need));
  txt := 'Deedstone Insurance: a specialist will call you back ' ||
         case when public.route_desk_open() then 'at ' || to_char(due at time zone 'America/Chicago', 'FMHH12:MI AM') || ' Central today.'
              else 'after 8 AM Central on ' || to_char(due at time zone 'America/Chicago', 'FMDay') || '.' end;
  perform public.front_desk_save(p_call_sid, jsonb_build_object('choice', 'callback', 'status', 'callback'));
  update public.front_desk_calls set callback_at = due, callback_text = left(txt, 320) where call_sid = p_call_sid;
  update public.help_calls set status = 'ended', ended_at = now(), end_reason = 'callback_booked', outcome = 'booked'
   where call_sid = p_call_sid and status in ('ringing', 'no_answer');
  return jsonb_build_object('ok', true, 'due', due, 'queue_id', cb, 'text', txt);
end;
$$;
revoke execute on function public.front_desk_callback(text, text) from public, anon, authenticated;

-- ── 5. route_tick: hold-line callers wait up to max_wait_min ───────────────────────────────────────────────────
-- ROUTE_TICK:BEGIN (scripts/p932-playbook.mjs copies 236's route_tick here with section g changed)
create or replace function public.route_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; chk record; offered int := 0; who uuid; nm text; ended int := 0;
begin
  if not pg_try_advisory_xact_lock(882001) then return jsonb_build_object('skipped', true); end if;

  -- a. Offers nobody took in 15 s: a counted miss.
  for r in select id from public.call_queue where status = 'offered' and offer_expires_at < now() loop
    perform public.route_missed(r.id, true);
  end loop;

  -- b. Quiet for 30 s: out of routing (an offer to them goes back, uncounted), and told.
  for r in select p.* from public.va_presence p
            where p.status in ('available', 'ringing') and (p.last_seen is null or p.last_seen < now() - interval '30 seconds') loop
    for who in select id from public.call_queue where status = 'offered' and offered_to = r.user_id loop
      perform public.route_missed(who, false);
    end loop;
    update public.va_presence set status = 'offline', since = now(), pulled_at = now(), pulled_reason = 'silent', updated_at = now()
     where user_id = r.user_id;
    begin
      perform public.notify(r.user_id, 'va_pulled', 'You were taken out of the call rotation',
        'Your portal stopped answering. Open it and press Available to get calls again.', '/fulfillment', true,
        'pulled:' || r.user_id || ':' || to_char(now(), 'YYYYMMDDHH24MI'), '{}'::jsonb);
    exception when others then raise warning 'va_pulled: %', sqlerrm;
    end;
  end loop;
  -- 15 minutes quiet while on shift: admins told once.
  for r in select p.user_id from public.va_presence p join public.profiles pr on pr.id = p.user_id
            where pr.role::text = 'fulfillment' and p.pulled_reason = 'silent' and p.silent_alerted_at is null
              and p.pulled_at < now() - interval '15 minutes' + interval '30 seconds'
              and public.va_on_shift_at(p.user_id, now()) loop
    update public.va_presence set silent_alerted_at = now() where user_id = r.user_id;
    perform public.route_notify_admins('va_silent',
      coalesce((select full_name from public.profiles where id = r.user_id), 'A VA') || ' has been quiet for 15 minutes',
      'They are on shift but their portal is not answering.', '/admin/team', 'silent:' || r.user_id || ':' || to_char(now(), 'YYYYMMDD'));
  end loop;

  -- c. Wrap-up past 3 minutes: admins told once per wrap.
  for r in select p.user_id from public.va_presence p
            where p.status = 'wrap' and p.wrap_alerted_at is null and p.wrap_started_at < now() - interval '3 minutes' loop
    update public.va_presence set wrap_alerted_at = now() where user_id = r.user_id;
    perform public.route_notify_admins('wrap_stuck',
      coalesce((select full_name from public.profiles where id = r.user_id), 'A VA') || ' has been in wrap-up over 3 minutes',
      'The call outcome is not logged yet.', '/admin/team', 'wrap:' || r.user_id || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  end loop;

  -- d. Callbacks at the promised time (the promiser first), ahead of servicing.
  for r in select l.id, l.va_callback_at, l.va_last_worked_by from public.leads l
            where l.va_outcome = 'callback' and l.va_callback_at <= now() and l.va_callback_at > now() - interval '2 days'
              and not exists (select 1 from public.call_queue q where q.lead_id = l.id and q.kind = 'callback'
                                and (q.status in ('held', 'waiting', 'offered', 'taken') or q.due_at = l.va_callback_at)) loop
    perform public.route_enqueue('callback', r.id, p_due => r.va_callback_at, p_promiser => r.va_last_worked_by, p_offer => false);
  end loop;
  -- More than 5 minutes late: admins told once.
  for r in select q.* from public.call_queue q
            where q.kind = 'callback' and q.status in ('waiting', 'offered') and not q.late_alerted
              and q.due_at < now() - interval '5 minutes' loop
    update public.call_queue set late_alerted = true where id = r.id;
    perform public.route_notify_admins('callback_late', 'Callback late: ' || coalesce(r.name, 'a lead'),
      'Promised for ' || to_char(r.due_at at time zone 'America/Chicago', 'HH12:MI AM') || ' CT and nobody has called yet.',
      '/admin/team', 'late:' || r.id);
  end loop;

  -- e. Held items whose window opened: check again.
  for r in select * from public.call_queue where status = 'held' and hold_until is not null and hold_until <= now() loop
    select * into chk from public.predial_eval(r.phone, r.state, r.lead_id, 'call', now(), r.policy_id, r.detail ? 'help_call_sid');
    if chk.ok and public.route_desk_open() then
      update public.call_queue set status = 'waiting', ready_at = now(), hold_until = null where id = r.id;
    elsif chk.ok then
      update public.call_queue set hold_until = public.route_desk_next(), hold_reason = 'after_hours' where id = r.id;
    elsif chk.reason in ('outside_hours', 'attempt_cap') then
      update public.call_queue set hold_until = greatest(chk.next_at, now() + interval '1 minute'), hold_reason = chk.reason where id = r.id;
    else
      update public.call_queue set status = 'cancelled', cancel_reason = chk.reason where id = r.id;
    end if;
  end loop;

  -- f. Dropped calls: the VA didn't rejoin in 60 s → the next VA gets it with the notes. Nobody in another 60 s →
  --    the line is ended by fulfillment-call (Twilio) and becomes a callback.
  for r in select v.* from public.va_lines v where v.status = 'rescue' and v.rescue_until < now()
              and not exists (select 1 from public.call_queue q where q.line_id = v.id and q.kind = 'rescue') loop
    select coalesce(l.contact_name, l.business_name) into nm from public.leads l where l.id = r.lead_id;
    perform public.route_enqueue('rescue', r.lead_id, p_line => r.id, p_name => nm, p_policy => r.policy_id,
      p_detail => r.detail, p_exclude => array_remove(array[r.va_id], null), p_offer => false);
  end loop;
  for r in select q.*, v.va_id as old_va from public.call_queue q join public.va_lines v on v.id = q.line_id
            where q.kind = 'rescue' and q.status in ('waiting', 'offered') and q.ready_at < now() - interval '60 seconds'
              and v.status = 'rescue' loop
    update public.call_queue set status = 'expired', cancel_reason = 'no_va_in_time', offered_to = null where id = r.id;
    update public.va_presence set status = 'available', updated_at = now() where user_id = r.offered_to and status = 'ringing';
    update public.va_lines set status = 'ended', ended_at = now(), end_reason = 'rescue_timeout' where id = r.line_id;
    if r.lead_id is not null or r.policy_id is not null then
      perform public.route_enqueue('callback', r.lead_id, p_due => now(), p_promiser => r.old_va, p_policy => r.policy_id,
        p_name => r.name, p_detail => jsonb_build_object('from', 'dropped_call'));
    end if;
    begin
      perform public.fulfillment_cron_post('fulfillment-call', jsonb_build_object('cron', 'end_line', 'line_id', r.line_id));
    exception when others then raise warning 'end_line post: %', sqlerrm;
    end;
    ended := ended + 1;
  end loop;

  -- g. Inbound callers nobody took in 2 minutes: help-voice ends the wait and they become a callback.
  --    P932: a caller on the hold line waits up to max_wait_min (help-voice books their callback itself);
  --    this only catches one help-voice lost (2 minutes past it).
  for r in select q.* from public.call_queue q
            where q.kind = 'inbound' and q.status in ('waiting', 'offered')
              and q.ready_at < now() - case when coalesce((q.detail ->> 'hold_line')::boolean, false)
                then make_interval(mins => coalesce((select max_wait_min from public.hold_line_settings where id = 1), 10) + 2)
                else interval '2 minutes' end loop
    update public.call_queue set status = 'expired', cancel_reason = 'no_va_in_time', offered_to = null where id = r.id;
    update public.va_presence set status = 'available', updated_at = now() where user_id = r.offered_to and status = 'ringing';
    perform public.route_enqueue('callback', r.lead_id, p_phone => r.phone, p_name => r.name, p_due => now(),
      p_detail => jsonb_build_object('from', 'inbound_no_answer', 'help_call_sid', r.help_call_sid));
    begin
      perform public.fulfillment_cron_post('help-voice', jsonb_build_object('cron', 'timeout', 'call', r.help_call_sid));
    exception when others then raise warning 'help timeout post: %', sqlerrm;
    end;
  end loop;

  -- h. Waiting 60 s: both admins pushed, then every 3 minutes; counted as a speed miss.
  for r in select q.* from public.call_queue q
            where q.status in ('waiting', 'offered') and q.kind in ('inbound', 'new_lead', 'callback')
              and q.ready_at < now() - interval '60 seconds'
              and (q.alerts = 0 or q.last_alert_at < now() - interval '3 minutes') loop
    update public.call_queue set alerts = alerts + 1, last_alert_at = now(),
           speed_miss = speed_miss or kind in ('inbound', 'new_lead')
     where id = r.id;
    perform public.route_notify_admins('lead_waiting',
      case r.kind when 'inbound' then 'A caller is waiting' when 'callback' then 'A callback is waiting' else 'A new lead is waiting' end
        || ': ' || coalesce(r.name, 'no name'),
      'Waiting ' || greatest(1, floor(extract(epoch from now() - r.ready_at) / 60))::int || ' min with no VA free.',
      '/admin/team', 'wait:' || r.id || ':' || (r.alerts + 1));
  end loop;

  -- i. Offer what's waiting: highest priority, then longest wait. Stops when nobody is free.
  for r in select id from public.call_queue where status = 'waiting'
            order by priority, coalesce(due_at, ready_at), ready_at loop
    if public.route_offer(r.id) is null then
      -- nobody free for this one; a lower item can't do better unless it may pull a VA off hold
      if not exists (select 1 from public.va_presence p where p.status in ('available', 'on_hold_carrier') and public.route_can_take(p)) then
        exit;
      end if;
    else
      offered := offered + 1;
    end if;
  end loop;
  return jsonb_build_object('offered', offered, 'ended', ended);
end;
$$;
revoke execute on function public.route_tick() from public, anon, authenticated;
-- ROUTE_TICK:END

-- ── Seed: the researched playbook (scripts/p932-playbook.mjs) ──────────────────────────────────────────────────
-- SEED:BEGIN
insert into public.carrier_playbook (carrier_key, carrier_name, names, action, method, esign_accepted, form_name, form_url,
  send_via, send_to, phone, have_ready, notes, source_url, checked_on, status) values
('cat-americo', 'Americo', array['americo', 'americo financial life', 'great southern life', 'united fidelity life']::text[], 'cancel', 'esign', 'yes', 'Surrender / cancel form', 'https://www.americo.com/SiteCollectionDocuments/SurrenderForm.pdf', 'email', 'forms@americo.com', '(816) 641-2850', array['Policy number', 'Owner’s signature']::text[], 'Americo also takes it on their own DocuSign web form.', 'https://www.americo.com/policy-holder/', '2026-11-10', 'confirmed'),
('cat-americo', 'Americo', array['americo', 'americo financial life', 'great southern life', 'united fidelity life']::text[], 'beneficiary', 'esign', 'no', 'Beneficiary change request', 'https://www.americo.com/SiteCollectionDocuments/BeneficiaryChange.pdf', 'fax', '(800) 395-9238', '(816) 641-2850', array['Policy number', 'New beneficiary: full name, relationship, date of birth', 'Share for each']::text[], 'Print, sign and send (wet ink). Only the owner can change it.', 'https://www.americo.com/policy-holder/', '2026-11-10', 'confirmed'),
('cat-americo', 'Americo', array['americo', 'americo financial life', 'great southern life', 'united fidelity life']::text[], 'bank', 'esign', 'yes', 'Bank draft authorization', 'https://www.americo.com/SiteCollectionDocuments/BankDraftAuthorization.pdf', 'email', 'forms@americo.com', '(816) 641-2850', array['Policy number', 'New bank routing and account number', 'New draft day', 'Account holder name']::text[], 'Also on Americo’s DocuSign web form.', 'https://www.americo.com/policy-holder/', '2026-11-10', 'confirmed'),
('cat-americo', 'Americo', array['americo', 'americo financial life', 'great southern life', 'united fidelity life']::text[], 'address', 'esign', 'yes', 'Address change', 'https://www.americo.com/SiteCollectionDocuments/AddressChange.pdf', 'email', 'forms@americo.com', '(816) 641-2850', array['Policy number', 'Date of birth', 'New address']::text[], null, 'https://www.americo.com/policy-holder/', '2026-11-10', 'confirmed'),
('cat-americo', 'Americo', array['americo', 'americo financial life', 'great southern life', 'united fidelity life']::text[], 'name', 'check', 'unknown', 'Name change form', 'https://www.americo.com/SiteCollectionDocuments/NameChange.pdf', null, null, '(816) 641-2850', array['Policy number', 'New legal name', 'Marriage certificate or court order']::text[], 'Form exists but isn’t listed on their page. Check on first call.', 'https://www.americo.com/policy-holder/', '2026-11-10', 'check'),
('cat-mutual-of-omaha', 'Mutual of Omaha', array['mutual of omaha', 'united of omaha', 'united of omaha life', 'companion life', 'mutual of omaha insurance', 'moo']::text[], 'cancel', 'check', 'unknown', null, null, null, null, '(800) 775-6000', array['Policy number', 'Date of birth', 'Last 4 of SSN']::text[], 'No cancel form published. Check on first call.', 'https://www.mutualofomaha.com/access/', '2026-11-10', 'check'),
('cat-mutual-of-omaha', 'Mutual of Omaha', array['mutual of omaha', 'united of omaha', 'united of omaha life', 'companion life', 'mutual of omaha insurance', 'moo']::text[], 'beneficiary', 'esign', 'unknown', 'Application for change of beneficiary (L4237)', 'https://content.mutualofomaha.com/contactforms/sites/content.mutualofomaha.com.contactforms/files/_forms/l4237.pdf', 'fax', '(402) 997-1906', '(800) 775-6000', array['Policy number', 'New beneficiary: full name, relationship, date of birth', 'Share for each']::text[], 'Also online in Customer Access. A trust or charity needs paper.', 'https://www.mutualofomaha.com/access/', '2026-11-10', 'check'),
('cat-mutual-of-omaha', 'Mutual of Omaha', array['mutual of omaha', 'united of omaha', 'united of omaha life', 'companion life', 'mutual of omaha insurance', 'moo']::text[], 'bank', 'online', 'unknown', null, null, null, null, '(800) 775-6000', array['Customer Access login', 'New bank routing and account number']::text[], 'Owner changes how and when they pay in Customer Access. Not by phone.', 'https://www.mutualofomaha.com/access/', '2026-11-10', 'confirmed'),
('cat-mutual-of-omaha', 'Mutual of Omaha', array['mutual of omaha', 'united of omaha', 'united of omaha life', 'companion life', 'mutual of omaha insurance', 'moo']::text[], 'address', 'online', 'unknown', null, null, null, null, '(800) 775-6000', array['Customer Access login', 'New address']::text[], 'Owner updates it in Customer Access.', 'https://www.mutualofomaha.com/access/', '2026-11-10', 'confirmed'),
('cat-mutual-of-omaha', 'Mutual of Omaha', array['mutual of omaha', 'united of omaha', 'united of omaha life', 'companion life', 'mutual of omaha insurance', 'moo']::text[], 'name', 'check', 'unknown', null, null, null, null, '(800) 775-6000', array['Policy number', 'New legal name', 'Marriage certificate or court order']::text[], 'Not published. Check on first call.', 'https://www.mutualofomaha.com/access/', '2026-11-10', 'check'),
('cat-transamerica', 'Transamerica', array['transamerica', 'western reserve life', 'peoples benefit life', 'transamerica life', 'transamerica premier', 'aegon', 'monumental life', 'stonebridge life', 'life investors', 'world financial group', 'wfg', 'ta', 'trans']::text[], 'cancel', 'check', 'unknown', null, null, null, null, '(800) 851-9777', array['Policy number', 'Date of birth', 'Last 4 of SSN']::text[], 'No form found; fax numbers conflict. Check on first call.', 'https://tlic.transamerica.com/portal/public/tlc/common/contact_us', '2026-11-10', 'check'),
('cat-transamerica', 'Transamerica', array['transamerica', 'western reserve life', 'peoples benefit life', 'transamerica life', 'transamerica premier', 'aegon', 'monumental life', 'stonebridge life', 'life investors', 'world financial group', 'wfg', 'ta', 'trans']::text[], 'beneficiary', 'check', 'unknown', null, null, null, null, '(800) 851-9777', array['Policy number', 'New beneficiary: full name, relationship, date of birth']::text[], 'Beneficiary form differs by issuing company. Check on first call.', 'https://tlic.transamerica.com/portal/public/tlc/common/contact_us', '2026-11-10', 'check'),
('cat-transamerica', 'Transamerica', array['transamerica', 'western reserve life', 'peoples benefit life', 'transamerica life', 'transamerica premier', 'aegon', 'monumental life', 'stonebridge life', 'life investors', 'world financial group', 'wfg', 'ta', 'trans']::text[], 'bank', 'check', 'unknown', null, null, null, null, '(800) 851-9777', array['Policy number', 'New bank routing and account number', 'New draft day']::text[], 'Not published. Check on first call.', 'https://tlic.transamerica.com/portal/public/tlc/common/contact_us', '2026-11-10', 'check'),
('cat-transamerica', 'Transamerica', array['transamerica', 'western reserve life', 'peoples benefit life', 'transamerica life', 'transamerica premier', 'aegon', 'monumental life', 'stonebridge life', 'life investors', 'world financial group', 'wfg', 'ta', 'trans']::text[], 'address', 'check', 'unknown', null, null, null, null, '(800) 851-9777', array['Policy number', 'Date of birth', 'New address']::text[], 'Not published. Check on first call.', 'https://tlic.transamerica.com/portal/public/tlc/common/contact_us', '2026-11-10', 'check'),
('cat-transamerica', 'Transamerica', array['transamerica', 'western reserve life', 'peoples benefit life', 'transamerica life', 'transamerica premier', 'aegon', 'monumental life', 'stonebridge life', 'life investors', 'world financial group', 'wfg', 'ta', 'trans']::text[], 'name', 'check', 'unknown', null, null, null, null, '(800) 851-9777', array['Policy number', 'New legal name', 'Marriage certificate or court order']::text[], 'Not published. Check on first call.', 'https://tlic.transamerica.com/portal/public/tlc/common/contact_us', '2026-11-10', 'check'),
('cat-foresters', 'Foresters', array['foresters', 'foresters financial', 'independent order of foresters', 'first investors life']::text[], 'cancel', 'esign', 'unknown', 'Certificate surrender request', 'https://www.foresters.com/-/media/foresters/documents/pdfs/us/customer-care/certificate-surrender-request-form.pdf', 'fax', '(877) 329-4631', '(800) 828-1540', array['Certificate number', 'Date of birth', 'Owner’s signature']::text[], null, 'https://www.foresters.com/en/customer-care', '2026-11-10', 'confirmed'),
('cat-foresters', 'Foresters', array['foresters', 'foresters financial', 'independent order of foresters', 'first investors life']::text[], 'beneficiary', 'esign', 'unknown', 'Beneficiary change form', 'https://www.foresters.com/-/media/foresters/documents/pdfs/us/customer-care/beneficiary-change-form.pdf', 'fax', '(877) 329-4631', '(800) 828-1540', array['Certificate number', 'New beneficiary: full name, relationship, date of birth', 'Share for each']::text[], null, 'https://www.foresters.com/en/customer-care', '2026-11-10', 'confirmed'),
('cat-foresters', 'Foresters', array['foresters', 'foresters financial', 'independent order of foresters', 'first investors life']::text[], 'bank', 'esign', 'unknown', 'Pre-authorized checking plan (PAC) request', 'https://www.foresters.com/-/media/foresters/documents/pdfs/us/customer-care/request-for-pre-authorization-form.pdf', 'email', 'service@foresters.com', '(800) 828-1540', array['Certificate number', 'New bank routing and account number', 'New draft day']::text[], null, 'https://www.foresters.com/en/customer-care', '2026-11-10', 'confirmed'),
('cat-foresters', 'Foresters', array['foresters', 'foresters financial', 'independent order of foresters', 'first investors life']::text[], 'address', 'esign', 'unknown', 'Certificate change form', 'https://www.foresters.com/-/media/foresters/documents/pdfs/us/customer-care/certificate-change-us-non-underwritten.pdf', 'fax', '(877) 329-4631', '(800) 828-1540', array['Certificate number', 'Date of birth', 'New address']::text[], null, 'https://www.foresters.com/en/customer-care', '2026-11-10', 'confirmed'),
('cat-foresters', 'Foresters', array['foresters', 'foresters financial', 'independent order of foresters', 'first investors life']::text[], 'name', 'esign', 'unknown', 'Name change form', 'https://www.foresters.com/-/media/foresters/documents/pdfs/us/customer-care/name-change-form.pdf', 'fax', '(877) 329-4631', '(800) 828-1540', array['Certificate number', 'New legal name', 'Marriage certificate or court order']::text[], null, 'https://www.foresters.com/en/customer-care', '2026-11-10', 'confirmed'),
('cat-globe-life', 'Globe Life', array['globe life', 'globe life and accident', 'torchmark', 'liberty national', 'american income life', 'united american']::text[], 'cancel', 'merge', 'unknown', null, null, null, null, '(844) 726-4372', array['Policy number', 'Date of birth', 'Last 4 of SSN']::text[], 'No cancel form or fax published. Cancel on a call with the owner.', 'https://home.globelifeinsurance.com/customer-service', '2026-11-10', 'check'),
('cat-globe-life', 'Globe Life', array['globe life', 'globe life and accident', 'torchmark', 'liberty national', 'american income life', 'united american']::text[], 'beneficiary', 'online', 'unknown', null, null, null, null, '(844) 726-4372', array['Online account login', 'New beneficiary: full name, relationship, date of birth']::text[], 'Owner changes it in their online account (portal differs by company), or on a call.', 'https://home.globelifeinsurance.com/customer-service', '2026-11-10', 'confirmed'),
('cat-globe-life', 'Globe Life', array['globe life', 'globe life and accident', 'torchmark', 'liberty national', 'american income life', 'united american']::text[], 'bank', 'check', 'unknown', null, null, null, null, '(844) 726-4372', array['Policy number', 'New bank routing and account number', 'New draft day']::text[], 'Not published. Check on first call.', 'https://home.globelifeinsurance.com/customer-service', '2026-11-10', 'check'),
('cat-globe-life', 'Globe Life', array['globe life', 'globe life and accident', 'torchmark', 'liberty national', 'american income life', 'united american']::text[], 'address', 'online', 'unknown', null, null, null, null, '(844) 726-4372', array['Online account login', 'New address']::text[], 'Owner updates contact details online, or on a call.', 'https://home.globelifeinsurance.com/customer-service', '2026-11-10', 'confirmed'),
('cat-globe-life', 'Globe Life', array['globe life', 'globe life and accident', 'torchmark', 'liberty national', 'american income life', 'united american']::text[], 'name', 'check', 'unknown', null, null, null, null, '(844) 726-4372', array['Policy number', 'New legal name', 'Marriage certificate or court order']::text[], 'Not published. Check on first call.', 'https://home.globelifeinsurance.com/customer-service', '2026-11-10', 'check'),
('cat-corebridge', 'Corebridge', array['corebridge', 'sunamerica', 'valic', 'corebridge financial', 'aig', 'american general', 'american general life', 'agl', 'aig life retirement', 'united states life', 'usl', 'aig direct', 'aig life']::text[], 'cancel', 'check', 'unknown', 'Miscellaneous service request (AGLC0107-FLAS)', 'https://adminplus.fgsfulfillment.com/View/AIGAG/1/AGLC0107-FLAS', null, null, '(844) 452-3832', array['Policy number', 'Owner’s SSN', 'Owner’s signature']::text[], 'No surrender form listed; they confirm by phone. Check on first call.', 'https://www.corebridgefinancial.com/support', '2026-11-10', 'check'),
('cat-corebridge', 'Corebridge', array['corebridge', 'sunamerica', 'valic', 'corebridge financial', 'aig', 'american general', 'american general life', 'agl', 'aig life retirement', 'united states life', 'usl', 'aig direct', 'aig life']::text[], 'beneficiary', 'esign', 'unknown', 'Change of beneficiary (AGLC0108-FLAS)', 'https://adminplus.fgsfulfillment.com/View/AIGAG/1/AGLC0108-FLAS', 'fax', '(844) 930-0370', '(844) 452-3832', array['Policy number', 'New beneficiary: full name, relationship, date of birth', 'Owner’s SSN', 'Share for each']::text[], 'An irrevocable beneficiary must agree.', 'https://www.corebridgefinancial.com/support', '2026-11-10', 'confirmed'),
('cat-corebridge', 'Corebridge', array['corebridge', 'sunamerica', 'valic', 'corebridge financial', 'aig', 'american general', 'american general life', 'agl', 'aig life retirement', 'united states life', 'usl', 'aig direct', 'aig life']::text[], 'bank', 'esign', 'unknown', 'Electronic payment form (AGLC108866-FLAS)', 'https://adminplus.fgsfulfillment.com/View/AIGAG/1/AGLC108866-FLAS', 'fax', '(855) 601-1834', '(844) 452-3832', array['Policy number', 'New bank routing and account number', 'New draft day', 'Checking or savings']::text[], null, 'https://www.corebridgefinancial.com/support', '2026-11-10', 'confirmed'),
('cat-corebridge', 'Corebridge', array['corebridge', 'sunamerica', 'valic', 'corebridge financial', 'aig', 'american general', 'american general life', 'agl', 'aig life retirement', 'united states life', 'usl', 'aig direct', 'aig life']::text[], 'address', 'esign', 'unknown', 'Name or address change (AGLC0222-FLAS)', 'https://adminplus.fgsfulfillment.com/View/AIGAG/1/AGLC0222-FLAS', 'fax', '(855) 601-1834', '(844) 452-3832', array['Policy number', 'Owner’s SSN', 'New address']::text[], null, 'https://www.corebridgefinancial.com/support', '2026-11-10', 'confirmed'),
('cat-corebridge', 'Corebridge', array['corebridge', 'sunamerica', 'valic', 'corebridge financial', 'aig', 'american general', 'american general life', 'agl', 'aig life retirement', 'united states life', 'usl', 'aig direct', 'aig life']::text[], 'name', 'esign', 'unknown', 'Name or address change (AGLC0222-FLAS)', 'https://adminplus.fgsfulfillment.com/View/AIGAG/1/AGLC0222-FLAS', 'fax', '(855) 601-1834', '(844) 452-3832', array['Policy number', 'New legal name', 'Marriage certificate or court order']::text[], null, 'https://www.corebridgefinancial.com/support', '2026-11-10', 'confirmed'),
('cat-aetna', 'Aetna', array['aetna', 'aetna final expense', 'aetna senior supplemental', 'cvs health', 'continental life insurance company of brentwood', 'american continental insurance', 'accendo insurance', 'loyal american life', 'american retirement life']::text[], 'cancel', 'check', 'unknown', null, null, null, null, '(800) 264-4000', array['Policy number', 'Date of birth', 'Last 4 of SSN']::text[], 'Not published. Check on first call.', 'https://choicemutual.com/wp-content/uploads/2025/05/Aetna-Policy.pdf', '2026-11-10', 'check'),
('cat-aetna', 'Aetna', array['aetna', 'aetna final expense', 'aetna senior supplemental', 'cvs health', 'continental life insurance company of brentwood', 'american continental insurance', 'accendo insurance', 'loyal american life', 'american retirement life']::text[], 'beneficiary', 'check', 'unknown', null, null, null, null, '(800) 264-4000', array['Policy number', 'New beneficiary: full name, relationship, date of birth']::text[], 'Written request on their form; an irrevocable beneficiary must agree. Check on first call.', 'https://choicemutual.com/wp-content/uploads/2025/05/Aetna-Policy.pdf', '2026-11-10', 'check'),
('cat-aetna', 'Aetna', array['aetna', 'aetna final expense', 'aetna senior supplemental', 'cvs health', 'continental life insurance company of brentwood', 'american continental insurance', 'accendo insurance', 'loyal american life', 'american retirement life']::text[], 'bank', 'check', 'unknown', null, null, null, null, '(800) 264-4000', array['Policy number', 'New bank routing and account number', 'New draft day']::text[], 'Not published. Check on first call.', 'https://choicemutual.com/wp-content/uploads/2025/05/Aetna-Policy.pdf', '2026-11-10', 'check'),
('cat-aetna', 'Aetna', array['aetna', 'aetna final expense', 'aetna senior supplemental', 'cvs health', 'continental life insurance company of brentwood', 'american continental insurance', 'accendo insurance', 'loyal american life', 'american retirement life']::text[], 'address', 'check', 'unknown', null, null, null, null, '(800) 264-4000', array['Policy number', 'Date of birth', 'New address']::text[], 'Not published. Check on first call.', 'https://choicemutual.com/wp-content/uploads/2025/05/Aetna-Policy.pdf', '2026-11-10', 'check'),
('cat-aetna', 'Aetna', array['aetna', 'aetna final expense', 'aetna senior supplemental', 'cvs health', 'continental life insurance company of brentwood', 'american continental insurance', 'accendo insurance', 'loyal american life', 'american retirement life']::text[], 'name', 'check', 'unknown', null, null, null, null, '(800) 264-4000', array['Policy number', 'New legal name', 'Marriage certificate or court order']::text[], 'Not published. Check on first call.', 'https://choicemutual.com/wp-content/uploads/2025/05/Aetna-Policy.pdf', '2026-11-10', 'check'),
('cat-royal-neighbors-of-america', 'Royal Neighbors of America', array['royal neighbors of america', 'royal neighbors', 'rna', 'rnoa']::text[], 'cancel', 'check', 'unknown', null, null, null, null, '(800) 627-4762', array['Certificate number', 'Date of birth', 'Last 4 of SSN']::text[], 'Not published. Check on first call.', 'https://www.royalneighbors.org/membership/member-resources/', '2026-11-10', 'check'),
('cat-royal-neighbors-of-america', 'Royal Neighbors of America', array['royal neighbors of america', 'royal neighbors', 'rna', 'rnoa']::text[], 'beneficiary', 'merge', 'unknown', 'Request for change of beneficiary (1813W)', 'https://www.royalneighbors.org/wp-content/uploads/2025/09/Request_Change_Beneficiary_1813W_Rev-4-2013_fillable_R.pdf', null, null, '(800) 627-4762', array['Certificate number', 'New beneficiary: full name, address, relationship, date of birth', 'An adult witness']::text[], 'Form goes by mail with a witness signature. Ask on the call if they’ll take it by fax.', 'https://www.royalneighbors.org/membership/member-resources/', '2026-11-10', 'confirmed'),
('cat-royal-neighbors-of-america', 'Royal Neighbors of America', array['royal neighbors of america', 'royal neighbors', 'rna', 'rnoa']::text[], 'bank', 'check', 'unknown', null, null, null, null, '(800) 627-4762', array['Policy number', 'New bank routing and account number', 'New draft day']::text[], 'Not published. Check on first call.', 'https://www.royalneighbors.org/membership/member-resources/', '2026-11-10', 'check'),
('cat-royal-neighbors-of-america', 'Royal Neighbors of America', array['royal neighbors of america', 'royal neighbors', 'rna', 'rnoa']::text[], 'address', 'online', 'unknown', null, null, null, null, '(800) 627-4762', array['Member login', 'New address']::text[], 'Owner changes it in the member portal.', 'https://www.royalneighbors.org/membership/member-resources/', '2026-11-10', 'confirmed'),
('cat-royal-neighbors-of-america', 'Royal Neighbors of America', array['royal neighbors of america', 'royal neighbors', 'rna', 'rnoa']::text[], 'name', 'merge', 'unknown', 'Request for change of name (2299W)', 'https://www.royalneighbors.org/wp-content/uploads/2025/09/Request_Change_Name_2299W_Rev_7-2011_fillable_R.pdf', null, null, '(800) 627-4762', array['Policy number', 'New legal name', 'Marriage certificate or court order']::text[], 'Mail only as published. Ask on the call if they’ll take it by fax.', 'https://www.royalneighbors.org/membership/member-resources/', '2026-11-10', 'confirmed'),
('cat-gerber-life', 'Gerber Life', array['gerber life', 'fabric', 'gerber', 'gerber life insurance']::text[], 'cancel', 'merge', 'unknown', null, null, null, null, '(800) 704-2180', array['Policy number', 'Date of birth', 'Last 4 of SSN']::text[], 'The owner calls (or messages) them; only the owner can cancel.', 'https://www.gerberlife.com/about/life-insurance-questions', '2026-11-10', 'confirmed'),
('cat-gerber-life', 'Gerber Life', array['gerber life', 'fabric', 'gerber', 'gerber life insurance']::text[], 'beneficiary', 'online', 'unknown', null, null, null, null, '(800) 704-2180', array['eService login', 'New beneficiary: full name, relationship, date of birth']::text[], 'eService makes the form; it’s printed, signed and mailed.', 'https://www.gerberlife.com/about/life-insurance-questions', '2026-11-10', 'confirmed'),
('cat-gerber-life', 'Gerber Life', array['gerber life', 'fabric', 'gerber', 'gerber life insurance']::text[], 'bank', 'online', 'unknown', null, null, null, null, '(800) 704-2180', array['eService login', 'New bank routing and account number', 'New draft day']::text[], 'eService changes the bank and the due date.', 'https://www.gerberlife.com/about/life-insurance-questions', '2026-11-10', 'confirmed'),
('cat-gerber-life', 'Gerber Life', array['gerber life', 'fabric', 'gerber', 'gerber life insurance']::text[], 'address', 'online', 'unknown', null, null, null, null, '(800) 704-2180', array['eService login', 'New address']::text[], 'eService → My Policies → Policyholder Details.', 'https://www.gerberlife.com/about/life-insurance-questions', '2026-11-10', 'confirmed'),
('cat-gerber-life', 'Gerber Life', array['gerber life', 'fabric', 'gerber', 'gerber life insurance']::text[], 'name', 'check', 'unknown', null, null, null, null, '(800) 704-2180', array['Policy number', 'New legal name', 'Marriage certificate or court order']::text[], 'Needs their form plus a legal document. Check on first call.', 'https://www.gerberlife.com/about/life-insurance-questions', '2026-11-10', 'check'),
('cat-liberty-bankers-life', 'Liberty Bankers Life', array['liberty bankers life', 'lbig', 'liberty bankers', 'lbl', 'liberty bankers life insurance company', 'liberty bankers insurance group', 'american benefit life']::text[], 'cancel', 'check', 'unknown', null, null, null, null, '(800) 604-8002', array['Policy number', 'Date of birth', 'Last 4 of SSN']::text[], 'Not published. Check on first call.', 'https://lbig.com/about-us/contact-us', '2026-11-10', 'check'),
('cat-liberty-bankers-life', 'Liberty Bankers Life', array['liberty bankers life', 'lbig', 'liberty bankers', 'lbl', 'liberty bankers life insurance company', 'liberty bankers insurance group', 'american benefit life']::text[], 'beneficiary', 'esign', 'unknown', 'Policy change form (LBL HS CHANGE-0809)', 'https://www.lbig.com/user/pages/09.Resources/02._download-forms/Life_Service_Form_(Form_LBL_PHS).pdf', 'fax', '(888) 525-5002', '(800) 604-8002', array['Policy number', 'New beneficiary: full name, relationship, date of birth', 'Insured’s SSN', 'An adult witness']::text[], 'Owner and an adult witness sign.', 'https://lbig.com/about-us/contact-us', '2026-11-10', 'confirmed'),
('cat-liberty-bankers-life', 'Liberty Bankers Life', array['liberty bankers life', 'lbig', 'liberty bankers', 'lbl', 'liberty bankers life insurance company', 'liberty bankers insurance group', 'american benefit life']::text[], 'bank', 'check', 'unknown', null, null, null, null, '(800) 604-8002', array['Policy number', 'New bank routing and account number', 'New draft day']::text[], 'Not published. Check on first call.', 'https://lbig.com/about-us/contact-us', '2026-11-10', 'check'),
('cat-liberty-bankers-life', 'Liberty Bankers Life', array['liberty bankers life', 'lbig', 'liberty bankers', 'lbl', 'liberty bankers life insurance company', 'liberty bankers insurance group', 'american benefit life']::text[], 'address', 'check', 'unknown', null, null, null, null, '(800) 604-8002', array['Policy number', 'Date of birth', 'New address']::text[], 'Not published. Check on first call.', 'https://lbig.com/about-us/contact-us', '2026-11-10', 'check'),
('cat-liberty-bankers-life', 'Liberty Bankers Life', array['liberty bankers life', 'lbig', 'liberty bankers', 'lbl', 'liberty bankers life insurance company', 'liberty bankers insurance group', 'american benefit life']::text[], 'name', 'esign', 'unknown', 'Policy change form (LBL HS CHANGE-0809)', 'https://www.lbig.com/user/pages/09.Resources/02._download-forms/Life_Service_Form_(Form_LBL_PHS).pdf', 'fax', '(888) 525-5002', '(800) 604-8002', array['Policy number', 'New legal name', 'Marriage certificate or court order', 'An adult witness']::text[], 'Legal document needed unless it’s marriage or a spelling fix.', 'https://lbig.com/about-us/contact-us', '2026-11-10', 'confirmed'),
('cat-sbli', 'SBLI', array['sbli', 'savings bank life insurance', 'sbli of massachusetts', 'the savings bank mutual life', 'the savings bank mutual life insurance company of massachusetts']::text[], 'cancel', 'check', 'unknown', null, null, null, null, '(800) 694-7254', array['Policy number', 'Date of birth']::text[], 'Not published. Check on first call.', 'https://cdn.sbli.com/forms/k-107.pdf', '2026-11-10', 'check'),
('cat-sbli', 'SBLI', array['sbli', 'savings bank life insurance', 'sbli of massachusetts', 'the savings bank mutual life', 'the savings bank mutual life insurance company of massachusetts']::text[], 'beneficiary', 'esign', 'unknown', 'Beneficiary change form (K-107)', 'https://cdn.sbli.com/forms/k-107.pdf', 'email', 'customerservice@sbli.com', '(800) 694-7254', array['Policy number', 'New beneficiary: full name, relationship, date of birth']::text[], 'An irrevocable beneficiary signs too. Massachusetts needs a witness.', 'https://cdn.sbli.com/forms/k-107.pdf', '2026-11-10', 'confirmed'),
('cat-sbli', 'SBLI', array['sbli', 'savings bank life insurance', 'sbli of massachusetts', 'the savings bank mutual life', 'the savings bank mutual life insurance company of massachusetts']::text[], 'bank', 'check', 'unknown', null, null, null, null, '(800) 694-7254', array['Policy number', 'New bank routing and account number', 'New draft day']::text[], 'Automatic payment plan form K-25B, seen only on a third-party site. Check on first call.', 'https://cdn.sbli.com/forms/k-107.pdf', '2026-11-10', 'check'),
('cat-sbli', 'SBLI', array['sbli', 'savings bank life insurance', 'sbli of massachusetts', 'the savings bank mutual life', 'the savings bank mutual life insurance company of massachusetts']::text[], 'address', 'online', 'unknown', 'Name and address change (K-108)', 'https://cdn.sbli.com/forms/k-108.pdf', null, null, '(800) 694-7254', array['my.sbli.com login', 'New address']::text[], 'Easiest at my.sbli.com; the form goes by mail only.', 'https://cdn.sbli.com/forms/k-107.pdf', '2026-11-10', 'confirmed'),
('cat-sbli', 'SBLI', array['sbli', 'savings bank life insurance', 'sbli of massachusetts', 'the savings bank mutual life', 'the savings bank mutual life insurance company of massachusetts']::text[], 'name', 'merge', 'unknown', 'Name and address change (K-108)', 'https://cdn.sbli.com/forms/k-108.pdf', null, null, '(800) 694-7254', array['Policy number', 'New legal name', 'Marriage certificate or court order']::text[], 'Mail only as published; owner signs in old and new name. Ask on the call.', 'https://cdn.sbli.com/forms/k-107.pdf', '2026-11-10', 'confirmed'),
('cat-ethos', 'Ethos', array['ethos', 'ethos life']::text[], 'cancel', 'esign', 'yes', 'Surrender form (Ethos sends it on request)', null, 'email', 'support@ethoslife.com', '(888) 384-6754', array['Policy number', 'Date of birth']::text[], 'Ethos emails the form to sign electronically.', 'https://ethos.com/policyholder-resource-page', '2026-11-10', 'confirmed'),
('cat-ethos', 'Ethos', array['ethos', 'ethos life']::text[], 'beneficiary', 'merge', 'unknown', null, null, null, null, '(888) 384-6754', array['Policy number', 'New beneficiary: full name, relationship, date of birth']::text[], 'No form: email or call Ethos with the owner.', 'https://ethos.com/policyholder-resource-page', '2026-11-10', 'confirmed'),
('cat-ethos', 'Ethos', array['ethos', 'ethos life']::text[], 'bank', 'online', 'unknown', null, null, null, null, '(888) 384-6754', array['Ethos login', 'New debit or credit card']::text[], 'Ethos takes cards, not bank drafts: Policies → Change payment method.', 'https://ethos.com/policyholder-resource-page', '2026-11-10', 'confirmed'),
('cat-ethos', 'Ethos', array['ethos', 'ethos life']::text[], 'address', 'merge', 'unknown', null, null, null, null, '(888) 384-6754', array['Policy number', 'Date of birth', 'New address']::text[], 'No form: email or call Ethos with the owner.', 'https://ethos.com/policyholder-resource-page', '2026-11-10', 'confirmed'),
('cat-ethos', 'Ethos', array['ethos', 'ethos life']::text[], 'name', 'check', 'unknown', null, null, null, null, '(888) 384-6754', array['Policy number', 'New legal name', 'Marriage certificate or court order']::text[], 'Not published. Check on first call.', 'https://ethos.com/policyholder-resource-page', '2026-11-10', 'check'),
('cat-lincoln-financial', 'Lincoln Financial', array['lincoln financial', 'lincoln national life', 'lincoln life', 'lfg', 'lincoln', 'first penn pacific', 'jefferson pilot']::text[], 'cancel', 'check', 'unknown', null, null, null, null, '(800) 487-1485', array['Policy number', 'Date of birth', 'Last 4 of SSN']::text[], 'Surrender form number seen only on third-party sites. Check on first call.', 'https://www.lincolnfinancial.com/pbl-static/pdf/CS06893-form.pdf', '2026-11-10', 'check'),
('cat-lincoln-financial', 'Lincoln Financial', array['lincoln financial', 'lincoln national life', 'lincoln life', 'lfg', 'lincoln', 'first penn pacific', 'jefferson pilot']::text[], 'beneficiary', 'esign', 'unknown', 'Beneficiary change for life policy (CS06893)', 'https://www.lincolnfinancial.com/pbl-static/pdf/CS06893-form.pdf', 'fax', '(800) 819-1987', '(800) 487-1485', array['Policy number', 'New beneficiary: full name, relationship, date of birth', 'Owner’s SSN']::text[], 'Replaces every beneficiary. Irrevocable needs CS11722.', 'https://www.lincolnfinancial.com/pbl-static/pdf/CS06893-form.pdf', '2026-11-10', 'confirmed'),
('cat-lincoln-financial', 'Lincoln Financial', array['lincoln financial', 'lincoln national life', 'lincoln life', 'lfg', 'lincoln', 'first penn pacific', 'jefferson pilot']::text[], 'bank', 'check', 'unknown', null, null, null, null, '(800) 487-1485', array['Policy number', 'New bank routing and account number', 'New draft day']::text[], 'Not published. Check on first call.', 'https://www.lincolnfinancial.com/pbl-static/pdf/CS06893-form.pdf', '2026-11-10', 'check'),
('cat-lincoln-financial', 'Lincoln Financial', array['lincoln financial', 'lincoln national life', 'lincoln life', 'lfg', 'lincoln', 'first penn pacific', 'jefferson pilot']::text[], 'address', 'esign', 'unknown', 'Life address change form', 'https://www.lincolnfinancial.com/pbl-static/pdf/Life-Address-Change-form---PDF.pdf', 'fax', '(800) 819-1987', '(800) 487-1485', array['Policy number', 'Old and new address']::text[], null, 'https://www.lincolnfinancial.com/pbl-static/pdf/CS06893-form.pdf', '2026-11-10', 'confirmed'),
('cat-lincoln-financial', 'Lincoln Financial', array['lincoln financial', 'lincoln national life', 'lincoln life', 'lfg', 'lincoln', 'first penn pacific', 'jefferson pilot']::text[], 'name', 'esign', 'unknown', 'Life name change form (CS10233)', 'https://www.lincolnfinancial.com/pbl-static/pdf/CS10233-form.pdf', 'fax', '(800) 819-1987', '(800) 487-1485', array['Policy number', 'New legal name', 'Marriage certificate or court order']::text[], 'Send both pages or they decline it.', 'https://www.lincolnfinancial.com/pbl-static/pdf/CS06893-form.pdf', '2026-11-10', 'confirmed'),
('cat-american-amicable', 'American Amicable', array['american amicable', 'american amicable life', 'occidental life of america', 'iowa american life', 'pioneer american', 'amam', 'am am']::text[], 'cancel', 'esign', 'unknown', 'Policy cancellation request (9874)', 'https://www.americanamicable.com/internet/webforms/common/9874.pdf', 'fax', '(254) 297-2105', '(800) 736-7311', array['Policy number', 'Owner’s SSN and date of birth', 'Refund: check, or bank for direct deposit']::text[], null, 'https://www.americanamicable.com/v4/contact-us.php', '2026-11-10', 'confirmed'),
('cat-american-amicable', 'American Amicable', array['american amicable', 'american amicable life', 'occidental life of america', 'iowa american life', 'pioneer american', 'amam', 'am am']::text[], 'beneficiary', 'esign', 'unknown', 'Beneficiary change request (BCR)', 'https://www.americanamicable.com/internet/webforms/common/BCR.pdf', 'fax', '(254) 297-2105', '(800) 736-7311', array['Policy number', 'New beneficiary: full name, relationship, date of birth', 'A witness who isn’t family']::text[], 'Notarized if the new beneficiary isn’t family.', 'https://www.americanamicable.com/v4/contact-us.php', '2026-11-10', 'confirmed'),
('cat-american-amicable', 'American Amicable', array['american amicable', 'american amicable life', 'occidental life of america', 'iowa american life', 'pioneer american', 'amam', 'am am']::text[], 'bank', 'esign', 'unknown', 'Bank draft authorization (1963)', 'https://www.americanamicable.com/internet/webforms/common/1963.pdf', 'fax', '(254) 297-2756', '(800) 736-7311', array['Policy number', 'New bank routing and account number', 'New draft day', 'Checking or savings']::text[], 'Also online: americanamicable.com bank authorization page.', 'https://www.americanamicable.com/v4/contact-us.php', '2026-11-10', 'confirmed'),
('cat-american-amicable', 'American Amicable', array['american amicable', 'american amicable life', 'occidental life of america', 'iowa american life', 'pioneer american', 'amam', 'am am']::text[], 'address', 'check', 'unknown', null, null, null, null, '(800) 736-7311', array['Policy number', 'Date of birth', 'New address']::text[], 'No form published; ask Client Experience (cx@aatx.com). Check on first call.', 'https://www.americanamicable.com/v4/contact-us.php', '2026-11-10', 'check'),
('cat-american-amicable', 'American Amicable', array['american amicable', 'american amicable life', 'occidental life of america', 'iowa american life', 'pioneer american', 'amam', 'am am']::text[], 'name', 'check', 'unknown', null, null, null, null, '(800) 736-7311', array['Policy number', 'New legal name', 'Marriage certificate or court order']::text[], 'Not published. Check on first call.', 'https://www.americanamicable.com/v4/contact-us.php', '2026-11-10', 'check'),
('cat-great-western', 'Great Western', array['great western', 'great western insurance', 'great western life']::text[], 'cancel', 'check', 'unknown', null, null, null, null, '(800) 733-5454', array['Policy number', 'Date of birth', 'Last 4 of SSN']::text[], 'Forms sit behind the Wellabe portal. Check on first call.', 'https://www.wellabe.com/faq', '2026-11-10', 'check'),
('cat-great-western', 'Great Western', array['great western', 'great western insurance', 'great western life']::text[], 'beneficiary', 'check', 'unknown', null, null, null, null, '(800) 733-5454', array['Policy number', 'New beneficiary: full name, relationship, date of birth']::text[], 'Forms sit behind the Wellabe portal. Check on first call.', 'https://www.wellabe.com/faq', '2026-11-10', 'check'),
('cat-great-western', 'Great Western', array['great western', 'great western insurance', 'great western life']::text[], 'bank', 'check', 'unknown', null, null, null, null, '(800) 733-5454', array['Policy number', 'New bank routing and account number', 'New draft day']::text[], 'Bank draft form is in the Wellabe portal. Check on first call.', 'https://www.wellabe.com/faq', '2026-11-10', 'check'),
('cat-great-western', 'Great Western', array['great western', 'great western insurance', 'great western life']::text[], 'address', 'online', 'unknown', null, null, null, null, '(800) 733-5454', array['mywellabe.com login', 'New address']::text[], 'Owner updates it in the Wellabe portal.', 'https://www.wellabe.com/faq', '2026-11-10', 'confirmed'),
('cat-great-western', 'Great Western', array['great western', 'great western insurance', 'great western life']::text[], 'name', 'merge', 'unknown', null, null, null, null, '(800) 733-5454', array['Policy number', 'New legal name', 'Marriage certificate or court order']::text[], 'Their FAQ says call Customer Success for a name change.', 'https://www.wellabe.com/faq', '2026-11-10', 'confirmed'),
('cat-f-g', 'F&G', array['f g', 'om financial', 'fidelity guaranty life', 'fidelity and guaranty', 'fgl', 'f and g', 'f g annuities life']::text[], 'cancel', 'check', 'unknown', null, null, null, null, '(888) 513-8797', array['Policy number', 'Date of birth', 'Last 4 of SSN']::text[], 'Not published. Check on first call.', 'https://www.fglife.com/contact/policyholder-support', '2026-11-10', 'check'),
('cat-f-g', 'F&G', array['f g', 'om financial', 'fidelity guaranty life', 'fidelity and guaranty', 'fgl', 'f and g', 'f g annuities life']::text[], 'beneficiary', 'esign', 'unknown', 'Change of beneficiary request (ADMIN 5742)', 'https://assets.fglife.com/is/content/fglife/ad-reviewed-materials/admin/admin5700s/ADMIN5742%20Change%20of%20Beneficiary%20Request.pdf', 'fax', '(800) 281-5777', '(888) 513-8797', array['Policy number', 'New beneficiary: full name, relationship, date of birth']::text[], 'Every owner signs; an irrevocable beneficiary consents.', 'https://www.fglife.com/contact/policyholder-support', '2026-11-10', 'confirmed'),
('cat-f-g', 'F&G', array['f g', 'om financial', 'fidelity guaranty life', 'fidelity and guaranty', 'fgl', 'f and g', 'f g annuities life']::text[], 'bank', 'check', 'unknown', 'Pre-authorized check form (ADMIN5778)', null, 'fax', '(800) 281-5777', '(888) 513-8797', array['Policy number', 'New bank routing and account number', 'New draft day']::text[], 'Form named on another F&G form, not read. Check on first call.', 'https://www.fglife.com/contact/policyholder-support', '2026-11-10', 'check'),
('cat-f-g', 'F&G', array['f g', 'om financial', 'fidelity guaranty life', 'fidelity and guaranty', 'fgl', 'f and g', 'f g annuities life']::text[], 'address', 'esign', 'unknown', 'Change of name or mailing address (ADMIN 5743)', 'https://assets.fglife.com/is/content/fglife/ad-reviewed-materials/admin/admin5700s/ADMIN5743%20Change%20of%20Name%20or%20Mailing%20Address.pdf', 'fax', '(800) 281-5777', '(888) 513-8797', array['Policy number', 'New address']::text[], 'Done in 3–5 business days.', 'https://www.fglife.com/contact/policyholder-support', '2026-11-10', 'confirmed'),
('cat-f-g', 'F&G', array['f g', 'om financial', 'fidelity guaranty life', 'fidelity and guaranty', 'fgl', 'f and g', 'f g annuities life']::text[], 'name', 'esign', 'unknown', 'Change of name or mailing address (ADMIN 5743)', 'https://assets.fglife.com/is/content/fglife/ad-reviewed-materials/admin/admin5700s/ADMIN5743%20Change%20of%20Name%20or%20Mailing%20Address.pdf', 'fax', '(800) 281-5777', '(888) 513-8797', array['Policy number', 'New legal name', 'Marriage certificate or court order']::text[], null, 'https://www.fglife.com/contact/policyholder-support', '2026-11-10', 'confirmed')
on conflict (carrier_key, action) do nothing;
-- SEED:END
