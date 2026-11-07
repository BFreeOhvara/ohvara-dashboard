import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { toLead, toClient, wallOf, weekOf, weekToPortal, portalToRows, toActivity, boughtOf, DEFAULT_TZ } from '../lib/agentReal'
import { atLabel, whenLabel, minutesFrom, needsYouNow, forYourInfo } from '../template/leadLifecycle'
import { normalizeSettings } from '../lib/agentSettings'
import { outcomeArgs } from '../lib/leadOutcomes'
import { invokeBilling } from '../lib/billing'
import { zoneOf } from '../lib/callSlots'
import { wallet as walletOf, expected } from '../template/spendPlan'
import { useNote } from '../template/kit'

// P848 — the agent portal on real data. The same names and record shapes as the sample door (src/template/data/index.js), read through
// the existing tables, views and RPCs under RLS (an agent reads only their own rows). Nothing here writes on its own.
// A table or function that isn't on the database yet reads as empty (never an error), like P855's fallbacks.
const LIVE = { refetchInterval: 30000 }
const MISSING = ['42P01', 'PGRST205', '42883', 'PGRST202']
export const isMissing = e => !!e && (MISSING.includes(e.code) || /does not exist|could not find/i.test(e.message || ''))
// A query whose source may not exist yet: missing = [] (or the fallback); any other error is a real error.
export async function soft(q, fallback = []) {
  const { data, error } = await q
  if (error) { if (isMissing(error)) return fallback; throw error }
  return data ?? fallback
}

export function useTz() {
  const { profile } = useAuth()
  return profile?.timezone || DEFAULT_TZ
}

// The agent's own wall clock, ticking each minute.
export function useWallNow() {
  const tz = useTz()
  const [ms, setMs] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setMs(Date.now()), 60000); return () => clearInterval(t) }, [])
  return wallOf(ms, tz)
}
export const realClock = tz => () => wallOf(Date.now(), tz)

export function useWeekReal() {
  const now = useWallNow()
  return useMemo(() => weekOf(now), [now])
}

// ── Leads ────────────────────────────────────────────────────────────────────────────────────────────────────────
function useInboundRows() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['p848', 'inbounds', profile?.id], enabled: !!profile?.id, ...LIVE,
    queryFn: () => soft(supabase.rpc('agent_inbounds')),
  })
}
// Every event on the agent's leads (RLS: inbound_events follow the lead), grouped by lead.
function useAllLeadEvents() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['p848', 'inbound-events', profile?.id], enabled: !!profile?.id, ...LIVE,
    queryFn: async () => {
      const rows = await soft(supabase.from('inbound_events').select('id, lead_id, kind, state, at, label, detail, actor_name, actor_role, created_at').order('at', { ascending: true }).limit(5000))
      const by = {}
      rows.forEach(e => { (by[e.lead_id] ||= []).push(e) })
      return by
    },
  })
}
export function useLeadsReal() {
  const tz = useTz()
  const rows = useInboundRows()
  const ev = useAllLeadEvents()
  const data = useMemo(() => (rows.data || []).map(r => toLead(r, ev.data?.[r.lead_id] || [], tz)), [rows.data, ev.data, tz])
  return { data, isLoading: rows.isLoading || ev.isLoading, error: rows.error || ev.error || null, refetch: rows.refetch }
}
export function useLeadReal(id) {
  const all = useLeadsReal()
  return { ...all, data: all.data.find(l => l.id === id) || null }
}

// ── Clients (the agent's own policies, RLS policies_select) ─────────────────────────────────────────────────────
const POLICY_COLS = 'id, agent_id, created_at, policy_number, client_first_name, client_last_name, client_phone, carrier_name, product_type, product_name, state, monthly_premium, annual_premium, status, archived_at'
function useClientRows() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['p848', 'clients', profile?.id], enabled: !!profile?.id, ...LIVE,
    queryFn: async () => {
      const [policies, status, tasks] = await Promise.all([
        soft(supabase.from('policies').select(POLICY_COLS).eq('agent_id', profile.id).is('archived_at', null).order('created_at', { ascending: false })),
        soft(supabase.from('policy_servicing_status').select('policy_id, stage, next_step, next_date, open_requests, is_sample').eq('agent_id', profile.id)),
        soft(supabase.rpc('agent_servicing_items')),
      ])
      return { policies, status, tasks }
    },
  })
}
export function useClientsReal() {
  const tz = useTz()
  const q = useClientRows()
  const data = useMemo(() => {
    const { policies = [], status = [], tasks = [] } = q.data || {}
    const st = Object.fromEntries(status.filter(r => !r.is_sample).map(r => [r.policy_id, r]))
    return policies.map(p => toClient(p, st[p.id], tasks, tz))
  }, [q.data, tz])
  return { data, isLoading: q.isLoading, error: q.error || null, refetch: q.refetch }
}
export function useClientReal(id) {
  const all = useClientsReal()
  return { ...all, data: all.data.find(c => c.id === id) || null }
}
export function useServicingTasks() {
  const q = useClientRows()
  return q.data?.tasks || []
}

// ── Messages: one thread per client with the team (my_message_threads + policy_messages, RLS) ───────────────────
function useThreadRows() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['p848', 'threads', profile?.id], enabled: !!profile?.id, ...LIVE,
    queryFn: async () => {
      const threads = await soft(supabase.rpc('my_message_threads'))
      const ids = threads.map(t => t.policy_id)
      const msgs = ids.length ? await soft(supabase.from('policy_messages').select('id, policy_id, sender_id, sender_name, body, created_at').in('policy_id', ids).order('created_at', { ascending: true }).limit(2000)) : []
      return { threads, msgs }
    },
  })
}
export function useThreadsReal() {
  const { profile } = useAuth()
  const tz = useTz()
  const q = useThreadRows()
  const now = useWallNow()
  const data = useMemo(() => {
    const { threads = [], msgs = [] } = q.data || {}
    return threads.map(t => ({
      id: t.policy_id, client_id: t.policy_id, name: `${t.client_first_name || ''} ${t.client_last_name || ''}`.trim() || 'Client', unread: Number(t.unread_count) || 0,
      messages: msgs.filter(m => m.policy_id === t.policy_id).map(m => ({ id: m.id, from: m.sender_id === profile?.id ? 'me' : 'team', text: m.body, at: atLabel(wallOf(m.created_at, tz), now) })),
    }))
  }, [q.data, profile?.id, tz, now])
  return { data, isLoading: q.isLoading, error: q.error || null, refetch: q.refetch }
}

// ── Settings: profile, hours (my_agent_settings), duty (agent_duty), notifications, caller ID, licence (interim) ──
const NOTE_ROWS = [
  ['lead', 'New lead', 'new_lead'], ['appt', 'Appointment reminders', 'appointment_1h'], ['msg', 'Messages from the team', null],
  ['client', 'Client needs you', 'needs_attention'], ['payment_missed', 'A client missed a payment (chargeback risk)', null],
  ['portal_action_needed', 'Something to do in a carrier portal', null], ['weekly', 'Your week, every Monday', null],
]
export const NOTE_TYPE = Object.fromEntries(NOTE_ROWS.map(([k, , t]) => [k, t]))
function useSettingsRows() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['p848', 'settings', profile?.id], enabled: !!profile?.id,
    queryFn: async () => {
      const [raw, duty, states, licences] = await Promise.all([
        soft(supabase.rpc('my_agent_settings'), null),
        soft(supabase.from('agent_duty').select('on_duty, since').eq('agent_id', profile.id).maybeSingle(), null),
        soft(supabase.from('agent_lead_settings').select('states').eq('agent_id', profile.id).maybeSingle(), null),
        soft(supabase.from('agent_licenses').select('state, license_number, expires_on').eq('profile_id', profile.id), []),
      ])
      return { raw, duty, states, licences }
    },
  })
}
export function useSettingsReal() {
  const { profile } = useAuth()
  const q = useSettingsRows()
  const data = useMemo(() => {
    const { raw, duty, states, licences = [] } = q.data || {}
    const n = normalizeSettings(raw)
    const week = weekToPortal(n.week)
    const server = Array.isArray(raw?.notifications) ? raw.notifications : []
    const cid = profile?.caller_id_number && profile?.caller_id_verified_at ? { status: 'confirmed', number: profile.caller_id_number } : profile?.caller_id_pending_number ? { status: 'pending', number: profile.caller_id_pending_number } : { status: 'not_set', number: '' }
    return {
      profile: { name: profile?.full_name || '', email: profile?.email || '', phone: profile?.phone || '', plan: 'Your plan shows here once billing is set up' },
      hours: { start: week.Mon.start, end: week.Mon.end, days: Object.keys(week).filter(d => week[d].on) },
      week, zoneConfirmed: !!profile?.timezone_confirmed_at, calendarSync: { provider: null, status: 'not_connected' },
      licence: { states: (states?.states || licences.map(l => l.state)).filter(x => x !== 'NY'), licensed: null }, // the tick's log is a door: ticked again after a reload
      timeZone: n.timezone || profile?.timezone || DEFAULT_TZ, callerId: cid,
      paymentIntake: { address: 'Starts when payment tracking goes live', recent: [], soon: true },
      notifications: NOTE_ROWS.map(([key, label, type]) => { const r = type && server.find(x => x.type === type); return { key, label, push: !!r?.push_on, email: !!r?.email_on, soon: !type } }),
      duty: duty?.on_duty === true, dutySince: duty?.on_duty ? duty.since : null, liveTransferPhone: n.phone,
    }
  }, [q.data, profile])
  return { data, isLoading: q.isLoading, error: q.error || null, refetch: q.refetch }
}

// ── Calendar: lead appointments + the team's client calls (review calls, packet checks) on the agent's clock ────
export function useAppointmentsReal() {
  const leads = useLeadsReal()
  const clients = useClientsReal()
  const tasks = useServicingTasks()
  const tz = useTz()
  const data = useMemo(() => {
    const out = []
    leads.data.forEach(l => {
      if (!l.apptAt || !['booked', 'showed'].includes(l.stage)) return
      const ev = l.apptAt
      out.push({ id: `ap-${l.id}`, ...clockParts(ev), who: `${l.first_name} ${l.last_name}`.trim(), label: 'Appointment', kind: 'lead', ref: l.id, iso: isoOfWall(ev, tz), tz: zoneOf(l.state, l.city) })
    })
    tasks.filter(t => t.due_at && !t.done_at && ['review_call', 'packet_check', 'check_in'].includes(t.kind)).forEach(t => {
      const c = clients.data.find(x => x.id === t.policy_id)
      const w = wallOf(t.due_at, tz)
      out.push({ id: `ap-t-${t.task_id}`, ...clockParts(w), who: c ? `${c.client_first_name} ${c.client_last_name}`.trim() : t.client_name || 'Client', label: t.kind === 'review_call' ? 'Review call' : t.kind === 'check_in' ? 'Check-in call' : 'Packet check', kind: 'client', ref: t.policy_id, iso: t.due_at, tz: c ? zoneOf(c.state, c.city) : null })
    })
    return out.sort((a, b) => (a.iso < b.iso ? -1 : 1))
  }, [leads.data, clients.data, tasks, tz])
  return { data, isLoading: leads.isLoading || clients.isLoading, error: leads.error || clients.error || null }
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function clockParts(w) {
  const d = new Date(`${w.slice(0, 10)}T12:00:00Z`)
  const h = Number(w.slice(11, 13))
  return { day: DOW[d.getUTCDay()], date: d.getUTCDate(), mon: MON[d.getUTCMonth()], time: `${h % 12 || 12}:${w.slice(14, 16)} ${h < 12 ? 'AM' : 'PM'}`, wall: w }
}
// A wall-clock string on tz back to an instant (good to the minute, DST-safe by one correction pass).
function isoOfWall(w, tz) {
  const guess = Date.parse(`${w}:00Z`)
  const off = Date.parse(`${wallOf(guess, tz)}:00Z`) - guess
  return new Date(guess - off).toISOString()
}

// ── Activity (agent_activity_feed, own rows: p_agent = me), the last 30 days ───────────────────────────────────
export function useActivityReal() {
  const { profile } = useAuth()
  const tz = useTz()
  const now = useWallNow()
  const q = useQuery({
    queryKey: ['p848', 'activity', profile?.id], enabled: !!profile?.id, ...LIVE,
    queryFn: () => soft(supabase.rpc('agent_activity_feed', { p_from: new Date(Date.now() - 30 * 86400000).toISOString(), p_to: new Date().toISOString(), p_agent: profile.id, p_limit: 300 })),
  })
  const data = useMemo(() => [...(q.data || [])].sort((a, b) => new Date(b.at) - new Date(a.at)).map(r => toActivity(r, atLabel(wallOf(r.at, tz), now))), [q.data, tz, now])
  return { data, isLoading: q.isLoading, error: q.error || null }
}

// ── Billing (interim, until P884's my_billing is on the database): spend per type, prepaid balance, card state ───
const mondayText = now => { const d = new Date(`${now.slice(0, 10)}T12:00:00Z`); const add = ((8 - d.getUTCDay()) % 7) || 7; const n = new Date(d.getTime() + add * 86400000); return `${DOW[n.getUTCDay()]}, ${MON[n.getUTCMonth()]} ${n.getUTCDate()}` }
export function useBillingReal() {
  const { profile } = useAuth()
  const now = useWallNow()
  const q = useQuery({
    queryKey: ['p848', 'billing', profile?.id], enabled: !!profile?.id,
    queryFn: async () => {
      const [spend, balance] = await Promise.all([
        soft(supabase.from('agent_inbound_spend').select(['inbound_type', 'weekly_cents', 'paused'].join(',')).eq('agent_id', profile.id)),
        soft(supabase.from('agent_lead_balance').select('balance_cents').eq('agent_id', profile.id).maybeSingle(), null),
      ])
      return { spend, balance }
    },
  })
  const clients = useClientsReal()
  const leads = useLeadsReal()
  const data = useMemo(() => {
    const { spend = [], balance } = q.data || {}
    const d0 = new Date(`${now.slice(0, 10)}T12:00:00Z`)
    const weekFrom = new Date(d0.getTime() - ((d0.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10)
    const monthFrom = `${now.slice(0, 7)}-01`
    const daily = t => Math.round(((spend.find(r => r.inbound_type === t && !r.paused)?.weekly_cents || 0) / 7) / 100)
    const b = {
      plan: 'pilot', products: profile?.has_servicing === false ? 'leads' : 'both',
      spend: { appts: daily('booked_appointment'), live: daily('live_call') }, pending: null, booked: 0, usual: 0,
      wallet: { week: 'This week', topUp: Math.max(0, (balance?.balance_cents || 0) / 100), rolled: 0, spent: 0, next: mondayText(now) },
      va: { on: false, hours: 0, rate: 0 }, bought: { week: boughtOf(leads.data, weekFrom), month: boughtOf(leads.data, monthFrom) }, saved: [], paused: null, cancel: null,
      payment: { card: null, failed: profile?.billing_status === 'past_due' || profile?.billing_status === 'unpaid' },
      next_charge: mondayText(now), nextBill: null, servicing: { status: 'active', next: null }, cancellations: null, history: [], real: true,
    }
    return { ...b, submitted: clients.data.length, walletNow: walletOf(b.wallet, b.spend), expected: expected(b.spend), servicing: { ...b.servicing, status: b.products === 'leads' ? 'off' : 'active' } }
  }, [q.data, profile, now, clients.data.length, leads.data])
  return { data, isLoading: q.isLoading, error: q.error || null }
}
function billingNeedsOf(b) {
  return b.payment.failed ? [{ key: 'failed', title: 'Payment failed', name: 'Update your card', what: 'Your leads are stopped until it goes through. Servicing keeps going for 3 days.', when: 'Now' }] : []
}

// ── Needs you now, Overview ──────────────────────────────────────────────────────────────────────────────────────
export function useNeedsReal() {
  const leads = useLeadsReal()
  const clients = useClientsReal()
  const billing = useBillingReal()
  const now = useWallNow()
  const data = useMemo(() => ({
    now: needsYouNow({ leads: leads.data, clients: clients.data, billingNeeds: billingNeedsOf(billing.data), servicing: billing.data.products !== 'leads' }, now),
    fyi: forYourInfo({ leads: leads.data }),
  }), [leads.data, clients.data, billing.data, now])
  return { data, isLoading: leads.isLoading || clients.isLoading, error: leads.error || clients.error || null }
}

const TASK_WORD = { packet_check: 'Packet check', review_call: 'Review call', check_in: 'Check-in call', lapse_save: 'Save call', chargeback_watch: 'Payment watch' }
const DONE_KEY = { packet_check: 'packet', review_call: 'review', cancellation: 'cancel', cancel_old: 'cancel', lapse_save: 'save' }
export function useOverviewReal() {
  const { profile } = useAuth()
  const tz = useTz()
  const now = useWallNow()
  const leads = useLeadsReal()
  const clients = useClientsReal()
  const appts = useAppointmentsReal()
  const settings = useSettingsReal()
  const tasks = useServicingTasks()
  const data = useMemo(() => {
    const by = st => clients.data.filter(c => c.stage === st).length
    const nameOf = id => { const c = clients.data.find(x => x.id === id); return c ? `${c.client_first_name} ${c.client_last_name}`.trim() : '' }
    const open = tasks.filter(t => !t.done_at && t.status !== 'done' && t.status !== 'cancelled')
    const soon = open.filter(t => t.due_at && minutesFrom(now, wallOf(t.due_at, tz)) < 7 * 1440).sort((a, b) => new Date(a.due_at) - new Date(b.due_at)).slice(0, 6)
    const d0 = new Date(`${now.slice(0, 10)}T12:00:00Z`)
    const back = (d0.getUTCDay() + 6) % 7 + 7 // last week's Monday
    const days = Array.from({ length: 7 }, (_, i) => { const x = new Date(d0.getTime() - (back - i) * 86400000); return { iso: x.toISOString().slice(0, 10), day: DOW[x.getUTCDay()], date: `${MON[x.getUTCMonth()]} ${x.getUTCDate()}` } })
    const doneByDay = days.map(d => {
      const row = { day: d.day, date: d.date, packet: 0, review: 0, cancel: 0, save: 0 }
      tasks.filter(t => t.done_at && wallOf(t.done_at, tz).slice(0, 10) === d.iso).forEach(t => { const k = DONE_KEY[t.kind]; if (k) row[k]++ })
      return row
    })
    // Booked per week, by the week each lead was booked; the range follows how long the agent has been with Ohvara.
    const age = profile?.created_at ? Math.max(0, minutesFrom(wallOf(profile.created_at, tz), now) / 1440) : 0
    const bookedAt = leads.data.map(l => l.events.find(e => e.kind === 'booked')?.at).filter(Boolean)
    const thisMon = new Date(d0.getTime() - ((d0.getUTCDay() + 6) % 7) * 86400000)
    const weekStart = i => new Date(thisMon.getTime() - i * 7 * 86400000)
    const inWeek = (w, i) => { const s = weekStart(i).toISOString().slice(0, 10); const e = weekStart(i - 1).toISOString().slice(0, 10); return w.slice(0, 10) >= s && w.slice(0, 10) < e }
    const thisWeek = bookedAt.filter(w => inWeek(w, 0)).length
    let bookedChart
    if (age < 14) {
      const todayIdx = (d0.getUTCDay() + 6) % 7
      bookedChart = { mode: 'days', range: 'This week, day by day', empty: thisWeek === 0, prev: null, points: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dd, i) => [dd, bookedAt.filter(w => w.slice(0, 10) === new Date(thisMon.getTime() + i * 86400000).toISOString().slice(0, 10)).length, i > todayIdx]) }
    } else {
      const n = Math.min(8, Math.max(2, Math.ceil(age / 7)))
      const points = Array.from({ length: n }, (_, k) => { const i = n - 1 - k; const s = weekStart(i); return [`${MON[s.getUTCMonth()]} ${s.getUTCDate()}`, bookedAt.filter(w => inWeek(w, i)).length] })
      bookedChart = { mode: 'weeks', range: age < 56 ? 'Since you joined' : 'Last 8 weeks', empty: false, prev: points.length > 1 ? points[points.length - 2][1] : null, points }
    }
    const nowMin = Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16))
    const today = appts.data.filter(a => a.wall?.slice(0, 10) === now.slice(0, 10))
    const minOf = a => Number(a.wall.slice(11, 13)) * 60 + Number(a.wall.slice(14, 16))
    const inText = a => { const d = minOf(a) - nowMin; return d <= 0 ? 'now' : `in ${d >= 60 ? `${Math.floor(d / 60)} h ` : ''}${d % 60} min` }
    const next = today.find(a => minOf(a) > nowMin)
    const d = new Date(`${now.slice(0, 10)}T12:00:00Z`)
    const h = Number(now.slice(11, 13))
    return {
      name: (profile?.full_name || '').split(' ')[0] || 'there',
      book: { protected: by('protected'), settingUp: by('setting_up'), needsAttention: by('needs_attention'), requestsOpen: by('requests') },
      duty: settings.data.duty, stepsOpen: open.length, attention: clients.data.filter(c => c.stage === 'needs_attention'),
      dueSoon: soon.map(t => { const w = wallOf(t.due_at, tz); const p = clockParts(w); return { id: t.task_id, label: TASK_WORD[t.kind] || 'Servicing step', clientName: nameOf(t.policy_id) || t.client_name || 'Client', clientId: t.policy_id, dueAt: whenLabel(w), day: p.day, date: p.date, done: false } }),
      doneByDay, bookedChart,
      upNext: appts.data.filter(a => a.wall >= now).slice(0, 3), leadsToday: leads.data.length,
      today: `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()]}, ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()]} ${d.getUTCDate()}`,
      clock: { time: `${h % 12 || 12}:${now.slice(14, 16)}`, ampm: h < 12 ? 'AM' : 'PM' },
      doneRange: `${days[0].date} to ${days[6].date}`,
      dutySince: settings.data.dutySince ? clockParts(wallOf(settings.data.dutySince, tz)).time : '',
      nextAppt: next ? { ...next, inText: inText(next) } : null,
      todayAppts: today.map(a => ({ ...a, inText: inText(a) })),
      newLeads: leads.data.filter(l => ['booked', 'ringing', 'missed'].includes(l.stage)).map(l => ({ id: l.id, name: `${l.first_name} ${l.last_name}`.trim(), kind: l.kind, stage: l.stage, appt: l.appt })),
    }
  }, [profile, tz, now, leads.data, clients.data, appts.data, settings.data, tasks])
  return { data, isLoading: leads.isLoading || clients.isLoading || settings.isLoading, error: leads.error || clients.error || null }
}

// Not on the database yet (doors): blocked days, setup progress, talk requests, feedback. Empty in real mode.
const EMPTY = { data: [], isLoading: false, error: null }
const NONE = { data: null, isLoading: false, error: null }
export const useBlocksReal = () => EMPTY
export const useTalksReal = () => EMPTY
export const useFeedbackReal = () => EMPTY
export const useSetupReal = () => NONE

// ── Actions: the writes that already have a backend, exactly as the old pages made them. Everything else says it
// starts soon and changes nothing (the door list in brain/ohvara/agent-backend-map.md). ─────────────────────────
export function useActionsReal() {
  const { profile } = useAuth()
  const me = profile?.id
  const qc = useQueryClient()
  const note = useNote()
  const clients = useClientsReal().data
  const tz = useTz()
  return useMemo(() => {
    // The screen shows its own confirmation first; ours lands just after, so "starts soon" or a failure is what stays.
    const later = text => setTimeout(() => note(text), 60)
    const soon = what => () => later(`${what} starts soon. Nothing changed yet`)
    const again = () => qc.invalidateQueries({ queryKey: ['p848'] })
    const run = async (p, fail = 'Could not save. Nothing changed') => {
      try { const { error } = await p; if (error) throw error; again() } catch (e) { later(e?.message && !/fetch|network/i.test(e.message) ? `${fail}: ${e.message}` : fail) }
    }
    const rpc = (fn, args, fail) => run(supabase.rpc(fn, args), fail)
    const saveSettings = (p, fail) => rpc('save_my_agent_settings', { p }, fail)
    const outcome = (id, stage, extra = {}) => {
      if (stage === 'no_show') return rpc('lead_mark_no_show', { p_lead: id })
      const o = { sold: 'sold', follow_up: 'follow_up', not_interested: 'not_interested' }[stage]
      if (!o) return later('Only Sold, Follow up and Not interested save for now. The team moves the rest')
      const followUpAt = extra.followAt ? isoOfWall(extra.followAt, tz) : extra.followUpAt
      return rpc('set_inbound_outcome', outcomeArgs(id, { outcome: o, note: extra.note, followUpAt, reason: extra.reason }))
    }
    const carrierId = async name => {
      if (!name) return null
      const { data } = await supabase.from('carriers').select('id, name').ilike('name', name).limit(1)
      return data?.[0]?.id || null
    }
    const KIND = { 'Change address': 'address_change', 'Change beneficiary': 'beneficiary_change', 'Change billing date': 'draft_date_change', 'Reinstate policy': 'lapse_save' }
    return {
      moveLead: outcome,
      markNoShow: id => rpc('lead_mark_no_show', { p_lead: id }),
      undoNoShow: soon('Undo for a no-show'),
      sendNoShowText: () => {},
      addLeadNote: (id, text) => rpc('add_inbound_note', { p_lead: id, p_note: text }),
      callBack: soon('Closing a call task'),
      askTeamToCall: soon('Asking our team to call'),
      sendBookingLink: soon('The booking link text'),
      cantMakeIt: soon('Can’t make it'),
      blockDay: soon('Blocking a day'),
      unblockDay: soon('Blocking a day'),
      moveAppts: soon('Moving appointments'),
      saveWeek: week => saveSettings({ working_hours: portalToRows(week) }, 'Could not save your hours'),
      connectCalendar: soon('Calendar connect'),
      // P848 licence states: the picked states go on agent_lead_settings.states (the agent's own row, as the old Leads
      // settings page saved it). The tick's log (time + states) needs a table: door.
      saveLicence: async v => {
        const states = (v?.states || []).filter(x => x !== 'NY')
        const { data: row } = await supabase.from('agent_lead_settings').select('agent_id').eq('agent_id', me).maybeSingle()
        const q = supabase.from('agent_lead_settings')
        await run(row ? q.update({ states, updated_at: new Date().toISOString() }).eq('agent_id', me) : q.insert({ agent_id: me, states }), 'Could not save your states')
      },
      talk: soon('Talk to someone'),
      sendFeedback: soon('Feedback on the team'),
      setSpend: soon('Changing your lead spend here'),
      topUp: soon('Topping up here'),
      setProducts: soon('Switching products here'),
      pause: soon('Pausing here'),
      resume: soon('Resuming here'),
      cancelPlan: soon('Cancelling here'),
      keepPlan: soon('Keeping your plan'),
      // Gap 1: the real card form (Stripe's own page) for a failed or late payment.
      fixCard: async () => {
        try { const r = await invokeBilling('portal'); if (r?.url) window.location.assign(r.url); else later('Could not open the card form') } catch (e) { later(e.message || 'Could not open the card form') }
      },
      saveSetup: soon('Saving setup'),
      setDuty: on => run(supabase.from('agent_duty').upsert({ agent_id: me, on_duty: !!on, since: on ? new Date().toISOString() : null }, { onConflict: 'agent_id' }), 'Could not change live calls'),
      doneTask: () => {},
      clientAction: (id, action) => {
        if (action === 'confirm') { const c = clients.find(x => x.id === id); return rpc('agent_confirm_recovery_number', { p_policy: id, p_phone: c?.client_phone ? c.client_phone.replace(/\D/g, '').replace(/^(\d{10})$/, '+1$1') : null }) }
        return later('That change starts soon. Nothing changed yet')
      },
      sendMessage: (threadId, text) => run(supabase.from('policy_messages').insert({ policy_id: threadId, sender_id: me, body: text }), 'Message not sent'),
      readThread: threadId => run(supabase.from('policy_message_reads').upsert({ policy_id: threadId, profile_id: me, last_read_at: new Date().toISOString() }, { onConflict: 'policy_id,profile_id' }), 'Could not mark it read'),
      submitSale: async form => {
        const [first, ...rest] = String(form.name || '').trim().split(/\s+/)
        const [carrier, old] = await Promise.all([carrierId(form.carrier), carrierId(form.replaces?.carrier)])
        await rpc('agent_submit_deal', {
          p_first: first || '', p_last: rest.join(' '), p_phone: form.phone, p_city: form.city, p_state: form.state, p_timezone: form.booking?.tz || zoneOf(form.state, form.city) || tz,
          p_new_carrier: carrier, p_policy_number: form.policy?.number || null, p_replaced: !!form.replaces, p_old_carrier: old, p_at: form.booking?.iso || null, p_best_time: form.bestTime || null, p_sms_consent: false, p_effective_date: null,
        }, 'Sale not submitted')
        if (form.linked?.kind === 'lead') await rpc('set_inbound_outcome', outcomeArgs(form.linked.id, { outcome: 'sold' }))
      },
      submitRequest: form => {
        const c = clients.find(x => `${x.client_first_name} ${x.client_last_name}`.trim() === String(form.name || '').trim())
        if (!c) return later('Pick the client again. Nothing was sent')
        return rpc('agent_submit_service_request', { p_policy: c.id, p_kind: KIND[form.kind] || 'other', p_note: form.kind, p_best_time: null }, 'Request not sent')
      },
      rotateIntake: soon('The forwarding address'),
      setNotification: (key, field, on) => {
        const type = NOTE_TYPE[key]
        if (!type) return later('That alert starts soon. Nothing changed yet')
        return saveSettings({ notifications: [{ type, [field === 'push' ? 'push' : 'email']: !!on }] }, 'Could not save the alert')
      },
      bookCall: soon('Booking from here'),
      saveSettings: patch => {
        if (patch?.timeZone) return saveSettings({ timezone: patch.timeZone }, 'Could not save your time zone')
        return later('That setting starts soon. Nothing changed yet')
      },
      bookFulfillmentCall: soon('Booking a team call from here'),
    }
  }, [me, qc, note, clients, tz])
}

export const useSignupReal = () => ({ data: { covers: ['Booked appointments and live calls, at a daily spend you set', 'A team that calls every lead right away and books them on your calendar', 'Servicing that keeps your policies on the books', 'Your own portal and phone app'] }, isLoading: false, error: null })

// The page as a whole: loading until the agent's leads, clients and settings are in; an error if one fails.
export function useStatusReal() {
  const qc = useQueryClient()
  const a = useLeadsReal(); const b = useClientsReal(); const c = useSettingsReal()
  return { loading: a.isLoading || b.isLoading || c.isLoading, error: a.error || b.error || c.error || null, retry: () => qc.invalidateQueries({ queryKey: ['p848'] }) }
}

export const REAL = {
  useStatus: useStatusReal,
  source: 'real', useNow: useWallNow, useWeek: useWeekReal,
  useLeads: useLeadsReal, useLead: useLeadReal, useClients: useClientsReal, useClient: useClientReal, useAppointments: useAppointmentsReal,
  useThreads: useThreadsReal, useActivity: useActivityReal, useBilling: useBillingReal, useTalks: useTalksReal, useFeedback: useFeedbackReal,
  useBlocks: useBlocksReal, useSetup: useSetupReal, useSettings: useSettingsReal, useNeeds: useNeedsReal, useSignup: useSignupReal,
  useOverview: useOverviewReal, useActions: useActionsReal,
}
