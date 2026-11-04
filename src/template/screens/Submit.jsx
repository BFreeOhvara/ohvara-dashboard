import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FilePlus2, Wrench, Check, TriangleAlert } from 'lucide-react'
import { useSampleBilling, useSampleActions } from '../data'
import { Field, Pending, useNote, SampleTag } from '../kit'
import { paths } from '../paths'

const EMPTY = { name: '', phone: '', city: '', state: '', email: '', best: 'Evenings', carrier: '', product: 'Mortgage protection' }

export default function Submit() {
  const { data: billing } = useSampleBilling()
  const { submitSale } = useSampleActions()
  const note = useNote()
  const [mode, setMode] = useState('choose')
  const [f, setF] = useState(EMPTY)
  const [tried, setTried] = useState(false)
  const [done, setDone] = useState(null)
  const { used, cap } = billing.submissions
  const capped = used >= cap
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const missing = ['name', 'phone', 'carrier'].filter(k => !f[k].trim())
  const bad = k => tried && missing.includes(k)
  const send = () => {
    setTried(true)
    if (missing.length) return
    submitSale(f)
    setDone(f.name)
    note('Sale submitted for servicing')
  }

  if (done) {
    return (
      <div className="tp-page"><section className="ov-card tp-card" style={{ maxWidth: 560 }}>
        <div className="tp-row"><span className="tp-ic teal"><Check size={18} /></span><h2 className="tp-h2">Submitted</h2></div>
        <p className="tp-mid" style={{ margin: '10px 0' }}>{done} is on your books. The team sets the review call and keeps you posted in Activity.</p>
        <div className="tp-row tp-wrap"><Link to={paths.clients()} className="tp-primary fx-accent">See your clients</Link><button type="button" className="tp-btn ov-ghost" onClick={() => { setDone(null); setF(EMPTY); setTried(false); setMode('choose') }}>Submit another</button></div>
      </section></div>
    )
  }

  if (mode === 'choose') {
    return (
      <div className="tp-page">
        <div className="tp-g2">
          <section className="ov-card tp-card"><span className="tp-ic"><FilePlus2 size={18} /></span><h2 className="tp-h2" style={{ marginTop: 10 }}>Submit a new sale</h2><p className="tp-sub">You closed it. We keep it on the books.</p>
            <p className="tp-sub" style={{ margin: '8px 0 12px' }}>{used} of {cap} submissions used this week</p>
            <button type="button" className="tp-primary fx-accent" onClick={() => setMode('sale')}>Start</button></section>
          <section className="ov-card tp-card"><span className="tp-ic teal"><Wrench size={18} /></span><h2 className="tp-h2" style={{ marginTop: 10 }}>Request a service</h2><p className="tp-sub">Something needs doing on a client you already have.</p>
            <p className="tp-sub" style={{ margin: '8px 0 12px' }}>Does not use a submission</p>
            <Link to={paths.requestService()} className="tp-btn ov-ghost" style={{ height: 44 }}>Request</Link></section>
        </div>
        <section className="ov-card tp-card"><div className="tp-row"><b className="tp-grow">Submissions this week</b><span className="tp-money">{used} / {cap}</span></div>
          <div className="tp-meter">{Array.from({ length: cap }, (_, i) => <i key={i} className={i < used ? 'on' : ''} />)}</div></section>
      </div>
    )
  }

  return (
    <div className="tp-page">
      {capped && <section className="ov-attn tp-card"><div className="tp-row"><TriangleAlert size={18} /><div><b>Weekly limit reached</b><p className="tp-sub">Only a new sale stops. Change your plan on Billing.</p></div></div></section>}
      <div className="tp-split">
        <section className="ov-card tp-card tp-stack">
          <div><h2 className="tp-h2">Who is the client</h2><p className="tp-sub">Name, number and where they live</p></div>
          <div className="tp-g2">
            <Field label="Name"><input className={bad('name') ? 'tp-danger' : ''} value={f.name} onChange={set('name')} placeholder="Full name" /></Field>
            <Field label="Phone"><input className={bad('phone') ? 'tp-danger' : ''} value={f.phone} onChange={set('phone')} placeholder="(555) 555-0100" /></Field>
            <Field label="City"><input value={f.city} onChange={set('city')} /></Field>
            <Field label="State"><input value={f.state} onChange={set('state')} /></Field>
            <Field label="Email, optional"><input value={f.email} onChange={set('email')} placeholder="name@example.com" /></Field>
            <Field label="Best time to reach them" hint="Client's local time."><select value={f.best} onChange={set('best')}>{['Mornings', 'Afternoons', 'Evenings'].map(x => <option key={x}>{x}</option>)}</select></Field>
          </div>
          <div><h2 className="tp-h2">The policy</h2></div>
          <div className="tp-g2">
            <Field label="Carrier"><input className={bad('carrier') ? 'tp-danger' : ''} value={f.carrier} onChange={set('carrier')} list="tp-carriers" placeholder="Start typing a carrier" /></Field>
            <Field label="Product"><select value={f.product} onChange={set('product')}>{['Mortgage protection', 'Final expense', 'Term life'].map(x => <option key={x}>{x}</option>)}</select></Field>
          </div>
          <datalist id="tp-carriers"><option value="Northfield Mutual" /><option value="Harborline Life" /><option value="Pinecrest Assurance" /></datalist>
          <Pending>Texting consent wording pending</Pending>
        </section>
        <div className="ov-card tp-card tp-stack">
          <h2 className="tp-h2">Booking summary</h2>
          <p className="tp-mid">{f.name || 'New client'}<br /><span className="tp-sub">{f.name ? f.phone || 'Add their number' : 'Add their name and number'}</span></p>
          <p className="tp-sub">The team sets the review call. <SampleTag>Sample plan</SampleTag></p>
          {tried && missing.length > 0 && <p className="tp-sub" style={{ color: 'var(--danger)' }}>Fill in the name, number and carrier first.</p>}
          <button type="button" className="tp-primary fx-accent" disabled={capped} onClick={send}>Submit sale</button>
          <button type="button" className="tp-btn ov-ghost" onClick={() => setMode('choose')}>Back</button>
          <p className="tp-sub">{used} of {cap} used this week</p>
        </div>
      </div>
    </div>
  )
}
