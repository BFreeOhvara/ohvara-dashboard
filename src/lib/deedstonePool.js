// P916 — admin Settings → Deedstone numbers, as plain logic (no React, no network). The pool of Ohvara's Twilio
// numbers, all branded "Deedstone Insurance" (CNAM DEEDSTONE INS). Each agent is quietly given one and keeps it;
// a number takes agents until its daily calls would pass the limit, then the next agent gets the next number.
// Real rows: admin_deedstone_numbers() (supabase/migrations/255_deedstone_numbers.sql). Agents never see any of this.

export const DEFAULT_LIMIT = 120
export const DEFAULT_ESTIMATE = 30
export const HOT_SHARE = 0.9
export const CALLER_NAME = 'DEEDSTONE INS'

const day = (back, now = new Date('2026-11-09T12:00:00-06:00')) => {
  const d = new Date(now); d.setDate(d.getDate() - back); return d.toISOString().slice(0, 10)
}
const week = counts => counts.map((calls, i) => ({ day: day(counts.length - 1 - i), calls }))

// Sample pool: one running hot, one with room, one new.
export const SAMPLE_POOL = {
  limit: DEFAULT_LIMIT, estimate: DEFAULT_ESTIMATE, agents_without_phone: 2,
  numbers: [
    { id: 'n1', phone: '+12145550101', label: 'Dallas 1', caller_name: CALLER_NAME, active: true, pod: ['va-maya', 'va-keisha'], provider_number_id: null, agents: 4, load: 118, today: 112, days: week([84, 97, 101, 108, 0, 0, 112]) },
    { id: 'n2', phone: '+12145550102', label: 'Dallas 2', caller_name: CALLER_NAME, active: true, pod: ['va-andre', 'va-omar', 'va-lily'], provider_number_id: null, agents: 3, load: 90, today: 61, days: week([40, 52, 58, 66, 0, 0, 61]) },
    { id: 'n3', phone: '+14695550103', label: 'Plano 1', caller_name: CALLER_NAME, active: true, provider_number_id: null, agents: 0, load: 0, today: 0, days: week([0, 0, 0, 0, 0, 0, 0]) },
  ],
}

export const isHot = (n, limit) => n.active && n.today >= Math.ceil(limit * HOT_SHARE)
export const isFull = (n, limit, estimate) => n.load + estimate > limit

// The warning at the top, or null. Same rule as the SQL: every active number hot or full → add a number.
export function poolWarning(pool) {
  const act = (pool.numbers || []).filter(n => n.active)
  if (!act.length) return { tone: 'warn', text: 'No Deedstone numbers yet. Calls go out from the old single number until you add one.' }
  const hot = act.filter(n => isHot(n, pool.limit))
  const room = act.filter(n => !isHot(n, pool.limit) && !isFull(n, pool.limit, pool.estimate))
  if (!room.length) return { tone: 'warn', text: 'Add a number: every Deedstone number is near its daily limit. New agents are being doubled up.' }
  if (hot.length) return { tone: 'warn', text: `${hot.map(n => shownPhone(n.phone)).join(', ')} ${hot.length === 1 ? 'is' : 'are'} running hot today. Add a number soon.` }
  return null
}

export function shownPhone(e) {
  const d = String(e || '').replace(/\D/g, '').slice(-10)
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(e || '')
}

// A 7-day bar's height as a share of the limit (capped at 1).
export const barOf = (calls, limit) => Math.min(1, (Number(calls) || 0) / Math.max(1, limit))

// Branding steps for Brayden and Jordan (nothing is signed up for from the portal).
export const BRANDING_STEPS = [
  ['Twilio business profile + STIR/SHAKEN', 'Trust Hub: register Ohvara (Deedstone) and put every pool number on it, so calls are signed "A" (fully attested).'],
  ['Caller name (CNAM)', `Register ${CALLER_NAME} on each number (Twilio CNAM, after the business profile is approved). Landlines and some carriers show this.`],
  ['Branded calling on cell phones', 'A branded-calling service (Twilio Branded Calls, or First Orion / Hiya) so "Deedstone Insurance" shows on mobiles.'],
  ['Keep the numbers off spam lists', 'Register every number free at the Free Caller Registry (freecallerregistry.com: AT&T, T-Mobile, Verizon).'],
  ['One number for calls and texts (Jordan)', 'Check whether these same numbers can send texts under the approved A2P campaign, so each client has one Deedstone contact.'],
]
