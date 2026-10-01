-- Prompt 666: Fulfillment calls a client showing the *agent's* number as
-- Caller ID ("calling on behalf of"), via a Twilio-bridged call.
--
-- The agent's number has to be verified with Twilio (Outgoing Caller IDs)
-- before Twilio will present it. Verification state lives here, but only the
-- agent-caller-id edge function (service role) may write it: profiles_update_self
-- lets a user write any column on their own row, so without the guard below an
-- agent could mark an arbitrary number "verified". The agent keeps the one
-- switch that's theirs — caller_id_enabled — and can turn it off at any time.

alter table public.profiles
  add column if not exists caller_id_number         text,         -- E.164, set once Twilio confirms
  add column if not exists caller_id_verified_at    timestamptz,
  add column if not exists caller_id_twilio_sid     text,         -- Twilio OutgoingCallerId SID (PN...)
  add column if not exists caller_id_pending_number text,         -- E.164, mid-verification
  add column if not exists caller_id_pending_at     timestamptz,
  add column if not exists caller_id_enabled        boolean not null default true;

comment on column public.profiles.caller_id_number is
  'Prompt 666: agent''s Twilio-verified Caller ID (E.164). Server-written only.';
comment on column public.profiles.caller_id_enabled is
  'Prompt 666: agent kill switch. Off = Fulfillment calls fall back to a plain tel: link.';

create or replace function public.profiles_guard_caller_id()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.caller_id_number         := old.caller_id_number;
    new.caller_id_verified_at    := old.caller_id_verified_at;
    new.caller_id_twilio_sid     := old.caller_id_twilio_sid;
    new.caller_id_pending_number := old.caller_id_pending_number;
    new.caller_id_pending_at     := old.caller_id_pending_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_caller_id on public.profiles;
create trigger profiles_guard_caller_id
  before update on public.profiles
  for each row execute function public.profiles_guard_caller_id();
