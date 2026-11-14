import { useState, useRef } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { User, Mail, Lock, ArrowRight, Loader2, Check, Clock, Info } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { isNativeApp } from '../lib/native'
import { fetchSignupOpen, useSignupOpen } from '../lib/signupStatus'
import { useAuth } from '../hooks/useAuth'
import { AuthPage, AuField, PasswordField, AuAlert } from '../components/auth/AuthShell'
import { keepSubmitVisible, EMAIL_RE, SUPPORT_EMAIL, AGENT_PERKS } from '../components/auth/authUtils'
import { PhoneAuthPage } from '../components/auth/PhoneAuth'
import { usePhoneAuth } from '../components/auth/usePhoneAuth'
import { SocialButtons } from '../components/auth/SocialButtons'
import { Captcha } from '../components/auth/Captcha'
import { TermsLine } from '../components/auth/TermsLine'
import { markTermsAgreed } from '../lib/oauth'

// Create your account. Anyone can make a portal account here, but only while the
// server's sign-up switch is on: the page asks self-signup for its status and
// fails closed (an error or anything but open shows "Sign-up isn't open yet").
// ?early=1 shows the form regardless; that is a convenience, the server still
// refuses. In the phone app the form is never shown.
//
// One message for every failed sign-up (an email that already has an account
// included), so the page can't be used to learn whether an email is registered.
//
// P999: the phone app makes accounts too now (same server switch, same rules); paying stays on the website. Phones
// get the approved mockup's card (PhoneAuth), with Apple / Google under the form. A throwaway email is refused and,
// once its key is set, the bot check runs on every sign-up.
//
// P996: rebuilt on /login's look (AuthShell). No flash: the story never changes, and the card waits (same size)
// until both the sign-in check and the sign-up switch have answered, so a signed-in visitor goes straight to the
// portal and a closed switch never shows the form first. The switch is asked as soon as this file loads on /signup.

if (typeof location !== 'undefined' && location.pathname === '/signup') fetchSignupOpen()

function Story() {
  return (
    <>
      <span className="sx-pill"><i />For licensed life insurance agents</span>
      <h1 className="sx-h1" style={{ marginTop: 20 }}>Create your <span className="sx-grad">Ohvara</span> account.</h1>
      <p className="sx-lede">Make your account, pick a plan, and your portal opens right away.</p>
      <div className="sx-perks">
        {AGENT_PERKS.map(([Icon, t, s]) => (
          <div className="sx-perk" key={t}>
            <span className="sx-perk-ico" aria-hidden="true"><Icon size={18} strokeWidth={2} /></span>
            <span><b>{t}</b><span>{s}</span></span>
          </div>
        ))}
      </div>
    </>
  )
}

function ClosedBody({ phone }) {
  return (
    <>
      <span className={`sx-big-ico sx-big-ico--warn${phone ? ' pa-center-ico' : ''}`}><Clock size={24} strokeWidth={2} aria-hidden="true" /></span>
      <h2>Sign-up isn’t open yet</h2>
      <p className="sx-card-sub" style={{ marginTop: 8 }}>
        New accounts can’t be made right now. If you already have an account, sign in. If you were sent an invite, use the link in it.
      </p>
      <Link to="/login" className="sx-btn" style={{ marginTop: 20, textDecoration: 'none' }}>Go to sign in</Link>
      <div className={phone ? 'pa-alt' : 'sx-center-note'}>Need help? <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></div>
    </>
  )
}

export default function Signup() {
  const { signIn, session, loading } = useAuth()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const phone = usePhoneAuth()
  const early = !isNativeApp() && search.get('early') === '1'
  const open = useSignupOpen() // null while asking
  const [serverClosed, setServerClosed] = useState(false)

  const [form, setForm] = useState({ full_name: '', email: '', password: '' })
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState(null) // { field: 'name' | 'email' | 'pw' | 'agree', msg }
  const [banner, setBanner] = useState(null) // 'rate' | 'neutral'
  const [submitting, setSubmitting] = useState(false)
  const [captcha, setCaptcha] = useState('')
  const captchaApi = useRef(null)

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
        body: { action: 'signup', full_name: name, email, password: pw, agree_terms: true, captcha_token: captcha || undefined },
      })
      if (fnError) {
        const status = fnError.context?.status
        if (status === 429) return setBanner('rate')
        if (status === 403) return setServerClosed(true)
        // P999: a refused field (throwaway email, bot check) says what to fix.
        if (status === 400) {
          let msg = ''
          try { msg = (await fnError.context.json())?.error || '' } catch { /* no body */ }
          if (/throwaway/i.test(msg)) return setError({ field: 'email', msg })
          if (msg) return setError({ field: null, msg })
        }
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
      if (!leaving) { setSubmitting(false); captchaApi.current?.reset() }
    }
  }

  if (!loading && session) return <Navigate to="/" replace />

  const waiting = loading || (!serverClosed && !early && open === null)
  const showForm = !serverClosed && (open === true || early)
  const limited = banner === 'rate'
  const bad = error?.field
  const clearRate = () => { if (limited) setBanner(null) }
  const check = (ok, label, optional) => (
    <span className={ok ? 'is-on' : ''}>
      {ok ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <i className="sx-dot" aria-hidden="true" />}{label}
      {!optional && <span className="sx-sr">{ok ? ' (done)' : ' (needed)'}</span>}
    </span>
  )
  // Apple / Google: the same agreement first. Ticked here, the sign-in that comes back skips the terms step.
  const socialFirst = () => {
    if (!agree) { setError({ field: 'agree', msg: 'Agree to the Terms and Privacy Policy to continue.' }); return false }
    markTermsAgreed()
    return true
  }

  const body = waiting ? (
    <div className="pub-wait" aria-busy="true"><Loader2 size={24} className="animate-spin" aria-label="Loading" /></div>
  ) : !showForm ? (
    <ClosedBody phone={phone} />
  ) : (
    <form aria-label="Create your account" onSubmit={handleSubmit} onFocus={keepSubmitVisible} noValidate>
      <h2>{phone ? 'Create account' : 'Create your account'}</h2>
      {!phone && <p className="sx-card-sub">You’ll sign in with your email.</p>}
      {banner === 'rate' && <div className="sx-note" role="alert"><b>Too many tries.</b> Wait a few minutes, then try again.</div>}
      {banner === 'neutral' && (
        <div className="sx-note" role="alert">
          <Info size={16} strokeWidth={2} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />
          <b>We couldn’t sign you in.</b> If you already have an account, <Link className="sx-link sx-link--soft" to="/login">sign in</Link> or <Link className="sx-link sx-link--soft" to="/login?forgot=1">reset your password</Link>.
        </div>
      )}
      {error && <AuAlert>{error.msg}</AuAlert>}
      <AuField first label="Full name" icon={User} name="name" autoComplete="name" autoCapitalize="words"
        autoFocus={!phone} value={form.full_name}
        onChange={e => { setForm(f => ({ ...f, full_name: e.target.value })); clearRate() }}
        placeholder={phone ? 'Full name' : 'Your full name'} error={bad === 'name'} />
      <AuField label="Email" icon={Mail} type="email" inputMode="email" name="email" autoComplete="username"
        autoCapitalize="none" spellCheck={false} value={form.email}
        onChange={e => { setForm(f => ({ ...f, email: e.target.value })); clearRate() }}
        placeholder={phone ? 'Email' : 'you@email.com'} error={bad === 'email'} />
      <PasswordField label="Password" icon={Lock} name="new-password" autoComplete="new-password"
        value={pw} onChange={e => { setForm(f => ({ ...f, password: e.target.value })); clearRate() }}
        placeholder={phone ? 'Password' : 'Choose a password'} error={bad === 'pw'} aria-describedby="su-pw-checks" />
      <div className="sx-checks" id="su-pw-checks" aria-live="polite">
        {check(has8, '8+ characters')}{check(hasNum, 'A number')}{check(hasSym, 'A symbol (optional)', true)}
      </div>
      <TermsLine checked={agree} onChange={v => { setAgree(v); if (bad === 'agree') setError(null) }} error={bad === 'agree'} />
      <Captcha onToken={setCaptcha} api={captchaApi} />
      <button type="submit" className="sx-btn" style={{ marginTop: phone ? 12 : 16 }} disabled={submitting || limited}>
        {submitting ? <><Loader2 size={18} className="animate-spin" />Creating your account…</> : phone ? 'Create account' : <>Create account<ArrowRight size={17} strokeWidth={2.4} /></>}
      </button>
      <SocialButtons phone={phone} beforeStart={socialFirst} onError={msg => setError({ field: null, msg })} />
      {phone
        ? <p className="pa-alt">Already have an account? <Link to="/login">Sign in</Link><span className="pa-small">VAs and admins join by invite from Ohvara.</span></p>
        : <div className="sx-center-note">Already have an account? <Link to="/login">Sign in</Link></div>}
    </form>
  )

  if (phone) return <PhoneAuthPage label="Create account">{body}</PhoneAuthPage>

  return (
    <AuthPage left={<Story />} waiting={waiting}>
      <section className="sx-card" aria-label={waiting ? 'Checking sign-up' : 'Create your account'} aria-busy={waiting || undefined}>{body}</section>
    </AuthPage>
  )
}
