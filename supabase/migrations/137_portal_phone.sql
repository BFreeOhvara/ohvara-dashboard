-- Prompt 751 — the pop-up phone: calling inside the portal.
--
-- Every call is one Twilio Conference named for the policy ("policy-<id>").
-- The rep's browser joins it through the TwiML App (fulfillment-voice); the
-- client and the carrier are participants added by fulfillment-call. Twilio's
-- callbacks land in fulfillment-voice, which keeps one row per outside leg
-- here, so the panel shows real states (ringing, talking, on hold, gone).
-- No recording anywhere.
--
--   recovery_config.voice_live   off switch, default off. While off the panel
--                                opens in preview and the old Call client path
--                                (bridge or tel:) stays the way to call.
--   policies.cancellation_effective_date / drafts_stopped
--                                the proof a Cancelled result needs, next to the
--                                existing cancellation_confirmation.
--                                (policies.effective_date is the NEW policy's.)
--   fulfillment_voice_legs       written only by the edge functions (service
--                                role); read by the assigned rep or an admin.

alter table public.recovery_config
  add column if not exists voice_live boolean not null default false;
grant update (voice_live) on public.recovery_config to authenticated;

alter table public.policies
  add column if not exists cancellation_effective_date date,
  add column if not exists drafts_stopped boolean;

create table if not exists public.fulfillment_voice_legs (
  call_sid        text primary key,
  policy_id       uuid not null references public.policies(id) on delete cascade,
  conference_sid  text,
  party           text not null check (party in ('client', 'carrier')),
  status          text not null default 'ringing'
                  check (status in ('ringing', 'live', 'ended')),
  on_hold         boolean not null default false,
  hold_since      timestamptz,
  started_at      timestamptz not null default now(),
  answered_at     timestamptz,
  ended_at        timestamptz,
  end_reason      text,
  updated_at      timestamptz not null default now()
);
create index if not exists fulfillment_voice_legs_policy_idx
  on public.fulfillment_voice_legs (policy_id, started_at desc);

alter table public.fulfillment_voice_legs enable row level security;
drop policy if exists fulfillment_voice_legs_read on public.fulfillment_voice_legs;
create policy fulfillment_voice_legs_read on public.fulfillment_voice_legs
  for select to authenticated using (
    public.is_admin() or exists (
      select 1 from public.policies p
       where p.id = policy_id and p.assigned_fulfillment_id = auth.uid()
    )
  );
revoke all on public.fulfillment_voice_legs from anon, authenticated;
grant select on public.fulfillment_voice_legs to authenticated;
