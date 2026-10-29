// Admin "Lead capacity" card: pure functions only (no supabase import), so
// scripts/lead-capacity.test.mjs runs them with node --test and the card can
// render from fixtures. useLeadCapacity reads the rows; buildCapacity turns
// them into the numbers the card shows and copies.
//
//   T  lowest price_cents among active lead_prices rows (176). No active row:
//      null, and nothing that needs a price is computed. Never guessed.
//      recovery_config.price_per_lead_cents (161/162 comments) is not used.
//   F  agents with agent_lead_settings.active, a balance (agent_lead_balance,
//      no row = 0) of at least T, and a profile with role 'agent', is_active.
//   C  sum of daily_cap over F. A null cap is left out and counted apart; 0 is
//      a real cap of 0.
//   L7 typed leads (lead_type <> 'cancellation') delivered inside the last full
//      Sunday-to-Saturday week in Central to an F agent. Funded is judged now.
//   U  typed leads with no assigned agent, whatever leads.status says (that is
//      the cancellation pipeline enum).

export const TZ = 'America/Chicago'
export const TYPED_LEAD_TYPES = ['mortgage_protection', 'policy_help', 'policy_review']
export const TYPE_LABELS = {
  mortgage_protection: 'Mortgage protection',
  policy_help: 'Policy help',
  policy_review: 'Policy review',
}
export const PROPOSAL = 'proposal, not decided'

export const typeLabel = t => TYPE_LABELS[t] || t
export const money = cents => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Active price rows, cheapest first.
export function activePrices(prices = []) {
  return prices
    .filter(p => p.active === true && Number.isFinite(Number(p.price_cents)))
    .map(p => ({ lead_type: p.lead_type, price_cents: Number(p.price_cents) }))
    .sort((a, b) => a.price_cents - b.price_cents || a.lead_type.localeCompare(b.lead_type))
}

// T: the lowest active price, or null when no row is active.
export function threshold(prices = []) {
  const a = activePrices(prices)
  return a.length ? a[0].price_cents : null
}

export function isFunded(balanceCents, t) {
  return t != null && balanceCents >= t
}

// The F agents: [{ agent_id, daily_cap, balance_cents }]. null when T is null.
export function fundedAgents({ settings = [], balances = [], profiles = [], threshold: t }) {
  if (t == null) return null
  const bal = new Map(balances.map(b => [b.agent_id, Number(b.balance_cents) || 0]))
  const prof = new Map(profiles.map(p => [p.id, p]))
  return settings
    .filter(s => s.active === true)
    .filter(s => {
      const p = prof.get(s.agent_id)
      return p && p.role === 'agent' && p.is_active === true
    })
    .map(s => ({ agent_id: s.agent_id, daily_cap: s.daily_cap ?? null, balance_cents: bal.get(s.agent_id) ?? 0 }))
    .filter(a => isFunded(a.balance_cents, t))
}

// C and the no-cap count over the F agents.
export function capacity(funded = []) {
  let cap = 0, noCap = 0
  for (const a of funded) {
    if (a.daily_cap == null) noCap += 1
    else cap += Number(a.daily_cap)
  }
  return { cap, noCap }
}

// ── the week ────────────────────────────────────────────────────────────────

// Calendar parts of an instant in a time zone (from the tz database via Intl).
function zonedParts(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ms))
  const o = {}
  for (const p of parts) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return o
}

// The zone's offset from UTC at an instant, in ms (Central: -5 h or -6 h).
function offsetAt(ms, tz) {
  const p = zonedParts(ms, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

// The UTC instant of local midnight on a calendar day in tz.
export function zonedMidnight(y, m, d, tz = TZ) {
  const guess = Date.UTC(y, m - 1, d)
  let ms = guess - offsetAt(guess, tz)
  ms = guess - offsetAt(ms, tz)
  return new Date(ms)
}

const dayLabel = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', {
  timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
}).replace(',', '')

// The last full Sunday-to-Saturday week in Central before now: start
// inclusive, end exclusive. At exactly Sunday 00:00 the week that just ended.
export function windowFor(now, tz = TZ) {
  const p = zonedParts(new Date(now).getTime(), tz)
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
  const end = new Date(Date.UTC(p.year, p.month - 1, p.day - weekday))
  const start = new Date(Date.UTC(p.year, p.month - 1, p.day - weekday - 7))
  const sat = new Date(Date.UTC(p.year, p.month - 1, p.day - weekday - 1))
  const ymd = x => [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()]
  return {
    start: zonedMidnight(...ymd(start), tz),
    end: zonedMidnight(...ymd(end), tz),
    label: `${dayLabel(...ymd(start))} to ${dayLabel(...ymd(sat))}`,
  }
}

export const inWindow = (t, win) => {
  if (!t) return false
  const ms = new Date(t).getTime()
  return ms >= win.start.getTime() && ms < win.end.getTime()
}

// L7 and the all-agents count from { assigned_rep_id, lead_type, delivered_at }
// rows. fundedIds null (no price): funded is null.
export function deliveredCounts(leads = [], win, fundedIds) {
  const typed = leads.filter(l => l.lead_type && l.lead_type !== 'cancellation' && inWindow(l.delivered_at, win))
  const ids = fundedIds ? new Set(fundedIds) : null
  return {
    all: typed.length,
    funded: ids ? typed.filter(l => l.assigned_rep_id && ids.has(l.assigned_rep_id)).length : null,
  }
}

// U from { lead_type, assigned_rep_id } rows.
export function countUnassigned(leads = []) {
  return leads.filter(l => TYPED_LEAD_TYPES.includes(l.lead_type) && l.assigned_rep_id == null).length
}

export const perDay = n => (n == null ? null : Math.round((n / 7) * 10) / 10)
export const fmtPerDay = n => (n == null ? '—' : n.toFixed(1))

// "Wed Oct 28, 9:28 PM" in Central.
export function asOfLabel(now, tz = TZ) {
  const d = new Date(now)
  const day = d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')
  const time = d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
  return { day, time, full: `${day}, ${time}` }
}

// Every number the card shows, from the rows useLeadCapacity reads.
export function buildCapacity({ prices = [], settings = [], balances = [], profiles = [], delivered = [], unassigned = [], now }) {
  const t = threshold(prices)
  const win = windowFor(now)
  const funded = fundedAgents({ settings, balances, profiles, threshold: t })
  const { cap, noCap } = funded ? capacity(funded) : { cap: null, noCap: null }
  const counts = deliveredCounts(delivered, win, funded ? funded.map(a => a.agent_id) : null)
  return {
    threshold: t,
    prices: activePrices(prices),
    funded: funded ? funded.length : null,
    cap,
    noCap,
    delivered: counts.funded,
    deliveredAll: counts.all,
    perDay: perDay(counts.funded),
    unassigned: countUnassigned(unassigned),
    window: win,
    asOf: new Date(now),
  }
}

const utcStamp = d => d.toISOString().slice(0, 16).replace('T', ' ')

// Plain text for Addie's weekly entry. Copy only; nothing is sent anywhere.
export function copyText(c) {
  const noPrice = c.threshold == null
  const capNote = c.noCap ? `${c.noCap} funded agent${c.noCap === 1 ? ' has' : 's have'} no cap set` : 'every funded agent has a cap'
  const lines = [
    `Lead capacity, as of ${asOfLabel(c.asOf).full}`,
    `Week: ${c.window.label}`,
    `Same week in UTC: ${utcStamp(c.window.start)} (included) to ${utcStamp(c.window.end)} (not included)`,
    '',
    noPrice
      ? 'Funded agents: No price set (no active lead price, so none is counted; no price is guessed)'
      : `Funded agents: ${c.funded} (leads on, balance at least ${money(c.threshold)}, the lowest active lead price, ${PROPOSAL})`,
    noPrice
      ? 'Daily cap across funded agents: — (needs a lead price)'
      : `Daily cap across funded agents: ${c.cap} a day (${capNote})`,
    'Lead prices:',
    ...(c.prices.length
      ? c.prices.map(p => `  ${typeLabel(p.lead_type)}: ${money(p.price_cents)} (${PROPOSAL})`)
      : ['  No active lead price']),
    noPrice
      ? 'Delivered last week to funded agents: — (needs a lead price)'
      : `Delivered last week to funded agents: ${c.delivered} (${fmtPerDay(c.perDay)} a day)`,
    `Delivered last week, all agents: ${c.deliveredAll}`,
    `Unassigned now: ${c.unassigned} typed lead${c.unassigned === 1 ? '' : 's'} waiting for an agent`,
    '',
    'Funded is judged as of now, not as of last week. Read only.',
  ]
  return lines.join('\n')
}
