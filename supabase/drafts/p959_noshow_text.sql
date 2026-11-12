-- P959 DRAFT, NOT A MIGRATION (no number reserved; Brayden/a manager reserves one, then this moves to supabase/migrations/).
-- Imported ("Your own leads") people who booked AND said yes to texts on the call get the normal no-show rebook text when
-- they no-show. Nobody who didn't say yes, and nobody before a booking. Words: functions/reactivation/core.ts (bk_noshow).
-- 1. The text steps allow bk_noshow.
alter table public.reactivation_texts drop constraint if exists reactivation_texts_step_key_check;
alter table public.reactivation_texts add constraint reactivation_texts_step_key_check
  check (step_key in ('bk_confirm', 'bk_day_before', 'bk_morning', 'bk_1h', 'bk_noshow'));

-- 2. The no-show trigger (269 §10) also queues the rebook text for someone who said yes to texts. appt_at = the
--    appointment they missed (the claim cancels a text whose appointment moved, so a rebooked person gets nothing stale).
create or replace function public.reactivation_no_show()
returns trigger language plpgsql security definer set search_path = public as $$
declare rc reactivation_contacts; missed timestamptz;
begin
  if new.kind = 'no_show' and new.state = 'done' and not coalesce(new.is_sample, false) then
    select c.* into rc from reactivation_contacts c join leads l on l.reactivation_id = c.id where l.id = new.lead_id;
    if rc.id is not null and rc.status in ('booked', 'transferred') and not exists (select 1 from dnc_numbers where phone = rc.phone and internal) then
      update reactivation_contacts set status = 'queued', rebook = true, rebook_tries = 0, updated_at = now(),
             next_at = coalesce(reactivation_window_next(rc.state, now() + interval '2 hours'), now() + interval '1 day')
       where id = rc.id and attempts < 10;
      update reactivation_texts set status = 'cancelled' where contact_id = rc.id and status = 'queued';
      if coalesce(rc.text_ok, false) then
        select booked_for into missed from ai_calls where id = rc.text_ok_call;
        if missed is not null then
          insert into reactivation_texts (contact_id, lead_id, agent_id, call_id, step_key, appt_at, send_at)
          values (rc.id, new.lead_id, rc.agent_id, rc.text_ok_call, 'bk_noshow', missed, now())
          on conflict (contact_id, step_key, appt_at) do nothing;
        end if;
      end if;
    end if;
  end if;
  return new;
exception when others then raise warning 'reactivation_no_show: %', sqlerrm; return new;
end;
$$;
revoke execute on function public.reactivation_no_show() from public, anon, authenticated;

-- 3. The claim (269 §9) must let bk_noshow through although its appointment is already past: change the cancel test to
--      (t.step_key not in ('bk_confirm', 'bk_noshow') and t.appt_at <= now())
--    (re-create reactivation_texts_claim with only that line changed).
