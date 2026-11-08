// P899 — clients, simplified (agent side). No React, no network: the Clients page, the Overview, the VA's save calls,
// the sample store and the tests share these rules; migration p899_clients_simple.sql applies the same ones on the
// server (it is the one that counts).
//
// Agents don't work clients, the team does. The agent sees one of four statuses:
//   Working          Our team is on it: a new policy being set up, an added client being welcomed, anything being
//                    fixed (a missed payment, a lapse, a "No" on the monthly check).
//   Needs attention  Only the monthly "Still on the books?" check.
//   Protected        In the green, nothing needed.
//   Closed           Gone for good (hidden unless turned on).
// Requests (an address change...) aren't a status: they show as a small tag on the card.
//
// The monthly check: some days after each client's draft date (admin setting, default 3) the agent is asked whether
// the policy is still on the books. One list per draft date ("These policies drafted on the 7th"), answered with one
// tap for all, or by ticking only the ones that fell off. Yes → Protected. No → Working, and the VA gets a save call.
// Checks run monthly for the first 12 drafts, then every 3 months (admin settings).

import { trackOpen, trackClosed, saveTrack } from './clientStages.js'

export const CHECK_DEFAULTS ={ delayDays: 3, monthlyFor: 12, thenEvery: 3 }

export const CLIENT_STATUS = {
  needs_attention: { key: 'needs_attention', tone: 'warn', label: 'Needs attention', sub: 'Still on the books?' },
  working: { key: 'working', tone: 'blue', label: 'Working', sub: 'Our team is on it.' },
  protected: { key: 'protected', tone: 'green', label: 'Protected', sub: 'In the green. Nothing needed.' },
  closed: { key: 'closed', tone: 'mute', label: 'Closed', sub: 'Gone for good.' },
}
// Filter order on Clients (Closed sits behind its own switch).
export const STATUS_ORDER = ['needs_attention', 'working', 'protected']

// ── Dates: plain YYYY-MM-DD strings, worked out in UTC so no zone shifts a day ─────────────────────────────────
const DAY = 86400000
const t = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) }
const iso = ms => new Date(ms).toISOString().slice(0, 10)
export const addDays = (s, n) => iso(t(s) + n * DAY)
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
// The draft date in a month: the draft day, or the month's last day when it's shorter (a 31st drafts on Nov 30).
export const draftIn = (y, m, day) => iso(Date.UTC(y, m, Math.min(day, daysIn(y, m))))
const validDay = d => Number.isInteger(Number(d)) && Number(d) >= 1 && Number(d) <= 31

// Every draft date from the first one on or after `from`, through `until` (both included). Capped at 600 (50 years).
export function draftDates(day, from, until) {
  if (!validDay(day) || !from || !until || until < from) return []
  const out = []
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)) - 1
  while (out.length < 600) {
    const d = draftIn(y, m, Number(day))
    if (d > until) break
    if (d >= from) out.push(d)
    m += 1
    if (m === 12) { m = 0; y += 1 }
  }
  return out
}

// Draft number k (0 = the first draft) is checked: every one of the first `monthlyFor`, then every `thenEvery`
// counted from the last monthly one. Defaults: drafts 1-12 monthly, then the 15th, 18th, 21st...
export function isCheckDraft(k, s = CHECK_DEFAULTS) {
  const m = Math.max(1, s.monthlyFor | 0), e = Math.max(1, s.thenEvery | 0)
  return k < m || (k - (m - 1)) % e === 0
}

// The check a client owes today: { draft, askOn, k } for the newest checked draft whose ask day has come and that
// isn't answered yet, or null. c: { draft_day, check_from (first day the policy is on the books), checked_through
// (the newest draft date answered) }. Only the newest unanswered draft is asked: one question per client.
export function dueCheck(c, today, s = CHECK_DEFAULTS) {
  if (!c || !validDay(c.draft_day) || !c.check_from || !today) return null
  const delay = Math.max(0, s.delayDays | 0)
  const drafts = draftDates(Number(c.draft_day), c.check_from, addDays(today, -delay))
  for (let k = drafts.length - 1; k >= 0; k--) {
    if (!isCheckDraft(k, s)) continue
    if (c.checked_through && drafts[k] <= c.checked_through) return null
    return { draft: drafts[k], askOn: addDays(drafts[k], delay), k }
  }
  return null
}

// When the next check is asked (for the drawer's "Next check" line): the ask day of the next checked draft after
// the newest one asked or answered.
export function nextCheck(c, today, s = CHECK_DEFAULTS) {
  if (!c || !validDay(c.draft_day) || !c.check_from || !today) return null
  const delay = Math.max(0, s.delayDays | 0)
  const drafts = draftDates(Number(c.draft_day), c.check_from, addDays(today, 31 * 4 + delay))
  for (let k = 0; k < drafts.length; k++) {
    const ask = addDays(drafts[k], delay)
    if (isCheckDraft(k, s) && ask > today) return { draft: drafts[k], askOn: ask, k }
  }
  return null
}

const CLOSED = new Set(['closed', 'cancelled', 'canceled', 'terminated', 'surrendered', 'not_taken', 'declined'])
// The agent's status for a client. Old servicing stages fold in: setting_up and needs_attention (a problem the team
// is fixing) are Working. P911, one rule for Protected: nothing pending AND the latest draft cleared, so an open
// change request is Working too, and a client on a stage checklist (lib/clientStages, c.track) stays Working until
// its last step is done (a save that can't be saved ends Closed).
export function clientStatusOf(c, today, s = CHECK_DEFAULTS) {
  if (!c) return 'working'
  if (c.closed || c.stage === 'closed' || CLOSED.has(String(c.status || '').toLowerCase()) || trackClosed(c)) return 'closed'
  if (c.fixing) return 'working'
  if (c.missed && !c.missed.done) return 'working'
  if (c.track?.kind) {
    if (trackOpen(c)) return 'working'
  } else if (c.stage === 'setting_up' || c.stage === 'needs_attention' || c.stage === 'working' || c.stage === 'requests' || c.request || c.fromLead) return 'working'
  if (dueCheck(c, today, s)) return 'needs_attention'
  return 'protected'
}
export const clientStatus = key => CLIENT_STATUS[key] || CLIENT_STATUS.working

// A request in progress, as the small tag on the card ("Address change in progress"), or null.
export function requestTag(c) {
  if (!c) return null
  if (c.request) return c.request
  if (c.stage === 'requests') return /in progress$/i.test(c.next_step || '') ? c.next_step : 'Request in progress'
  return null
}

// What the team is working on, for a Working client's card and drawer.
export function workingWhy(c) {
  if (c?.fixing?.why === 'off_books') return 'You said it’s no longer on the books. We’re calling to save it.'
  if (c?.fixing?.why === 'lapsed') return 'You marked it lapsed. We’re calling to get it back on.'
  if (c?.fixing?.why === 'carrier_email') return 'A carrier email says a payment was missed. We’re on it.'
  if (c?.missed && !c.missed.done) return 'A payment was missed. We’re calling to save it.'
  if (c?.added) return 'Added by you. We’re welcoming them and checking the details.'
  if (c?.fromLead) return 'Sold. Add the policy details on Submit and our team takes it from there.'
  return 'Setting up the new policy. Nothing needed from you.'
}

// ── The monthly lists: one per draft date ──────────────────────────────────────────────────────────────────────
const SUFFIX = { 1: 'st', 2: 'nd', 3: 'rd' }
export const ordinal = n => `${n}${(n % 100 > 10 && n % 100 < 14) ? 'th' : SUFFIX[n % 10] || 'th'}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const shortDate = d => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`

// The clients owing a check, grouped by the draft date they're asked about, oldest list first.
// Each: { draft, askOn, day (of the month), clients }.
export function checkLists(clients, today, s = CHECK_DEFAULTS) {
  const by = new Map()
  for (const c of clients || []) {
    if (clientStatusOf(c, today, s) !== 'needs_attention') continue
    const due = dueCheck(c, today, s)
    if (!due) continue
    if (!by.has(due.draft)) by.set(due.draft, { draft: due.draft, askOn: due.askOn, day: Number(due.draft.slice(8, 10)), clients: [] })
    by.get(due.draft).clients.push(c)
  }
  return [...by.values()].sort((a, b) => (a.draft < b.draft ? -1 : 1))
}
export const listQuestion = l => (l.clients.length === 1
  ? `This policy drafted on the ${ordinal(l.day)}. Is it still on the books?`
  : `These policies drafted on the ${ordinal(l.day)}. Are they still on the books?`)

// An answer for one client on the check for `draft`. Yes clears it; No hands it to the team (a save call).
export function answerCheck(c, draft, onBooks) {
  const base = { ...c, checked_through: !c.checked_through || draft > c.checked_through ? draft : c.checked_through }
  return onBooks ? { ...base, fixing: null } : { ...base, fixing: { why: 'off_books', since: draft }, track: saveTrack(draft) }
}
// A whole list: every client is answered; the ids in `fellOff` are No, the rest Yes. Returns { yes, no } id lists.
export function answerList(list, fellOff = []) {
  const off = new Set(fellOff)
  const ids = (list?.clients || []).map(c => c.id)
  return { yes: ids.filter(id => !off.has(id)), no: ids.filter(id => off.has(id)) }
}
// Lapsed, from any client card: straight to Working, with a save call. A due check counts as answered (No).
export function markLapsed(c, today, s = CHECK_DEFAULTS) {
  const due = dueCheck(c, today, s)
  return { ...c, checked_through: due ? due.draft : c.checked_through || null, fixing: { why: 'lapsed', since: today }, track: saveTrack(today) }
}

// Business days: Mon-Fri.
const dow = d => new Date(t(d)).getUTCDay()
const isWorkday = d => dow(d) !== 0 && dow(d) !== 6
export function nextWorkday(d) { let x = addDays(d, 1); while (!isWorkday(x)) x = addDays(x, 1); return x }
export function workdayBefore(d) { let x = addDays(d, -1); while (!isWorkday(x)) x = addDays(x, -1); return x }

// The VA's save call for a No or a Lapsed: kind lapse_save, due by the end of the next business day.
export function saveCallFor(c, why, today) {
  const first = c.client_first_name || 'the client'
  const note = why === 'lapsed'
    ? `${c.agentName || 'The agent'} marked ${first}’s policy lapsed. Call ${first} and get it back on.`
    : `${c.agentName || 'The agent'} says ${first}’s policy is no longer on the books (the ${shortDate(c.fixing?.since || today)} draft). Call ${first} and save it.`
  return { kind: 'lapse_save', client_id: c.id, why, due: nextWorkday(today), note }
}

// ── Replacement timing (changes P886's gate) ───────────────────────────────────────────────────────────────────
// Clients usually set the new policy to draft on the old policy's draft day, and the old one is cancelled before
// then so they never pay twice. The cancellation can go once the new policy is ISSUED (no wait for its first
// payment), and it's timed to stop the old policy's next draft: the VA's cancel task is due the business day before.
export function replacementGate(g) {
  if (!g?.applies) return { applies: false, open: true, waiting_for: [] }
  const waiting_for = g.issued_on ? [] : ['issued']
  return { ...g, open: waiting_for.length === 0 || !!g.override, waiting_for: g.override ? [] : waiting_for }
}
// The old policy's next draft after `from` (YYYY-MM-DD), and the day the cancellation is due: the business day
// before that draft, never before `from` itself (issued the day before a draft = cancel that same day).
export function cancelDueBy(oldDraftDay, from) {
  if (!validDay(oldDraftDay) || !from) return null
  const draft = draftDates(Number(oldDraftDay), addDays(from, 1), addDays(from, 62))[0]
  if (!draft) return null
  const due = workdayBefore(draft)
  return { draft, due: due < from ? from : due }
}
