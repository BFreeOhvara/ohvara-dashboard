import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { User, Mail, Lock, ArrowRight, Loader2, Check, Clock, CalendarCheck, PhoneCall, Eye, ListChecks, Wallet, Link2Off } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { AuthPage, AuField, PasswordField, AuCheck, AuAlert } from '../components/auth/AuthShell'
import { keepSubmitVisible, EMAIL_RE, SUPPORT_EMAIL } from '../components/auth/authUtils'

// Create account — Prompt 781 (mockups media/sign-in/Join + JoinPhone in the
// vault). Reached from an invite: /join?t=<token>, the text's short
// /j/<token>, or the older /join/<token>. Name, email, password; no username,
// no step bar. Create account signs them straight in to their role's home.
//
// Email invite: the email is filled from the invite and locked (P731).
// Text invite: no email is known, so they type one; it's confirmed after
// (claim-invite mails a link, the portal shows a banner until it's clicked).
// Role comes from the invite; nobody else ever sees the password.

const PERKS = {
  agent: [
    [CalendarCheck, 'Submit a client in under a minute', 'Pick a time that fits the client and the carrier.'],
    [PhoneCall, 'We make the cancel call', 'Our team gets the old policy cancelled, on the record.'],
    [Eye, 'Watch it happen live', 'Booked, called, cancelled. Every step shows up for you.'],
  ],
  fulfillment: [
    [ListChecks, 'Your calls, lined up', 'Today shows your next call and everything after it.'],
    [PhoneCall, 'Call from the portal', 'Ring the client and carrier, merge, done.'],
    [Wallet, null, 'Paid automatically every Monday.'],
  ],
}

const dollars = c => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`

function Story({ role, pay }) {
  const perks = PERKS[role] || PERKS.agent
  return (
    <>
      <h1 className="sx-h1 sx-h1--join">You’re invited to <span className="sx-grad">Ohvara.</span></h1>
      <p className="sx-lede sx-desk-only">
        {role === 'fulfillment' ? 'Make the cancel calls. Get paid every Monday.' : 'Submit the client. We handle the cancel, and you watch it happen.'}
      </p>
      <div className="sx-perks">
        {perks.map(([Icon, t, s], i) => {
          // Fulfillment's pay line uses the live pay-per-cancel setting.
          const title = t ?? (pay != null ? `${dollars(pay)} per verified cancel` : 'Paid per verified cancel')
          return (
            <div className="sx-perk" key={i}>
              <span className="sx-perk-ico" aria-hidden="true"><Icon size={18} strokeWidth={2} /></span>
              <span><b>{title}</b><span>{s}</span></span>
            </div>
          )
        })}
      </div>
    </>
  )
}

function DeadInvite({ reason }) {
  const used = reason === 'used'
  const expired = reason === 'expired'
  return (
    <>
      <span className="sx-big-ico sx-big-ico--warn">{used ? <Check size={24} strokeWidth={2.2} /> : expired ? <Clock size={24} strokeWidth={2} /> : <Link2Off size={24} strokeWidth={2} />}</span>
      <h2>{used ? 'This invite was already used' : expired ? 'This invite has expired' : 'This invite link isn’t valid'}</h2>
      <p className="sx-card-sub" style={{ marginTop: 8 }}>
        {used ? 'Someone already made an account with it. If that was you, sign in instead.'
          : expired ? 'Invites work for 7 days. Ask whoever invited you to send a new one.'
          : 'Check that you opened the whole link. If it still doesn’t work, ask whoever invited you for a new one.'}
      </p>
      {used
        ? <Link to="/login" className="sx-btn" style={{ marginTop: 20 }}>Go to sign in</Link>
        : <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('New Ohvara invite')}`} className="sx-btn" style={{ marginTop: 20 }}>Email support for a new invite</a>}
      <div className="sx-center-note">Need help? <a className="sx-soft" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></div>
    </>
  )
}

export default function Join() {
  const params = useParams()
  const [search] = useSearchParams()
  const token = params.token || search.get('t') || ''
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const [checking, setChecking] = useState(true)
  const [invite, setInvite] = useState(null) // { role, email, byText, pay } when valid
  const [reason, setReason] = useState(null)
  const [form, setForm] = useState({ full_name: '', email: '', password: '' })
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState('')
  const [bad, setBad] = useState({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function check() {
      if (!token) { setReason('invalid'); setChecking(false); return }
      const { data, error: fnError } = await supabase.functions.invoke('claim-invite', { body: { action: 'check', token } })
      if (cancelled) return
      if (!fnError && data?.valid) {
        setInvite({ role: data.role, email: data.email || null, byText: !!data.by_text, pay: data.pay_per_cancel_cents ?? null })
        // Prompt 731: an email invite an agent sent only works for that address.
        if (data.email) setForm(f => ({ ...f, email: data.email }))
      } else {
        setReason(data?.reason || 'invalid')
      }
      setChecking(false)
    }
    check()
    return () => { cancelled = true }
  }, [token])

  const pw = form.password
  const has8 = pw.length >= 8
  const hasNum = /\d/.test(pw)
  const hasSym = /[^A-Za-z0-9]/.test(pw)

  async function handleSubmit(e) {
    e?.preventDefault()
    setError('')
    const name = form.full_name.trim()
    const email = form.email.trim()
    if (!name) { setBad({ name: true }); return setError('Type your full name.') }
    if (!EMAIL_RE.test(email)) { setBad({ email: true }); return setError('Type a valid email address.') }
    if (!has8 || !hasNum) { setBad({ pw: true }); return setError('Your password needs 8 or more characters and a number.') }
    if (!agree) { setBad({ agree: true }); return setError('Agree to the Terms and Privacy Policy to continue.') }
    setBad({})
    setSubmitting(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('claim-invite', {
        body: { action: 'claim', token, full_name: name, email, password: pw },
      })
      // supabase-js surfaces non-2xx as fnError with the body unread — pull
      // the function's real error message out of the response when present.
      if (fnError) {
        let msg = 'Couldn’t create your account. Try again.'
        try {
          const body = await fnError.context?.json()
          if (body?.error) msg = body.error
        } catch { /* keep generic */ }
        throw new Error(msg)
      }
      if (data?.error) throw new Error(data.error)

      // Account created — sign them straight in and let RoleRedirect route.
      await signIn(email.toLowerCase(), pw)
      navigate('/', { replace: true })
    } catch (err) {
      const m = err.message || ''
      if (/already exists/i.test(m)) setBad({ email: true })
      setError(m || 'Couldn’t create your account. Try again.')
      setSubmitting(false)
    }
  }

  const role = invite?.role === 'fulfillment' ? 'fulfillment' : 'agent'

  return (
    <AuthPage left={<Story role={role} pay={invite?.pay} />}>
      <section className="sx-card sx-card--join" aria-label={invite ? 'Create your account' : 'Invite'} aria-busy={checking || undefined}>
        {checking ? (
          <div style={{ padding: '48px 0', display: 'flex', justifyContent: 'center', color: 'var(--sx-teal-hi)' }}>
            <Loader2 size={24} className="animate-spin" aria-label="Checking your invite" />
          </div>
        ) : !invite ? (
          <DeadInvite reason={reason} />
        ) : (
          <form onSubmit={handleSubmit} onFocus={keepSubmitVisible} noValidate>
            <span className={`sx-role sx-role--${role}`}><i />Invited as {role === 'fulfillment' ? 'Fulfillment' : 'an agent'}</span>
            <h2>Create your account</h2>
            <p className="sx-card-sub">You’ll sign in with your email.</p>
            {error && <AuAlert>{error}</AuAlert>}
            <AuField first label="Full name" icon={User} name="name" autoComplete="name" autoCapitalize="words"
              value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              placeholder="Your first and last name" error={!!bad.name} />
            <AuField label="Email" icon={Mail} type="email" inputMode="email" name="email" autoComplete="username"
              autoCapitalize="none" spellCheck={false} value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="you@email.com"
              locked={!!invite.email} required={!invite.email} error={!!bad.email}
              hint={!invite.email && invite.byText ? 'We’ll send a link to confirm it.' : null} hintId="join-email-hint" />
            <PasswordField label="Password" icon={Lock} name="new-password" autoComplete="new-password"
              value={pw} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="Make a password" error={!!bad.pw} aria-describedby="join-pw-checks" />
            <div className="sx-checks" id="join-pw-checks" aria-live="polite">
              <span className={has8 ? 'is-on' : ''}>{has8 ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <i className="sx-dot" aria-hidden="true" />}8+ characters<span className="sx-sr">{has8 ? ' (done)' : ' (needed)'}</span></span>
              <span className={hasNum ? 'is-on' : ''}>{hasNum ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <i className="sx-dot" aria-hidden="true" />}A number<span className="sx-sr">{hasNum ? ' (done)' : ' (needed)'}</span></span>
              <span className={hasSym ? 'is-on' : ''}>{hasSym ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <i className="sx-dot" aria-hidden="true" />}A symbol (optional)</span>
            </div>
            <AuCheck terms checked={agree} onChange={setAgree} error={!!bad.agree}>
              I agree to the <a className="sx-link sx-link--soft" href="https://ohvara.com/terms" target="_blank" rel="noreferrer">Terms</a> and <a className="sx-link sx-link--soft" href="https://ohvara.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
            </AuCheck>
            <button type="submit" className="sx-btn" style={{ marginTop: 16 }} disabled={submitting}>
              {submitting ? <><Loader2 size={18} className="animate-spin" />Creating your account…</> : <>Create account<ArrowRight size={17} strokeWidth={2.4} /></>}
            </button>
            <div className="sx-center-note">Already have an account? <Link to="/login">Sign in</Link></div>
          </form>
        )}
      </section>
    </AuthPage>
  )
}
