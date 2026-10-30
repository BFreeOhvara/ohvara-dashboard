import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { User, Mail, Lock, Eye, EyeOff, ArrowRight, Loader2, Check, Clock, Info, AlertCircle, ShieldCheck, Phone } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { isNativeApp } from '../lib/native'
import { useSignupOpen } from '../lib/signupStatus'
import { useAuth } from '../hooks/useAuth'
import { OhvaraMark } from '../components/ui/OhvaraMark'
import { keepSubmitVisible, EMAIL_RE, SUPPORT_EMAIL } from '../components/auth/authUtils'
import './signup.css'

// Create your account — the approved mockup (media/signup/Signup + SignupPhone
// in the vault). Anyone can make a portal account here, but only while the
// server's sign-up switch is on: the page asks self-signup for its status and
// fails closed (an error or anything but open shows "Sign-up isn't open yet").
// ?early=1 shows the form regardless; that is a convenience, the server still
// refuses. In the phone app the form is never shown.
//
// One message for every failed sign-up (an email that already has an account
// included), so the page can't be used to learn whether an email is registered.

const PERKS = [
  [ShieldCheck, 'Servicing', 'Submit every deal you close and we keep each policy on the books.'],
  [Phone, 'Leads', 'Opens soon. Set a weekly spend and we bring you people to sell to.'],
  [Check, 'Opens right away', 'Pick a plan and your portal opens as soon as your payment is confirmed.'],
]

function Field({ label, icon: Icon, error, right, ...input }) {
  return (
    <label className="su-fld">
      <span className="su-lab">{label}</span>
      <span className={`su-inp${error ? ' is-err' : ''}`}>
        <Icon size={18} strokeWidth={2} aria-hidden="true" />
        <input aria-invalid={error || undefined} {...input} />
        {right}
      </span>
    </label>
  )
}

function PasswordField(props) {
  const [show, setShow] = useState(false)
  return (
    <Field {...props} type={show ? 'text' : 'password'}
      right={
        <button type="button" className="su-eye" onClick={() => setShow(s => !s)}
          aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
          {show ? <EyeOff size={19} strokeWidth={2} /> : <Eye size={19} strokeWidth={2} />}
        </button>
      } />
  )
}

function FieldError({ children }) {
  return <div className="su-ferr" role="alert"><AlertCircle size={15} strokeWidth={2} aria-hidden="true" />{children}</div>
}

function Hint({ ok, children }) {
  return (
    <span className={`su-hint${ok ? ' ok' : ''}`}>
      {ok ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : <i aria-hidden="true" />}
      {children}<span className="su-sr">{ok ? ' (done)' : ' (needed)'}</span>
    </span>
  )
}

function ClosedCard({ native }) {
  return (
    <section className="ov-card su-card" aria-label={native ? 'Sign-up isn’t available in the app' : 'Sign-up isn’t open yet'}>
      <span className="su-tile"><Clock size={24} strokeWidth={2} aria-hidden="true" /></span>
      <h2 className="su-closed-h">{native ? 'Sign-up isn’t available in the app' : 'Sign-up isn’t open yet'}</h2>
      <p className="lede su-closed-p">
        {native
          ? 'New accounts can’t be made in the app. If you already have an account, sign in. If you were sent an invite, use the link in it.'
          : 'New accounts can’t be made on this page right now. If you already have an account, sign in. If you were sent an invite, use the link in it.'}
      </p>
      <div className="su-acts2">
        <Link to="/login" className="ov-solid su-btn">Go to sign in</Link>
      </div>
      <div className="su-below">Need help? <a className="su-lnk" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></div>
    </section>
  )
}

export default function Signup() {
  const { signIn, session, loading } = useAuth()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const native = isNativeApp()
  const early = !native && search.get('early') === '1'
  const open = useSignupOpen() // null while asking
  const [serverClosed, setServerClosed] = useState(false)

  const [form, setForm] = useState({ full_name: '', email: '', password: '' })
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState(null) // { field: 'name' | 'email' | 'pw' | 'agree', msg }
  const [banner, setBanner] = useState(null) // 'rate' | 'neutral'
  const [submitting, setSubmitting] = useState(false)

  const pw = form.password
  const has8 = pw.length >= 8
  const hasNum = /\d/.test(pw)
  const hasSym = /[^A-Za-z0-9]/.test(pw)

  async function handleSubmit(e) {
    e?.preventDefault()
    setError(null); setBanner(null)
    const name = form.full_name.trim()
    const email = form.email.trim()
    if (!name) return setError({ field: 'name', msg: 'Type your full name.' })
    if (!EMAIL_RE.test(email)) return setError({ field: 'email', msg: 'Type a valid email address.' })
    if (!has8 || !hasNum) return setError({ field: 'pw', msg: 'Your password needs 8 or more characters and a number.' })
    if (!agree) return setError({ field: 'agree', msg: 'Agree to the Terms and Privacy Policy to continue.' })

    setSubmitting(true)
    let leaving = false
    try {
      const { data, error: fnError } = await supabase.functions.invoke('self-signup', {
        body: { action: 'signup', full_name: name, email, password: pw, agree_terms: true },
      })
      if (fnError) {
        const status = fnError.context?.status
        if (status === 429) return setBanner('rate')
        if (status === 403) return setServerClosed(true)
        return setBanner('neutral')
      }
      if (data?.ok !== true && data?.success !== true) return setBanner('neutral')

      // Account made (or the email already had one: the answer is the same).
      // Sign in; if that doesn't work, say so without saying why.
      try {
        await signIn(email.toLowerCase(), pw)
      } catch {
        return setBanner('neutral')
      }
      leaving = true
      navigate('/', { replace: true })
    } catch {
      setBanner('neutral')
    } finally {
      if (!leaving) setSubmitting(false)
    }
  }

  if (!loading && session) return <Navigate to="/" replace />

  const showForm = !native && !serverClosed && (open === true || early)
  const asking = !native && !serverClosed && !early && open === null
  const limited = banner === 'rate'
  const bad = error?.field
  const clearRate = () => { if (limited) setBanner(null) }

  return (
    <div className="su">
      <div className="su-brand">
        <OhvaraMark height={40} back="var(--ov-hi)" front="var(--ov-data-b)" />
        Ohvara Portal
      </div>
      <div className="su-mid">
        {showForm || asking
          ? <h1>Create your <span>Ohvara</span> account.</h1>
          : <h1>The Ohvara <span>Portal.</span></h1>}
        <p className="su-sub">
          {showForm || asking
            ? 'Make your account, pick a plan, and your portal opens right away.'
            : 'We keep every policy you write on the books, so you can keep selling.'}
        </p>
        {(showForm || asking) && (
          <div className="su-perks">
            {PERKS.map(([Icon, t, s]) => (
              <div className="ov-card su-perk" key={t}>
                <i aria-hidden="true"><Icon size={17} strokeWidth={2.4} /></i>
                <span><b>{t}</b><span>{s}</span></span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="su-r">
        {asking ? (
          <section className="ov-card su-card" aria-label="Checking sign-up" aria-busy="true">
            <div style={{ padding: '40px 0', display: 'flex', justifyContent: 'center', color: 'var(--ov-data-b)' }}>
              <Loader2 size={24} className="animate-spin" aria-label="Checking whether sign-up is open" />
            </div>
          </section>
        ) : !showForm ? (
          <ClosedCard native={native} />
        ) : (
          <form className="ov-card su-card" aria-label="Create your account" onSubmit={handleSubmit} onFocus={keepSubmitVisible} noValidate>
            <h2>Create your account</h2>
            <p className="lede">You’ll sign in with your email.</p>
            {banner === 'rate' && (
              <div className="su-note quiet" role="alert">
                <Clock size={18} strokeWidth={2} aria-hidden="true" />
                <span><b>Too many tries</b>Wait a few minutes, then try again.</span>
              </div>
            )}
            {banner === 'neutral' && (
              <div className="su-note info" role="alert">
                <Info size={18} strokeWidth={2} aria-hidden="true" />
                <span>
                  <b>We couldn’t sign you in</b>
                  If you already have an account, sign in or reset your password.
                  <span className="su-acts">
                    <Link className="su-lnk" to="/login">Sign in</Link>
                    <Link className="su-lnk" to="/login?forgot=1">Reset your password</Link>
                  </span>
                </span>
              </div>
            )}
            <Field label="Full name" icon={User} name="name" autoComplete="name" autoCapitalize="words"
              autoFocus={window.innerWidth >= 768} value={form.full_name}
              onChange={e => { setForm(f => ({ ...f, full_name: e.target.value })); clearRate() }}
              placeholder="Your full name" error={bad === 'name'} />
            {bad === 'name' && <FieldError>{error.msg}</FieldError>}
            <Field label="Email" icon={Mail} type="email" inputMode="email" name="email" autoComplete="username"
              autoCapitalize="none" spellCheck={false} value={form.email}
              onChange={e => { setForm(f => ({ ...f, email: e.target.value })); clearRate() }}
              placeholder="you@email.com" error={bad === 'email'} />
            {bad === 'email' && <FieldError>{error.msg}</FieldError>}
            <PasswordField label="Password" icon={Lock} name="new-password" autoComplete="new-password"
              value={pw} onChange={e => { setForm(f => ({ ...f, password: e.target.value })); clearRate() }}
              placeholder="Choose a password" error={bad === 'pw'} aria-describedby="su-pw-hints" />
            {bad === 'pw' && <FieldError>{error.msg}</FieldError>}
            <div className="su-hints" id="su-pw-hints" aria-live="polite">
              <Hint ok={has8}>8+ characters</Hint>
              <Hint ok={hasNum}>A number</Hint>
              <Hint ok={hasSym}>A symbol (optional)</Hint>
            </div>
            <label className="su-cbrow">
              <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} aria-invalid={bad === 'agree' || undefined} />
              <span className={`su-cb${agree ? ' on' : ''}${bad === 'agree' ? ' bad' : ''}`} aria-hidden="true">{agree && <Check size={13} strokeWidth={3.4} />}</span>
              <span>
                I agree to the <a href="https://ohvara.com/terms" target="_blank" rel="noreferrer">Terms</a> and <a href="https://ohvara.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
              </span>
            </label>
            {bad === 'agree' && <FieldError>{error.msg}</FieldError>}
            <button type="submit" className="ov-solid su-btn" disabled={submitting || limited}>
              {submitting ? <><Loader2 size={18} className="animate-spin" />Creating your account…</> : <>Create account<ArrowRight size={17} strokeWidth={2.4} /></>}
            </button>
            <div className="su-below">Already have an account? <Link className="su-lnk" to="/login">Sign in</Link></div>
          </form>
        )}
      </div>

      <div className="su-foot">
        <span>© {new Date().getFullYear()} Ohvara</span>
        <a href="https://ohvara.com/privacy" target="_blank" rel="noreferrer">Privacy</a>
        <a href="https://ohvara.com/terms" target="_blank" rel="noreferrer">Terms</a>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </div>
    </div>
  )
}
