-- Migration 030: fair-share rewrite of assign_daily_batches (Thread #14 fix)
--
-- PROBLEM (verified 2026-06-17): the previous function processed reps in an
-- arbitrary loop order and each rep greedily topped up to batch_size from the
-- shared unassigned pool (`limit needed`) BEFORE the next rep was processed.
-- With a pool thinner than reps x batch_size, the first reps filled completely
-- and later reps got nothing (e.g. 6 reps / 300 pool / size 150 -> 150,150,0,0,0,0).
--
-- FIX: only the shared-pool top-up (old "step 3") changes. It is now a
-- CROSS-REP ROUND-ROBIN pass: each round, every active rep still under
-- batch_size that has an eligible unassigned lead takes exactly ONE (the oldest
-- by created_at). Reps drop out of the rotation as they fill, so a satisfied
-- rep's would-be share redistributes to reps that still need leads. This yields
-- floor(pool/N) or floor+1 per rep (remainder dealt to lowest rep id first),
-- caps every rep at batch_size, and respects per-lead niche eligibility -- so it
-- is fair whether reps contend for the whole pool (niche-agnostic, niche=NULL)
-- or a niche-scoped slice (niche-pooled).
--
-- Steps that touch only a rep's OWN previously-assigned/returned leads have no
-- cross-rep contention and are UNCHANGED: rollover (1,2), dry-pool fallbacks
-- (4,5), and the over-batch trim (6). They are kept, just reordered around the
-- new cross-rep pass: rollover runs first (so each rep's pre-existing claim is
-- counted before the pool is split), then the fair-share pool pass, then the
-- own-lead fallbacks + trim.
--
-- Implementation choice: iterative round-robin (not a closed-form floor(pool/N)
-- assignment) because it correctly handles UNEQUAL per-rep need (a rep that
-- rolled over some of its own leads needs fewer from the pool), automatically
-- redistributes a capped/satisfied rep's excess to others, and enforces
-- per-lead niche eligibility -- all of which a single modulo split cannot do
-- cleanly. It is O(leads_dealt) single-row updates; fine for a daily cron at
-- realistic scale (reps x batch_size bounded). If nationwide volume ever makes
-- it slow, it can be converted to a set-based per-bucket modulo assignment.
--
-- NOTE: synonym drift (e.g. 'tow truck' vs 'Towing') is intentionally NOT
-- addressed here -- it is a separate niche-normalization item. The fair-share
-- logic is unaffected by it: leads simply bucket by their stored niche string
-- (case-insensitively), so a rep only ever contends for leads whose niche
-- lower()-matches theirs, and the split is fair within whatever bucket results.

CREATE OR REPLACE FUNCTION public.assign_daily_batches(batch_size integer DEFAULT 150)
 RETURNS TABLE(rep_id uuid, batch_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  rep record;
  needed int;
  excess int;
  any_dealt boolean;
  lead_to_assign uuid;
begin
  -- PASS 1 (per-rep) -- steps 1 & 2: roll over the rep's OWN unworked 'New'
  -- leads from previous days so a pre-existing claim is counted before the
  -- shared pool is split in PASS 2. (No cross-rep contention: a rep's own leads.)
  for rep in
    select id, niche from profiles where role = 'rep' and is_active = true
  loop
    select batch_size - count(*) into needed
    from leads
    where assigned_rep_id = rep.id and batch_date = current_date;

    if needed > 0 then
      update leads set batch_date = current_date
      where id in (
        select id from leads
        where assigned_rep_id = rep.id
          and batch_date < current_date
          and status = 'New'
          and (rep.niche is null or lower(niche) = lower(rep.niche))
        order by batch_date desc
        limit needed
      );
    end if;
  end loop;

  -- PASS 2 (CROSS-REP FAIR-SHARE) -- replaces the old greedy "step 3".
  -- Round-robin deal from the shared unassigned pool: one eligible lead per
  -- under-cap rep per round, in ascending rep id (deterministic remainder),
  -- until no under-cap rep can take an eligible lead.
  loop
    any_dealt := false;
    for rep in
      select p.id, p.niche
      from profiles p
      where p.role = 'rep' and p.is_active = true
        and (
          select count(*) from leads l
          where l.assigned_rep_id = p.id and l.batch_date = current_date
        ) < batch_size
      order by p.id
    loop
      select id into lead_to_assign
      from leads
      where assigned_rep_id is null and status = 'New'
        and (rep.niche is null or lower(niche) = lower(rep.niche))
      order by created_at
      limit 1;

      if lead_to_assign is not null then
        update leads set assigned_rep_id = rep.id, batch_date = current_date
        where id = lead_to_assign;
        any_dealt := true;
      end if;
    end loop;
    exit when not any_dealt;
  end loop;

  -- PASS 3 (per-rep) -- steps 4, 5, 6: dry-pool fallbacks (rep's OWN leads only)
  -- and the over-batch trim. Unchanged from the prior function.
  for rep in
    select id, niche from profiles where role = 'rep' and is_active = true
  loop
    -- 4. re-surface the rep's recent worked leads, skipping queue-managed /
    --    permanent statuses (019)
    select batch_size - count(*) into needed
    from leads
    where assigned_rep_id = rep.id and batch_date = current_date;
    if needed > 0 then
      update leads set batch_date = current_date
      where id in (
        select id from leads
        where assigned_rep_id = rep.id
          and batch_date < current_date
          and status not in ('Booked', 'Appointment Booked', 'Not Interested', 'No Answer', 'Follow-Up')
          and (rep.niche is null or lower(niche) = lower(rep.niche))
        order by batch_date desc, updated_at desc
        limit needed
      );
    end if;

    -- 5. FINAL GUARANTEE (024): still short -- pull from ANY of the rep's own
    --    leads except permanent Not Interested (niche-matched only).
    select batch_size - count(*) into needed
    from leads
    where assigned_rep_id = rep.id and batch_date = current_date;
    if needed > 0 then
      update leads set batch_date = current_date
      where id in (
        select id from leads
        where assigned_rep_id = rep.id
          and batch_date is distinct from current_date
          and status <> 'Not Interested'
          and (rep.niche is null or lower(niche) = lower(rep.niche))
        order by batch_date desc nulls last, updated_at desc
        limit needed
      );
    end if;

    -- 6. TRIM (025): if the rep is now OVER batch_size for today, push excess
    --    fresh 'New' leads to tomorrow so the batch is exactly batch_size.
    select count(*) - batch_size into excess
    from leads
    where assigned_rep_id = rep.id and batch_date = current_date;
    if excess > 0 then
      update leads set batch_date = current_date + 1
      where id in (
        select id from leads
        where assigned_rep_id = rep.id
          and batch_date = current_date
          and status = 'New'
        order by created_at desc
        limit excess
      );
    end if;
  end loop;

  -- return per-rep counts
  for rep in
    select id from profiles where role = 'rep' and is_active = true
  loop
    rep_id := rep.id;
    select count(*) into batch_count
    from leads
    where assigned_rep_id = rep.id and batch_date = current_date;
    return next;
  end loop;
end;
$function$;
