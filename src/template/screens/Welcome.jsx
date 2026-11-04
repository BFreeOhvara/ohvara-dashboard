import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Lock } from 'lucide-react'
import { PLAN } from '../../lib/planPricing'
import { useNote } from '../kit'
import { paths } from '../paths'
import { BudgetSlider, ServicingLine, PlanSummary } from '../PlanBuilder'

// First run: the locked welcome a new agent sees until a plan is built. The plan step is the plan builder
// (Prompt 835): weekly budget, monthly servicing, one-time setup. Sample only; no payment happens here.
export default function Welcome() {
  const note = useNote()
  const [steps, setSteps] = useState({ account: true, plan: false, first: false })
  const [weekly, setWeekly] = useState(PLAN.budget.start)
  const [mode, setMode] = useState('appts')
  return (
    <div className="tp tp-solo">
      <div className="tp-solo-in tp-solo-wide">
        <div className="tp-brand"><span className="tp-logo">O</span>Ohvara</div>
        <section className="ov-hero tp-hero" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <span className="ov-hero-chip"><Lock size={14} />Your portal is locked</span>
          <h1 className="tp-h2" style={{ fontFamily: 'var(--font-display)', fontSize: 34, margin: '14px 0 0' }}>Welcome to Ohvara</h1>
          <p>Build your plan and your portal opens on Overview.</p>
        </section>
        <section className="ov-card tp-card tp-stack" aria-label="How to start">
          <h2 className="tp-h2">How to start</h2>
          <ul className="tp-list pb-todo">
            {[['account', 'Create your account'], ['plan', 'Build your plan'], ['first', 'Submit your first sale']].map(([k, label]) => (
              <li key={k}><button type="button" className="tp-li" onClick={() => setSteps({ ...steps, [k]: !steps[k] })} aria-pressed={steps[k]}>
                <span className={`tp-ic${steps[k] ? ' teal' : ''}`}>{steps[k] ? <Check size={16} /> : null}</span><b className="tp-grow">{label}</b></button></li>
            ))}
          </ul>
        </section>
        <section className="ov-card tp-card tp-stack pb-tile" aria-label="Build your plan">
          <div><h2 className="tp-h2">Build your plan</h2><p className="tp-sub">Choose how much to put into new business each week. Your budget runs the ads and our team books them for you. Servicing is billed monthly.</p></div>
          <div className="pb-grid">
            <div className="pb-steps">
              <p className="pb-step">Step 1 · Weekly budget</p>
              <BudgetSlider weekly={weekly} mode={mode} onWeekly={setWeekly} onMode={setMode} id="welcome-budget" />
              <p className="pb-step">Step 2 · Policy servicing (monthly)</p>
              <ServicingLine />
            </div>
            <PlanSummary weekly={weekly} mode={mode}>
              <p className="pb-note">Setup covers onboarding, your calendar and texts, and the first ad test.</p>
              <button type="button" className="tp-primary fx-accent" onClick={() => { setSteps({ ...steps, plan: true }); note('Sample only. No payment was taken') }}>Start onboarding</button>
              <Link to={paths.home()} className="tp-btn ov-ghost" style={{ height: 44 }}>Open my portal</Link>
            </PlanSummary>
          </div>
        </section>
        <p className="tp-sub" style={{ textAlign: 'center' }}><Link to={paths.signup()} className="tp-link">Back to sign-up</Link></p>
      </div>
    </div>
  )
}
