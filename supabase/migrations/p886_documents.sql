-- P886 — Documents: e-sign, stored on the policy, sent to the carrier by fax, email or upload (N-E-30, N-E-31,
-- N-E-32), plus the replacement-timing gate (the old policy is cancelled only after the new one is issued and its
-- first payment clears; Brayden's rule from N-D-11, built here because 852 hasn't run).
--
-- NOT NUMBERED, NOT APPLIED. Brayden gives it a number and applies it (Parallel rule 4). Additive only: new tables,
-- functions, one bucket, five notification types, new columns on carriers / policies / servicing_tasks and one
-- trigger on policies. Nothing is dropped, renamed or emptied; no existing function is replaced.
--
-- APPLY ORDER: after 132 (carrier hours), 146/156 (notify), 187 (replaced_old_policy), 193/196/206 (servicing_tasks
-- with requested_by + outcome), 212. Independent of p880-p885.
--
-- Nothing leaves Ohvara while doc_settings.send_live is false (the default): every fax and email is SANDBOX, the
-- doc-send function marks it delivered (or failed, for the test numbers) without calling anyone. Going live is
-- Brayden's call (a fax provider account, a cost). E-sign is built in (no paid service): typed name + consent tick
-- + time, IP, device, and a SHA-256 of the signed file, with an audit page added to the PDF.
--
-- How a document moves:
--   E-sign (E-85, E-13, E-07, E-60, E-30): a VA picks a carrier form (doc_templates) or uploads the carrier's form,
--     names the signers (owner, joint owner, irrevocable beneficiary, insured, payor, POA) → doc_start_signing makes
--     one private link per signer (only a SHA-256 of the token is kept; the raw token waits in link_token for the
--     engine to text it, then is wiped by doc_link_pushed) → each signer opens /sign/<token> (doc-sign function),
--     sees the form prefilled from the policy, types their name, ticks consent, signs → when the last one signs the
--     function stamps the PDF and stores it (doc_signed_file) → the VA is told "signed". A decline or an expired
--     link tells the VA too; a new link can be made (doc_new_link).
--   Upload (E-32 POA, E-101 carrier letters): doc_request_upload makes a link that asks the client for a photo or
--     file; or the VA / agent uploads straight to the bucket and calls doc_register_upload. Either way: on the policy,
--     with its type and date.
--   Send (E-13, E-14, E-87): doc_send_request picks the carrier's preferred channel (carriers.docs_channels, first
--     one with an address) or the one the VA names. fax / email go out through doc-send (sandbox while
--     send_live is off); upload = the VA uploads on the carrier's site and marks it done; agent_portal = the agent is
--     told to upload it in their producer portal (Brayden rule: the VA has no agent logins) and confirms.
--     Delivered → a receipt (time, number or address, pages, provider id) and a "Confirm <carrier> received it" task
--     due in doc_settings.confirm_days business days (5 PM Central). Failed → the reason on the document, the VA is
--     told, and Retry (same or another channel) up to max_attempts. "Never received" on the confirm call → the VA
--     can fix the carrier's address and resend; the re-confirm comes due in resend_confirm_days.
--   Replacement gate: on a policy that replaces an old one (replaced_old_policy = true), the old-policy cancel call
--     can't go live, the cancellation can't be marked done, and a cancellation_request can't be sent to the carrier
--     until new_issued_on AND first_payment_cleared_on are both set (replacement_mark), unless an admin overrides it
--     with a reason (replacement_override). When the gate opens, the assigned VA is told it's ready.
--
-- Owned elsewhere (used here, not built): carrier form library screen + form numbers (N-E-15, 858; the table is here
-- so e-sign has its forms), the rest of the carrier directory (N-E-12, 858; only the three send addresses and the
-- channel order are added here), per-carrier rules (N-E-14, 858), the text/email that carries the link (N-E-33,
-- GoHighLevel: Jordan reads doc_signers where link_pushed_at is null), authorised contacts / POA on the carrier file
-- (N-E-36/37, 852), old policy number (N-E-03, 852), queue priority (N-E-43, 852).

do $$
begin
  if to_regclass('public.servicing_tasks') is null then raise exception 'p886 needs 180 applied first'; end if;
  if to_regclass('public.notification_types') is null then raise exception 'p886 needs 146 applied first'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'policies'
                    and column_name = 'replaced_old_policy') then
    raise exception 'p886 needs 187 applied first';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'servicing_tasks'
                    and column_name = 'outcome') then
    raise exception 'p886 needs 193/206 applied first';
  end if;
end $$;

-- ── 1. Settings ─────────────────────────────────────────────────────────────
create table if not exists public.doc_settings (
  id                   boolean primary key default true check (id),
  send_live            boolean not null default false,   -- false = sandbox: nothing is faxed or emailed
  fax_provider         text not null default 'none' check (fax_provider in ('none', 'telnyx')),
  fax_from             text,                              -- the sending fax number, once there is one
  email_from           text,                              -- e.g. Deedstone Servicing <docs@deedstone…>
  sign_link_hours      int not null default 168 check (sign_link_hours between 1 and 720),
  confirm_days         int not null default 3 check (confirm_days between 1 and 15),
  resend_confirm_days  int not null default 2 check (resend_confirm_days between 1 and 15),
  max_attempts         int not null default 3 check (max_attempts between 1 and 10),
  replacement_gate_on  boolean not null default true,
  consent_version      text not null default 'esign-v1',
  updated_at           timestamptz not null default now()
);
insert into public.doc_settings (id) values (true) on conflict (id) do nothing;
alter table public.doc_settings enable row level security;
drop policy if exists doc_settings_read on public.doc_settings;
create policy doc_settings_read on public.doc_settings for select to authenticated using (true);
drop policy if exists doc_settings_admin on public.doc_settings;
create policy doc_settings_admin on public.doc_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.doc_settings from public, anon, authenticated;
grant select on public.doc_settings to authenticated;
grant update (send_live, fax_provider, fax_from, email_from, sign_link_hours, confirm_days, resend_confirm_days,
              max_attempts, replacement_gate_on, updated_at) on public.doc_settings to authenticated;

-- 5 PM Central on the n-th business day (Mon-Fri) after p_from. No holiday list yet (same as p885).
create or replace function public.doc_business_deadline(p_from timestamptz, p_days int)
returns timestamptz language sql stable set search_path = public as $$
  select ((d.day + time '17:00') at time zone 'America/Chicago')
    from (select (p_from at time zone 'America/Chicago')::date + n as day,
                 count(*) filter (where extract(isodow from (p_from at time zone 'America/Chicago')::date + n) < 6)
                   over (order by n) as nth
            from generate_series(1, greatest(p_days, 1) * 2 + 7) n) d
   where extract(isodow from d.day) < 6 and d.nth = greatest(p_days, 1)
   limit 1
$$;

create or replace function public.doc_hash(p text) returns text language sql immutable set search_path = public as $$
  select encode(extensions.digest(convert_to(coalesce(p, ''), 'UTF8'), 'sha256'), 'hex')
$$;
revoke all on function public.doc_hash(text) from public, anon, authenticated;

-- ── 2. Where each carrier takes documents (the carrier list) ────────────────
alter table public.carriers
  add column if not exists docs_fax        text,
  add column if not exists docs_email      text,
  add column if not exists docs_upload_url text,
  add column if not exists docs_channels   text[] not null default '{}',
  add column if not exists docs_notes      text,
  add column if not exists docs_checked_by uuid references public.profiles(id) on delete set null,
  add column if not exists docs_checked_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'carriers_docs_channels_check') then
    alter table public.carriers add constraint carriers_docs_channels_check
      check (docs_channels <@ array['fax', 'email', 'upload', 'agent_portal']::text[]);
  end if;
end $$;
comment on column public.carriers.docs_channels is
  'P886: how this carrier takes signed forms, most preferred first (fax, email, upload, agent_portal).';

-- Fax numbers are kept as 10 US digits; emails lower-cased.
create or replace function public.doc_norm_fax(p text) returns text language sql immutable set search_path = public as $$
  select case when length(d) = 10 then d when length(d) = 11 and left(d, 1) = '1' then right(d, 10) end
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;
create or replace function public.doc_norm_email(p text) returns text language sql immutable set search_path = public as $$
  select case when lower(btrim(p)) ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then lower(btrim(p)) end
$$;

-- E-13 / E-14: the VA saves what the carrier told them. Fulfillment or admin.
create or replace function public.carrier_docs_update(
  p_carrier uuid, p_fax text default null, p_email text default null, p_upload_url text default null,
  p_channels text[] default null, p_notes text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_fax text := public.doc_norm_fax(p_fax); v_email text := public.doc_norm_email(p_email);
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment or an admin can change where a carrier takes documents' using errcode = '42501';
  end if;
  if not exists (select 1 from carriers where id = p_carrier) then raise exception 'Carrier not found' using errcode = 'P0002'; end if;
  if nullif(btrim(p_fax), '') is not null and v_fax is null then
    raise exception 'That fax number needs 10 digits' using errcode = '22023';
  end if;
  if nullif(btrim(p_email), '') is not null and v_email is null then
    raise exception 'That email address doesn''t look right' using errcode = '22023';
  end if;
  if nullif(btrim(p_upload_url), '') is not null and btrim(p_upload_url) !~* '^https://' then
    raise exception 'The upload address must start with https://' using errcode = '22023';
  end if;
  if p_channels is not null and not (p_channels <@ array['fax', 'email', 'upload', 'agent_portal']::text[]) then
    raise exception 'Channels are fax, email, upload or agent_portal' using errcode = '22023';
  end if;
  update carriers
     set docs_fax        = case when p_fax is null then docs_fax else v_fax end,
         docs_email      = case when p_email is null then docs_email else v_email end,
         docs_upload_url = case when p_upload_url is null then docs_upload_url else nullif(btrim(p_upload_url), '') end,
         docs_channels   = coalesce((select array_agg(distinct_c order by first_at)
                                       from (select c as distinct_c, min(o) as first_at
                                               from unnest(p_channels) with ordinality u(c, o) group by c) z), docs_channels),
         docs_notes      = case when p_notes is null then docs_notes else nullif(left(btrim(p_notes), 1000), '') end,
         docs_checked_by = auth.uid(),
         docs_checked_at = now()
   where id = p_carrier;
end;
$$;
revoke all on function public.carrier_docs_update(uuid, text, text, text, text[], text) from public, anon;
grant execute on function public.carrier_docs_update(uuid, text, text, text, text[], text) to authenticated;

-- ── 3. Tables ───────────────────────────────────────────────────────────────
-- The kinds of paper a policy collects.
create or replace function public.doc_types() returns text[] language sql immutable set search_path = public as $$
  select array['cancellation_request', 'beneficiary_change', 'owner_change', 'amendment', 'payment_change',
               'address_change', 'name_change', 'poa', 'carrier_letter', 'certificate', 'claim_form',
               'death_certificate', 'id_document', 'other']
$$;
create or replace function public.doc_signer_roles() returns text[] language sql immutable set search_path = public as $$
  select array['owner', 'joint_owner', 'insured', 'irrevocable_beneficiary', 'payor', 'poa']
$$;

-- Carrier forms that can be prefilled and signed. fields: [{"key": "<prefill key>", "page": 0, "x": 72, "y": 640,
-- "size": 10}] or a signature box {"key": "sign:<role>", ...}. 858 builds the admin form-library screen on this.
create table if not exists public.doc_templates (
  id            uuid primary key default gen_random_uuid(),
  carrier_id    uuid references public.carriers(id) on delete cascade,   -- null = works for any carrier
  doc_type      text not null check (doc_type = any (public.doc_types())),
  name          text not null check (length(btrim(name)) between 2 and 120),
  form_number   text,
  storage_path  text not null,                                           -- in bucket policy-docs, under templates/
  fields        jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  signer_roles  text[] not null default array['owner'] check (cardinality(signer_roles) between 1 and 4
                                                             and signer_roles <@ public.doc_signer_roles()),
  active        boolean not null default true,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists public.policy_documents (
  id            uuid primary key default gen_random_uuid(),
  policy_id     uuid not null references public.policies(id) on delete cascade,
  agent_id      uuid not null references public.profiles(id) on delete cascade,
  task_id       uuid references public.servicing_tasks(id) on delete set null,
  carrier_id    uuid references public.carriers(id) on delete set null,   -- who it goes to (old carrier for a cancel)
  template_id   uuid references public.doc_templates(id) on delete set null,
  doc_type      text not null check (doc_type = any (public.doc_types())),
  title         text not null check (length(btrim(title)) between 2 and 160),
  source        text not null check (source in ('esign', 'va_upload', 'agent_upload', 'client_upload', 'carrier')),
  status        text not null check (status in ('out_for_signature', 'signed', 'declined', 'expired',
                                                 'awaiting_upload', 'on_file', 'void')),
  storage_path  text,             -- the form before signing, or the uploaded file
  signed_path   text,             -- the signed PDF with its audit page
  sha256        text,             -- of the final file (signed_path, else storage_path)
  prefill       jsonb not null default '{}'::jsonb,
  document_date date not null default (now() at time zone 'America/Chicago')::date,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  signed_at     timestamptz,
  voided_at     timestamptz,
  void_reason   text,
  updated_at    timestamptz not null default now()
);
create index if not exists policy_documents_policy_idx on public.policy_documents (policy_id, created_at desc);
create index if not exists policy_documents_task_idx on public.policy_documents (task_id) where task_id is not null;

create table if not exists public.doc_signers (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.policy_documents(id) on delete cascade,
  role            text not null check (role = any (public.doc_signer_roles() || array['uploader'])),
  name            text not null check (length(btrim(name)) between 2 and 120),
  phone           text,
  email           text,
  sort            int not null default 1,
  token_hash      text not null unique,
  link_token      text,           -- raw token, only until the engine has texted it (doc_link_pushed wipes it)
  link_expires_at timestamptz not null,
  link_pushed_at  timestamptz,
  viewed_at       timestamptz,
  signed_at       timestamptz,
  signed_name     text,
  sign_ip         text,
  sign_ua         text,
  consent_version text,
  declined_at     timestamptz,
  decline_reason  text,
  created_at      timestamptz not null default now()
);
create index if not exists doc_signers_doc_idx on public.doc_signers (document_id, sort);
create index if not exists doc_signers_outbox_idx on public.doc_signers (created_at) where link_pushed_at is null;

create table if not exists public.doc_sends (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.policy_documents(id) on delete cascade,
  policy_id       uuid not null references public.policies(id) on delete cascade,
  carrier_id      uuid references public.carriers(id) on delete set null,
  channel         text not null check (channel in ('fax', 'email', 'upload', 'agent_portal')),
  destination     text,           -- fax digits, email, upload URL; null for agent_portal
  status          text not null default 'queued'
                    check (status in ('queued', 'sending', 'delivered', 'failed', 'received', 'not_received')),
  attempt         int not null default 1,
  retry_of        uuid references public.doc_sends(id) on delete set null,
  sandbox         boolean not null default true,
  provider        text,
  provider_ref    text,
  pages           int,
  failure_reason  text,
  receipt         jsonb not null default '{}'::jsonb,
  requested_by    uuid references public.profiles(id) on delete set null,
  requested_at    timestamptz not null default now(),
  sent_at         timestamptz,
  delivered_at    timestamptz,
  failed_at       timestamptz,
  confirmed_at    timestamptz,
  confirmed_by    uuid references public.profiles(id) on delete set null,
  confirm_note    text,
  confirm_task_id uuid references public.servicing_tasks(id) on delete set null
);
create index if not exists doc_sends_doc_idx on public.doc_sends (document_id, requested_at desc);
create index if not exists doc_sends_queue_idx on public.doc_sends (requested_at) where status = 'queued';

-- Append-only trail: who did what to which document, send or gate.
create table if not exists public.doc_audit (
  id          bigint generated always as identity primary key,
  policy_id   uuid references public.policies(id) on delete cascade,
  document_id uuid references public.policy_documents(id) on delete cascade,
  send_id     uuid references public.doc_sends(id) on delete cascade,
  kind        text not null,
  actor_id    uuid,
  detail      jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index if not exists doc_audit_policy_idx on public.doc_audit (policy_id, at desc);

create or replace function public.doc_audit_add(p_policy uuid, p_doc uuid, p_send uuid, p_kind text, p_detail jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into doc_audit (policy_id, document_id, send_id, kind, actor_id, detail)
  values (p_policy, p_doc, p_send, p_kind, auth.uid(), coalesce(p_detail, '{}'::jsonb))
$$;
revoke all on function public.doc_audit_add(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.doc_audit_no_change() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'The document trail can''t be changed' using errcode = '42501'; end;
$$;
drop trigger if exists doc_audit_append_only on public.doc_audit;
create trigger doc_audit_append_only before update or delete on public.doc_audit
  for each row execute function public.doc_audit_no_change();

-- Confirm tasks point back at their send.
alter table public.servicing_tasks add column if not exists doc_send_id uuid references public.doc_sends(id) on delete set null;

-- RLS: the agent sees their own policies' papers; Fulfillment and admins see all. Writes only through functions.
alter table public.doc_templates enable row level security;
alter table public.policy_documents enable row level security;
alter table public.doc_signers enable row level security;
alter table public.doc_sends enable row level security;
alter table public.doc_audit enable row level security;

drop policy if exists doc_templates_read on public.doc_templates;
create policy doc_templates_read on public.doc_templates for select to authenticated
  using (public.is_fulfillment() or public.is_admin());
drop policy if exists policy_documents_read on public.policy_documents;
create policy policy_documents_read on public.policy_documents for select to authenticated
  using (agent_id = auth.uid() or public.is_fulfillment() or public.is_admin());
drop policy if exists doc_signers_read on public.doc_signers;
create policy doc_signers_read on public.doc_signers for select to authenticated
  using (exists (select 1 from policy_documents d where d.id = document_id
                   and (d.agent_id = auth.uid() or public.is_fulfillment() or public.is_admin())));
drop policy if exists doc_sends_read on public.doc_sends;
create policy doc_sends_read on public.doc_sends for select to authenticated
  using (exists (select 1 from policy_documents d where d.id = document_id
                   and (d.agent_id = auth.uid() or public.is_fulfillment() or public.is_admin())));
drop policy if exists doc_audit_read on public.doc_audit;
create policy doc_audit_read on public.doc_audit for select to authenticated using (public.is_admin());

revoke all on public.doc_templates, public.policy_documents, public.doc_signers, public.doc_sends, public.doc_audit
  from public, anon, authenticated;
grant select on public.doc_templates, public.policy_documents, public.doc_sends, public.doc_audit to authenticated;
-- Never the token, its hash, the IP or the device to the app: those are the signing proof, read by the server only.
grant select (id, document_id, role, name, sort, link_expires_at, link_pushed_at, viewed_at, signed_at, signed_name,
              declined_at, decline_reason, created_at) on public.doc_signers to authenticated;

-- ── 4. Storage: one private bucket ──────────────────────────────────────────
-- <policy_id>/<document_id>/<file>   and   templates/<template_id>/<file>
insert into storage.buckets (id, name, public) values ('policy-docs', 'policy-docs', false) on conflict (id) do nothing;
drop policy if exists policy_docs_read on storage.objects;
create policy policy_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'policy-docs' and (
           public.is_fulfillment() or public.is_admin()
           or exists (select 1 from public.policies p
                       where p.id::text = (storage.foldername(name))[1] and p.agent_id = auth.uid())));
drop policy if exists policy_docs_insert on storage.objects;
create policy policy_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'policy-docs' and (
           public.is_fulfillment() or public.is_admin()
           or exists (select 1 from public.policies p
                       where p.id::text = (storage.foldername(name))[1] and p.agent_id = auth.uid())));

-- ── 5. Notifications ────────────────────────────────────────────────────────
insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort)
select v.type, v.roles, v.label, v.email, 'notify', true, v.push, false, true,
       coalesce((select max(sort) from public.notification_types), 0) + v.n
  from (values
    ('document_signed',       array['fulfillment', 'admin'], 'A form was signed',                         false, true,  1),
    ('document_declined',     array['fulfillment', 'admin'], 'A form was declined or its link ran out',   false, true,  2),
    ('document_send_failed',  array['fulfillment', 'admin'], 'A fax or email to a carrier failed',        false, true,  3),
    ('carrier_upload_needed', array['agent'],                'Upload a form in a carrier portal',         true,  true,  4),
    ('replacement_ready',     array['fulfillment', 'admin'], 'A new policy is in force: cancel the old one', false, true, 5)
  ) as v(type, roles, label, email, push, n)
 where not exists (select 1 from public.notification_types t where t.type = v.type);

-- Who on Fulfillment hears about a document: who made it, else the policy's VA.
create or replace function public.doc_va_for(p_doc uuid) returns uuid language sql stable security definer
set search_path = public as $$
  select coalesce(
           (select d.created_by from policy_documents d join profiles pr on pr.id = d.created_by
             where d.id = p_doc and pr.role::text in ('fulfillment', 'admin')),
           (select coalesce(p.servicing_va_id, p.assigned_fulfillment_id) from policy_documents d
              join policies p on p.id = d.policy_id where d.id = p_doc))
$$;
revoke all on function public.doc_va_for(uuid) from public, anon, authenticated;

create or replace function public.doc_client_name(p_policy uuid) returns text language sql stable security definer
set search_path = public as $$
  select coalesce(nullif(btrim(coalesce(client_first_name, '') || ' ' || coalesce(client_last_name, '')), ''), 'This client')
    from policies where id = p_policy
$$;
revoke all on function public.doc_client_name(uuid) from public, anon, authenticated;

-- ── 6. The replacement-timing gate ──────────────────────────────────────────
alter table public.policies
  add column if not exists new_issued_on             date,
  add column if not exists first_payment_cleared_on  date,
  add column if not exists replacement_override      text,
  add column if not exists replacement_override_by   uuid references public.profiles(id) on delete set null,
  add column if not exists replacement_override_at   timestamptz;

-- open = the old policy may be cancelled now. applies = this deal replaces an old policy and the gate is on.
create or replace function public.replacement_gate_state(p_policy uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare p policies%rowtype; v_on boolean; v_applies boolean; v_wait text[] := '{}';
begin
  select * into p from policies where id = p_policy;
  if not found then return null; end if;
  if not (p.agent_id = auth.uid() or public.is_fulfillment() or public.is_admin() or auth.uid() is null) then
    raise exception 'Not your policy' using errcode = '42501';
  end if;
  v_on := coalesce((select replacement_gate_on from doc_settings), true);
  v_applies := v_on and p.replaced_old_policy is true;
  if p.new_issued_on is null then v_wait := v_wait || 'issued'::text; end if;
  if p.first_payment_cleared_on is null then v_wait := v_wait || 'first_payment'::text; end if;
  return jsonb_build_object(
    'applies', v_applies,
    'open', not v_applies or cardinality(v_wait) = 0 or p.replacement_override is not null,
    'waiting_for', to_jsonb(case when v_applies and p.replacement_override is null then v_wait else '{}'::text[] end),
    'issued_on', p.new_issued_on, 'first_payment_on', p.first_payment_cleared_on,
    'override', p.replacement_override, 'override_at', p.replacement_override_at);
end;
$$;
revoke all on function public.replacement_gate_state(uuid) from public, anon;
grant execute on function public.replacement_gate_state(uuid) to authenticated, service_role;

create or replace function public.replacement_gate_closed(p policies) returns boolean language sql stable
set search_path = public as $$
  select coalesce((select replacement_gate_on from doc_settings), true)
     and p.replaced_old_policy is true
     and p.replacement_override is null
     and (p.new_issued_on is null or p.first_payment_cleared_on is null)
$$;

create or replace function public.policies_replacement_gate() returns trigger language plpgsql
set search_path = public as $$
begin
  if not public.replacement_gate_closed(new) then return new; end if;
  if new.fulfillment_stage::text = 'Complete' and old.fulfillment_stage is distinct from new.fulfillment_stage then
    raise exception 'Not yet: the old policy is cancelled only after the new one is issued and its first payment clears.'
      using errcode = '22023', hint = 'replacement_gate';
  end if;
  if new.call_live_since is not null and old.call_live_since is null then
    raise exception 'Not yet: the cancel call waits until the new policy is issued and its first payment clears.'
      using errcode = '22023', hint = 'replacement_gate';
  end if;
  return new;
end;
$$;
drop trigger if exists b5_replacement_gate on public.policies;
create trigger b5_replacement_gate before update of fulfillment_stage, call_live_since on public.policies
  for each row execute function public.policies_replacement_gate();

-- The VA (or the agent, on their own policy) records the two facts. p_what: issued | first_payment. A null date clears
-- it (a mistake). When both are in, the assigned VA is told the old policy can be cancelled.
create or replace function public.replacement_mark(p_policy uuid, p_what text, p_on date, p_how text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p policies%rowtype; v_was boolean; v_va uuid;
begin
  if p_what is null or p_what not in ('issued', 'first_payment') then
    raise exception 'Mark issued or first_payment' using errcode = '22023';
  end if;
  select * into p from policies where id = p_policy for update;
  if not found then raise exception 'Policy not found' using errcode = 'P0002'; end if;
  if not (public.is_fulfillment() or public.is_admin() or (p.agent_id = auth.uid() and not public.is_fulfillment())) then
    raise exception 'Not your policy' using errcode = '42501';
  end if;
  if p_on is not null and (p_on > (now() at time zone 'America/Chicago')::date or p_on < current_date - 730) then
    raise exception 'Pick a date that has already happened' using errcode = '22023';
  end if;
  if p_what = 'first_payment' and p_on is not null and coalesce(p.new_issued_on, p_on) > p_on then
    raise exception 'The first payment can''t clear before the policy is issued' using errcode = '22023';
  end if;
  v_was := public.replacement_gate_closed(p);
  update policies
     set new_issued_on            = case when p_what = 'issued' then p_on else new_issued_on end,
         first_payment_cleared_on = case when p_what = 'first_payment' then p_on else first_payment_cleared_on end
   where id = p_policy
  returning * into p;
  perform public.doc_audit_add(p_policy, null, null, 'replacement_mark',
                               jsonb_build_object('what', p_what, 'on', p_on, 'how', left(p_how, 300)));
  if v_was and not public.replacement_gate_closed(p) then
    v_va := coalesce(p.assigned_fulfillment_id, p.servicing_va_id);
    if v_va is not null then
      perform public.notify(v_va, 'replacement_ready',
        public.doc_client_name(p_policy) || ': the new policy is in force',
        'Issued ' || to_char(p.new_issued_on, 'Mon FMDD') || ', first payment cleared '
          || to_char(p.first_payment_cleared_on, 'Mon FMDD') || '. Cancel the old policy'
          || coalesce(' with ' || p.carrier_name, '') || ' now.',
        '/fulfillment/schedule', true, 'replacement_ready:' || p_policy, jsonb_build_object('policy_id', p_policy));
    end if;
  end if;
  return public.replacement_gate_state(p_policy);
end;
$$;
revoke all on function public.replacement_mark(uuid, text, date, text) from public, anon;
grant execute on function public.replacement_mark(uuid, text, date, text) to authenticated;

-- Admin only, with a reason (e.g. the client insists and signed for it). Null reason lifts the override.
create or replace function public.replacement_override(p_policy uuid, p_reason text) returns jsonb language plpgsql
security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can override the replacement timing' using errcode = '42501'; end if;
  if p_reason is not null and length(btrim(p_reason)) < 10 then
    raise exception 'Say why in a sentence' using errcode = '22023';
  end if;
  update policies
     set replacement_override    = nullif(left(btrim(p_reason), 500), ''),
         replacement_override_by = case when p_reason is null then null else auth.uid() end,
         replacement_override_at = case when p_reason is null then null else now() end
   where id = p_policy;
  if not found then raise exception 'Policy not found' using errcode = 'P0002'; end if;
  perform public.doc_audit_add(p_policy, null, null, 'replacement_override', jsonb_build_object('reason', p_reason));
  return public.replacement_gate_state(p_policy);
end;
$$;
revoke all on function public.replacement_override(uuid, text) from public, anon;
grant execute on function public.replacement_override(uuid, text) to authenticated;

-- ── 7. Prefill: the policy's facts a carrier form asks for ──────────────────
-- Never bank, routing, account or licence numbers: those stay off forms we generate.
create or replace function public.doc_prefill(p_policy uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare p policies%rowtype; f policy_fulfillment_details%rowtype; v_name text;
begin
  select * into p from policies where id = p_policy;
  if not found then raise exception 'Policy not found' using errcode = 'P0002'; end if;
  if not (public.is_fulfillment() or public.is_admin() or auth.uid() is null) then
    raise exception 'Only Fulfillment can prepare a form' using errcode = '42501';
  end if;
  select * into f from policy_fulfillment_details where policy_id = p_policy;
  v_name := coalesce(nullif(btrim(f.full_legal_name), ''), btrim(p.client_first_name || ' ' || p.client_last_name));
  return jsonb_strip_nulls(jsonb_build_object(
    'owner_name', v_name, 'insured_name', v_name,
    'first_name', p.client_first_name, 'last_name', p.client_last_name,
    'date_of_birth', to_char(f.date_of_birth, 'MM/DD/YYYY'),
    'phone', p.client_phone, 'email', f.email,
    'address_street', f.address_street, 'address_city', f.address_city,
    'address_state', coalesce(f.address_state, p.state), 'address_zip', f.address_zip,
    'policy_number', p.policy_number,
    'new_carrier', coalesce(p.new_carrier_name, case when p.replaced_old_policy is not true then p.carrier_name end),
    'old_carrier', case when p.replaced_old_policy then coalesce(f.current_carrier, p.carrier_name) end,
    'beneficiary_name', f.beneficiaries->0->>'name', 'beneficiary_relationship', f.beneficiaries->0->>'relationship',
    'monthly_premium', to_char(p.monthly_premium, 'FM999990.00'),
    'effective_date', to_char(p.effective_date, 'MM/DD/YYYY'),
    'today', to_char(now() at time zone 'America/Chicago', 'MM/DD/YYYY')));
end;
$$;
revoke all on function public.doc_prefill(uuid) from public, anon;
grant execute on function public.doc_prefill(uuid) to authenticated, service_role;

-- ── 8. E-sign ───────────────────────────────────────────────────────────────
create or replace function public.doc_new_token() returns text language sql volatile set search_path = public as $$
  select encode(extensions.gen_random_bytes(24), 'hex')
$$;
revoke all on function public.doc_new_token() from public, anon, authenticated;

-- p_signers: [{"role": "owner", "name": "Ann Lee", "phone": "...", "email": "..."}], 1 to 4, roles from
-- doc_signer_roles(), each once. A template's signer_roles must all be there. Either p_template or p_storage_path
-- (the carrier's own form, uploaded by the VA). Returns the document and one link token per signer, shown once.
create or replace function public.doc_start_signing(
  p_policy uuid, p_doc_type text, p_title text, p_signers jsonb,
  p_template uuid default null, p_storage_path text default null, p_task uuid default null, p_carrier uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p policies%rowtype; t doc_templates%rowtype; v_doc uuid; s jsonb; v_tok text; v_links jsonb := '[]';
  v_roles text[]; v_hours int; n int := 0; v_carrier uuid;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can send a form for signature' using errcode = '42501';
  end if;
  select * into p from policies where id = p_policy;
  if not found then raise exception 'Policy not found' using errcode = 'P0002'; end if;
  if p_doc_type is null or not (p_doc_type = any (public.doc_types())) then
    raise exception 'Pick what kind of form this is' using errcode = '22023';
  end if;
  if p_template is not null then
    select * into t from doc_templates where id = p_template and active;
    if not found then raise exception 'That form isn''t in the library' using errcode = 'P0002'; end if;
  elsif nullif(btrim(p_storage_path), '') is null then
    raise exception 'Pick a carrier form or upload the carrier''s form' using errcode = '22023';
  elsif split_part(p_storage_path, '/', 1) <> p_policy::text then
    raise exception 'The form must be stored on this policy' using errcode = '22023';
  end if;
  if p_task is not null and not exists (select 1 from servicing_tasks where id = p_task and policy_id = p_policy) then
    raise exception 'That step isn''t on this policy' using errcode = '22023';
  end if;
  if jsonb_typeof(p_signers) is distinct from 'array' or jsonb_array_length(p_signers) not between 1 and 4 then
    raise exception 'Add one to four signers' using errcode = '22023';
  end if;
  select array_agg(x->>'role') into v_roles from jsonb_array_elements(p_signers) x;
  if not (v_roles <@ public.doc_signer_roles()) then raise exception 'Unknown signer role' using errcode = '22023'; end if;
  if (select count(distinct r) from unnest(v_roles) r) <> cardinality(v_roles) then
    raise exception 'Each signer role once' using errcode = '22023';
  end if;
  if p_template is not null and not (t.signer_roles <@ v_roles) then
    raise exception 'This form needs: %', array_to_string(t.signer_roles, ', ') using errcode = '22023';
  end if;
  -- A cancellation request goes to the old carrier; any other form to the carrier the policy is with.
  v_carrier := coalesce(p_carrier, t.carrier_id,
                        case when p_doc_type = 'cancellation_request' then p.carrier_id
                             else coalesce(p.new_carrier_id, p.carrier_id) end);
  v_hours := (select sign_link_hours from doc_settings);

  insert into policy_documents (policy_id, agent_id, task_id, carrier_id, template_id, doc_type, title, source, status,
                                storage_path, prefill, created_by)
  values (p_policy, p.agent_id, p_task, v_carrier, p_template, p_doc_type, left(btrim(coalesce(p_title, t.name)), 160),
          'esign', 'out_for_signature', coalesce(nullif(btrim(p_storage_path), ''), t.storage_path),
          public.doc_prefill(p_policy), auth.uid())
  returning id into v_doc;

  for s in select * from jsonb_array_elements(p_signers) loop
    n := n + 1;
    if length(btrim(coalesce(s->>'name', ''))) < 2 then
      raise exception 'Each signer needs a name' using errcode = '22023';
    end if;
    v_tok := public.doc_new_token();
    insert into doc_signers (document_id, role, name, phone, email, sort, token_hash, link_token, link_expires_at)
    values (v_doc, s->>'role', btrim(s->>'name'), nullif(btrim(s->>'phone'), ''), public.doc_norm_email(s->>'email'), n,
            public.doc_hash(v_tok), v_tok, now() + make_interval(hours => v_hours));
    v_links := v_links || jsonb_build_object('role', s->>'role', 'name', btrim(s->>'name'), 'token', v_tok);
  end loop;

  perform public.doc_audit_add(p_policy, v_doc, null, 'sent_for_signature', jsonb_build_object('signers', v_roles));
  return jsonb_build_object('document_id', v_doc, 'links', v_links,
                            'expires_at', now() + make_interval(hours => v_hours));
end;
$$;
revoke all on function public.doc_start_signing(uuid, text, text, jsonb, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.doc_start_signing(uuid, text, text, jsonb, uuid, text, uuid, uuid) to authenticated;

-- A fresh link for one signer (lost text, expired). The old link stops working.
create or replace function public.doc_new_link(p_signer uuid) returns jsonb language plpgsql security definer
set search_path = public as $$
declare s doc_signers%rowtype; d policy_documents%rowtype; v_tok text := public.doc_new_token();
begin
  if not (public.is_fulfillment() or public.is_admin()) then raise exception 'Only Fulfillment can do this' using errcode = '42501'; end if;
  select * into s from doc_signers where id = p_signer for update;
  if not found then raise exception 'Signer not found' using errcode = 'P0002'; end if;
  select * into d from policy_documents where id = s.document_id for update;
  if s.signed_at is not null then raise exception 'They already signed' using errcode = '22023'; end if;
  if d.status not in ('out_for_signature', 'expired', 'declined', 'awaiting_upload') then
    raise exception 'This form is %', d.status using errcode = '22023';
  end if;
  update doc_signers
     set token_hash = public.doc_hash(v_tok), link_token = v_tok, link_pushed_at = null, declined_at = null,
         decline_reason = null,
         link_expires_at = now() + make_interval(hours => (select sign_link_hours from doc_settings))
   where id = p_signer;
  update policy_documents set status = case when source = 'client_upload' then 'awaiting_upload' else 'out_for_signature' end,
         updated_at = now() where id = d.id;
  perform public.doc_audit_add(d.policy_id, d.id, null, 'new_link', jsonb_build_object('signer', p_signer));
  return jsonb_build_object('signer_id', p_signer, 'token', v_tok);
end;
$$;
revoke all on function public.doc_new_link(uuid) from public, anon;
grant execute on function public.doc_new_link(uuid) to authenticated;

-- The engine (GoHighLevel) texts the link from Deedstone and stamps it; the raw token is wiped. Service role only.
create or replace function public.doc_link_pushed(p_signer uuid) returns void language sql security definer
set search_path = public as $$
  update doc_signers set link_pushed_at = now(), link_token = null where id = p_signer and link_pushed_at is null
$$;
revoke all on function public.doc_link_pushed(uuid) from public, anon, authenticated;
grant execute on function public.doc_link_pushed(uuid) to service_role;

-- Void a form (wrong form, wrong person). Its links stop working. Signed files stay on the policy, marked void.
create or replace function public.doc_void(p_doc uuid, p_reason text) returns void language plpgsql security definer
set search_path = public as $$
declare d policy_documents%rowtype;
begin
  if not (public.is_fulfillment() or public.is_admin()) then raise exception 'Only Fulfillment can do this' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why' using errcode = '22023'; end if;
  select * into d from policy_documents where id = p_doc for update;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if d.status = 'void' then return; end if;
  update policy_documents set status = 'void', voided_at = now(), void_reason = left(btrim(p_reason), 300), updated_at = now()
   where id = p_doc;
  update doc_signers set link_expires_at = least(link_expires_at, now()), link_token = null where document_id = p_doc;
  perform public.doc_audit_add(d.policy_id, p_doc, null, 'void', jsonb_build_object('reason', p_reason));
end;
$$;
revoke all on function public.doc_void(uuid, text) from public, anon;
grant execute on function public.doc_void(uuid, text) to authenticated;

-- ── 9. The signing / upload page (doc-sign function, service role) ─────────
-- What the link opens. Stamps viewed_at. Expired links report expired (and the form goes expired when every
-- unsigned signer's link has run out).
create or replace function public.doc_token_view(p_token text) returns jsonb language plpgsql security definer
set search_path = public as $$
declare s doc_signers%rowtype; d policy_documents%rowtype; v_state text;
begin
  select * into s from doc_signers where token_hash = public.doc_hash(p_token);
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  select * into d from policy_documents where id = s.document_id;
  v_state := case
    when d.status = 'void' then 'void'
    when s.signed_at is not null then 'signed'
    when s.declined_at is not null then 'declined'
    when d.status = 'on_file' then 'done'
    when s.link_expires_at < now() then 'expired'
    else case when s.role = 'uploader' then 'upload' else 'sign' end end;
  if v_state = 'expired' and d.status = 'out_for_signature'
     and not exists (select 1 from doc_signers x where x.document_id = d.id and x.signed_at is null and x.link_expires_at >= now()) then
    update policy_documents set status = 'expired', updated_at = now() where id = d.id;
    perform public.notify(public.doc_va_for(d.id), 'document_declined',
      public.doc_client_name(d.policy_id) || ': signing link ran out', d.title || '. Make a new link.',
      '/fulfillment/servicing', true, 'doc_expired:' || d.id, jsonb_build_object('document_id', d.id));
  end if;
  if v_state in ('sign', 'upload') and s.viewed_at is null then
    update doc_signers set viewed_at = now() where id = s.id;
  end if;
  return jsonb_build_object(
    'state', v_state, 'mode', case when s.role = 'uploader' then 'upload' else 'sign' end,
    'signer_id', s.id, 'document_id', d.id, 'policy_id', d.policy_id, 'name', s.name, 'role', s.role,
    'title', d.title, 'doc_type', d.doc_type, 'carrier', (select name from carriers where id = d.carrier_id),
    'storage_path', d.storage_path, 'template_id', d.template_id, 'prefill', d.prefill,
    'fields', coalesce((select fields from doc_templates where id = d.template_id), '[]'::jsonb),
    'consent_version', (select consent_version from doc_settings),
    'others', (select coalesce(jsonb_agg(jsonb_build_object('role', x.role, 'name', x.name, 'signed', x.signed_at is not null) order by x.sort), '[]')
                 from doc_signers x where x.document_id = d.id and x.id <> s.id));
end;
$$;
revoke all on function public.doc_token_view(text) from public, anon, authenticated;
grant execute on function public.doc_token_view(text) to service_role;

-- One signer signs. Returns all_signed and, when it is, every signer's proof so the function can stamp the PDF.
create or replace function public.doc_token_sign(p_token text, p_name text, p_consent boolean, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s doc_signers%rowtype; d policy_documents%rowtype; v_all boolean;
begin
  select * into s from doc_signers where token_hash = public.doc_hash(p_token) for update;
  if not found then raise exception 'This link isn''t valid' using errcode = 'P0002'; end if;
  select * into d from policy_documents where id = s.document_id for update;
  if s.role = 'uploader' then raise exception 'This link is for sending a file' using errcode = '22023'; end if;
  if d.status <> 'out_for_signature' then raise exception 'This form can''t be signed now (%).', d.status using errcode = '22023'; end if;
  if s.signed_at is not null then raise exception 'You already signed this' using errcode = '22023'; end if;
  if s.declined_at is not null then raise exception 'This link was declined' using errcode = '22023'; end if;
  if s.link_expires_at < now() then raise exception 'This link ran out. Ask us for a new one.' using errcode = '22023'; end if;
  if p_consent is not true then raise exception 'Tick the box to agree to sign electronically' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Type your full name' using errcode = '22023'; end if;
  update doc_signers
     set signed_at = now(), signed_name = left(btrim(p_name), 120), sign_ip = left(p_ip, 64), sign_ua = left(p_ua, 300),
         consent_version = (select consent_version from doc_settings), link_token = null
   where id = s.id;
  v_all := not exists (select 1 from doc_signers where document_id = d.id and signed_at is null);
  perform public.doc_audit_add(d.policy_id, d.id, null, 'signed', jsonb_build_object('signer', s.id, 'role', s.role, 'ip', p_ip));
  return jsonb_build_object('all_signed', v_all, 'document_id', d.id, 'policy_id', d.policy_id,
    'signers', (select jsonb_agg(jsonb_build_object('role', role, 'name', name, 'signed_name', signed_name,
                                                    'signed_at', signed_at, 'ip', sign_ip, 'ua', sign_ua,
                                                    'consent_version', consent_version) order by sort)
                  from doc_signers where document_id = d.id));
end;
$$;
revoke all on function public.doc_token_sign(text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.doc_token_sign(text, text, boolean, text, text) to service_role;

create or replace function public.doc_token_decline(p_token text, p_reason text) returns void language plpgsql
security definer set search_path = public as $$
declare s doc_signers%rowtype; d policy_documents%rowtype;
begin
  select * into s from doc_signers where token_hash = public.doc_hash(p_token) for update;
  if not found then raise exception 'This link isn''t valid' using errcode = 'P0002'; end if;
  select * into d from policy_documents where id = s.document_id for update;
  if d.status <> 'out_for_signature' or s.signed_at is not null then
    raise exception 'This form can''t be declined now' using errcode = '22023';
  end if;
  update doc_signers set declined_at = now(), decline_reason = left(btrim(p_reason), 300), link_token = null where id = s.id;
  update policy_documents set status = 'declined', updated_at = now() where id = d.id;
  perform public.doc_audit_add(d.policy_id, d.id, null, 'declined', jsonb_build_object('signer', s.id, 'reason', p_reason));
  perform public.notify(public.doc_va_for(d.id), 'document_declined',
    s.name || ' declined to sign', d.title || coalesce('. Reason: ' || nullif(btrim(p_reason), ''), '') || '. Call them.',
    '/fulfillment/servicing', true, null, jsonb_build_object('document_id', d.id));
end;
$$;
revoke all on function public.doc_token_decline(text, text) from public, anon, authenticated;
grant execute on function public.doc_token_decline(text, text) to service_role;

-- The stamped PDF is stored; the form is signed; the VA is told.
create or replace function public.doc_signed_file(p_doc uuid, p_path text, p_sha256 text) returns void language plpgsql
security definer set search_path = public as $$
declare d policy_documents%rowtype;
begin
  select * into d from policy_documents where id = p_doc for update;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if exists (select 1 from doc_signers where document_id = p_doc and signed_at is null) then
    raise exception 'Not everyone has signed' using errcode = '22023';
  end if;
  if split_part(p_path, '/', 1) <> d.policy_id::text or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Bad file' using errcode = '22023';
  end if;
  update policy_documents set status = 'signed', signed_path = p_path, sha256 = p_sha256, signed_at = now(),
         document_date = (now() at time zone 'America/Chicago')::date, updated_at = now()
   where id = p_doc;
  perform public.doc_audit_add(d.policy_id, p_doc, null, 'signed_file', jsonb_build_object('sha256', p_sha256));
  perform public.notify(public.doc_va_for(p_doc), 'document_signed',
    public.doc_client_name(d.policy_id) || ' signed', d.title || '. It''s on the policy, ready to send to the carrier.',
    '/fulfillment/servicing', true, 'doc_signed:' || p_doc, jsonb_build_object('document_id', p_doc));
end;
$$;
revoke all on function public.doc_signed_file(uuid, text, text) from public, anon, authenticated;
grant execute on function public.doc_signed_file(uuid, text, text) to service_role;

-- ── 10. Uploads ─────────────────────────────────────────────────────────────
-- A link that asks the client for a photo or file (POA, a carrier letter). The engine texts it like a signing link.
create or replace function public.doc_request_upload(p_policy uuid, p_doc_type text, p_title text, p_name text,
                                                      p_task uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p policies%rowtype; v_doc uuid; v_tok text := public.doc_new_token(); v_sig uuid;
begin
  if not (public.is_fulfillment() or public.is_admin()) then raise exception 'Only Fulfillment can ask for a file' using errcode = '42501'; end if;
  select * into p from policies where id = p_policy;
  if not found then raise exception 'Policy not found' using errcode = 'P0002'; end if;
  if p_doc_type is null or not (p_doc_type = any (public.doc_types())) then raise exception 'Pick what kind of paper this is' using errcode = '22023'; end if;
  insert into policy_documents (policy_id, agent_id, task_id, carrier_id, doc_type, title, source, status, created_by)
  values (p_policy, p.agent_id, p_task, coalesce(p.new_carrier_id, p.carrier_id), p_doc_type,
          left(btrim(coalesce(nullif(btrim(p_title), ''), 'Requested file')), 160), 'client_upload', 'awaiting_upload', auth.uid())
  returning id into v_doc;
  insert into doc_signers (document_id, role, name, phone, token_hash, link_token, link_expires_at)
  values (v_doc, 'uploader', coalesce(nullif(btrim(p_name), ''), public.doc_client_name(p_policy)), p.client_phone,
          public.doc_hash(v_tok), v_tok, now() + make_interval(hours => (select sign_link_hours from doc_settings)))
  returning id into v_sig;
  perform public.doc_audit_add(p_policy, v_doc, null, 'upload_requested', '{}');
  return jsonb_build_object('document_id', v_doc, 'signer_id', v_sig, 'token', v_tok);
end;
$$;
revoke all on function public.doc_request_upload(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.doc_request_upload(uuid, text, text, text, uuid) to authenticated;

-- The client's file arrived through their link (service role, after the function stored it).
create or replace function public.doc_token_upload(p_token text, p_path text, p_sha256 text, p_ip text, p_ua text)
returns uuid language plpgsql security definer set search_path = public as $$
declare s doc_signers%rowtype; d policy_documents%rowtype;
begin
  select * into s from doc_signers where token_hash = public.doc_hash(p_token) for update;
  if not found or s.role <> 'uploader' then raise exception 'This link isn''t valid' using errcode = 'P0002'; end if;
  select * into d from policy_documents where id = s.document_id for update;
  if d.status <> 'awaiting_upload' or s.link_expires_at < now() then raise exception 'This link ran out. Ask us for a new one.' using errcode = '22023'; end if;
  if split_part(p_path, '/', 1) <> d.policy_id::text or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Bad file' using errcode = '22023'; end if;
  update doc_signers set signed_at = now(), sign_ip = left(p_ip, 64), sign_ua = left(p_ua, 300), link_token = null where id = s.id;
  update policy_documents set status = 'on_file', storage_path = p_path, sha256 = p_sha256,
         document_date = (now() at time zone 'America/Chicago')::date, updated_at = now() where id = d.id;
  perform public.doc_audit_add(d.policy_id, d.id, null, 'client_uploaded', jsonb_build_object('sha256', p_sha256));
  perform public.notify(public.doc_va_for(d.id), 'document_signed',
    public.doc_client_name(d.policy_id) || ' sent a file', d.title || '. It''s on the policy.',
    '/fulfillment/servicing', true, 'doc_upload:' || d.id, jsonb_build_object('document_id', d.id));
  return d.id;
end;
$$;
revoke all on function public.doc_token_upload(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.doc_token_upload(text, text, text, text, text) to service_role;

-- A file the VA or agent already uploaded to the bucket (a carrier letter, a certificate, the carrier's blank form).
create or replace function public.doc_register_upload(
  p_policy uuid, p_doc_type text, p_title text, p_path text, p_sha256 text default null,
  p_document_date date default null, p_task uuid default null, p_from_carrier boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare p policies%rowtype; v_doc uuid; v_src text;
begin
  select * into p from policies where id = p_policy;
  if not found then raise exception 'Policy not found' using errcode = 'P0002'; end if;
  if public.is_fulfillment() or public.is_admin() then v_src := case when p_from_carrier then 'carrier' else 'va_upload' end;
  elsif p.agent_id = auth.uid() then v_src := 'agent_upload';
  else raise exception 'Not your policy' using errcode = '42501';
  end if;
  if p_doc_type is null or not (p_doc_type = any (public.doc_types())) then raise exception 'Pick what kind of paper this is' using errcode = '22023'; end if;
  if split_part(coalesce(p_path, ''), '/', 1) <> p_policy::text then raise exception 'The file must be stored on this policy' using errcode = '22023'; end if;
  if p_sha256 is not null and p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Bad file hash' using errcode = '22023'; end if;
  if p_document_date > (now() at time zone 'America/Chicago')::date then raise exception 'The date can''t be in the future' using errcode = '22023'; end if;
  insert into policy_documents (policy_id, agent_id, task_id, carrier_id, doc_type, title, source, status, storage_path,
                                sha256, document_date, created_by)
  values (p_policy, p.agent_id, p_task, case when p_doc_type = 'cancellation_request' then p.carrier_id
                                               else coalesce(p.new_carrier_id, p.carrier_id) end,
          p_doc_type, left(btrim(coalesce(nullif(btrim(p_title), ''), 'Document')), 160), v_src, 'on_file', p_path, p_sha256,
          coalesce(p_document_date, (now() at time zone 'America/Chicago')::date), auth.uid())
  returning id into v_doc;
  perform public.doc_audit_add(p_policy, v_doc, null, 'uploaded', jsonb_build_object('source', v_src));
  return v_doc;
end;
$$;
revoke all on function public.doc_register_upload(uuid, text, text, text, text, date, uuid, boolean) from public, anon;
grant execute on function public.doc_register_upload(uuid, text, text, text, text, date, uuid, boolean) to authenticated;

-- ── 11. Sending to the carrier ──────────────────────────────────────────────
-- The address for a channel, from the carrier list.
create or replace function public.doc_carrier_address(p_carrier uuid, p_channel text) returns text language sql stable
set search_path = public as $$
  select case p_channel when 'fax' then docs_fax when 'email' then docs_email when 'upload' then docs_upload_url end
    from carriers where id = p_carrier
$$;

-- The first channel in the carrier's order that has an address (agent_portal needs none). Null = the carrier list
-- doesn't say yet: the VA asks the carrier and saves it (carrier_docs_update).
create or replace function public.doc_pick_channel(p_carrier uuid) returns text language sql stable
set search_path = public as $$
  select c from carriers, unnest(docs_channels) with ordinality u(c, o)
   where carriers.id = p_carrier and (c = 'agent_portal' or public.doc_carrier_address(p_carrier, c) is not null)
   order by o limit 1
$$;

-- Queue a send. p_channel null = the carrier's preference; p_destination null = the carrier list's address.
-- p_retry_of: a failed or never-received send this replaces (same document).
create or replace function public.doc_send_request(p_doc uuid, p_channel text default null, p_destination text default null,
                                                    p_retry_of uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d policy_documents%rowtype; p policies%rowtype; prev doc_sends%rowtype; cfg doc_settings%rowtype;
  v_channel text; v_dest text; v_send uuid; v_attempt int := 1; v_status text := 'queued'; v_carrier text;
begin
  if not (public.is_fulfillment() or public.is_admin()) then raise exception 'Only Fulfillment can send to a carrier' using errcode = '42501'; end if;
  select * into cfg from doc_settings;
  select * into d from policy_documents where id = p_doc for update;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if d.status not in ('signed', 'on_file') then
    raise exception 'Only a signed form or a file on the policy can be sent (this one is %)', d.status using errcode = '22023';
  end if;
  select * into p from policies where id = d.policy_id;
  if d.doc_type = 'cancellation_request' and public.replacement_gate_closed(p) then
    raise exception 'Not yet: the old policy is cancelled only after the new one is issued and its first payment clears.'
      using errcode = '22023', hint = 'replacement_gate';
  end if;
  if d.carrier_id is null then raise exception 'Pick the carrier first' using errcode = '22023'; end if;
  v_carrier := (select name from carriers where id = d.carrier_id);
  if exists (select 1 from doc_sends where document_id = p_doc and status in ('queued', 'sending')) then
    raise exception 'This one is already on its way' using errcode = '22023';
  end if;
  if p_retry_of is not null then
    select * into prev from doc_sends where id = p_retry_of and document_id = p_doc;
    if not found then raise exception 'Nothing to retry' using errcode = 'P0002'; end if;
    if prev.status not in ('failed', 'not_received') then raise exception 'Only a failed or never-received send can be retried' using errcode = '22023'; end if;
    v_attempt := (select count(*) + 1 from doc_sends where document_id = p_doc);
    if v_attempt > cfg.max_attempts then
      raise exception 'Tried % times. Call % to check the address, or ask an admin.', cfg.max_attempts, v_carrier using errcode = '22023';
    end if;
  end if;

  v_channel := coalesce(p_channel, public.doc_pick_channel(d.carrier_id));
  if v_channel is null then
    raise exception '% has no fax, email or upload address on file yet. Ask them and save it on the carrier.', v_carrier
      using errcode = '22023', hint = 'no_channel';
  end if;
  if v_channel not in ('fax', 'email', 'upload', 'agent_portal') then raise exception 'Unknown channel' using errcode = '22023'; end if;
  v_dest := case v_channel
    when 'fax' then public.doc_norm_fax(coalesce(p_destination, public.doc_carrier_address(d.carrier_id, 'fax')))
    when 'email' then public.doc_norm_email(coalesce(p_destination, public.doc_carrier_address(d.carrier_id, 'email')))
    when 'upload' then nullif(btrim(coalesce(p_destination, public.doc_carrier_address(d.carrier_id, 'upload'))), '')
  end;
  if v_channel <> 'agent_portal' and v_dest is null then
    raise exception 'Add a valid % for %', case v_channel when 'fax' then 'fax number' when 'email' then 'email address' else 'upload address' end, v_carrier
      using errcode = '22023', hint = 'no_destination';
  end if;
  -- upload: the VA does it on the carrier's site and marks it. agent_portal: the agent does it in their portal.
  if v_channel in ('upload', 'agent_portal') then v_status := 'sending'; end if;

  insert into doc_sends (document_id, policy_id, carrier_id, channel, destination, status, attempt, retry_of, sandbox,
                         provider, requested_by, sent_at)
  values (p_doc, d.policy_id, d.carrier_id, v_channel, v_dest, v_status, v_attempt, p_retry_of, not cfg.send_live,
          case when v_channel = 'fax' and cfg.send_live then cfg.fax_provider when v_channel = 'email' and cfg.send_live then 'resend'
               when v_channel in ('fax', 'email') then 'sandbox' else 'by_hand' end,
          auth.uid(), case when v_status = 'sending' then now() end)
  returning id into v_send;

  if v_channel = 'agent_portal' then
    perform public.notify(d.agent_id, 'carrier_upload_needed',
      'Upload ' || public.doc_client_name(d.policy_id) || '''s form to ' || v_carrier,
      d.title || '. Download it, upload it in your ' || v_carrier || ' producer portal, then tap I uploaded it.',
      '/agent/clients', true, 'upload_needed:' || v_send, jsonb_build_object('send_id', v_send, 'document_id', p_doc));
  end if;
  perform public.doc_audit_add(d.policy_id, p_doc, v_send, 'send_requested',
                               jsonb_build_object('channel', v_channel, 'attempt', v_attempt, 'sandbox', not cfg.send_live));
  return jsonb_build_object('send_id', v_send, 'channel', v_channel, 'destination', v_dest, 'status', v_status,
                            'attempt', v_attempt, 'sandbox', not cfg.send_live);
end;
$$;
revoke all on function public.doc_send_request(uuid, text, text, uuid) from public, anon;
grant execute on function public.doc_send_request(uuid, text, text, uuid) to authenticated;

-- doc-send picks up queued fax / email sends (service role).
create or replace function public.doc_sends_claim(p_limit int default 10) returns setof jsonb language plpgsql
security definer set search_path = public as $$
begin
  return query
  with picked as (
    select s.id from doc_sends s where s.status = 'queued' and s.channel in ('fax', 'email')
     order by s.requested_at limit greatest(1, least(p_limit, 50)) for update skip locked
  ), upd as (
    update doc_sends s set status = 'sending', sent_at = now() from picked where s.id = picked.id returning s.*
  )
  select jsonb_build_object('send_id', u.id, 'channel', u.channel, 'destination', u.destination, 'sandbox', u.sandbox,
           'provider', u.provider, 'attempt', u.attempt, 'document_id', d.id, 'title', d.title,
           'path', coalesce(d.signed_path, d.storage_path), 'carrier', c.name,
           'client', public.doc_client_name(d.policy_id), 'policy_number', p.policy_number)
    from upd u join policy_documents d on d.id = u.document_id join policies p on p.id = d.policy_id
    left join carriers c on c.id = u.carrier_id;
end;
$$;
revoke all on function public.doc_sends_claim(int) from public, anon, authenticated;
grant execute on function public.doc_sends_claim(int) to service_role;

-- The result of a send. Who may report it: the server (fax/email, from the provider), the VA (upload), the policy's
-- agent (agent_portal). delivered → receipt + confirm task; failed → reason + the VA told.
create or replace function public.doc_send_result(p_send uuid, p_status text, p_failure text default null,
                                                   p_receipt jsonb default '{}', p_provider_ref text default null,
                                                   p_pages int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s doc_sends%rowtype; d policy_documents%rowtype; v_task uuid; v_days int; v_server boolean; v_carrier text;
begin
  if p_status not in ('delivered', 'failed') then raise exception 'delivered or failed' using errcode = '22023'; end if;
  select * into s from doc_sends where id = p_send for update;
  if not found then raise exception 'Send not found' using errcode = 'P0002'; end if;
  select * into d from policy_documents where id = s.document_id;
  v_server := auth.uid() is null;   -- the service role (doc-send, the fax webhook); the app always has a uid
  if not v_server then
    if s.channel = 'upload' and (public.is_fulfillment() or public.is_admin()) then null;
    elsif s.channel = 'agent_portal' and (d.agent_id = auth.uid() or public.is_admin()) then null;
    else raise exception 'Not yours to mark' using errcode = '42501';
    end if;
  end if;
  if s.status not in ('queued', 'sending') then
    -- Providers can call twice; the same answer again is fine.
    if s.status = p_status then return jsonb_build_object('send_id', p_send, 'status', s.status, 'repeat', true); end if;
    raise exception 'This send is already %', s.status using errcode = '22023';
  end if;
  if p_status = 'failed' and length(btrim(coalesce(p_failure, ''))) < 2 then raise exception 'Say why it failed' using errcode = '22023'; end if;
  v_carrier := coalesce((select name from carriers where id = s.carrier_id), 'the carrier');

  if p_status = 'delivered' then
    v_days := case when s.retry_of is null then (select confirm_days from doc_settings) else (select resend_confirm_days from doc_settings) end;
    insert into servicing_tasks (agent_id, policy_id, kind, status, due_at, requested_by, requested_by_id, note, doc_send_id)
    values (d.agent_id, d.policy_id, 'carrier_call', 'requested', public.doc_business_deadline(now(), v_days), 'system', s.requested_by,
            left('Confirm ' || v_carrier || ' received the ' || d.title || ' (sent by '
                 || case s.channel when 'fax' then 'fax to ' || coalesce(s.destination, '') when 'email' then 'email to ' || coalesce(s.destination, '')
                                   when 'upload' then 'upload' else 'the agent''s portal' end
                 || ' on ' || to_char(now() at time zone 'America/Chicago', 'Mon FMDD, FMHH12:MI AM') || ' CT'
                 || case when s.sandbox then ', sandbox' else '' end || ').', 500),
            p_send)
    returning id into v_task;
    update doc_sends set status = 'delivered', delivered_at = now(), confirm_task_id = v_task,
           provider_ref = coalesce(p_provider_ref, provider_ref), pages = coalesce(p_pages, pages),
           receipt = coalesce(receipt, '{}') || coalesce(p_receipt, '{}') || jsonb_build_object('at', now(), 'to', destination)
     where id = p_send;
  else
    update doc_sends set status = 'failed', failed_at = now(), failure_reason = left(btrim(p_failure), 300),
           provider_ref = coalesce(p_provider_ref, provider_ref), receipt = coalesce(receipt, '{}') || coalesce(p_receipt, '{}')
     where id = p_send;
    perform public.notify(coalesce(s.requested_by, public.doc_va_for(d.id)), 'document_send_failed',
      'Didn''t reach ' || v_carrier || ': ' || public.doc_client_name(d.policy_id),
      d.title || '. ' || left(btrim(p_failure), 200) || '. Retry, or use another way.',
      '/fulfillment/servicing', true, null, jsonb_build_object('send_id', p_send, 'document_id', d.id));
  end if;
  perform public.doc_audit_add(d.policy_id, d.id, p_send, 'send_' || p_status,
                               jsonb_build_object('failure', p_failure, 'provider_ref', p_provider_ref));
  return jsonb_build_object('send_id', p_send, 'status', p_status, 'confirm_task_id', v_task);
end;
$$;
revoke all on function public.doc_send_result(uuid, text, text, jsonb, text, int) from public, anon;
grant execute on function public.doc_send_result(uuid, text, text, jsonb, text, int) to authenticated, service_role;

-- The confirm call: the carrier has it (closes the task, completed) or says it never came (task could_not_complete;
-- the VA fixes the address and retries).
create or replace function public.doc_send_confirm(p_send uuid, p_received boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s doc_sends%rowtype; d policy_documents%rowtype;
begin
  if not (public.is_fulfillment() or public.is_admin()) then raise exception 'Only Fulfillment can do this' using errcode = '42501'; end if;
  select * into s from doc_sends where id = p_send for update;
  if not found then raise exception 'Send not found' using errcode = 'P0002'; end if;
  if s.status <> 'delivered' then raise exception 'Only a delivered send can be confirmed (this one is %)', s.status using errcode = '22023'; end if;
  if p_received is null then raise exception 'Say whether they have it' using errcode = '22023'; end if;
  select * into d from policy_documents where id = s.document_id;
  update doc_sends set status = case when p_received then 'received' else 'not_received' end, confirmed_at = now(),
         confirmed_by = auth.uid(), confirm_note = nullif(left(btrim(p_note), 500), '')
   where id = p_send;
  if s.confirm_task_id is not null then
    update servicing_tasks set status = 'done', outcome = case when p_received then 'completed' else 'could_not_complete' end,
           outcome_note = nullif(left(btrim(p_note), 500), '')
     where id = s.confirm_task_id and status <> 'done';
  end if;
  perform public.doc_audit_add(d.policy_id, d.id, p_send, case when p_received then 'carrier_received' else 'carrier_not_received' end,
                               jsonb_build_object('note', p_note));
  return jsonb_build_object('send_id', p_send, 'status', case when p_received then 'received' else 'not_received' end);
end;
$$;
revoke all on function public.doc_send_confirm(uuid, boolean, text) from public, anon;
grant execute on function public.doc_send_confirm(uuid, boolean, text) to authenticated;

-- ── 12. One read for the screens ────────────────────────────────────────────
-- Every document on a policy with its signers (no proof columns) and sends, newest first, plus the gate.
create or replace function public.policy_documents_for(p_policy uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare p policies%rowtype;
begin
  select * into p from policies where id = p_policy;
  if not found then raise exception 'Policy not found' using errcode = 'P0002'; end if;
  if not (p.agent_id = auth.uid() or public.is_fulfillment() or public.is_admin()) then
    raise exception 'Not your policy' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'gate', public.replacement_gate_state(p_policy),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'doc_type', d.doc_type, 'title', d.title, 'source', d.source, 'status', d.status,
        'task_id', d.task_id, 'carrier', c.name, 'carrier_id', d.carrier_id,
        'path', coalesce(d.signed_path, d.storage_path), 'sha256', d.sha256, 'document_date', d.document_date,
        'created_at', d.created_at, 'signed_at', d.signed_at, 'void_reason', d.void_reason,
        'signers', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'role', x.role, 'name', x.name,
                      'viewed_at', x.viewed_at, 'signed_at', x.signed_at, 'declined_at', x.declined_at,
                      'decline_reason', x.decline_reason, 'link_expires_at', x.link_expires_at,
                      'link_sent', x.link_pushed_at is not null) order by x.sort), '[]')
                      from doc_signers x where x.document_id = d.id),
        'sends', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'channel', s.channel, 'destination', s.destination,
                      'status', s.status, 'attempt', s.attempt, 'sandbox', s.sandbox, 'failure_reason', s.failure_reason,
                      'receipt', s.receipt, 'requested_at', s.requested_at, 'delivered_at', s.delivered_at,
                      'confirmed_at', s.confirmed_at, 'confirm_task_id', s.confirm_task_id) order by s.requested_at desc), '[]')
                      from doc_sends s where s.document_id = d.id)
      ) order by d.created_at desc)
      from policy_documents d left join carriers c on c.id = d.carrier_id where d.policy_id = p_policy), '[]'::jsonb));
end;
$$;
revoke all on function public.policy_documents_for(uuid) from public, anon;
grant execute on function public.policy_documents_for(uuid) to authenticated;

-- ── 13. doc-send every minute, only when a fax or email is waiting ──────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'doc-send') then
    perform cron.unschedule('doc-send');
  end if;
  perform cron.schedule('doc-send', '* * * * *', $cron$
    select public.fulfillment_cron_post('doc-send', '{"action":"run"}'::jsonb)
     where exists (select 1 from public.doc_sends where status = 'queued' and channel in ('fax', 'email'))
  $cron$);
end $$;
