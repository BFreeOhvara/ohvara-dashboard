import { useState } from 'react'
import { Layers, Wallet } from 'lucide-react'
import { useSampleBilling, useSampleActions } from '../data'
import { Chip, Drawer, Money, SampleTag, Switch, useNote } from '../kit'

// Sample-only: no payment or sign-in code. Every price here is a sample price.
export default function Billing() {
  const { data: b } = useSampleBilling()
  const { setPlanSize, setPaused, setLeadType } = useSampleActions()
  const note = useNote()
  const [panel, setPanel] = useState(null)
  const [size, setSize] = useState(b.plan.size)
  const total = b.leadTypes.filter(t => t.on).reduce((n, t) => n + t.weekly, 0)
  return (
    <div className="tp-page">
      <div className="tp-g2">
        <section className="ov-card tp-card tp-stack" aria-label="Servicing plan">
          <div className="tp-row"><span className="tp-ic"><Layers size={18} /></span><h2 className="tp-h2 tp-grow">Servicing plan</h2><Chip tone={b.paused ? 'mute' : 'green'}>{b.paused ? 'Paused' : 'Active'}</Chip></div>
          <div className="tp-row tp-wrap"><Money v={b.plan.weekly} size="lg" /><span className="tp-sub">/ week</span><SampleTag /></div>
          <div><p className="tp-sub">{b.submissions.used} of {b.submissions.cap} submissions used this week · resets Mon</p>
            <div className="tp-meter">{Array.from({ length: b.submissions.cap }, (_, i) => <i key={i} className={i < b.submissions.used ? 'on' : ''} />)}</div></div>
          <p className="tp-sub">Plans: 7 or 16 a week</p>
          <div className="tp-row tp-wrap"><button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('plan')}>Change plan</button>
            <button type="button" className="tp-btn ov-ghost" onClick={() => { setPaused(!b.paused); note(b.paused ? 'Plan resumed' : 'Plan paused') }}>{b.paused ? 'Resume' : 'Pause'}</button></div>
        </section>
        <section className="ov-card tp-card tp-stack" aria-label="Leads spend">
          <div className="tp-row"><span className="tp-ic teal"><Wallet size={18} /></span><h2 className="tp-h2 tp-grow">Leads spend</h2><Chip tone="green">Active</Chip></div>
          <div className="tp-row tp-wrap"><Money v={total} size="lg" /><span className="tp-sub">/ week</span><SampleTag /></div>
          {b.leadTypes.map(t => <div key={t.key} className="tp-row"><div className="tp-grow"><b>{t.label}</b><p className="tp-sub">{t.sub}</p></div><Money v={t.weekly} /><Switch on={t.on} label={t.label} onChange={v => setLeadType(t.key, v)} /></div>)}
          <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('spend')}>Change spend</button>
        </section>
      </div>
      <section className="ov-card tp-card"><div className="tp-row tp-between"><h2 className="tp-h2">Next charge</h2><SampleTag /></div>
        <p className="tp-mid" style={{ margin: '8px 0' }}>{b.next_charge}</p>
        <button type="button" className="tp-btn ov-ghost" onClick={() => note('Payment method changes are not open yet')}>Update payment method</button></section>
      <section className="ov-card tp-card"><h2 className="tp-h2">History</h2>
        <ul className="tp-list">{b.history.map(h => <li key={h.id} className="tp-li"><span className="tp-grow"><b>{h.label}</b><small>{h.at}</small></span><Money v={h.amount} /></li>)}</ul>
        <p className="tp-sub">Sample amounts. Pricing is not final.</p></section>

      <Drawer open={panel === 'plan'} onClose={() => setPanel(null)} title="Change plan" sub="Sample prices, not final"
        footer={<button type="button" className="ov-hero tp-primary" onClick={() => { setPlanSize(size); note(`Plan set to ${size} a week`); setPanel(null) }}>Save plan</button>}>
        {[7, 16].map(n => <button key={n} type="button" className={`tp-plan${size === n ? ' on' : ''}`} aria-pressed={size === n} onClick={() => setSize(n)}><span className="tp-grow"><b>{n} a week</b><p className="tp-sub">Submissions each week</p></span><Money v={n === 7 ? 275 : 575} /></button>)}
      </Drawer>
      <Drawer open={panel === 'spend'} onClose={() => setPanel(null)} title="Change spend" sub="Turn a lead type on or off" footer={<button type="button" className="ov-hero tp-primary" onClick={() => { note('Spend updated'); setPanel(null) }}>Done</button>}>
        {b.leadTypes.map(t => <div key={t.key} className="tp-row"><div className="tp-grow"><b>{t.label}</b></div><Money v={t.weekly} /><Switch on={t.on} label={t.label} onChange={v => setLeadType(t.key, v)} /></div>)}
      </Drawer>
    </div>
  )
}
