import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, Pencil, User, ShieldCheck, ClipboardCheck, PhoneCall, Wrench, Activity as ActivityIcon } from 'lucide-react'
import { useSampleActions } from '../data'
import { Field, Pending, Seg, useNote, initials } from '../kit'
import { paths } from '../paths'
import { Select } from '../Select'

// P843: Submit a policy, built out in the shell design. Three clear steps (the client, the policy, review) with a
// live summary beside them. The submit logic and the data it writes are unchanged from before: the same form
// fields, the same three required ones (name, phone, carrier) and the same submitSale(form) call.
const EMPTY = { name: '', phone: '', city: '', state: '', email: '', best: 'Evenings', carrier: '', product: 'Mortgage protection' }
const PRODUCTS = ['Mortgage protection', 'Final expense', 'Term life']
const TIMES = ['Mornings', 'Afternoons', 'Evenings']
const CARRIERS = ['Northfield Mutual', 'Harborline Life', 'Pinecrest Assurance']
const STEPS = [
  { key: 'client', label: 'The client', sub: 'Who you sold to', Icon: User, needs: ['name', 'phone'] },
  { key: 'policy', label: 'The policy', sub: 'Product and carrier', Icon: ShieldCheck, needs: ['carrier'] },
  { key: 'review', label: 'Review', sub: 'Check and submit', Icon: ClipboardCheck, needs: [] },
]
const NEEDED = { name: 'Client name', phone: 'Phone number', carrier: 'Carrier' }
const NEXT = [
  [PhoneCall, 'We set the review call', 'The team calls the client to confirm the policy details.'],
  [ShieldCheck, 'Servicing starts', 'Billing checks, carrier follow-ups and any changes are handled for you.'],
  [ActivityIcon, 'You see every step', 'Updates land in Activity and on the client in Clients.'],
]

function Steps({ at, done, onPick }) {
  return (
    <ol className="fx-sub-steps" aria-label="Steps">
      {STEPS.map((s, i) => {
        const state = i === at ? 'is-on' : done(i) ? 'is-done' : ''
        const body = <><span className="fx-sub-dot">{done(i) && i !== at ? <Check size={14} aria-hidden="true" /> : i + 1}</span><span><b>{s.label}</b><small>{s.sub}</small></span></>
        return (
          <li key={s.key} className={state}>
            {i < at ? <button type="button" onClick={() => onPick(i)}>{body}</button> : <span aria-current={i === at ? 'step' : undefined}>{body}</span>}
          </li>
        )
      })}
    </ol>
  )
}

function Review({ f, onEdit }) {
  const rows = [
    ['client', 'The client', [['Name', f.name], ['Phone', f.phone], ['Email', f.email || 'Not given'], ['Lives in', [f.city, f.state].filter(Boolean).join(', ') || 'Not given'], ['Best time', f.best]]],
    ['policy', 'The policy', [['Product', f.product], ['Carrier', f.carrier]]],
  ]
  return (
    <div className="fx-sub-review">
      {rows.map(([key, title, list], i) => (
        <section key={key} className="fx-sub-rblk">
          <header><h3>{title}</h3><button type="button" className="fx-pillbtn" onClick={() => onEdit(i)}><Pencil size={13} aria-hidden="true" />Edit</button></header>
          <dl>{list.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </section>
      ))}
    </div>
  )
}

export default function Submit() {
  const { submitSale } = useSampleActions()
  const note = useNote()
  const [step, setStep] = useState(0)
  const [f, setF] = useState(EMPTY)
  const [tried, setTried] = useState(false)
  const [checked, setChecked] = useState([])
  const [done, setDone] = useState(null)
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const missing = ['name', 'phone', 'carrier'].filter(k => !f[k].trim())
  const bad = k => (tried || checked.includes(STEPS.findIndex(s => s.needs.includes(k)))) && missing.includes(k)
  const stepOk = i => STEPS[i].needs.every(k => !missing.includes(k))
  const next = () => {
    setChecked(c => [...new Set([...c, step])])
    if (stepOk(step)) setStep(step + 1)
  }
  const send = () => {
    setTried(true)
    if (missing.length) { setStep(STEPS.findIndex(s => s.needs.some(k => missing.includes(k)))); return }
    submitSale(f)
    setDone(f.name)
    note('Sale submitted for servicing')
  }
  const restart = () => { setDone(null); setF(EMPTY); setTried(false); setChecked([]); setStep(0) }

  if (done) {
    return (
      <div className="tp-page fx-page fx-sub is-done">
        <section className="fx-tile fx-sub-ok" style={{ '--i': 0 }}>
          <span className="fx-sub-okic"><Check size={26} aria-hidden="true" /></span>
          <h2>Submitted</h2>
          <p>{done} is on your books. The team sets the review call and keeps you posted in Activity.</p>
          <ol className="fx-sub-next">{NEXT.map(([Icon, t, s]) => <li key={t}><span className="fx-sub-nic"><Icon size={16} aria-hidden="true" /></span><span><b>{t}</b><small>{s}</small></span></li>)}</ol>
          <div className="tp-row tp-wrap fx-sub-okacts">
            <Link to={paths.clients()} className="tp-primary fx-accent">See your clients</Link>
            <button type="button" className="tp-btn ov-ghost" onClick={restart}>Submit another</button>
          </div>
        </section>
      </div>
    )
  }

  const S = STEPS[step]
  return (
    <div className="tp-page fx-page fx-sub">
      <section className="fx-tile fx-sub-form" style={{ '--i': 0 }} aria-label="Submit a policy">
        <header className="fx-sub-h">
          <span className="fx-sub-ic"><S.Icon size={18} aria-hidden="true" /></span>
          <span className="tp-grow"><small>Step {step + 1} of {STEPS.length}</small><h2>{S.label}</h2></span>
        </header>
        <Steps at={step} done={i => checked.includes(i) && stepOk(i)} onPick={setStep} />

        <div className="fx-sub-body" key={S.key}>
          {S.key === 'client' && <>
            <p className="tp-sub">Name and number are needed. The rest helps the team reach them.</p>
            <div className="fx-form-grid">
              <Field label="Full name"><input className={bad('name') ? 'tp-danger' : ''} value={f.name} onChange={set('name')} placeholder="First and last name" autoComplete="off" /></Field>
              <Field label="Phone"><input className={bad('phone') ? 'tp-danger' : ''} value={f.phone} onChange={set('phone')} placeholder="(555) 555-0100" inputMode="tel" autoComplete="off" /></Field>
              <Field label="Email, optional"><input value={f.email} onChange={set('email')} placeholder="name@example.com" inputMode="email" autoComplete="off" /></Field>
              <Field label="City"><input value={f.city} onChange={set('city')} autoComplete="off" /></Field>
              <Field label="State"><input value={f.state} onChange={set('state')} placeholder="TX" autoComplete="off" /></Field>
            </div>
            <div className="fx-sub-field"><b>Best time to reach them</b><small>Client's local time.</small><Seg label="Best time to reach them" value={f.best} onChange={v => setF({ ...f, best: v })} options={TIMES.map(x => ({ key: x, label: x }))} /></div>
          </>}

          {S.key === 'policy' && <>
            <p className="tp-sub">What you sold and who it is with.</p>
            <div className="fx-sub-field"><b>Product</b><Seg label="Product" value={f.product} onChange={v => setF({ ...f, product: v })} options={PRODUCTS.map(x => ({ key: x, label: x }))} /></div>
            <div className="fx-form-grid">
              <Field label="Carrier" hint="Pick one or type the carrier's name."><Select label="Carrier" invalid={bad('carrier')} value={f.carrier} onChange={v => setF({ ...f, carrier: v })} options={CARRIERS} placeholder="Pick or type a carrier" search allowCustom /></Field>
            </div>
            <div className="fx-sub-quick" aria-label="Carriers">{CARRIERS.map(c => <button key={c} type="button" className={`fx-filter${f.carrier === c ? ' is-on' : ''}`} aria-pressed={f.carrier === c} onClick={() => setF({ ...f, carrier: c })}>{c}</button>)}</div>
            <Pending>Texting consent wording pending</Pending>
          </>}

          {S.key === 'review' && <>
            <p className="tp-sub">Check it over. You can still change anything.</p>
            <Review f={f} onEdit={setStep} />
            {tried && missing.length > 0 && <p className="fx-sub-err">Fill in the {missing.map(k => NEEDED[k].toLowerCase()).join(', ')} first.</p>}
          </>}
        </div>

        <footer className="fx-sub-f">
          {step > 0 ? <button type="button" className="tp-btn ov-ghost" onClick={() => setStep(step - 1)}><ChevronLeft size={15} aria-hidden="true" />Back</button> : <span />}
          <span className="tp-grow" />
          {S.key !== 'review'
            ? <button type="button" className="tp-primary fx-accent" onClick={next}>Next<ChevronRight size={15} aria-hidden="true" /></button>
            : <button type="button" className="tp-primary fx-accent" onClick={send}><Check size={15} aria-hidden="true" />Submit policy</button>}
        </footer>
      </section>

      <aside className="fx-sub-side">
        <section className="fx-tile fx-sub-sum" style={{ '--i': 1 }} aria-label="Summary">
          <div className="fx-sub-who">
            <span className="tp-av av-sky" aria-hidden="true">{f.name.trim() ? initials(f.name.trim()).toUpperCase() : '?'}</span>
            <span className="tp-grow"><b>{f.name.trim() || 'New client'}</b><small>{f.phone.trim() || 'No number yet'}</small></span>
          </div>
          <dl className="fx-sub-mini">
            <div><dt>Product</dt><dd>{f.product}</dd></div>
            <div><dt>Carrier</dt><dd>{f.carrier.trim() || 'Not picked'}</dd></div>
            <div><dt>Best time</dt><dd>{f.best}</dd></div>
          </dl>
          <ul className="fx-sub-check" aria-label="Needed to submit">
            {Object.entries(NEEDED).map(([k, label]) => <li key={k} className={missing.includes(k) ? '' : 'is-ok'}><span>{missing.includes(k) ? '' : <Check size={12} aria-hidden="true" />}</span>{label}</li>)}
          </ul>
        </section>
        <section className="fx-tile fx-sub-after" style={{ '--i': 2 }} aria-label="What happens next">
          <h3>What happens next</h3>
          <ol className="fx-sub-next">{NEXT.map(([Icon, t, s]) => <li key={t}><span className="fx-sub-nic"><Icon size={16} aria-hidden="true" /></span><span><b>{t}</b><small>{s}</small></span></li>)}</ol>
        </section>
        <Link to={paths.requestService()} className="fx-tile fx-sub-req" style={{ '--i': 3 }}>
          <span className="fx-sub-nic"><Wrench size={16} aria-hidden="true" /></span>
          <span className="tp-grow"><b>Request a service</b><small>Something to change on a client you already have</small></span>
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </aside>
    </div>
  )
}
