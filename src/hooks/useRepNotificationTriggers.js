import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { DAILY_BATCH_TARGET } from './useProfiles'

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
  { id: 'rate_5',      label: '5% Rate',                 condition: c => parseFloat(c.month?.bookingRate) >= 5 },
  { id: 'rate_10',     label: '10% Rate',                condition: c => parseFloat(c.month?.bookingRate) >= 10 },
  { id: 'rate_15',     label: '15% Rate',                condition: c => parseFloat(c.month?.bookingRate) >= 15 },
  { id: 'rate_20',     label: '20% Rate',                condition: c => parseFloat(c.month?.bookingRate) >= 20 },
  { id: 'rate_25',     label: '25% Rate',                condition: c => parseFloat(c.month?.bookingRate) >= 25 },
  { id: 'streak_3',    label: '3-Day Streak',            condition: c => (c.activity?.longestStreak    || 0) >= 3 },
  { id: 'streak_7',    label: '7-Day Streak',            condition: c => (c.activity?.longestStreak    || 0) >= 7 },
  { id: 'streak_14',   label: '14-Day Streak',           condition: c => (c.activity?.longestStreak    || 0) >= 14 },
  { id: 'streak_21',   label: '21-Day Streak',           condition: c => (c.activity?.longestStreak    || 0) >= 21 },
  { id: 'streak_30',   label: '30-Day Streak',           condition: c => (c.activity?.longestStreak    || 0) >= 30 },
  { id: 'full_week',   label: 'Full Week',               condition: c => (c.activity?.bestWeekDials    || 0) >= 750 },
  { id: 'perfect_day', label: 'Perfect Day',             condition: c => (c.activity?.bestDayDials     || 0) >= DAILY_BATCH_TARGET },
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
  }, [repId, badgeCtx?.month, badgeCtx?.activity, badgeCtx?.commission])
}

// ── Follow-up notifier ───────────────────────────────────────────────────────
// Checks the lead list for follow-ups due within 30 minutes. Runs on each
// leads refresh. Uses a session-local ref + the existing notifications list to
// avoid duplicate inserts within the session.

export function useFollowUpNotifier(repId, leads = [], existingNotifications = []) {
  const qc = useQueryClient()
  const notifiedThisSession = useRef(new Set())

  useEffect(() => {
    if (!repId || !leads.length) return

    const now = Date.now()
    const cutoff = now + 30 * 60 * 1000

    const dueSoon = leads.filter(l =>
      l.status === 'Follow-Up' &&
      l.follow_up_at &&
      new Date(l.follow_up_at).getTime() > now &&
      new Date(l.follow_up_at).getTime() <= cutoff
    )

    if (dueSoon.length === 0) return

    const alreadyInDB = new Set(
      existingNotifications
        .filter(n => n.type === 'follow_up' && n.data?.lead_id)
        .map(n => n.data.lead_id)
    )

    const toNotify = dueSoon.filter(l =>
      !notifiedThisSession.current.has(l.id) && !alreadyInDB.has(l.id)
    )

    if (toNotify.length === 0) return

    toNotify.forEach(lead => notifiedThisSession.current.add(lead.id))

    Promise.all(
      toNotify.map(lead =>
        supabase.from('notifications').insert({
          profile_id: repId,
          type: 'follow_up',
          message: `Follow-up due soon: ${lead.business_name}`,
          data: { lead_id: lead.id, business_name: lead.business_name },
        })
      )
    ).then(() => {
      qc.invalidateQueries({ queryKey: ['rep-notifications', repId] })
      qc.invalidateQueries({ queryKey: ['rep-notifications-unread', repId] })
    })
  }, [repId, leads, existingNotifications])
}
