// Dev-only sample data for /agent/leads?sample=1 (see leadsPage.js). Made-up
// people, 555 numbers, no emails. Kept in memory: nothing is ever written.
// Loaded only from an import.meta.env.DEV branch, so production drops it.
// Add &fail=1 to make status saves fail (the per-card rollback).
const ago = h => new Date(Date.now() - h * 3600e3).toISOString()
const lead = (id, first_name, last_name, phone, state, hours, status, qa = {}) => ({
  id, first_name, last_name, phone, state, status, assigned_at: ago(hours), created_at: ago(hours),
  homeowner: null, mortgage_balance_band: null, age_band: null, smoker: null, best_time: null, ...qa,
})

let leads = [
  lead('s1', 'Jordan', 'Placeholder', '+15550100123', 'TX', 1, 'assigned',
    { homeowner: true, mortgage_balance_band: '$100k–$250k', age_band: '45–54', smoker: false, best_time: 'Morning' }),
  lead('s2', 'Maximiliana-Alexandrina', 'Featherstonehaugh-Worthington', '+15550100124', 'FL', 3, 'contacted',
    { homeowner: true, mortgage_balance_band: '$250k–$500k', age_band: '55–64', smoker: true, best_time: 'Evening' }),
  lead('s3', 'Sam', 'Example', '+15550100125', 'OH', 22, 'closed',
    { homeowner: true, mortgage_balance_band: 'Under $100k', age_band: '35–44', smoker: false, best_time: 'Anytime' }),
  lead('s4', null, null, null, 'TX', 100, 'bad', { homeowner: false, age_band: '25–34' }),
  lead('s5', 'Bartholomew-Christophersonwilliamsonjohnston', 'Vandenberghe-Oyelaran', null, 'PA', 170, 'assigned'),
]
let settings = { active: true, states: ['FL', 'OH', 'TX'], daily_cap: 5 }

const wait = ms => new Promise(r => setTimeout(r, ms))
const failing = () => new URLSearchParams(window.location.search).get('fail') === '1'

export async function sampleLeads() {
  await wait(400)
  return leads.map(l => ({ ...l }))
}

export async function sampleSetStatus(id, status) {
  await wait(800)
  if (failing()) throw new Error('Sample save failed')
  leads = leads.map(l => (l.id === id ? { ...l, status } : l))
}

export async function sampleSettings() {
  await wait(300)
  return { ...settings, states: [...settings.states] }
}

export async function sampleSaveSettings(values) {
  await wait(600)
  settings = { active: values.active, states: [...values.states], daily_cap: values.daily_cap }
}
