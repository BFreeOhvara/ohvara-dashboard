import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// ── Message reply notifier ───────────────────────────────────────────────────
// Subscribes to realtime UPDATEs on the messages table for this rep's sent
// messages. When a reply arrives (reply_body transitions null → set), the DB
// trigger (migration 043 messages_reply_notify) has already inserted a
// notifications row — we just invalidate the cache to surface it immediately
// rather than waiting for the next polling cycle.
export function useMessageReplyNotifier(repId) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!repId) return
    const channel = supabase
      .channel(`msg-replies-${repId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `sender_id=eq.${repId}` },
        (payload) => {
          if (payload.new?.reply_body && !payload.old?.reply_body) {
            qc.invalidateQueries({ queryKey: ['rep-notifications', repId] })
            qc.invalidateQueries({ queryKey: ['rep-notifications-unread', repId] })
          }
        })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [repId, qc])
}

// ── Deal closed notifier ─────────────────────────────────────────────────────
// Subscribes to realtime INSERTs on commission_payouts for this rep.
// Fetches the payout with joins (realtime payload has no joined data), then
// inserts a "Deal closed!" notification with the dollar amount and business name.
export function useDealClosedNotifier(repId) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!repId) return
    const channel = supabase
      .channel(`deal-closed-${repId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commission_payouts', filter: `rep_id=eq.${repId}` },
        async (payload) => {
          const raw = payload.new
          let biz = 'a new deal'
          let amountCents = raw.amount_cents
          const { data } = await supabase
            .from('commission_payouts')
            .select('amount_cents, appointment:appointments!appointment_id ( lead:leads ( business_name ) )')
            .eq('id', raw.id)
            .single()
          if (data) {
            amountCents = data.amount_cents
            if (data.appointment?.lead?.business_name) biz = data.appointment.lead.business_name
          }
          await supabase.from('notifications').insert({
            profile_id: repId,
            type: 'deal_closed',
            message: `Deal closed: ${biz}`,
            data: { payout_id: raw.id, amount_cents: amountCents },
          })
          qc.invalidateQueries({ queryKey: ['rep-notifications', repId] })
          qc.invalidateQueries({ queryKey: ['rep-notifications-unread', repId] })
        })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [repId, qc])
}

// Badge definitions — must stay in sync with BADGE_GROUPS in MyGoals.jsx.
// Conditions are deterministic from badgeCtx = { month, commission, activity }.
const ALL_BADGES = [
  { id: 'dial_1',      label: 'First Dial',              condition: c => (c.month?.totalDials    || 0) >= 1 },
  { id: 'dial_10',     label: '10 Dials',                condition: c => (c.month?.totalDials    || 0) >= 10 },
  { id: 'dial_50',     label: '50 Dials',                condition: c => (c.month?.totalDials    || 0) >= 50 },
  { id: 'dial_100',    label: '100 Dials',               condition: c => (c.month?.totalDials    || 0) >= 100 },
  { id: 'dial_250',    label: '250 Dials',               condition: c => (c.month?.totalDials    || 0) >= 250 },
  { id: 'dial_500',    label: '500 Dials',               condition: c => (c.month?.totalDials    || 0) >= 500 },
  { id: 'dial_1000',   label: '1,000 Dials',             condition: c => (c.month?.totalDials    || 0) >= 1000 },
  { id: 'dial_2500',   label: '2,500 Dials',             condition: c => (c.month?.totalDials    || 0) >= 2500 },
  { id: 'dial_5000',   label: '5,000 Dials',             condition: c => (c.month?.totalDials    || 0) >= 5000 },
  { id: 'dial_10000',  label: '10,000 Dials',            condition: c => (c.month?.totalDials    || 0) >= 10000 },
  { id: 'book_1',      label: 'First Booking',           condition: c => (c.month?.bookedCount   || 0) >= 1 },
  { id: 'book_5',      label: '5 Bookings',              condition: c => (c.month?.bookedCount   || 0) >= 5 },
  { id: 'book_10',     label: '10 Bookings',             condition: c => (c.month?.bookedCount   || 0) >= 10 },
  { id: 'book_25',     label: '25 Bookings',             condition: c => (c.month?.bookedCount   || 0) >= 25 },
  { id: 'book_50',     label: '50 Bookings',             condition: c => (c.month?.bookedCount   || 0) >= 50 },
  { id: 'book_100',    label: '100 Bookings',            condition: c => (c.month?.bookedCount   || 0) >= 100 },
  { id: 'book_250',    label: '250 Bookings',            condition: c => (c.month?.bookedCount   || 0) >= 250 },
  { id: 'streak_3',    label: '3-Day Streak',            condition: c => (c.activity?.longestStreak     || 0) >= 3 },
  { id: 'streak_5',    label: 'Full Work Week',          condition: c => (c.activity?.longestStreak     || 0) >= 5 },
  { id: 'streak_10',   label: 'Two-Week Run',            condition: c => (c.activity?.longestStreak     || 0) >= 10 },
  { id: 'perfect_streak_3', label: '3 Perfect Days in a Row', condition: c => (c.activity?.perfectStreak    || 0) >= 3 },
  { id: 'perfect_week',     label: 'Perfect Week',            condition: c => (c.activity?.perfectStreak    || 0) >= 5 },
  { id: 'perfect_5',   label: '5 Perfect Days',          condition: c => (c.activity?.totalPerfectDays  || 0) >= 5 },
  { id: 'perfect_25',  label: '25 Perfect Days',         condition: c => (c.activity?.totalPerfectDays  || 0) >= 25 },
  { id: 'perfect_50',  label: '50 Perfect Days',         condition: c => (c.activity?.totalPerfectDays  || 0) >= 50 },
  { id: 'days_10',     label: '10 Days',                 condition: c => (c.activity?.totalCompletedDays || 0) >= 10 },
  { id: 'days_25',     label: '25 Days',                 condition: c => (c.activity?.totalCompletedDays || 0) >= 25 },
  { id: 'days_50',     label: '50 Days',                 condition: c => (c.activity?.totalCompletedDays || 0) >= 50 },
  { id: 'days_75',     label: '75 Days',                 condition: c => (c.activity?.totalCompletedDays || 0) >= 75 },
  { id: 'days_100',    label: '100 Days',                condition: c => (c.activity?.totalCompletedDays || 0) >= 100 },
  { id: 'perfect_day', label: 'Perfect Day',             condition: c => !!c.activity?.perfectDay },
  { id: 'comm_first',  label: 'First Commission',        condition: c => (c.commission?.total          || 0) > 0 },
  { id: 'comm_500',    label: '$500 Earned',             condition: c => (c.commission?.total          || 0) >= 500 },
  { id: 'comm_1k',     label: '$1K Earned',              condition: c => (c.commission?.total          || 0) >= 1000 },
  { id: 'comm_2_5k',   label: '$2.5K Earned',            condition: c => (c.commission?.total          || 0) >= 2500 },
  { id: 'comm_5k',     label: '$5K Earned',              condition: c => (c.commission?.total          || 0) >= 5000 },
  { id: 'comm_10k',    label: '$10K Earned',             condition: c => (c.commission?.total          || 0) >= 10000 },
  { id: 'five_a_day',  label: '5 in a Day',              condition: c => (c.activity?.bestDayBookings  || 0) >= 5 },
  { id: 'back_to_back',label: 'Back-to-Back Bookings',   condition: c => !!c.activity?.backToBack },
]

// ── Badge notifier ───────────────────────────────────────────────────────────
// Called from MyGoals.jsx where badgeCtx is already loaded. On the first render
// where badgeCtx has data, upserts a notification for every earned badge.
// The DB unique constraint on (profile_id, badge_id) makes this idempotent.

export function useBadgeNotifier(repId, badgeCtx) {
  const qc = useQueryClient()
  const hasChecked = useRef(false)

  useEffect(() => {
    if (!repId || !badgeCtx?.month || !badgeCtx?.activity) return
    if (hasChecked.current) return
    hasChecked.current = true

    const earned = ALL_BADGES.filter(b => b.condition(badgeCtx))
    if (earned.length === 0) return

    Promise.all(
      earned.map(badge =>
        supabase.from('notifications').upsert(
          {
            profile_id: repId,
            type: 'badge',
            message: `Badge unlocked: ${badge.label}`,
            badge_id: badge.id,
            data: { badge_id: badge.id, label: badge.label },
          },
          { onConflict: 'profile_id,badge_id', ignoreDuplicates: true }
        )
      )
    ).then(() => {
      qc.invalidateQueries({ queryKey: ['rep-notifications', repId] })
      qc.invalidateQueries({ queryKey: ['rep-notifications-unread', repId] })
    })
  }, [repId, badgeCtx, qc])
}

// ── Call graded notifier ─────────────────────────────────────────────────────
// Subscribes to realtime UPDATEs on the calls table for this rep.
// When grade-call writes a grade (graded_at transitions null → set), invalidates
// the notification cache so the bell refreshes without waiting for the next poll.
export function useCallGradedNotifier(repId) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!repId) return
    const channel = supabase
      .channel(`call-graded-${repId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'calls',
        filter: `rep_id=eq.${repId}`,
      }, (payload) => {
        if (payload.new?.graded_at && !payload.old?.graded_at) {
          qc.invalidateQueries({ queryKey: ['rep-notifications', repId] })
          qc.invalidateQueries({ queryKey: ['rep-notifications-unread', repId] })
          qc.invalidateQueries({ queryKey: ['my-calls', repId] })
        }
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [repId, qc])
}

// ── Follow-up notifier ───────────────────────────────────────────────────────
// Fires once per lead when its follow_up_at is within 5 minutes.
// Dedup key is `${leadId}:5` (session + DB both checked).
// Runs on each notifications refresh (every 15s) — no separate timer needed.

const FOLLOW_UP_THRESHOLDS_MIN = [5]

export function useFollowUpNotifier(repId, leads = [], existingNotifications = []) {
  const qc = useQueryClient()
  const notifiedThisSession = useRef(new Set())

  useEffect(() => {
    if (!repId || !leads.length) return

    const now = Date.now()

    const alreadyInDB = new Set(
      existingNotifications
        .filter(n => n.type === 'follow_up' && n.data?.lead_id != null && n.data?.threshold != null)
        .map(n => `${n.data.lead_id}:${n.data.threshold}`)
    )

    const toNotify = []
    for (const lead of leads) {
      if (lead.status !== 'Follow-Up' || !lead.follow_up_at) continue
      const minutesUntilDue = (new Date(lead.follow_up_at).getTime() - now) / 60000
      if (minutesUntilDue <= 0) continue

      for (const threshold of FOLLOW_UP_THRESHOLDS_MIN) {
        if (minutesUntilDue > threshold) continue
        const key = `${lead.id}:${threshold}`
        if (notifiedThisSession.current.has(key) || alreadyInDB.has(key)) continue
        notifiedThisSession.current.add(key)
        toNotify.push({
          profile_id: repId,
          type: 'follow_up',
          message: `Follow-up in 5 min: ${lead.business_name}`,
          data: { lead_id: lead.id, business_name: lead.business_name, threshold },
        })
      }
    }

    if (toNotify.length === 0) return

    Promise.all(
      toNotify.map(row => supabase.from('notifications').insert(row))
    ).then(() => {
      qc.invalidateQueries({ queryKey: ['rep-notifications', repId] })
      qc.invalidateQueries({ queryKey: ['rep-notifications-unread', repId] })
    })
  }, [repId, leads, existingNotifications, qc])
}
