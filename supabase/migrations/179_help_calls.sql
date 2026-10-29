-- 179 — Inbound help calls, one row per call (Roadmap Goal 9: Google Ads calls
-- ring the VA's browser phone, the VA qualifies, then live-transfers to an
-- on-duty agent or books on an agent's calendar).
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked
-- step. Additive only: one new table, two indexes, one trigger function, two
-- select policies, and the table joins the realtime publication if it isn't in
-- it yet. Nothing that exists is removed, renamed or emptied. Final names
-- (help-voice and help-transfer build against them):
--
--   table public.help_calls
--     id                   uuid pk
--     call_sid             text unique   the caller's inbound CallSid; the
--                                        conference is 'help-' || call_sid
--     caller_number        text          E.164 From
--     tracking_number      text          E.164 To
--     conference_sid       text
--     va_id                uuid -> profiles   the VA who answered
--     va_call_sid          text          the VA's browser leg
--     ringing_va_call_sids text[]        VA legs rung (cancel the losers; all
--                                        unanswered = no_answer)
--     status               text          ringing | live | transferring |
--                                        transferred | no_answer | ended
--     end_reason           text          e.g. no_va_online, no_va_answer,
--                                        caller_hung_up, conference_end
--     transfer_agent_id    uuid -> profiles
--     agent_call_sid       text
--     outcome              text          transferred | booked | dropped
--     lead_id              uuid -> leads
--     created_at, answered_at, transfer_started_at, transferred_at, ended_at,
--     updated_at           timestamptz
--
--   policy help_calls_select_own_va   an active Fulfillment rep reads the calls
--                                     they answered (va_id = auth.uid())
--   policy help_calls_select_admin    admins read every call (is_admin(), 152)
--   function public.help_calls_touch_updated_at()   updated_at trigger
--
-- Signed-in users can only read. There are no insert / update / delete
-- policies and no write grants: the edge functions use the service role,
-- which bypasses RLS and does every write.

create table if not exists public.help_calls (
  id                   uuid primary key default gen_random_uuid(),
  call_sid             text not null unique,
  caller_number        text,
  tracking_number      text,
  conference_sid       text,
  va_id                uuid references public.profiles(id) on delete set null,
  va_call_sid          text,
  ringing_va_call_sids text[] not null default '{}',
  status               text not null default 'ringing'
    check (status in ('ringing','live','transferring','transferred','no_answer','ended')),
  end_reason           text,
  transfer_agent_id    uuid references public.profiles(id) on delete set null,
  agent_call_sid       text,
  outcome              text
    check (outcome is null or outcome in ('transferred','booked','dropped')),
  lead_id              uuid references public.leads(id) on delete set null,
  created_at           timestamptz not null default now(),
  answered_at          timestamptz,
  transfer_started_at  timestamptz,
  transferred_at       timestamptz,
  ended_at             timestamptz,
  updated_at           timestamptz not null default now()
);

-- The VA's own recent calls, and the open calls the functions look up.
create index if not exists help_calls_va_created_idx
  on public.help_calls (va_id, created_at desc);
create index if not exists help_calls_open_status_idx
  on public.help_calls (status)
  where status in ('ringing','live','transferring','no_answer');

alter table public.help_calls enable row level security;

drop policy if exists help_calls_select_own_va on public.help_calls;
drop policy if exists help_calls_select_admin on public.help_calls;

create policy help_calls_select_own_va on public.help_calls
  for select to authenticated
  using (
    va_id = auth.uid()
    and exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'fulfillment' and p.is_active)
  );
create policy help_calls_select_admin on public.help_calls
  for select to authenticated using (public.is_admin());

revoke all on public.help_calls from anon, authenticated;
grant select on public.help_calls to authenticated;

-- ── updated_at ──────────────────────────────────────────────────────────────
create or replace function public.help_calls_touch_updated_at()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.help_calls_touch_updated_at() from public, anon, authenticated;

drop trigger if exists help_calls_touch_updated_at on public.help_calls;
create trigger help_calls_touch_updated_at
  before update on public.help_calls
  for each row execute function public.help_calls_touch_updated_at();

-- ── realtime ────────────────────────────────────────────────────────────────
-- So the VA desk sees status changes as they happen, the same guarded way 114
-- adds policy_messages. Realtime still applies the select policies above.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'help_calls'
  ) then
    alter publication supabase_realtime add table public.help_calls;
  end if;
end $$;

-- Check after applying (expect relrowsecurity true; two select policies; anon
-- has no select, authenticated has select only):
--   select relrowsecurity from pg_class where oid = 'public.help_calls'::regclass;
--   select policyname, cmd from pg_policies where tablename = 'help_calls';
--   select has_table_privilege('anon', 'public.help_calls', 'select') anon,
--          has_table_privilege('authenticated', 'public.help_calls', 'select') authed_select,
--          has_table_privilege('authenticated', 'public.help_calls', 'insert') authed_insert;
