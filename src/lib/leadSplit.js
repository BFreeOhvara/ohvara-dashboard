// P889 — one lead product (brain/ohvara/How Ohvara Works.md "One lead product"). Plain rules, no imports, so the
// agent screens, the VA desk, the admin screens, the tests and the migration (supabase/migrations/p889_one_lead_product.sql,
// same numbers) all say the same thing.
//
// The agent sets ONE daily spend and one setting, How you take leads:
//   appts  Appointments only: every lead is booked. All spend goes to form ads.
//   both   Appointments + live transfers: inside the agent's live-call hours a ready lead is transferred live,
//          everything else is booked. Behind the scenes the spend can be split between form ads and call ads.
// P901 (Meta only at launch): call ads are OFF (SPLIT_RULES.callAdsOn / lead_split_rules.call_ads_on). While off,
// every agent runs 100% form ads, the Monday move holds, and live transfers come from form leads (Check agent).
// Agents never see the split, and never hear where a lead came from.

export const LEAD_MODES = [
  { key: 'appts', label: 'Appointments only', sub: 'Every lead is booked on your calendar.' },
  { key: 'both', label: 'Appointments + live transfers', sub: 'Ready leads ring your phone during your live-call hours. Everyone else is booked.' },
]
export const PITCH = 'Every lead gets a call within seconds. If they’re ready now, they ring straight to your phone. If not, they’re booked on your calendar.'

// Admin settings (drafts). Dollars a day for the call minimum.
export const SPLIT_RULES = {
  callAdsOn: false,   // P901: Call ads (Google). Off at launch: all spend goes to form ads; the split below waits.
  startFormPct: 70,   // where a new transfer agent starts: 70% form / 30% call
  maxStep: 10,        // most the split moves in one week, in points
  floorPct: 20,       // neither side goes under this
  minSales: 5,        // under this many sales (both sides, in the look-back), compare cost per transfer or show
  callMinDaily: 20,   // call ads need at least this a day, or all spend goes to form ads
  holdWithin: 0.1,    // costs within 10% of each other: hold
  lookbackWeeks: 4,   // the numbers behind each Monday move
}

// ── Live-call hours (the agent's own time zone) ─────────────────────────────────────────────────────────────────
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const on = (start, end) => ({ on: true, start, end })
const off = { on: false, start: '9:00 AM', end: '5:00 PM' }
export const DEFAULT_LIVE_HOURS = { Mon: on('9:00 AM', '5:00 PM'), Tue: on('9:00 AM', '5:00 PM'), Wed: on('9:00 AM', '5:00 PM'), Thu: on('9:00 AM', '5:00 PM'), Fri: on('9:00 AM', '5:00 PM'), Sat: off, Sun: off }

export function clockMin(c) {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(c || '')
  return m ? ((Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(m[2]) : null
}
export const liveHoursOk = hours => DAYS.some(d => hours?.[d]?.on && clockMin(hours[d].end) > clockMin(hours[d].start))
// How you take leads is complete: Appointments only, or live transfers with at least one live-call day.
export const takeOk = take => !!take && (take.mode !== 'both' || liveHoursOk(take.hours))
export const liveHoursPerWeek = hours => DAYS.reduce((t, d) => t + (hours?.[d]?.on ? Math.max(0, (clockMin(hours[d].end) - clockMin(hours[d].start)) / 60) : 0), 0)

// "Mon–Fri, 9:00 AM–5:00 PM" style: runs of days with the same hours.
export function liveHoursText(hours) {
  const runs = []
  DAYS.forEach((d, i) => {
    const h = hours?.[d]
    if (!h?.on) return
    const last = runs[runs.length - 1]
    if (last && last.end === i - 1 && last.start === h.start && last.close === h.end) last.end = i
    else runs.push({ from: i, end: i, start: h.start, close: h.end })
  })
  if (!runs.length) return 'No live-call hours set'
  return runs.map(r => `${r.from === r.end ? DAYS[r.from] : `${DAYS[r.from]}–${DAYS[r.end]}`}, ${r.start}–${r.close}`).join(' · ')
}

// Weekday and minute of the day on the agent's clock.
export function clockIn(tz, nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Chicago', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(nowMs))
  const get = t => parts.find(p => p.type === t)?.value
  return { day: get('weekday'), min: (Number(get('hour')) % 24) * 60 + Number(get('minute')) }
}
export function inLiveHours(hours, tz, nowMs = Date.now()) {
  const { day, min } = clockIn(tz, nowMs)
  const h = hours?.[day]
  if (!h?.on) return false
  const a = clockMin(h.start); const b = clockMin(h.end)
  return a != null && b != null && min >= a && min < b
}

// ── A fresh form lead on the VA desk ────────────────────────────────────────────────────────────────────────────
// The VA calls right away and qualifies. Inside the agent's live-call hours (transfer agents) → Check agent; else book.
export function freshLeadRoute({ mode, hours, tz }, nowMs = Date.now()) {
  if (mode !== 'both') return { route: 'book', key: 'appts_only', why: 'Appointments only: book them' }
  if (!inLiveHours(hours, tz, nowMs)) return { route: 'book', key: 'out_of_hours', why: `Outside their live-call hours (${liveHoursText(hours)}): book them` }
  return { route: 'check', key: 'in_hours', why: 'Inside their live-call hours: check the agent if they’re ready now' }
}
// After Check agent: Yes is a cold transfer; No, no answer in 30 s, a failed push or a bounce → book like today.
export const afterCheck = answer => (answer === 'yes' ? 'transfer' : 'book')

// ── The split (admin only; agents never see it) ─────────────────────────────────────────────────────────────────
const clampPct = (p, r) => Math.min(100 - r.floorPct, Math.max(r.floorPct, Math.round(p)))

// What runs today from one daily spend (dollars). formPct = the stored split for transfer agents.
export function effectiveSplit({ daily, mode, formPct = SPLIT_RULES.startFormPct }, rules = SPLIT_RULES) {
  const d = Math.max(0, Number(daily) || 0)
  if (mode !== 'both') return { form: d, call: 0, formPct: 100, reason: 'appts_only' }
  if (!rules.callAdsOn) return { form: d, call: 0, formPct: 100, reason: 'call_ads_off' }
  const pct = clampPct(formPct, rules)
  const call = Math.round((d * (100 - pct)) / 100)
  if (call < rules.callMinDaily) return { form: d, call: 0, formPct: 100, reason: 'call_min' }
  return { form: d - call, call, formPct: pct, reason: 'split' }
}

// The Monday move. side = { spent, sales, shows, transfers } over the look-back. Returns the new split, the metric
// used, why, and the numbers behind it (logged with every change).
export function costOf(side, metric) {
  const n = metric === 'sale' ? side.sales : (side.shows || 0) + (side.transfers || 0)
  if (!side.spent) return null
  return n ? side.spent / n : Infinity
}
export function nextSplit({ formPct, locked = false, form, call }, rules = SPLIT_RULES) {
  const cur = clampPct(formPct ?? rules.startFormPct, rules)
  const sales = (form?.sales || 0) + (call?.sales || 0)
  const metric = sales >= rules.minSales ? 'sale' : 'early'
  const cf = costOf(form || {}, metric); const cc = costOf(call || {}, metric)
  const numbers = { metric, form: { ...form, cost: cf }, call: { ...call, cost: cc }, sales }
  const hold = reason => ({ formPct: cur, moved: 0, metric, reason, numbers })
  if (!rules.callAdsOn) return hold('call_ads_off')
  if (locked) return hold('locked')
  if (cf == null || cc == null) return hold('no_spend')
  if (cf === Infinity && cc === Infinity) return hold('no_results')
  const hi = Math.max(cf, cc); const lo = Math.min(cf, cc)
  if (hi !== Infinity && (hi - lo) / hi <= rules.holdWithin) return hold('even')
  const next = clampPct(cur + (cf < cc ? rules.maxStep : -rules.maxStep), rules)
  if (next === cur) return hold('floor')
  return { formPct: next, moved: next - cur, metric, reason: cf < cc ? 'form_cheaper' : 'call_cheaper', numbers }
}

export const SPLIT_REASON = {
  appts_only: 'Appointments only: all form ads', call_ads_off: 'Call ads off: all form ads', call_min: 'Under the call minimum: all form ads', split: 'Split',
  locked: 'Locked by admin', no_spend: 'Held: one side had no spend', no_results: 'Held: no results yet on either side',
  even: 'Held: costs within 10%', floor: 'Held: at the 20% floor', form_cheaper: 'Form ads cheaper', call_cheaper: 'Call ads cheaper',
}
