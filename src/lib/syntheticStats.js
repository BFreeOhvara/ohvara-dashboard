// Deterministic string hash + seeded PRNG — the same automation name always
// produces the same sample numbers, with no fixed catalog lookup table.
// Used by the closer's SampleDashboard preview AND the client portal's demo
// view (clients.status === 'demo'), so a prospect sees identical numbers in
// both places.
function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0 }
  return Math.abs(h) || 1
}

function seededRandom(seed) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

export const SYNTHETIC_COLORS = ['var(--accent)', 'var(--success)', 'var(--info)', 'var(--warning)']

export function syntheticStatsFor(automation, index) {
  const rand = seededRandom(hashStr(automation.name + index))
  const actions = Math.round(20 + rand() * 70)
  const successRate = Math.round(60 + rand() * 35)
  const value = Math.round((400 + rand() * 3800) / 50) * 50
  const color = SYNTHETIC_COLORS[index % SYNTHETIC_COLORS.length]
  return {
    color,
    kpis: [
      { label: 'Actions This Month', value: `${actions}` },
      { label: 'Success Rate', value: `${successRate}%` },
      { label: 'Est. Value Recovered', value: `$${value.toLocaleString()}` },
    ],
    feed: [
      `${automation.name} triggered — ${Math.round(rand() * 50) + 1} min ago`,
      automation.description ? `${automation.description} — Yesterday` : 'New activity logged — Yesterday',
      `${Math.max(1, Math.round(actions / 10))} actions completed this week`,
    ],
  }
}
