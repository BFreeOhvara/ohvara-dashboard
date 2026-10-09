import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  User, ShieldCheck, SlidersHorizontal, PhoneForwarded, Wrench, Mail, KeyRound, Smartphone, LogOut, Moon, Sun,
  Check, Globe, Video, PhoneCall, ArrowLeft, ArrowRight, X, Copy, Loader2, Trash2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { useUpdateOwnProfile } from '../hooks/useSettings'
import { useAppSettings, useUpdateAppSettings } from '../hooks/useAppSettings'
import { useBillingTiers } from '../hooks/useBillingTiers'
import { SELECTABLE_TIMEZONES, DEFAULT_TIMEZONE } from '../lib/timezones'
import { roleLabel } from '../lib/roleLabels'
import { verifyPassword } from '../lib/verifyPassword'
import { invokeCallerId, formatUsPhone } from '../lib/callerId'
import { MONO, DISPLAY } from '../lib/exportStyles'
import { Switch } from '../components/ui/Switch'
import { Avatar } from '../components/ui/Avatar'
import {
  SettingsNav, SettingsCard, SettingsChip, CodeBoxes, StrengthBar, OvField,
} from '../components/agent/AgentUI'
import { ProfilePanel } from './Profile'
import { TextFollowUpPanel } from '../components/settings/TextFollowUpPanel'
import { FulfillmentPayAdminPanel } from '../components/fulfillment/GettingPaid'

// Settings — Prompt 720 rethink on the v16 language (P714–P719). Eight tabs
// became four sections plus one admin-only, picked from a side menu beside
// an account card (desktop) or a drill-in list (phone):
//   Profile · Sign-in & security · Preferences · Client contact · Team tools
// The hash is the only source of truth for the open section, so deep links,
// the browser's back button (phone list ↔ section) and old links all work.
// Old hashes map onto the new sections; #billing still goes to Billing
// (Prompt 691) and /profile still lands on Profile (App.jsx).
//
// Usernames are gone (sign-in is by email). Email changes only happen in
// Sign-in & security, through Supabase auth, and migration 129 copies a
// confirmed change onto profiles.email. Two-step verification is Supabase
// TOTP MFA; useAuth exposes `mfaRequired` and Login shows the code step.
//
// Earlier history (tab rail → segmented bar, Profile folded in, Billing moved
// out, Notifications/Payouts removed) is in git; P669/P674/P691.

const SECTIONS = [
  { key: 'profile',     label: 'Profile',            sub: 'Photo, name and phone',        icon: User,              lede: 'How you show up across the portal.' },
  { key: 'security',    label: 'Sign-in & security', sub: 'Email, password, two-step',    icon: ShieldCheck,       lede: 'Keep your account yours.' },
  { key: 'preferences', label: 'Preferences',        sub: 'Theme and time zone',          icon: SlidersHorizontal, lede: 'How the portal looks and keeps time for you.' },
  { key: 'contact',     label: 'Client contact',     sub: 'Caller ID and text follow-up', icon: PhoneForwarded,    lede: 'How Fulfillment reaches your clients for you.', roles: ['agent', 'admin'] },
  { key: 'team',        label: 'Team tools',         sub: 'Live Room and Fulfillment pay', icon: Wrench,           lede: 'Company-wide settings only admins can change.', roles: ['admin'] },
]

// Old tab hashes → new sections.
const ALIASES = {
  regional: 'preferences', appearance: 'preferences',
  callerid: 'contact', textfollowup: 'contact',
  integrations: 'team', pay: 'team',
}

function useMedia(query) {
  return useSyncExternalStore(
    cb => {
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
  )
}

const H1 = { margin: 0, fontFamily: DISPLAY, fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--ov-hi)' }
const errText = { margin: 0, fontSize: 13.5, color: 'var(--danger)' }
const box = { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 14, minWidth: 0 }

function Spin({ on, children }) {
  return on ? <Loader2 size={15} className="animate-spin" /> : children
}

function Done({ children }) {
  return (
    <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, color: 'var(--ov-st-cancelled)' }}>
      <Check size={15} strokeWidth={2.4} /> {children}
    </span>
  )
}

export default function Settings() {
  const { profile, signOut } = useAuth()
  const { hash } = useLocation()
  const navigate = useNavigate()
  const phone = useMedia('(max-width: 767.98px)')

  const raw = hash.slice(1)
  const sections = profile ? SECTIONS.filter(s => !s.roles || s.roles.includes(profile.role)) : []
  const wanted = ALIASES[raw] || raw
  const valid = sections.some(s => s.key === wanted)
  // #integrations / #pay for a non-admin: Profile, not a missing section.
  const key = valid ? wanted : (ALIASES[raw] ? 'profile' : null)

  // Rewrite an old hash to the new one, so the URL says where you are.
  useEffect(() => {
    if (profile && key && raw !== key && raw !== 'billing') navigate({ hash: `#${key}` }, { replace: true })
  }, [profile, key, raw, navigate])

  if (!profile) return null
  // Prompt 691 — Billing moved to its own page; old /settings#billing links
  // (and Stripe return URLs from before the move) land there.
  if (raw === 'billing') return <Navigate to="/agent/billing" replace />

  const pick = k => navigate({ hash: `#${k}` }, { replace: !phone })

  // Phone without a section: account card, the list, Sign out.
  if (phone && !key) {
    return (
      <div className="ov-set">
        <AccountCard profile={profile} />
        <SettingsNav items={sections} onPick={pick} phone />
        <button type="button" className="ov-ghost ov-set-btn" style={{ height: 50, fontSize: 15 }}
          onClick={async () => { await signOut(); navigate('/login') }}>
          <LogOut size={17} strokeWidth={2} /> Sign out
        </button>
      </div>
    )
  }

  const open = key || 'profile'
  const section = sections.find(s => s.key === open)
  return (
    <div className="ov-set">
      {!phone && (
        <aside className="ov-set-side">
          <AccountCard profile={profile} />
          <SettingsNav items={sections} active={open} onPick={pick} />
        </aside>
      )}
      <div className="ov-set-main">
        <div style={{ padding: '4px 4px 2px', display: 'flex', alignItems: 'center', gap: 12 }}>
          {phone && (
            <button type="button" aria-label="All settings" className="ov-ghost"
              onClick={() => navigate('/settings')}
              style={{ width: 40, height: 40, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <ArrowLeft size={17} strokeWidth={2} />
            </button>
          )}
          <div style={{ minWidth: 0 }}>
            <h1 style={{ ...H1, fontSize: phone ? 24 : 28 }}>{section.label}</h1>
            <p style={{ margin: '4px 0 0', fontSize: 14.5, color: 'var(--ov-mute)' }}>{section.lede}</p>
          </div>
        </div>
        {open === 'profile'     && <ProfilePanel profile={profile} onEmail={() => pick('security')} />}
        {open === 'security'    && <SecuritySection profile={profile} />}
        {open === 'preferences' && <PreferencesSection profile={profile} />}
        {open === 'contact'     && <><CallerIdPanel profile={profile} /><TextFollowUpPanel profile={profile} /></>}
        {open === 'team'        && <><LiveRoomCard /><FulfillmentPayAdminPanel /></>}
      </div>
    </div>
  )
}

// ── Account card ────────────────────────────────────────────────────────────
// "<Role> · <plan>" — the plan only for a billed agent with a plan running
// (same tiers the Billing page reads); exempt or no plan shows just the role.
function AccountCard({ profile }) {
  const { session } = useAuth()
  const { data: tiers = [] } = useBillingTiers()
  const status = profile.billing_status
  const running = status === 'active' || status === 'past_due'
    || (status === 'canceled' && profile.billing_current_period_end && new Date(profile.billing_current_period_end) > new Date())
  const plan = profile.role === 'agent' && !profile.billing_exempt && running
    ? tiers.find(t => t.key === profile.billing_tier)?.name : null

  return (
    <div className="ov-hero" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, padding: '24px 18px 20px', borderRadius: 20, minWidth: 0 }}>
      <Avatar profile={profile} size={64} style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, boxShadow: '0 0 0 4px rgba(255,255,255,0.18)' }} />
      <div style={{ minWidth: 0, maxWidth: '100%' }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 600, color: '#FFFFFF', overflowWrap: 'anywhere' }}>{profile.full_name}</div>
        <div style={{ marginTop: 2, fontSize: 13, color: 'var(--ov-hero-soft)', overflowWrap: 'anywhere' }}>{session?.user?.email}</div>
      </div>
      <span className="ov-hero-chip" style={{ height: 26, padding: '0 11px', fontSize: 12 }}>
        {roleLabel(profile.role)}{plan ? ` · ${plan}` : ''}
      </span>
    </div>
  )
}

// ── Sign-in & security ──────────────────────────────────────────────────────
function SecuritySection({ profile }) {
  return (
    <>
      <EmailCard profile={profile} />
      <PasswordCard />
      <TwoStepCard />
      <DevicesCard />
    </>
  )
}

const LEGACY_DOMAIN = '@ohvara.internal'

function EmailCard({ profile }) {
  const { session } = useAuth()
  const user = session.user
  const legacy = user.email?.endsWith(LEGACY_DOMAIN)
  const [editing, setEditing] = useState(false)
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState(user.new_email || null)

  async function save() {
    setError('')
    const email = next.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Enter a valid email address')
    if (email === user.email) return setError("That's already your sign-in email")
    setBusy(true)
    const { error: e } = await supabase.auth.updateUser({ email }, { emailRedirectTo: `${window.location.origin}/settings#security` })
    setBusy(false)
    if (e) return setError(/already/i.test(e.message) ? 'Another account already uses that email.' : e.message || 'Could not change the email, try again')
    setSentTo(email); setEditing(false); setNext('')
  }

  return (
    <SettingsCard icon={Mail} title="Sign-in email" sub="You sign in to the portal with this email."
      right={!editing && (
        <button type="button" className="ov-ghost ov-set-btn" onClick={() => { setEditing(true); setError('') }}>Change email</button>
      )}>
      <div className="ov-box" style={{ ...box, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ov-hi)', overflowWrap: 'anywhere', minWidth: 0 }}>{user.email}</span>
        {legacy
          ? <span style={{ fontSize: 13, color: 'var(--ov-mute)' }}>Signs in with username <span style={{ fontFamily: MONO, color: 'var(--ov-soft)' }}>{profile.username}</span></span>
          : user.email_confirmed_at && <SettingsChip tone="on">Verified</SettingsChip>}
      </div>
      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="ov-set-2">
            <OvField label="New email" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com"
              value={next} onChange={e => setNext(e.target.value)} autoFocus error={!!error}
              onKeyDown={e => { if (e.key === 'Enter') save() }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="ov-buy ov-set-btn" onClick={save} disabled={busy || !next.trim()}><Spin on={busy}>Save</Spin></button>
              <button type="button" className="ov-ghost ov-set-btn" onClick={() => { setEditing(false); setNext(''); setError('') }}>Cancel</button>
            </div>
          </div>
          {error && <p style={errText}>{error}</p>}
        </div>
      )}
      {sentTo && !editing && (
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ov-soft)' }}>
          Check <span style={{ fontWeight: 600, color: 'var(--ov-hi)' }}>{sentTo}</span> to confirm the change.
        </p>
      )}
    </SettingsCard>
  )
}

// Password, in two steps: the current one alone, then New + Confirm side by
// side once it checks out. The check runs on a throwaway client
// (lib/verifyPassword) so the live session, possibly aal2, is never replaced.
function PasswordCard() {
  const { session } = useAuth()
  const [step, setStep] = useState('current')
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState({ next: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function check() {
    setError(''); setDone(false)
    if (!current) return setError('Enter your current password')
    setBusy(true)
    const ok = await verifyPassword(session.user.email, current).catch(() => false)
    setBusy(false)
    if (!ok) return setError("That's not your current password.")
    setCurrent(''); setStep('new')
  }

  async function update() {
    setError('')
    if (pw.next.length < 8) return setError('New password must be at least 8 characters')
    if (pw.next !== pw.confirm) return setError('New passwords do not match')
    setBusy(true)
    const { error: e } = await supabase.auth.updateUser({ password: pw.next })
    setBusy(false)
    if (e) return setError(e.message || 'Could not update the password, try again')
    setPw({ next: '', confirm: '' }); setStep('current'); setDone(true)
  }

  function back() { setStep('current'); setPw({ next: '', confirm: '' }); setError('') }

  return (
    <SettingsCard icon={KeyRound} title="Password" sub="First confirm your current password, then choose a new one.">
      {step === 'current' ? (
        <>
          <div className="ov-set-2">
            <OvField label="Current password" type="password" autoComplete="current-password" value={current}
              onChange={e => setCurrent(e.target.value)} error={!!error}
              onKeyDown={e => { if (e.key === 'Enter') check() }} />
            <div>
              <button type="button" className="ov-buy ov-set-btn" onClick={check} disabled={busy}>
                <Spin on={busy}><ArrowRight size={15} strokeWidth={2.2} /> Continue</Spin>
              </button>
            </div>
          </div>
          {error && <p style={errText}>{error}</p>}
          {done ? <Done>Password updated. Use it next time you sign in.</Done> : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--ov-faint)' }}>
              <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: '50%', border: '2px dashed var(--ov-faint)', boxSizing: 'border-box' }} />
              New password and confirm unlock once your current password checks out
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, background: 'var(--ov-st-cancelled-tint)' }}>
            <span style={{ width: 24, height: 24, flexShrink: 0, borderRadius: '50%', background: 'var(--ov-st-cancelled)', color: 'var(--ov-on-kind)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Check size={14} strokeWidth={3} />
            </span>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--ov-hi)' }}>Current password confirmed</span>
            <button type="button" className="ov-set-link" onClick={back}>Change</button>
          </div>
          <div className="ov-set-2">
            <OvField label="New password" type="password" autoComplete="new-password" placeholder="8+ characters" autoFocus
              value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} />
            <OvField label="Confirm new password" type="password" autoComplete="new-password" placeholder="Type it again"
              value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))}
              error={!!pw.confirm && pw.confirm !== pw.next.slice(0, pw.confirm.length)}
              onKeyDown={e => { if (e.key === 'Enter') update() }} />
          </div>
          <StrengthBar password={pw.next} />
          {error && <p style={errText}>{error}</p>}
          <div>
            <button type="button" className="ov-buy ov-set-btn" onClick={update} disabled={busy || !pw.next || !pw.confirm}>
              <Spin on={busy}>Update password</Spin>
            </button>
          </div>
        </>
      )}
    </SettingsCard>
  )
}

// Two-step verification (Supabase TOTP). Off → Set up window; On → the
// factor row with Turn off (asks for a current code first).
function TwoStepCard() {
  const { refreshSession } = useAuth()
  const [factor, setFactor] = useState(undefined) // undefined loading, null none
  const [loadError, setLoadError] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [turningOff, setTurningOff] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const apply = useCallback(({ data, error: e }) => {
    setLoadError(!!e)
    setFactor(e ? null : data.totp.find(f => f.status === 'verified') || null)
  }, [])
  const load = useCallback(() => supabase.auth.mfa.listFactors().then(apply), [apply])
  useEffect(() => { supabase.auth.mfa.listFactors().then(apply) }, [apply])

  async function turnOff(c = code) {
    if (c.length !== 6) return
    setError(''); setBusy(true)
    const { error: ve } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: c })
    if (ve) { setBusy(false); setCode(''); return setError("That code didn't work. Codes change every 30 seconds.") }
    const { error: ue } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
    if (ue) { setBusy(false); return setError(ue.message || 'Could not turn two-step off, try again') }
    await refreshSession()
    await load()
    setBusy(false); setTurningOff(false); setCode(''); setDone('Two-step is off.')
  }

  const on = !!factor
  return (
    <SettingsCard icon={Smartphone} title="Two-step verification"
      sub={on
        ? 'After your password, the portal asks for a 6-digit code from your authenticator app.'
        : "After your password, enter a 6-digit code from an authenticator app on your phone. Someone with your password still can't get in."}
      right={factor !== undefined && <SettingsChip tone={on ? 'on' : 'off'}>{on ? 'On' : 'Off'}</SettingsChip>}>
      {factor === undefined ? (
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ov-mute)' }}>Checking…</p>
      ) : on ? (
        <div className="ov-box" style={{ ...box, flexDirection: 'column', alignItems: 'stretch', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 10, background: 'var(--ov-st-cancelled-tint)', color: 'var(--ov-st-cancelled)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldCheck size={18} strokeWidth={2} />
            </span>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>Authenticator app</div>
              <div style={{ fontSize: 13, color: 'var(--ov-mute)' }}>
                Added {new Date(factor.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
            {!turningOff && <button type="button" className="ov-set-off" onClick={() => { setTurningOff(true); setError(''); setDone('') }}>Turn off</button>}
          </div>
          {turningOff && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 14, borderTop: '1px solid var(--ov-line)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ov-hi)' }}>Enter a code from your app to turn two-step off</div>
              <CodeBoxes value={code} onChange={setCode} onComplete={turnOff} autoFocus disabled={busy} invalid={!!error} height={52} />
              {error && <p style={errText}>{error}</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="ov-buy ov-set-btn" onClick={() => turnOff()} disabled={busy || code.length !== 6}>
                  <Spin on={busy}>Turn off two-step</Spin>
                </button>
                <button type="button" className="ov-ghost ov-set-btn" onClick={() => { setTurningOff(false); setCode(''); setError('') }}>Keep it on</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="ov-box" style={{ ...box, gap: 14, flexWrap: 'wrap', padding: '16px 18px' }}>
          <div style={{ flex: 1, minWidth: 220, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ov-soft)' }}>
            Works with Google Authenticator, Microsoft Authenticator, 1Password, Authy and others. Takes about a minute.
          </div>
          <button type="button" className="ov-buy ov-set-btn" onClick={() => { setSetupOpen(true); setDone('') }} disabled={loadError}>
            <ShieldCheck size={15} strokeWidth={2.2} /> Set up two-step
          </button>
        </div>
      )}
      {loadError && <p style={errText}>Couldn't check two-step for this account. Reload to try again.</p>}
      {done && <Done>{done}</Done>}
      {setupOpen && (
        <SetupWindow
          onClose={() => setSetupOpen(false)}
          onDone={async () => { setSetupOpen(false); await refreshSession(); await load(); setDone('Two-step is on. You’ll be asked for a code next time you sign in.') }}
        />
      )}
    </SettingsCard>
  )
}

// The "Set up two-step" window. Enrolls a fresh TOTP factor on open (after
// clearing any abandoned unverified ones); closing before the code checks out
// removes it again. The QR code and key live only in this component's state.
function SetupWindow({ onClose, onDone }) {
  const [enrolled, setEnrolled] = useState(null) // { id, qr, secret }
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const factorId = useRef(null)
  const verified = useRef(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return // StrictMode runs effects twice; enroll once
    started.current = true
    ;(async () => {
      const { data: list } = await supabase.auth.mfa.listFactors()
      for (const f of (list?.all || []).filter(f => f.factor_type === 'totp' && f.status !== 'verified')) {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' })
      if (e) return setError(/disabled|not enabled/i.test(e.message)
        ? "Two-step isn't switched on for Ohvara yet. Ask an admin."
        : e.message || 'Could not start setup, try again')
      factorId.current = data.id
      setEnrolled({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    })()
  }, [])

  const close = useCallback(() => {
    if (factorId.current && !verified.current) supabase.auth.mfa.unenroll({ factorId: factorId.current })
    onClose()
  }, [onClose])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [close])

  async function verify(c = code) {
    if (!enrolled || c.length !== 6) return
    setError(''); setBusy(true)
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolled.id, code: c })
    setBusy(false)
    if (e) { setCode(''); return setError("That code didn't work. Codes change every 30 seconds.") }
    verified.current = true
    onDone()
  }

  async function copy() {
    try { await navigator.clipboard.writeText(enrolled.secret); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* key is on screen */ }
  }

  const grouped = enrolled?.secret.match(/.{1,4}/g)?.join(' ')
  const stepLabel = { fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }
  return createPortal(
    <>
      <div className="ov-scrim" onClick={close} aria-hidden="true" />
      <div className="ov-modal-wrap" onClick={e => { if (e.target === e.currentTarget) close() }}>
        <div className="ov-card ov-modal" role="dialog" aria-modal="true" aria-labelledby="two-step-title">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={stepLabel}>Step 1 of 2</div>
              <h2 id="two-step-title" style={{ margin: '2px 0 0', fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, color: 'var(--ov-hi)' }}>Scan with your authenticator app</h2>
            </div>
            <button type="button" onClick={close} aria-label="Close" className="ov-ghost"
              style={{ width: 40, height: 40, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <X size={16} strokeWidth={2} />
            </button>
          </div>

          <div className="ov-qr-row" style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <div className="ov-qr" style={{ width: 194, height: 194, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {enrolled ? <img src={enrolled.qr} alt="QR code for your authenticator app" /> : <Loader2 size={22} className="animate-spin" style={{ color: '#5E7195' }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ov-soft)' }}>
                Open your authenticator app, tap add, and scan this code. Can't scan? Type this key instead:
              </div>
              <div className="ov-box" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 12 }}>
                <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 13, color: 'var(--ov-hi)', overflowWrap: 'anywhere' }}>{grouped || '…'}</span>
                <button type="button" onClick={copy} disabled={!enrolled} aria-label="Copy key" className="ov-set-link" style={{ display: 'flex' }}>
                  {copied ? <Check size={16} strokeWidth={2.4} style={{ color: 'var(--ov-st-cancelled)' }} /> : <Copy size={16} strokeWidth={2} />}
                </button>
              </div>
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--ov-line)' }} />
          <div>
            <div style={stepLabel}>Step 2 of 2</div>
            <div style={{ marginTop: 2, fontSize: 15, fontWeight: 600, color: 'var(--ov-hi)' }}>Enter the 6-digit code it shows</div>
          </div>
          <CodeBoxes value={code} onChange={setCode} onComplete={verify} disabled={!enrolled || busy} invalid={!!error} />
          {error && <p style={errText}>{error}</p>}
          <button type="button" className="ov-buy ov-set-btn" style={{ height: 50, fontSize: 15 }} onClick={() => verify()} disabled={!enrolled || busy || code.length !== 6}>
            <Spin on={busy}>Turn on two-step</Spin>
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}

function DevicesCard() {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function go() {
    setBusy(true); setError(''); setDone(false)
    const { error: e } = await supabase.auth.signOut({ scope: 'others' })
    setBusy(false)
    if (e) return setError(e.message || 'Could not sign out other devices, try again')
    setDone(true)
  }

  return (
    <SettingsCard icon={LogOut} title="Other devices" sub="Signed in on a phone or computer you no longer use? Sign it out from here."
      right={<button type="button" className="ov-ghost ov-set-btn" onClick={go} disabled={busy}><Spin on={busy}>Sign out everywhere else</Spin></button>}>
      {done && <Done>Done, other devices are signed out</Done>}
      {error && <p style={errText}>{error}</p>}
    </SettingsCard>
  )
}

// ── Preferences ─────────────────────────────────────────────────────────────
function PreferencesSection({ profile }) {
  return (
    <>
      <ThemeCard />
      <TimeZoneCard profile={profile} />
    </>
  )
}

// Literal previews of each theme (they can't read var(): they show the theme
// that may not be active).
const PREVIEW = {
  dark:  { page: '#07080D', side: '#152748', hero: '#16294C', card: '#161922', edge: 'rgba(255,255,255,0.08)' },
  light: { page: '#EEF2F3', side: '#009581', hero: '#00917D', card: '#FFFFFF', edge: 'rgba(2,79,70,0.12)' },
}

function ThemeCard() {
  const [theme, setTheme] = useTheme()
  return (
    <SettingsCard icon={Sun} title="Theme" sub="Applies instantly and is remembered on this device.">
      <div role="radiogroup" aria-label="Theme" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {['dark', 'light'].map(mode => {
          const on = theme === mode
          const c = PREVIEW[mode]
          const Icon = mode === 'dark' ? Moon : Sun
          return (
            <button key={mode} type="button" role="radio" aria-checked={on} onClick={() => setTheme(mode)}
              className="ov-set-item"
              style={{
                flex: '1 1 200px', flexDirection: 'column', alignItems: 'stretch', gap: 0, padding: 0, borderRadius: 16, overflow: 'hidden',
                boxShadow: `inset 0 0 0 2px ${on ? 'var(--ov-st-booked)' : 'var(--ov-line)'}`,
              }}>
              <span style={{ height: 110, background: c.page, padding: 14, display: 'flex', gap: 8, boxSizing: 'border-box' }}>
                <span style={{ width: '26%', borderRadius: 8, background: c.side }} />
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ height: 30, borderRadius: 8, background: c.hero }} />
                  <span style={{ flex: 1, borderRadius: 8, background: c.card, border: `1px solid ${c.edge}` }} />
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px' }}>
                <Icon size={16} strokeWidth={2} style={{ color: 'var(--ov-mid)' }} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--ov-hi)' }}>{mode === 'dark' ? 'Dark' : 'Light'}</span>
                {on && (
                  <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--ov-st-booked)', color: 'var(--ov-on-kind)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Check size={13} strokeWidth={3} />
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </SettingsCard>
  )
}

function TimeZoneCard({ profile }) {
  const update = useUpdateOwnProfile()
  const { refreshProfile } = useAuth()
  const [timezone, setTimezone] = useState(profile.timezone || DEFAULT_TIMEZONE)
  const [saved, setSaved] = useState(false)
  const [weekendPending, setWeekendPending] = useState(false)
  const dirty = timezone !== (profile.timezone || DEFAULT_TIMEZONE)

  async function save() {
    // timezone_confirmed_at marks that this was set deliberately — the column
    // defaults every row to America/Chicago, with no other way to tell
    // "genuinely Central" from "never opened Settings" (Prompt 283).
    await update.mutateAsync({ profileId: profile.id, updates: { timezone, timezone_confirmed_at: new Date().toISOString() } })
    await refreshProfile()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function toggleWeekendLeads(next) {
    setWeekendPending(true)
    await update.mutateAsync({ profileId: profile.id, updates: { weekend_leads_enabled: next } })
    await refreshProfile()
    setWeekendPending(false)
  }

  return (
    <SettingsCard icon={Globe} title="Time zone" sub="Call times, reminders and Activity show in this zone.">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 14, alignItems: 'end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mid)' }}>Your time zone</span>
          <span className="ov-input">
            <Globe size={17} strokeWidth={1.9} style={{ flexShrink: 0 }} />
            <select value={timezone} onChange={e => setTimezone(e.target.value)}
              style={{ flex: 1, minWidth: 0, height: '100%', border: 'none', outline: 'none', background: 'transparent', font: 'inherit', fontSize: 15, color: 'var(--ov-hi)', cursor: 'pointer' }}>
              {SELECTABLE_TIMEZONES.map(tz => <option key={tz.value} value={tz.value} style={{ color: '#111' }}>{tz.label} time</option>)}
            </select>
          </span>
        </label>
        <button type="button" className="ov-buy ov-set-btn" onClick={save} disabled={!dirty || update.isPending}>
          <Spin on={update.isPending && dirty}>{saved && !dirty ? <><Check size={15} strokeWidth={2.4} /> Saved</> : 'Save'}</Spin>
        </button>
      </div>
      <div style={{ fontSize: 13, color: 'var(--ov-mute)' }}>Amounts are in US dollars.</div>

      {profile.role === 'rep' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 16, borderTop: '1px solid var(--ov-line)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>Weekend leads</p>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--ov-mute)' }}>Off by default. Your batch pauses Saturday and Sunday.</p>
          </div>
          <Switch checked={!!profile.weekend_leads_enabled} onChange={toggleWeekendLeads} disabled={weekendPending} />
        </div>
      )}
    </SettingsCard>
  )
}

// ── Client contact: Caller ID (Prompt 666, migration 108) ───────────────────
// The agent verifies their own cell with Twilio once; after that, when
// Fulfillment calls one of their clients about a cancellation, the client sees
// the agent's number (one they already know) and Fulfillment says they're
// calling on the agent's behalf. Verification is Twilio's own: it calls the
// number and the agent keys in the code shown here, so nobody can borrow a
// number they don't hold. The switch is the agent's to flip any time.
// P720 restyle only: same RPCs, polling and state.
const POLL_MS = 4000
const POLL_LIMIT_MS = 3 * 60e3

function CallerIdPanel({ profile }) {
  const { refreshProfile } = useAuth()
  const update = useUpdateOwnProfile()
  const [configured, setConfigured] = useState(null)
  const [phone, setPhone] = useState(formatUsPhone(profile.phone) || '')
  const [changing, setChanging] = useState(false)
  const [pending, setPending] = useState(null)        // { code, phone, startedAt }
  const [timedOut, setTimedOut] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const pollRef = useRef(null)
  // refreshProfile isn't memoized in useAuth; read it through a ref so the
  // polling interval isn't torn down and rebuilt on every render.
  const refreshRef = useRef(refreshProfile)
  useEffect(() => { refreshRef.current = refreshProfile })

  const verified = !!(profile.caller_id_verified_at && profile.caller_id_number)
  const digits = phone.replace(/\D/g, '')

  useEffect(() => {
    invokeCallerId('agent-caller-id', { action: 'status' })
      .then(d => setConfigured(!!d.configured))
      .catch(() => setConfigured(false))
  }, [])

  useEffect(() => {
    if (!pending) return
    pollRef.current = setInterval(async () => {
      if (Date.now() - pending.startedAt > POLL_LIMIT_MS) {
        clearInterval(pollRef.current)
        setTimedOut(true)
        return
      }
      try {
        const d = await invokeCallerId('agent-caller-id', { action: 'check' })
        if (d.verified) {
          clearInterval(pollRef.current)
          await refreshRef.current()
          setPending(null)
          setChanging(false)
        }
      } catch { /* keep polling; one blip shouldn't end the flow */ }
    }, POLL_MS)
    return () => clearInterval(pollRef.current)
  }, [pending])

  async function start() {
    setError(''); setTimedOut(false); setBusy(true)
    try {
      const d = await invokeCallerId('agent-caller-id', { action: 'start', phone })
      setPending({ code: d.validation_code, phone: d.phone, startedAt: Date.now() })
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  function cancelPending() {
    clearInterval(pollRef.current)
    setPending(null); setTimedOut(false)
  }

  async function toggle(next) {
    await update.mutateAsync({ profileId: profile.id, updates: { caller_id_enabled: next } })
    await refreshProfile()
  }

  async function remove() {
    setError(''); setBusy(true)
    try {
      await invokeCallerId('agent-caller-id', { action: 'remove' })
      await refreshProfile()
      setConfirmRemove(false)
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  const on = verified && !!profile.caller_id_enabled
  return (
    <SettingsCard icon={PhoneCall} title="Caller ID"
      sub="When Fulfillment calls your clients, they see your number, one they already know. Fulfillment always says they're calling on your behalf."
      right={configured !== null && <SettingsChip tone={on ? 'on' : 'off'}>{on ? 'On' : 'Off'}</SettingsChip>}>

      {configured === false && !verified && (
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ov-mute)' }}>
          Calling isn't connected yet, so there's nothing to verify. This switches on once the phone account is set up.
        </p>
      )}

      {/* Verified: the number + the agent's kill switch */}
      {verified && !changing && !pending && (
        <>
          <div className="ov-box" style={{ ...box, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ov-hi)', fontFamily: MONO }}>{formatUsPhone(profile.caller_id_number)}</span>
            <SettingsChip tone="on">Verified</SettingsChip>
            <span style={{ flex: 1 }} />
            <button type="button" className="ov-set-link" onClick={() => { setChanging(true); setPhone('') }}>Change number</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>Show my number on Fulfillment's calls</p>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--ov-mute)' }}>
                {profile.caller_id_enabled
                  ? "On: Fulfillment's calls to your clients show this number"
                  : 'Off: Fulfillment calls from their own number'}
              </p>
            </div>
            <Switch checked={!!profile.caller_id_enabled} onChange={toggle} disabled={update.isPending} />
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {confirmRemove ? (
              <>
                <span style={{ fontSize: 13.5, color: 'var(--ov-soft)' }}>Remove this number?</span>
                <button type="button" onClick={remove} disabled={busy} className="ov-set-off" style={{ color: 'var(--danger)' }}>Remove</button>
                <button type="button" onClick={() => setConfirmRemove(false)} className="ov-set-link">Keep</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmRemove(true)} className="ov-set-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Trash2 size={13} /> Remove number
              </button>
            )}
          </div>
        </>
      )}

      {/* Not verified yet, or changing: enter a number */}
      {configured && (!verified || changing) && !pending && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="ov-set-2">
            <OvField label="Your cell number" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(602) 555-0143" inputMode="tel" />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="ov-buy ov-set-btn" onClick={start} disabled={busy || digits.length < 10}>
                <Spin on={busy}>Verify number</Spin>
              </button>
              {changing && <button type="button" className="ov-ghost ov-set-btn" onClick={() => setChanging(false)}>Cancel</button>}
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ov-mute)' }}>We'll call this number once. Keep your phone handy.</p>
        </div>
      )}

      {/* Mid-verification: the code Twilio's call will ask for */}
      {pending && (
        <div style={{ padding: '16px 18px', borderRadius: 14, background: 'var(--ov-st-booked-tint)', boxShadow: 'inset 0 0 0 1px var(--ov-st-booked-edge)' }}>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ov-soft)' }}>
            Calling <span style={{ fontFamily: MONO }}>{formatUsPhone(pending.phone)}</span> now. Answer, and when asked, key in:
          </p>
          <p style={{ margin: '10px 0', fontSize: 30, fontWeight: 600, letterSpacing: 6, color: 'var(--ov-hi)', fontFamily: MONO }}>
            {pending.code}
          </p>
          {timedOut ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, color: 'var(--ov-st-needs)' }}>Didn't hear back from that call.</span>
              <button type="button" onClick={start} disabled={busy} className="ov-ghost ov-set-btn" style={{ height: 40 }}>Call me again</button>
              <button type="button" onClick={cancelPending} className="ov-set-link">Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Loader2 size={14} className="animate-spin" style={{ color: 'var(--ov-st-booked)', flexShrink: 0 }} />
              <span style={{ fontSize: 13.5, color: 'var(--ov-soft)', flex: 1 }}>Waiting for you to enter the code…</span>
              <button type="button" onClick={cancelPending} className="ov-set-link">Cancel</button>
            </div>
          )}
        </div>
      )}

      {error && <p style={errText}>{error}</p>}
    </SettingsCard>
  )
}

// ── Team tools: Live Room (Prompt 392/393, migration 091/097) ───────────────
// Daily.co's room URL is what the Team → Meetings Live Room joins. No API key
// lives here or anywhere client-side; a Daily room only needs its URL. One
// company-wide link, so this whole section is admin-only.
function LiveRoomCard() {
  const { data: settings } = useAppSettings()
  const updateSettings = useUpdateAppSettings()
  const [url, setUrl] = useState('')
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  const connected = !!settings?.daily_room_url

  async function save() {
    await updateSettings.mutateAsync({ daily_room_url: url.trim() || null })
    setEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <SettingsCard icon={Video} title="Live Room" sub="The Daily.co room behind the always-open Live Room on Team → Meetings."
      right={<SettingsChip tone={connected ? 'on' : 'off'}>{connected ? 'Connected' : 'Not connected'}</SettingsChip>}>
      {!editing ? (
        <div className="ov-box" style={{ ...box, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontFamily: MONO, color: connected ? 'var(--ov-hi)' : 'var(--ov-mute)', overflowWrap: 'anywhere' }}>
            {settings?.daily_room_url || 'No room link yet'}
          </span>
          {saved && <Done>Saved</Done>}
          <button type="button" className="ov-set-link is-blue" onClick={() => { setUrl(settings?.daily_room_url || ''); setEditing(true) }}>
            {connected ? 'Update room link' : 'Set room link'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <OvField label="Daily.co room URL" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://your-team.daily.co/live-room" autoFocus />
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ov-mute)' }}>Create a free room at daily.co (Rooms → Create room) and paste its URL here.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="ov-buy ov-set-btn" onClick={save} disabled={updateSettings.isPending}><Spin on={updateSettings.isPending}>Save</Spin></button>
            <button type="button" className="ov-ghost ov-set-btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </SettingsCard>
  )
}
