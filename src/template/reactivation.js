// P952 — Reactivate old leads, the sample side. The real side (hooks/reactivationReal.js) has the same shape;
// DataProvider hands screens one or the other (data/index.js SAMPLE.reactivation, hooks/agentRealData.js REAL.reactivation):
//   useTerms()            { price_cents, min_leads, max_attempts, live, scrub_connected, licensed, loading, unavailable }
//   useLists()            { lists: [{ id, name, status, uploaded, removed, callable, amount_cents, refunded_cents, progress }], refresh }
//   create(name, rows, attest)  cleans again on our side → { list_id, uploaded, callable, removed, price_cents, amount_cents }
//   pay(listId)           charges the card on file (statement OHVARA LEADS) → { status: 'paid' | 'failed', failure }
//   discard(listId)       throws away a list that isn't paid
// Sample: nothing is charged and nobody is called. The scrub isn't connected, so a paid list waits ("Checking the list").
import { useSyncExternalStore } from 'react'
import { normalizePhone, REMOVED_ORDER } from '../lib/reactivation.js'

export const SAMPLE_LICENSED = ['AZ', 'FL', 'GA', 'TX']
// Numbers our side knows not to call (the sample's do-not-call list): shows the "on our do-not-call list" line.
// (Not 555-01xx: those are fictional numbers and come off as bad numbers first.)
export const SAMPLE_DNC = ['+14805552144', '+16025552177']
const prog = (o = {}) => ({ total: 0, worked: 0, reached: 0, booked: 0, transferred: 0, stop: 0, not_interested: 0, wrong: 0, remaining: 0, removed: 0, ...o })
const SEED = [
  { id: 'rl-1', name: '2024 mortgage leads', status: 'working', created_at: '2026-10-28T15:00:00Z', uploaded: 512, callable: 480,
    removed: { bad_number: 9, duplicate: 11, existing: 4, unlicensed: 6, dnc: 2 }, amount_cents: 96000, price_cents_each: 200, refunded_cents: 0,
    progress: prog({ total: 480, worked: 312, reached: 96, booked: 14, transferred: 6, stop: 3, not_interested: 21, wrong: 7, remaining: 168 }) },
  { id: 'rl-2', name: 'Spring aged leads', status: 'done', created_at: '2026-09-14T15:00:00Z', uploaded: 140, callable: 126,
    removed: { bad_number: 4, duplicate: 3, existing: 2, unlicensed: 5, dnc: 0 }, amount_cents: 25200, price_cents_each: 200, refunded_cents: 400,
    progress: prog({ total: 124, worked: 124, reached: 41, booked: 5, transferred: 2, stop: 1, not_interested: 9, wrong: 4, remaining: 0 }) },
]
let lists = SEED
const subs = new Set()
const put = next => { lists = next; subs.forEach(f => f()) }
const subscribe = f => { subs.add(f); return () => subs.delete(f) }
const snap = () => lists
const wait = ms => new Promise(r => setTimeout(r, ms))
const TERMS = { price_cents: 200, min_leads: 100, max_attempts: 5, cadence_days: [0, 1, 3, 6, 13], live: false, scrub_connected: false, licensed: SAMPLE_LICENSED, loading: false, unavailable: false }
const fail = (msg, code) => { const e = new Error(msg); e.code = code; throw e }

// The same cleaning the server does (migration 267 reactivation_create), on the mapped rows.
export function sampleClean(rows, { licensed = SAMPLE_LICENSED, existing = [], dnc = SAMPLE_DNC } = {}) {
  const removed = Object.fromEntries(REMOVED_ORDER.map(k => [k, 0]))
  const seen = new Set(), ex = new Set(existing), no = new Set(dnc), lic = new Set(licensed)
  let callable = 0
  for (const r of rows) {
    const ph = normalizePhone(r.phone)
    const st = String(r.state || '').trim().toUpperCase()
    const why = !ph ? 'bad_number' : seen.has(ph) ? 'duplicate' : ex.has(ph) ? 'existing' : !lic.has(st) ? 'unlicensed' : no.has(ph) ? 'dnc' : null
    if (ph) seen.add(ph)
    if (why) removed[why]++; else callable++
  }
  return { removed, callable }
}

export const SAMPLE_REACTIVATION = {
  source: 'sample',
  useTerms: () => TERMS,
  useLists() { return { lists: useSyncExternalStore(subscribe, snap), refresh: () => {}, loading: false } },
  async create(name, rows, attest, existing = []) {
    if (!attest) fail('Tick the line about the list first', 'attest')
    if (!rows?.length) fail('The list is empty', 'empty')
    if (rows.length > 5000) fail('Up to 5,000 people per list', 'too_many')
    await wait(350)
    const { removed, callable } = sampleClean(rows, { existing })
    if (callable < TERMS.min_leads) fail(`After cleaning, ${callable} people are left. A list needs at least ${TERMS.min_leads}.`, 'below_min')
    const id = `rl-${Date.now()}`
    put([{ id, name: name || 'Old leads', status: 'draft', created_at: new Date().toISOString(), uploaded: rows.length, callable, removed,
      amount_cents: callable * TERMS.price_cents, price_cents_each: TERMS.price_cents, refunded_cents: 0, progress: prog({ total: callable, remaining: callable }) }, ...lists])
    return { list_id: id, uploaded: rows.length, callable, removed, price_cents: TERMS.price_cents, amount_cents: callable * TERMS.price_cents }
  },
  async pay(id) {
    await wait(500)
    put(lists.map(l => (l.id === id ? { ...l, status: 'waiting_scrub', paid_at: new Date().toISOString() } : l)))
    return { status: 'paid', failure: null, sample: true }
  },
  async discard(id) { put(lists.filter(l => l.id !== id)) },
}
export const resetSampleReactivation = () => put(SEED)
