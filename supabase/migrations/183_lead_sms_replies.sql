-- 183 — Lead text replies for the VA queue (Roadmap Goal 8 groundwork).
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked
-- step. Additive only: one table, two indexes on it, a trigger and four
-- functions, each created only if it isn't there yet (or replaced in place).
-- Nothing is dropped, renamed, truncated or deleted. Creates no index on
-- leads and grants nothing on sms_e164.
--
-- HOLD: merge only after Goal 1's 166_lead_types_delivery is merged (one lead
-- model first). This file does not use leads.lead_type, so it applies before
-- or after 166.
--
-- Until now twilio-sms-webhook kept only STOP / START and dropped every other
-- inbound text. With this file the webhook saves those replies here:
--
--   lead_sms_replies          one row per inbound text that isn't STOP / START,
--                             once per Twilio MessageSid. The service role
--                             (the webhook) writes; nobody else reads or writes
--                             the table directly.
--   lead_sms_match(phone)     service role only. The newest lead with this
--                             phone (compared through sms_e164, 157), or null.
--   va_lead_replies()         Fulfillment / admin: unhandled replies, newest
--                             first, with the lead's name.
--   va_mark_reply_handled(id) Fulfillment / admin: marks one reply handled.

-- ── the replies ─────────────────────────────────────────────────────────────
create table if not exists public.lead_sms_replies (
  id          uuid primary key default gen_random_uuid(),
  from_phone  text not null,                       -- E.164 when sms_e164 can read it
  body        text not null default '' check (char_length(body) <= 1600),
  twilio_sid  text not null unique,                -- Twilio retries save nothing twice
  lead_id     uuid references public.leads(id) on delete set null,
  received_at timestamptz not null default now(),
  handled_by  uuid references public.profiles(id) on delete set null,
  handled_at  timestamptz
);

-- The VA queue: unhandled, newest first.
create index if not exists lead_sms_replies_open_idx
  on public.lead_sms_replies (received_at desc) where handled_at is null;
-- on delete set null from leads.
create index if not exists lead_sms_replies_lead_idx
  on public.lead_sms_replies (lead_id) where lead_id is not null;

alter table public.lead_sms_replies enable row level security;
-- No policies: anon and authenticated get nothing. The service role bypasses
-- RLS; people read through the two va_ functions below.
revoke all on public.lead_sms_replies from public, anon, authenticated;

-- Stored the way sms_opt_outs stores numbers, whatever the caller sends; a
-- number sms_e164 can't read (not US) is kept as sent.
create or replace function public.lead_sms_replies_e164()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  new.from_phone := coalesce(public.sms_e164(new.from_phone), new.from_phone);
  return new;
end;
$$;

revoke execute on function public.lead_sms_replies_e164() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.lead_sms_replies'::regclass and tgname = 'lead_sms_replies_e164') then
    create trigger lead_sms_replies_e164
      before insert or update of from_phone on public.lead_sms_replies
      for each row execute function public.lead_sms_replies_e164();
  end if;
end $$;

-- ── matching a reply to its lead ────────────────────────────────────────────
-- Leads keep phone as typed (submit-mp-lead stores E.164; older leads may
-- not), so the match goes through sms_e164 on both sides. No index on leads
-- for it: sms_e164 is revoked from authenticated (157), and an index
-- expression runs as the user writing the row, so it would break admin and
-- rep writes to leads. One scan per inbound text is fine.
create or replace function public.lead_sms_match(p_phone text)
 returns uuid
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  select l.id
    from leads l
   where l.phone is not null
     and public.sms_e164(l.phone) = public.sms_e164(p_phone)
   order by l.created_at desc, l.id desc
   limit 1
$$;

revoke execute on function public.lead_sms_match(text) from public, anon, authenticated;
grant  execute on function public.lead_sms_match(text) to service_role;

-- ── the VA queue ────────────────────────────────────────────────────────────
create or replace function public.va_lead_replies()
 returns table (id uuid, lead_id uuid, lead_name text, from_phone text, body text, received_at timestamptz)
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can see text replies' using errcode = '42501';
  end if;
  return query
    select r.id, r.lead_id,
           coalesce(nullif(btrim(l.contact_name), ''), l.business_name),
           r.from_phone, r.body, r.received_at
      from lead_sms_replies r
      left join leads l on l.id = r.lead_id
     where r.handled_at is null
     order by r.received_at desc, r.id desc;
end;
$$;

revoke execute on function public.va_lead_replies() from public, anon;
grant  execute on function public.va_lead_replies() to authenticated;

-- Marks one reply handled by the caller. Already handled: left as it was (the
-- first VA keeps the credit), no error.
create or replace function public.va_mark_reply_handled(p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can handle text replies' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'Reply id is required' using errcode = '22004';
  end if;
  update lead_sms_replies
     set handled_by = auth.uid(), handled_at = now()
   where id = p_id and handled_at is null;
  if not found and not exists (select 1 from lead_sms_replies where id = p_id) then
    raise exception 'Reply not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.va_mark_reply_handled(uuid) from public, anon;
grant  execute on function public.va_mark_reply_handled(uuid) to authenticated;

-- Check after applying (expect: table privileges all false for anon and
-- authenticated; lead_sms_match only service_role; the va_ functions
-- authenticated + service_role, and 42501 for an agent):
--   select r, has_table_privilege(r, 'public.lead_sms_replies', 'select'),
--             has_table_privilege(r, 'public.lead_sms_replies', 'insert')
--     from unnest(array['anon', 'authenticated']) r;
--   select r, has_function_privilege(r, 'public.lead_sms_match(text)', 'execute'),
--             has_function_privilege(r, 'public.va_lead_replies()', 'execute'),
--             has_function_privilege(r, 'public.va_mark_reply_handled(uuid)', 'execute')
--     from unnest(array['anon', 'authenticated', 'service_role']) r;
