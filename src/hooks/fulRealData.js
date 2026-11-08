import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useFulfillmentQueue } from './usePolicies'
import { useVaDesk } from './useVaDesk'
import { soft, isMissing } from './agentRealData'
import { instantOf } from '../lib/callSlots'
import {
  DEFAULT_TZ, realClock, toClient, toCall, toQueueLead, toTask, toThreads, toFeed, toPay, toAgents, dayOf, scheduleOf,
  callResultRpc, keyDayName, dateOfKey, whenText,
} from '../lib/fulReal'
import { useNote } from '../template/kit'
import { useFulSampleLive, useFulSampleUi, usePluggedShift } from '../template/ful/data'
import { CALL_TONE, CALL_WORD } from '../template/ful/words'

// P852 — the Fulfillment (VA) portal on real data. Same names and record shapes as the sample door
// (src/template/ful/data.js), read through the tables and RPCs that already exist, under RLS: a VA reads only the
// policies assigned to them, their own claims, cancels, payouts, messages and bell. A table or function that isn't on
// the database yet reads as empty (soft), never an error. Writes go only through the existing server functions; nothing
// here texts, emails or dials (voice_live and sms_live stay off). Mappers: lib/fulReal.js.
const LIVE = { refetchInterval: 30000 }
const K = 'p852'

export function useTz() { const { profile } = useAuth(); return profile?.timezone || DEFAULT_TZ }
export function useTick(ms = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}
const useMe = () => useAuth().profile || null
const wrap = (q, data) => ({ data, isLoading: q.isLoading, error: q.error || null })

// ── Reads ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function useClockReal() { const tz = useTz(); const now = useTick(60000); return useMemo(() => realClock(now, tz), [now, tz]) }

function useMyPolicies() {
  const me = useMe()
  const q = useFulfillmentQueue({ enabled: !!me?.id })
  const mine = useMemo(() => (q.data || []).filter(p => p.assigned_fulfillment_id === me?.id), [q.data, me?.id])
  return { q, mine }
}
export function useFulClientsReal() {
  const tz = useTz(); const now = useTick()
  const { q, mine } = useMyPolicies()
  return wrap(q, useMemo(() => mine.map(p => { const c = toClient(p, now, tz); return { ...c, name: `${c.client_first_name} ${c.client_last_name}`.trim() } }), [mine, now, tz]))
}
export function useFulCallsReal() {
  const tz = useTz(); const now = useTick()
  const { q, mine } = useMyPolicies()
  return wrap(q, useMemo(() => mine.map(p => toCall(p, now, tz)), [mine, now, tz]))
}

// The VA's checklist answers while they work a lead (sent with the outcome, like the old desk's draft).
const drafts = new Map()
export function useFulQueueReal() {
  const me = useMe(); const tz = useTz(); const now = useTick()
  const ui = useFulSampleUi() // re-render when a checklist draft changes
  const q = useQuery({ queryKey: [K, 'queue'], enabled: !!me?.id, refetchInterval: 15000, queryFn: () => soft(supabase.rpc('va_queue')) })
  return wrap(q, useMemo(() => (q.data || []).map(r => {
    const l = toQueueLead(r, now, tz, me?.id)
    return drafts.has(l.id) ? { ...l, checklist: { ...l.checklist, ...drafts.get(l.id) } } : l
  }), [q.data, now, tz, me?.id, ui])) // eslint-disable-line react-hooks/exhaustive-deps -- ui bumps when a draft (module Map) changes
}
export function useFulTasksReal() {
  const me = useMe(); const tz = useTz(); const now = useTick()
  const q = useQuery({ queryKey: [K, 'servicing'], enabled: !!me?.id, ...LIVE, queryFn: () => soft(supabase.rpc('va_servicing_queue')) })
  return wrap(q, useMemo(() => (q.data || []).map(r => toTask(r, now, tz)), [q.data, now, tz]))
}
export function useFulThreadsReal() {
  const me = useMe(); const tz = useTz(); const now = useTick()
  const q = useQuery({
    queryKey: [K, 'threads', me?.id], enabled: !!me?.id, ...LIVE,
    queryFn: async () => {
      const threads = await soft(supabase.rpc('my_message_threads'))
      const ids = threads.map(t => t.policy_id).filter(Boolean)
      const messages = ids.length ? await soft(supabase.from('policy_messages').select('id, policy_id, sender_id, body, created_at').in('policy_id', ids).order('created_at').limit(500)) : []
      return { threads, messages }
    },
  })
  return wrap(q, useMemo(() => toThreads(q.data?.threads, q.data?.messages, me?.id, now, tz), [q.data, me?.id, now, tz]))
}
export function useFulFeedReal() {
  const me = useMe(); const tz = useTz(); const now = useTick()
  const q = useQuery({
    queryKey: [K, 'feed', me?.id], enabled: !!me?.id, ...LIVE,
    queryFn: () => soft(supabase.from('notifications').select('id, type, title, detail, message, link, read, created_at').eq('profile_id', me.id).order('created_at', { ascending: false }).limit(30)),
  })
  return wrap(q, useMemo(() => (q.data || []).map(n => toFeed(n, now, tz)), [q.data, now, tz]))
}
export function useFulAgentsReal() {
  const me = useMe()
  const clients = useFulClientsReal()
  const q = useQuery({ queryKey: [K, 'roster'], enabled: !!me?.id, staleTime: 300000, queryFn: () => soft(supabase.rpc('va_agent_roster')) })
  return wrap(q, useMemo(() => toAgents(q.data, clients.data), [q.data, clients.data]))
}
function usePayRows() {
  const me = useMe()
  return useQuery({
    queryKey: [K, 'pay', me?.id], enabled: !!me?.id, ...LIVE,
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 864e5).toISOString()
      const [cancels, payouts, cfg, accounts] = await Promise.all([
        soft(supabase.from('fulfillment_cancels').select('id, client_name, carrier_name, agent_name, logged_at, created_at, amount_cents, status').eq('rep_id', me.id).gte('created_at', since).order('created_at', { ascending: false })),
        soft(supabase.from('fulfillment_payouts').select('id, period_start, period_end, hours, amount_cents, status, paid_at, cancels').eq('rep_id', me.id).order('period_start', { ascending: false }).limit(12)),
        soft(supabase.from('recovery_config').select('pay_per_cancel_cents').limit(1), []),
        soft(supabase.from('fulfillment_payout_accounts').select('bank_name, last4, payouts_enabled, details_submitted').eq('rep_id', me.id)),
      ])
      return { cancels, payouts, rateCents: cfg[0]?.pay_per_cancel_cents ?? null, account: accounts[0] || null }
    },
  })
}
export function useFulPayReal() {
  const me = useMe(); const tz = useTz(); const now = useTick(60000)
  const q = usePayRows()
  return wrap(q, useMemo(() => toPay({ ...(q.data || {}), email: me?.email || '' }, now, tz), [q.data, me?.email, now, tz]))
}
function useNotificationRows() {
  const me = useMe()
  return useQuery({ queryKey: [K, 'alerts', me?.id], enabled: !!me?.id, staleTime: 60000, queryFn: () => soft(supabase.rpc('my_notification_settings')) })
}
export function useFulSettingsReal() {
  const me = useMe()
  const tz = useTz()
  const pay = usePayRows()
  const n = useNotificationRows()
  const now = useTick(60000)
  return wrap(n, useMemo(() => ({
    profile: { name: me?.full_name || '', email: me?.email || '', phone: me?.phone || '' },
    timeZone: tz,
    payDetails: toPay({ ...(pay.data || {}), email: me?.email || '' }, now, tz).account,
    // Email switches are real (my_notification_settings); app pushes follow the phone app's own permission.
    notifications: (n.data || []).map(r => ({ key: r.type, label: r.label, push: true, email: !!r.email_on })),
    real: true,
  }), [me, tz, pay.data, n.data, now]))
}
// The rota (va_shifts, migration 231) isn't on the database yet: an empty rota, said plainly, until it is.
const NO_SHIFT = { me: null, shift: { start: '8:00 AM', end: '6:00 PM', text: '8:00 AM to 6:00 PM' }, days: [], mine: [], onToday: false, mates: [], askable: [], dayOffs: [], live: false, thisWeek: 0, notSet: true }
export function useFulShiftReal() {
  const rota = usePluggedShift()
  return { data: rota || NO_SHIFT, isLoading: false, error: null }
}

export function useFulDayReal() {
  const clock = useClockReal()
  const calls = useFulCallsReal(); const queue = useFulQueueReal(); const tasks = useFulTasksReal(); const threads = useFulThreadsReal()
  return {
    data: useMemo(() => dayOf({ calls: calls.data, queue: queue.data, tasks: tasks.data, threads: threads.data }, clock.today), [calls.data, queue.data, tasks.data, threads.data, clock.today]),
    isLoading: calls.isLoading || queue.isLoading || tasks.isLoading, error: calls.error || queue.error || tasks.error || null,
  }
}
export function useFulScheduleReal() {
  const tz = useTz()
  const calls = useFulCallsReal(); const queue = useFulQueueReal()
  const data = useMemo(() => scheduleOf({ calls: calls.data, queue: queue.data }, tz).map(i => (i.kind === 'call' ? { ...i, tone: CALL_TONE[i.status], word: CALL_WORD[i.status] } : i)), [calls.data, queue.data, tz])
  return { data, isLoading: calls.isLoading, error: calls.error }
}
// Appointments the VA booked for agents: they live on the agent's calendar (agent_bookings), not readable by a VA yet.
export function useFulBookedReal() { return { data: [], isLoading: false, error: null } }
// P894: the agent's booked calls, so the desk's picker greys out every time within 30 minutes of one (lib/callSlots
// agentFree). agent_booked_slots comes with migration p894; until it's applied this is empty and the server is the check.
export function useAgentApptsReal(agentId) {
  const q = useQuery({
    queryKey: [K, 'agent-booked', agentId], enabled: !!agentId, ...LIVE,
    queryFn: async () => { const { data, error } = await supabase.rpc('agent_booked_slots', { p_agent: agentId }); if (error) { if (isMissing(error)) return []; throw error } return data || [] },
  })
  return useMemo(() => (q.data || []).map((iso, i) => ({ id: `booked-${i}`, iso: typeof iso === 'string' ? iso : iso?.agent_booked_slots })), [q.data])
}
export function useVaForReal() { return null }

// The 30-minute rule's inputs for this VA. With no rota on the database yet, the team at any time is this VA alone,
// so a callback or move can't land within 30 minutes of another of their calls (the server rule is a door: P854 N-22).
export function useVaBookingReal() {
  const me = useMe(); const tz = useTz()
  const calls = useFulCallsReal(); const queue = useFulQueueReal()
  return useMemo(() => {
    const busy = [
      ...calls.data.filter(k => k.status === 'booked').map(k => ({ id: k.id, va_id: me?.id, iso: k.iso })),
      ...queue.data.filter(l => l.cb_iso).map(l => ({ id: l.id, va_id: me?.id, iso: l.cb_iso })),
    ]
    const self = { id: me?.id, name: me?.full_name || 'You', me: true, tz, off: false }
    return { team: () => [self], calls: busy, load: () => 0, viewerTz: tz, me: me?.id }
  }, [calls.data, queue.data, me?.id, me?.full_name, tz])
}

// Texts in from leads that need a call back (va_lead_replies); Call marks one handled (va_mark_reply_handled).
export function useCallTasksReal() {
  const me = useMe(); const tz = useTz(); const now = useTick(); const qc = useQueryClient(); const note = useNote()
  const q = useQuery({ queryKey: [K, 'replies'], enabled: !!me?.id, ...LIVE, queryFn: () => soft(supabase.rpc('va_lead_replies')) })
  const rows = useMemo(() => (q.data || []).map(r => ({ id: r.id, lead: r.lead_id, who: r.lead_name || 'Lead', kind: 'Text reply', text: r.body || '', at: whenText(r.received_at, now, tz), reply: null })), [q.data, now, tz])
  const done = id => supabase.rpc('va_mark_reply_handled', { p_id: id }).then(({ error }) => { if (error) note(error.message); qc.invalidateQueries({ queryKey: [K, 'replies'] }) })
  return { rows, done }
}

export function useFulStatusReal() {
  const qc = useQueryClient()
  const a = useFulCallsReal(); const b = useFulQueueReal(); const c = useFulTasksReal()
  return { loading: a.isLoading || b.isLoading || c.isLoading, error: a.error || b.error || c.error || null, retry: () => qc.invalidateQueries() }
}

// ── Writes ───────────────────────────────────────────────────────────────────────────────────────────────────────
const SEND = { 'Coverage question': 'coverage', 'Needs advice': 'advice' }
// A time word from a picker ('Today, 4:30 PM', 'Fri, 10:00 AM') → the next such instant on the VA's clock.
export function instantFromWords(text, clock, tz) {
  const m = /^(Today|Tomorrow|Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2}:\d{2}\s*[AP]M)$/i.exec(String(text || '').trim())
  if (!m) return null
  let key = clock.today
  if (m[1] === 'Tomorrow') key = clock.bookDays.find(([, k]) => k > clock.today)?.[1] ?? key
  else if (m[1] !== 'Today') {
    for (let i = 1; i <= 7; i++) {
      const d = new Date(`${dateOfKey(clock.today)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i)
      const k = Number(d.toISOString().slice(0, 10).replace(/-/g, ''))
      if (keyDayName(k) === m[1]) { key = k; break }
    }
  }
  return instantOf(dateOfKey(key), m[2].toUpperCase(), tz)
}

export function useFulActionsReal() {
  const qc = useQueryClient()
  const me = useMe()
  const note = useNote()
  const tz = useTz()
  const clock = useClockReal()
  const desk = useVaDesk()
  const ui = useFulSampleLive()
  const queue = useFulQueueReal()
  return useMemo(() => {
    const refresh = (...keys) => keys.forEach(k => qc.invalidateQueries({ queryKey: k }))
    // Every write: run it, refresh what it touched, and say so plainly if the server refused (its own words).
    const run = (fn, keys) => Promise.resolve().then(fn).then(() => refresh(...keys)).catch(e => {
      refresh(...keys)
      note(isMissing(e) ? 'That part isn’t connected yet. Nothing was saved.' : (e?.message || 'That didn’t save. Try again.'))
    })
    const rpc = async (fn, args) => { const { data, error } = await supabase.rpc(fn, args); if (error) throw error; return data }
    const Q = [K, 'queue']; const S = [K, 'servicing']; const P = ['policies']; const T = [K, 'threads']; const PAY = [K, 'pay']
    const leadRow = id => queue.data.find(l => l.id === id)
    const outcome = (id, o, extra = {}) => run(() => rpc('va_set_lead_outcome', { p_lead: id, p_agent: extra.agent || null, p_outcome: o, p_callback_at: extra.at || null, p_booking_id: null, p_checklist: drafts.get(id) || null }).then(() => drafts.delete(id)), [Q])
    const notYet = what => note(`${what} isn’t connected yet. Nothing was saved.`)
    return {
      // Queue
      holdLead: id => run(() => rpc('va_claim', { p_lead: id }), [Q]),
      releaseLead: id => run(() => rpc('va_release', { p_lead: id }), [Q]),
      setChecklist: (id, checklist) => { drafts.set(id, checklist); ui.bump() },
      notReached: id => outcome(id, 'not_reached'),
      callback: (id, _when, iso) => (iso ? outcome(id, 'callback', { at: iso }) : note('Pick a time first')),
      closeLead: id => outcome(id, 'not_interested'),
      // Booked on the agent's calendar after the agent's hours check (useVaDesk.book), then recorded on the lead.
      bookLead: (id, agentId, _when, iso, ctz) => {
        const l = leadRow(id)
        if (!l || !iso) return note('Pick a time first')
        return run(() => desk.book.mutateAsync({ lead: { lead_id: id, contact_name: l.name, phone: l.phone, city: l.city, state: l.checklist.state || l.state }, agentId, scheduledAt: iso, timezone: ctz || tz, carrier: null, checklist: drafts.get(id) || l.checklist }), [Q])
      },
      // Calls (cancellation calls on policies assigned to this VA)
      markCall: (id, status, extra = {}) => {
        const r = callResultRpc(id, status, { ...extra, proof: !!extra.confirmation })
        if (!r) return null
        // A No answer ends a call, so it opens one first if the phone didn't (voice_live is off: nothing dials).
        if (status === 'no_answer') return run(async () => { await rpc('fulfillment_start_call', { p_policy: id }).catch(e => { if (!/already|live/i.test(e?.message || '')) throw e }); await rpc(...r) }, [P, PAY])
        return run(() => rpc(...r), [P, PAY])
      },
      saveCallNotes: (id, notes) => run(() => rpc('fulfillment_save_notes', { p_policy: id, p_notes: notes }), [P]),
      moveCall: () => notYet('Moving a cancellation call'),
      // Servicing (migration 206's functions)
      startTask: id => run(() => rpc('va_servicing_claim', { p_task: id }), [S]),
      putBack: id => run(() => rpc('va_servicing_release', { p_task: id }), [S]),
      finishTask: (id, o) => run(() => rpc('va_servicing_outcome', { p_task: id, p_outcome: o }), [S]),
      scheduleTask: (id, when) => {
        const at = instantFromWords(when, clock, tz)
        return at ? run(() => rpc('va_servicing_schedule', { p_task: id, p_at: at }), [S]) : note('Pick a time first')
      },
      sendToAgent: (id, reason) => run(() => rpc('va_servicing_send_to_agent', { p_task: id, p_reason: SEND[reason] || 'other', p_question: SEND[reason] ? null : reason }), [S]),
      textConsent: () => notYet('Saving the text-updates answer'),
      // Messages (policy_messages: the agent and the VA about one client)
      sendMessage: (threadId, text) => run(async () => { const { error } = await supabase.from('policy_messages').insert({ policy_id: threadId, sender_id: me.id, body: text }); if (error) throw error }, [T]),
      readThread: threadId => run(async () => { const { error } = await supabase.from('policy_message_reads').upsert({ policy_id: threadId, profile_id: me.id, last_read_at: new Date().toISOString() }, { onConflict: 'policy_id,profile_id' }); if (error) throw error }, [T]),
      // Shift: the rota tables (231) aren't on the database yet.
      requestDayOff: () => notYet('Asking for a day off'),
      cancelDayOff: () => notYet('Taking back a day off'),
      showLive: ui.showLive, hideLive: ui.hideLive,
      // Settings: name, phone and time zone on the VA's own profile; email alerts per type. Bank details go through the
      // payout service's own form (fulfillment-connect-session), never typed here.
      saveSettings: patch => {
        if (patch.profile || patch.timeZone) {
          const up = {}
          if (patch.profile) { up.full_name = patch.profile.name; up.phone = patch.profile.phone }
          if (patch.timeZone) up.timezone = patch.timeZone
          return run(async () => { const { error } = await supabase.from('profiles').update(up).eq('id', me.id); if (error) throw error }, [['profile'], ['auth']])
        }
        if (patch.notifications) return run(() => Promise.all(patch.notifications.map(n => rpc('set_notification_email', { p_type: n.key, p_on: !!n.email }))), [[K, 'alerts']])
        if (patch.payDetails) return note('Bank details change in the payout service. Use Pay details.')
        return null
      },
    }
  }, [qc, me, note, tz, clock, desk.book, ui, queue.data])
}

export const REAL = {
  source: 'real',
  useStatus: useFulStatusReal, useClock: useClockReal,
  useClients: useFulClientsReal, useCalls: useFulCallsReal, useQueue: useFulQueueReal, useTasks: useFulTasksReal, useThreads: useFulThreadsReal,
  useFeed: useFulFeedReal, useSettings: useFulSettingsReal, useAgents: useFulAgentsReal, useShift: useFulShiftReal, useSchedule: useFulScheduleReal,
  useBooked: useFulBookedReal, usePay: useFulPayReal, useDay: useFulDayReal, useActions: useFulActionsReal,
  useVaFor: useVaForReal, useVaBooking: useVaBookingReal, useAgentAppts: useAgentApptsReal, useCallTasks: useCallTasksReal,
}
