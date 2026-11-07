import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, MailCheck, MessageSquareText } from 'lucide-react'
import { useSampleSignup } from '../data'
import { Field, Pending, Seg, SampleTag, useNote } from '../kit'
import { paths } from '../paths'
import { PhoneInput } from '../PhoneInput'
import { phoneComplete, formatPhone } from '../phoneMask'
import '../p878.css'

// P878 — sign-up (N-H-02, N-H-31): are you a licensed agent first (no: a plain stop, no account); then name, email,
// mobile and password; then a code to the email and one to the mobile. During the pilot the only cost is lead spend.
// Sample only: no account is made and no code is sent (any 6 digits pass).
const okCode = c => /^\d{6}$/.test(c)

export default function Signup() {
  const { data } = useSampleSignup()
  const go = useNavigate()
  const note = useNote()
  const [licensed, setLicensed] = useState(null)
  const [step, setStep] = useState('details')
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' })
  const [codes, setCodes] = useState({ email: '', phone: '' })
  const [agree, setAgree] = useState(false)
  const [tried, setTried] = useState(false)
  const valid = { name: !!f.name.trim(), email: /.+@.+\..+/.test(f.email), phone: phoneComplete(f.phone), password: f.password.length >= 8 }
  const bad = k => tried && !valid[k]
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const submit = e => {
    e.preventDefault()
    setTried(true)
    if (Object.values(valid).some(v => !v) || !agree) return
    note('Sample: codes were not really sent')
    setStep('verify')
  }
  const verify = e => {
    e.preventDefault()
    if (!okCode(codes.email) || !okCode(codes.phone)) return
    note('Account preview created. Nothing was saved')
    go(paths.welcome())
  }
  return (
    <div className="tp tp-solo">
      <div className="tp-solo-in">
        <div className="tp-brand"><span className="tp-logo">O</span>Ohvara</div>
        <section className="ov-card tp-card tp-stack">
          <div><h1 className="tp-h2" style={{ fontSize: 26 }}>Create your account</h1><p className="tp-sub">For licensed life insurance agents. Setup takes about 15 minutes.</p></div>
          <div className="lc-q"><b>Are you a licensed life insurance agent?</b>
            <Seg role="radiogroup" label="Are you a licensed life insurance agent?" value={licensed} onChange={v => { setLicensed(v); setStep('details') }} options={[{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'Not yet' }]} />
          </div>
          {licensed === 'no' && (
            <div className="wz-stop" role="status"><b>Ohvara is for licensed agents</b><p className="tp-sub">You need an active life insurance licence before you can sign up. Once you have one, come back and it takes about 15 minutes to get set up.</p></div>
          )}
          {licensed === 'yes' && step === 'details' && (
            <form className="tp-stack" onSubmit={submit} noValidate>
              <Field label="Full name"><input className={bad('name') ? 'tp-danger' : ''} value={f.name} onChange={set('name')} autoComplete="name" placeholder="Jordan Example" /></Field>
              <Field label="Email"><input className={bad('email') ? 'tp-danger' : ''} type="email" value={f.email} onChange={set('email')} autoComplete="email" placeholder="you@example.com" /></Field>
              <Field label="Mobile number" hint="Live calls and alerts come to this phone."><PhoneInput invalid={bad('phone')} value={f.phone} onChange={d => setF({ ...f, phone: d })} autoComplete="tel-national" /></Field>
              <Field label="Password" hint="At least 8 characters."><input className={bad('password') ? 'tp-danger' : ''} type="password" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
              <div className="tp-plan"><span className="tp-grow"><b>During the pilot you pay only your lead spend</b><p className="tp-sub">You set it per day and change it any time. Prepaid each week; what you don{'’'}t use rolls over.</p></span><SampleTag>Pilot</SampleTag></div>
              <ul className="tp-list">{data.covers.map(c => <li key={c} className="tp-row tp-sub" style={{ minHeight: 26 }}><Check size={14} />{c}</li>)}</ul>
              <label className="tp-check"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /><span>Agreement checkbox, wording pending</span></label>
              <Pending>Terms, privacy and text-message consent wording pending</Pending>
              {tried && !agree && <p className="fx-sub-err" role="alert">Tick the box to go on.</p>}
              <button type="submit" className="tp-primary fx-accent">Create account</button>
            </form>
          )}
          {licensed === 'yes' && step === 'verify' && (
            <form className="tp-stack" onSubmit={verify} noValidate>
              <p className="tp-sub">We sent a 6-digit code to each. Enter both to go on.</p>
              <div className="wz-code"><Field label={`Code sent to ${f.email}`}><input value={codes.email} inputMode="numeric" maxLength={6} autoComplete="one-time-code" onChange={e => setCodes({ ...codes, email: e.target.value.replace(/\D/g, '') })} /></Field><MailCheck size={18} aria-hidden="true" /></div>
              <div className="wz-code"><Field label={`Code texted to ${formatPhone(f.phone)}`}><input value={codes.phone} inputMode="numeric" maxLength={6} autoComplete="one-time-code" onChange={e => setCodes({ ...codes, phone: e.target.value.replace(/\D/g, '') })} /></Field><MessageSquareText size={18} aria-hidden="true" /></div>
              <button type="submit" className="tp-primary fx-accent" disabled={!okCode(codes.email) || !okCode(codes.phone)}>Verify and start setup</button>
              <p className="tp-sub"><button type="button" className="tp-link" onClick={() => note('Sample: new codes were not really sent')}>Send new codes</button> · <button type="button" className="tp-link" onClick={() => setStep('details')}>Change email or mobile</button></p>
            </form>
          )}
          <p className="tp-sub">Already have an account? <button type="button" className="tp-link" onClick={() => note('Sign in is not part of the template')}>Sign in</button></p>
        </section>
        <p className="tp-sub" style={{ textAlign: 'center' }}><Link to={paths.home()} className="tp-link">Back to the template</Link> · Privacy, Terms, Help (wording pending)</p>
      </div>
    </div>
  )
}
