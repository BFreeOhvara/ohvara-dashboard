import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useSampleSignup } from '../data'
import { Field, Money, Pending, SampleTag, useNote } from '../kit'
import { paths } from '../paths'
import { PLAN } from '../../lib/planPricing'

// Sample-only sign-up. No account is created, nothing is sent, and no terms wording is written.
export default function Signup() {
  const { data } = useSampleSignup()
  const go = useNavigate()
  const note = useNote()
  const [f, setF] = useState({ name: '', email: '', password: '' })
  const [agree, setAgree] = useState(false)
  const [tried, setTried] = useState(false)
  const bad = k => tried && !f[k].trim()
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const submit = e => {
    e.preventDefault()
    setTried(true)
    if (!f.name.trim() || !f.email.trim() || f.password.length < 1 || !agree) return
    note('Account preview created. Nothing was saved')
    go(paths.welcome())
  }
  return (
    <div className="tp tp-solo">
      <form className="tp-solo-in" onSubmit={submit} noValidate>
        <div className="tp-brand"><span className="tp-logo">O</span>Ohvara</div>
        <section className="ov-card tp-card tp-stack">
          <div><h1 className="tp-h2" style={{ fontSize: 26 }}>Create your account</h1><p className="tp-sub">You build your plan next. Change your budget any week.</p></div>
          <Field label="Full name"><input className={bad('name') ? 'tp-danger' : ''} value={f.name} onChange={set('name')} autoComplete="name" placeholder="Jordan Example" /></Field>
          <Field label="Email"><input className={bad('email') ? 'tp-danger' : ''} type="email" value={f.email} onChange={set('email')} autoComplete="email" placeholder="you@example.com" /></Field>
          <Field label="Password"><input className={bad('password') ? 'tp-danger' : ''} type="password" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
          <div className="tp-stack" aria-label="How billing works">
            <div className="tp-plan"><span className="tp-grow"><b>Weekly budget</b><p className="tp-sub">You set it with a slider and see the range it books</p></span><span><small className="tp-sub">from </small><Money v={PLAN.budget.min} cents={false} /><small className="tp-sub"> / week</small></span></div>
            <div className="tp-plan"><span className="tp-grow"><b>Policy servicing</b><p className="tp-sub">We keep your sales on the books</p></span><span><Money v={PLAN.servicingMonthly} cents={false} /><small className="tp-sub"> / month</small></span></div>
            <div className="tp-plan"><span className="tp-grow"><b>One-time setup</b><p className="tp-sub">Onboarding, calendar, texts, first ad test</p></span><Money v={PLAN.setupFee} cents={false} /></div>
            <SampleTag>Draft prices</SampleTag>
          </div>
          <ul className="tp-list">{data.covers.map(c => <li key={c} className="tp-row tp-sub" style={{ minHeight: 26 }}><Check size={14} />{c}</li>)}</ul>
          <label className="tp-check"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /><span>Agreement checkbox, wording pending</span></label>
          <Pending>Terms and privacy wording pending</Pending>
          {tried && !agree && <p className="tp-sub" style={{ color: 'var(--danger)' }}>Tick the box to go on.</p>}
          <button type="submit" className="tp-primary fx-accent">Create account</button>
          <p className="tp-sub">Already have an account? <button type="button" className="tp-link" onClick={() => note('Sign in is not part of the template')}>Sign in</button></p>
        </section>
        <p className="tp-sub" style={{ textAlign: 'center' }}><Link to={paths.home()} className="tp-link">Back to the template</Link> · Privacy, Terms, Help (wording pending)</p>
      </form>
    </div>
  )
}
