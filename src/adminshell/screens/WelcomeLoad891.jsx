import { useSyncExternalStore } from 'react'
import { Minus, Plus, UserPlus } from 'lucide-react'
import { Avatar, Chip, SampleTag, useNote } from '../../template/kit'
import { spreadWelcomes } from '../../lib/bookImport.js'
import '../../template/p891.css'

// P891 — Clients → Servicing: how many clients the agents brought in (Add clients / Import) are waiting for a
// welcome call, per agent, and the team-wide cap on welcome calls a day (big imports spread over days). Sample only;
// the server read is admin_welcome_backlog() and the setting is book_settings.welcome_calls_per_day (p891).
// Its own tiny store so this file adds nothing to the shared admin data file.
let state = {
  perDay: 25,
  agents: [
    { id: 'ag-dana', name: 'Dana Walker', waiting: 2, dueToday: 1, overdue: 0, imported: 'Tue, Nov 3 · 2 clients' },
    { id: 'ag-priya', name: 'Priya Shah', waiting: 46, dueToday: 25, overdue: 0, imported: 'Wed, Nov 4 · 61 clients' },
    { id: 'ag-james', name: 'James Okafor', waiting: 3, dueToday: 0, overdue: 1, imported: 'Mon, Nov 2 · 3 clients' },
  ],
}
const subs = new Set()
const setState = fn => { state = { ...state, ...fn(state) }; subs.forEach(l => l()) }
const useWelcome = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => state)

export function WelcomeLoad() {
  const s = useWelcome()
  const note = useNote()
  const total = s.agents.reduce((t, a) => t + a.waiting, 0)
  // Days to clear what's waiting at this cap (the server spreads them the same way).
  const days = total ? Math.max(...spreadWelcomes(total, s.perDay)) + 1 : 0
  const step = d => setState(x => ({ perDay: Math.min(500, Math.max(1, x.perDay + d)) }))
  return (
    <section className="fx-tile adm-steps" style={{ '--i': 0 }} aria-label="Welcome calls waiting">
      <header className="fx-tile-h">
        <span className="tp-grow"><h2>Welcome calls waiting <SampleTag>Sample</SampleTag></h2><p>{total} clients agents added · about {days} business day{days === 1 ? '' : 's'} to clear at this pace</p></span>
        <div className="wl-cap" role="group" aria-label="Welcome calls a day">
          <span>A day</span>
          <button type="button" className="tp-icbtn" aria-label="Fewer a day" onClick={() => step(-5)}><Minus size={15} /></button>
          <b className="tp-num" aria-live="polite">{s.perDay}</b>
          <button type="button" className="tp-icbtn" aria-label="More a day" onClick={() => step(5)}><Plus size={15} /></button>
          <button type="button" className="tp-btn ov-ghost" onClick={() => note(`Welcome calls a day set to ${s.perDay}. New imports spread at this pace`)}>Save</button>
        </div>
      </header>
      <ul className="tp-list adm-rows">{s.agents.map(a => (
        <li key={a.id} className="adm-step">
          <Avatar name={a.name} tone={a.overdue ? 'warn' : 'blue'} />
          <span className="tp-grow"><b>{a.name}</b><small><UserPlus size={12} aria-hidden="true" /> Last import {a.imported}</small></span>
          <span className="wl-n"><b className="tp-num">{a.waiting}</b><small>waiting</small></span>
          <span className="wl-n"><b className="tp-num">{a.dueToday}</b><small>due today</small></span>
          {a.overdue > 0 ? <Chip tone="warn">{a.overdue} late</Chip> : <Chip tone="green">On pace</Chip>}
        </li>
      ))}</ul>
    </section>
  )
}
