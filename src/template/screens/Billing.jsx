import { useState } from 'react'
import { Layers, Wallet, CreditCard } from 'lucide-react'
import { useSampleBilling, useSampleActions } from '../data'
import { Chip, Drawer, Money, SampleTag, Switch, useNote } from '../kit'
import { CountUp, usd } from '../motion'

// Sample-only: no payment or sign-in code. Every price here is a sample price.
// A statement: the week's total and how much of the plan is used up top, what you pay for on the left, the
// history and the card on file on the right.
export default function Billing() {
  const { data: b } = useSampleBilling()
  const { setPlanSize, setPaused, setLeadType } = useSampleActions()
  const note = useNote()
  const [panel, setPanel] = useState(null)
  const [size, setSize] = useState(b.plan.size)
  const total = b.leadTypes.filter(t => t.on).reduce((n, t) => n + t.weekly, 0)
  const share = b.submissions.used / b.submissions.cap
  const ring = 2 * Math.PI * 70
  return (
    <div className="tp-page fx-page fx-grid">
      <section className="fx-tile is-hero fx-s7" style={{ '--i': 0 }} aria-label="This week">
        <header className="fx-tile-h"><span className="tp-grow"><h2>This week</h2><p>Next charge {b.next_charge}</p></span><SampleTag /></header>
        <b className="tp-money fx-huge"><CountUp value={b.plan.weekly + total} format={usd()} /></b>
        <div className="fx-split">
          <span><i className="is-blue" />Servicing<b><Money v={b.plan.weekly} cents={false} /></b></span>
          <span><i className="is-teal" />Leads<b><Money v={total} cents={false} /></b></span>
        </div>
        <div className="fx-stack is-hero" aria-hidden="true"><i className="is-blue" style={{ flexGrow: b.plan.weekly }} /><i className="is-teal" style={{ flexGrow: total || 0.0001, '--d': 1 }} /></div>
      </section>

      <section className="fx-tile fx-s5" style={{ '--i': 1 }} aria-label="Submissions used">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Submissions used</h2><p>Resets Monday</p></span></header>
        <div className="fx-ringrow">
          <span className="fx-ring">
            <svg viewBox="0 0 160 160" aria-hidden="true">
              <circle cx="80" cy="80" r="70" className="fx-ring-track" />
              <circle cx="80" cy="80" r="70" className="fx-ring-arc" style={{ '--len': ring, '--to': ring * (1 - Math.min(1, share)) }} strokeDasharray={ring} transform="rotate(-90 80 80)" />
            </svg>
            <span className="fx-ring-mid"><b className="tp-num"><CountUp value={b.submissions.used} /></b><small>of {b.submissions.cap}</small></span>
          </span>
          <span className="fx-ringside"><b className="tp-num fx-big2"><CountUp value={b.submissions.cap - b.submissions.used} /></b><span>left on your plan this week</span></span>
        </div>
      </section>

      <section className="fx-tile fx-s6" style={{ '--i': 2 }} aria-label="Servicing plan">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Servicing plan</h2><p>{b.plan.size} submissions a week · plans: 7 or 16</p></span><Chip tone={b.paused ? 'mute' : 'green'}>{b.paused ? 'Paused' : 'Active'}</Chip></header>
        <div className="tp-row tp-wrap"><b className="tp-money fx-huge2"><CountUp value={b.plan.weekly} format={usd()} /></b><span className="tp-sub">a week</span><SampleTag /></div>
        <div className="fx-dots" aria-label={`${b.submissions.used} of ${b.submissions.cap} used`}>{Array.from({ length: b.submissions.cap }, (_, i) => <i key={i} className={i < b.submissions.used ? 'on' : ''} style={{ '--d': i }} />)}</div>
        <div className="tp-row tp-wrap fx-acts"><button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('plan')}>Change plan</button>
          <button type="button" className="tp-btn ov-ghost" onClick={() => { setPaused(!b.paused); note(b.paused ? 'Plan resumed' : 'Plan paused') }}>{b.paused ? 'Resume' : 'Pause'}</button></div>
      </section>

      <section className="fx-tile fx-s6" style={{ '--i': 3 }} aria-label="Leads spend">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Leads spend</h2><p>Turn a lead type on or off</p></span><button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('spend')}><Wallet size={14} />Change</button></header>
        <div className="tp-row tp-wrap"><b className="tp-money fx-huge2"><CountUp value={total} format={usd()} /></b><span className="tp-sub">a week</span><SampleTag /></div>
        <ul className="fx-rows">{b.leadTypes.map(t => <li key={t.key} className="fx-row is-flat"><span className="tp-grow"><b>{t.label}</b><small>{t.sub}</small></span><Money v={t.weekly} cents={false} /><Switch on={t.on} label={t.label} onChange={v => setLeadType(t.key, v)} /></li>)}</ul>
      </section>

      <section className="fx-tile fx-s12" style={{ '--i': 4 }} aria-label="History">
        <header className="fx-tile-h"><span className="tp-grow"><h2>History</h2><p>Sample amounts. Pricing is not final.</p></span><button type="button" className="tp-btn ov-ghost" onClick={() => note('Payment method changes are not open yet')}><CreditCard size={14} />Payment method</button></header>
        <ul className="fx-rows fx-hist">{b.history.map(h => <li key={h.id} className="fx-row is-flat"><span className="fx-row-ic"><Layers size={15} aria-hidden="true" /></span><span className="tp-grow"><b>{h.label}</b><small>{h.at}</small></span><Money v={h.amount} /></li>)}</ul>
      </section>

      <Drawer open={panel === 'plan'} onClose={() => setPanel(null)} title="Change plan" sub="Sample prices, not final"
        footer={<button type="button" className="tp-primary fx-accent" onClick={() => { setPlanSize(size); note(`Plan set to ${size} a week`); setPanel(null) }}>Save plan</button>}>
        {[7, 16].map(n => <button key={n} type="button" className={`tp-plan${size === n ? ' on' : ''}`} aria-pressed={size === n} onClick={() => setSize(n)}><span className="tp-grow"><b>{n} a week</b><p className="tp-sub">Submissions each week</p></span><Money v={n === 7 ? 275 : 575} /></button>)}
      </Drawer>
      <Drawer open={panel === 'spend'} onClose={() => setPanel(null)} title="Change spend" sub="Turn a lead type on or off" footer={<button type="button" className="tp-primary fx-accent" onClick={() => { note('Spend updated'); setPanel(null) }}>Done</button>}>
        {b.leadTypes.map(t => <div key={t.key} className="tp-row"><div className="tp-grow"><b>{t.label}</b></div><Money v={t.weekly} /><Switch on={t.on} label={t.label} onChange={v => setLeadType(t.key, v)} /></div>)}
      </Drawer>
    </div>
  )
}
