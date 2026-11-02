import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Lock } from 'lucide-react'
import { useSampleSignup } from '../data'
import { Money, SampleTag, useNote } from '../kit'

// First run: the locked welcome a new agent sees until a plan is chosen. Sample only; no payment happens here.
export default function Welcome() {
  const { data } = useSampleSignup()
  const note = useNote()
  const [steps, setSteps] = useState({ account: true, plan: false, first: false })
  const plan = data.plans[0]
  return (
    <div className="tp tp-solo">
      <div className="tp-solo-in tp-solo-wide">
        <div className="tp-brand"><span className="tp-logo">O</span>Ohvara</div>
        <section className="ov-hero tp-hero" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <span className="ov-hero-chip"><Lock size={14} />Your portal is locked</span>
          <h1 className="tp-h2" style={{ fontFamily: 'var(--font-display)', fontSize: 34, margin: '14px 0 0' }}>Welcome to Ohvara</h1>
          <p>Pick a plan and your portal opens on Overview.</p>
        </section>
        <div className="tp-g2">
          <section className="ov-card tp-card tp-stack" aria-label="How to start">
            <h2 className="tp-h2">How to start</h2>
            <ul className="tp-list">
              {[['account', 'Create your account'], ['plan', 'Choose a plan'], ['first', 'Submit your first sale']].map(([k, label]) => (
                <li key={k}><button type="button" className="tp-li" onClick={() => setSteps({ ...steps, [k]: !steps[k] })} aria-pressed={steps[k]}>
                  <span className={`tp-ic${steps[k] ? ' teal' : ''}`}>{steps[k] ? <Check size={16} /> : null}</span><b className="tp-grow">{label}</b></button></li>
              ))}
            </ul>
          </section>
          <section className="ov-card tp-card tp-stack" aria-label="Your plan">
            <div className="tp-row"><h2 className="tp-h2 tp-grow">{plan.label}</h2><SampleTag /></div>
            <div className="tp-row"><Money v={plan.weekly} size="lg" cents={false} /><span className="tp-sub">/ week</span></div>
            <p className="tp-sub">What Servicing covers</p>
            <ul className="tp-list">{data.covers.map(c => <li key={c} className="tp-row tp-sub" style={{ minHeight: 28 }}><Check size={14} />{c}</li>)}</ul>
            <button type="button" className="ov-hero tp-primary" onClick={() => { setSteps({ ...steps, plan: true }); note('Sample only. No payment was taken') }}>Subscribe</button>
            <Link to="/" className="tp-btn ov-ghost" style={{ height: 44 }}>Open my portal</Link>
          </section>
        </div>
        <p className="tp-sub" style={{ textAlign: 'center' }}><Link to="/signup" className="tp-link">Back to sign-up</Link></p>
      </div>
    </div>
  )
}
