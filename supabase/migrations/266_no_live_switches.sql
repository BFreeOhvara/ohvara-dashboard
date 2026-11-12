-- 266_no_live_switches (Prompt 950, Brayden Nov 10 18:39). NOT APPLIED until Brayden's yes.
-- "I don't want me or Jordan to be able to flip things on or off in the portal. Everything is built; it's just not on yet.
-- CC turns it on at launch with my yes." The portal's live switches are gone (admin Settings › Go live, Live charging,
-- Owner payouts, the old /settings switches). This is the database half: the live flags keep their values (all off) and
-- stay readable, but no signed-in user, admin included, can change them. Only the service role (CC, in a session, with
-- Brayden's yes) or the database owner can. See brain/ohvara/Go Live Runbook.md for the order and the emergency stop.
--
-- The flags:
--   recovery_config : sms_live (texts), voice_live (portal calls), ai_caller_live (AI caller), owner_payouts_live,
--                     payouts_live (VA pay), recording_live (call recording), invite_sms_live (invite by text)
--   app_settings    : show_sample_data (sample data on for everyone)
--   billing_settings: live_charging (+ _at, _by)
-- How: a BEFORE UPDATE trigger on each table refuses a change to those columns whenever the caller is a signed-in user
-- (auth.uid() is not null). The service role and a direct database connection carry no user, so they pass. Column
-- grants are also taken away from `authenticated` where an earlier migration had given them, and the one RPC that
-- flipped live charging is taken away from signed-in users.
-- Tests: supabase/tests/p950_no_live_switches.sql (PGlite).

create or replace function public.live_flags_guard() returns trigger language plpgsql set search_path = public as $$
declare col text;
begin
  if auth.uid() is null then return new; end if; -- service role / database owner: CC, with Brayden's yes
  foreach col in array tg_argv loop
    if to_jsonb(new) -> col is distinct from to_jsonb(old) -> col then
      raise exception 'The live switches are not changed in the portal. Ohvara turns them on with Brayden''s yes.' using errcode = '42501', hint = col;
    end if;
  end loop;
  return new;
end $$;
comment on function public.live_flags_guard() is
  'P950: refuses a signed-in user changing a live flag (the column names are the trigger arguments). Service role and the database owner pass.';

revoke all on function public.live_flags_guard() from public, anon, authenticated; -- a trigger function: no one calls it (p922)

drop trigger if exists recovery_config_live_guard on public.recovery_config;
create trigger recovery_config_live_guard before update on public.recovery_config
  for each row execute function public.live_flags_guard('sms_live', 'voice_live', 'ai_caller_live', 'owner_payouts_live', 'payouts_live', 'recording_live', 'invite_sms_live');

drop trigger if exists app_settings_live_guard on public.app_settings;
create trigger app_settings_live_guard before update on public.app_settings
  for each row execute function public.live_flags_guard('show_sample_data');

drop trigger if exists billing_settings_live_guard on public.billing_settings;
create trigger billing_settings_live_guard before update on public.billing_settings
  for each row execute function public.live_flags_guard('live_charging', 'live_charging_at', 'live_charging_by');

-- Earlier migrations (122, 137, 138, 145) gave signed-in users column-level update on some flags. Take those back; the
-- notice text and the other settings in the same grants stay.
revoke update (sms_live, voice_live, payouts_live, recording_live) on public.recovery_config from authenticated;

-- The one RPC that flipped live charging: service role only now.
revoke execute on function public.admin_billing_live_set(boolean) from public, anon, authenticated;
grant  execute on function public.admin_billing_live_set(boolean) to service_role;

comment on column public.recovery_config.owner_payouts_live is
  'P945: owners (admins) get their 50% of the profit in the Monday pay run, to the bank they connected through Stripe. Off until Ohvara turns it on with Brayden''s yes (P950: no portal switch; Go Live Runbook).';
