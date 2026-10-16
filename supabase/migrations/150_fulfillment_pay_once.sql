-- 150 — Fulfillment hardening, area 3: a cancel is paid once (Prompt 769-3).
--
-- The gap: when a Monday transfer failed, its cancels kept the failed
-- payout's id. Next Monday's payout counted them in its amount (they were
-- still unpaid) but only re-pointed cancels with no payout id, so the paid
-- stamp missed them. They stayed unpaid and were paid a third time the week
-- after. Now a claim points every cancel it counts at itself, so the paid
-- stamp (fulfillment_finish_payout) covers exactly what was sent.
create or replace function public.fulfillment_claim_payout(p_rep uuid, p_period_start date, p_run uuid,
                                                           p_hold boolean default false, p_reason text default null)
 returns fulfillment_payouts
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  cur public.fulfillment_payouts;
  f   record;
begin
  select * into cur from fulfillment_payouts where rep_id = p_rep and period_start = p_period_start for update;
  if found and cur.status = 'paid' then return null; end if;
  if found and cur.status = 'approved' then return cur; end if;
  select * into f from public.fulfillment_payable(p_rep, p_period_start);
  if f.amount_cents <= 0 then return null; end if;
  insert into fulfillment_payouts as fo (rep_id, period_start, period_end, amount_cents, cancels, topup_cents, status, run_id, failure_reason)
  values (p_rep, p_period_start, p_period_start + 6, f.amount_cents, f.cancels, f.topup_cents,
          case when p_hold then 'held' else 'approved' end, p_run, case when p_hold then p_reason end)
  on conflict (rep_id, period_start) do update
     set amount_cents = excluded.amount_cents, cancels = excluded.cancels, topup_cents = excluded.topup_cents,
         status = excluded.status, run_id = excluded.run_id, failure_reason = excluded.failure_reason,
         hours = 0, rate_cents = 0
  returning * into cur;
  if not p_hold then
    -- fulfillment_payable only returns unpaid, unlocked cancels, so this never
    -- moves a cancel off a payout that is approved or paid.
    update fulfillment_cancels set payout_id = cur.id
     where id = any (f.cancel_ids) and payout_id is distinct from cur.id;
  end if;
  return cur;
end;
$$;

-- Leftovers nothing calls (hours-based pay is gone; the lock check is used
-- only inside security-definer triggers and functions).
revoke execute on function public.fulfillment_sync_payouts(uuid) from public, anon, authenticated;
revoke execute on function public.fulfillment_fix_hours(uuid, date, jsonb, text) from public, anon, authenticated;
revoke execute on function public.fulfillment_cancel_locked(public.fulfillment_cancels) from public, anon, authenticated;
revoke execute on function public.team_performance_policies() from public, anon, authenticated;
