import { Minus, Plus, CalendarCheck } from 'lucide-react'
import { SampleTag, useNote } from '../../template/kit'
import { useCheckSettings, setCheckSettings } from '../../template/checkSettings'
import '../../template/p891.css'

// P899 — Clients → Servicing: the monthly "Still on the books?" check agents answer. How many days after each draft
// date the agent is asked, how many drafts are checked monthly, then how often after that. Sample: the store the
// agent's Clients page reads (template/checkSettings.js). Server: book_settings.check_delay_days, check_monthly_for,
// check_then_every (p899_clients_simple.sql, not applied).
const ROWS = [
  { key: 'delayDays', label: 'Days after the draft', sub: 'When the agent is asked', min: 0, max: 14 },
  { key: 'monthlyFor', label: 'Monthly for', sub: 'Drafts (months) checked every month', min: 1, max: 36, unit: 'months' },
  { key: 'thenEvery', label: 'Then every', sub: 'After that, one check every', min: 1, max: 12, unit: 'months' },
]

export function BookCheck() {
  const s = useCheckSettings()
  const note = useNote()
  const step = (r, d) => setCheckSettings({ [r.key]: Math.min(r.max, Math.max(r.min, s[r.key] + d)) })
  return (
    <section className="fx-tile adm-steps" style={{ '--i': 0 }} aria-label="Still on the books check">
      <header className="fx-tile-h">
        <span className="tp-grow"><h2><CalendarCheck size={16} aria-hidden="true" /> Still on the books? <SampleTag>Sample</SampleTag></h2>
          <p>Agents are asked {s.delayDays} day{s.delayDays === 1 ? '' : 's'} after each draft, monthly for the first {s.monthlyFor} months, then every {s.thenEvery} months. A No goes to the VA as a save call.</p></span>
        <button type="button" className="tp-btn ov-ghost" onClick={() => note(`Check saved: ${s.delayDays} days after the draft, monthly for ${s.monthlyFor} months, then every ${s.thenEvery}`)}>Save</button>
      </header>
      <ul className="tp-list adm-rows">{ROWS.map(r => (
        <li key={r.key} className="adm-step">
          <span className="tp-grow"><b>{r.label}</b><small>{r.sub}</small></span>
          <div className="wl-cap" role="group" aria-label={r.label}>
            <button type="button" className="tp-icbtn" aria-label={`Less: ${r.label}`} onClick={() => step(r, -1)}><Minus size={15} /></button>
            <b className="tp-num" aria-live="polite">{s[r.key]}</b>
            <button type="button" className="tp-icbtn" aria-label={`More: ${r.label}`} onClick={() => step(r, 1)}><Plus size={15} /></button>
            {r.unit && <span>{r.unit}</span>}
          </div>
        </li>
      ))}</ul>
    </section>
  )
}
