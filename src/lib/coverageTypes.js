// P1016 — lead types: the kind of life insurance leads an agent takes (mortgage protection, final expense, IUL,
// truckers, veterans, term life). One per agent today (coverage_pick_max() = 1 on the server; PICK_MAX here). Only the
// ad creative and the form's questions differ between types; everything else is the same.
// Database: migration 281 (coverage_types, agent_coverage, leads.coverage_type). Pure: node --test reads it.

export const PICK_MAX = 1

// The list as it ships (sample mode and the fallback before the real list loads). Same as 281's seed.
export const SAMPLE_TYPES = [
  { key: 'mortgage_protection', label: 'Mortgage protection', words: 'mortgage protection', blurb: 'Homeowners who want their mortgage paid off if they pass away.', sort: 1, hidden: false, most_popular: true },
  { key: 'final_expense', label: 'Final expense', words: 'final expense', blurb: 'People 50 to 85 covering funeral costs and final bills.', sort: 2, hidden: false, most_popular: false },
  { key: 'iul', label: 'IUL', words: 'indexed universal life', blurb: 'Lifelong cover that builds cash value tied to a market index.', sort: 3, hidden: false, most_popular: false },
  { key: 'truckers', label: 'Truckers', words: 'trucker life insurance', blurb: 'CDL drivers and owner-operators, cover that fits life on the road.', sort: 4, hidden: false, most_popular: false },
  { key: 'veterans', label: 'Veterans', words: 'veterans life insurance', blurb: 'Veterans and military families.', sort: 5, hidden: false, most_popular: false },
  { key: 'term_life', label: 'Term life', words: 'term life', blurb: 'Affordable cover for a set number of years.', sort: 6, hidden: false, most_popular: false },
]

export const byOrder = list => [...(list || [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.label).localeCompare(String(b.label)))
export const visibleTypes = list => byOrder(list).filter(t => !t.hidden)
export const popularKey = list => (list || []).find(t => t.most_popular)?.key ?? null

// "final_expense" -> "Final expense"; unknown -> the key itself; none -> fallback.
export function typeLabel(list, key, fallback = '—') {
  if (!key) return fallback
  return (list || []).find(t => t.key === key)?.label ?? SAMPLE_TYPES.find(t => t.key === key)?.label ?? key
}

// The agent's type in effect: their pick, else the Most popular one (what the server does too).
export const effectiveType = (mine, list) => mine || popularKey(list) || SAMPLE_TYPES[0].key

// "Switches to Final expense tomorrow" / "… on Tue, Nov 18". nextFrom = 'YYYY-MM-DD' (Central); today likewise.
export function switchWords(list, nextKey, nextFrom, today) {
  if (!nextKey || !nextFrom) return ''
  const label = typeLabel(list, nextKey)
  const t = today ? Date.parse(`${today}T12:00:00Z`) : null
  const d = Date.parse(`${nextFrom}T12:00:00Z`)
  if (t !== null && Math.round((d - t) / 86400000) === 1) return `Switches to ${label} tomorrow`
  const day = new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `Switches to ${label} on ${day}`
}

// Today's date in Central ('YYYY-MM-DD'), the clock switches run on.
export function centralToday(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return p
}

// Admin reports: leads, booked, sold and cost per lead by type.
//   leads: [{ coverage, agentId, booked, sold }]   (booked/sold booleans)
//   spend: [{ agentId, spendCents }]               (the period's ad spend per agent)
// An agent runs one type a day, so each agent's spend is split across types by their own leads' mix (exact when
// they didn't switch in the period). Rows come back in the list's order; types with no leads and no spend are left out.
export function byType(list, leads = [], spend = []) {
  const rows = new Map()
  const row = k => {
    if (!rows.has(k)) rows.set(k, { key: k, label: k === 'none' ? 'No type yet' : typeLabel(list, k), leads: 0, booked: 0, sold: 0, spendCents: 0 })
    return rows.get(k)
  }
  const mix = new Map() // agentId -> Map(type -> count)
  for (const l of leads) {
    const k = l.coverage || 'none'
    const r = row(k)
    r.leads += 1
    if (l.booked) r.booked += 1
    if (l.sold) r.sold += 1
    if (l.agentId) {
      if (!mix.has(l.agentId)) mix.set(l.agentId, new Map())
      const m = mix.get(l.agentId)
      m.set(k, (m.get(k) || 0) + 1)
    }
  }
  for (const s of spend) {
    const cents = Math.max(0, Math.round(s.spendCents || 0))
    if (!cents) continue
    const m = mix.get(s.agentId)
    const total = m ? [...m.values()].reduce((a, b) => a + b, 0) : 0
    if (!total) { row(s.coverage || 'none').spendCents += cents; continue }
    let left = cents
    const parts = [...m.entries()]
    parts.forEach(([k, n], i) => {
      const c = i === parts.length - 1 ? left : Math.round(cents * n / total)
      row(k).spendCents += c
      left -= c
    })
  }
  const order = byOrder(list).map(t => t.key)
  return [...rows.values()]
    .map(r => ({ ...r, perLeadCents: r.leads ? Math.round(r.spendCents / r.leads) : null }))
    .sort((a, b) => {
      const ia = order.indexOf(a.key), ib = order.indexOf(b.key)
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
    })
}
