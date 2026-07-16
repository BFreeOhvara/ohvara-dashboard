import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { Loader2, Check, X, Lock, KeyRound } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useUpdateOwnProfile } from '../hooks/useSettings'
import { SELECTABLE_TIMEZONES, DEFAULT_TIMEZONE } from '../lib/timezones'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Input'
import { Button } from '../components/ui/Button'

// Settings (Prompt 226) — Regional (self-service timezone, the whole reason
// this page exists — drives assign_daily_batches()'s per-rep local-midnight
// gate), Account, Payouts (rep/closer only — a pointer to the existing
// Stripe Connect flow, not a new form).

const ROLE_HOME = { rep: '/rep', closer: '/closer', admin: '/admin', client: '/client' }

function SavedTick({ show }) {
  if (!show) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--success)' }}>
      <Check size={13} /> Saved
    </span>
  )
}

// Stacks on mobile so the control (a button, often multi-word) never has to
// squeeze into a shrunk flex slot next to the label and text-wrap (Prompt 295).
function SectionRow({ label, description, control }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4" style={{ padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0 }}>{label}</p>
        {description && <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>{description}</p>}
      </div>
      {control}
    </div>
  )
}

function RegionalSection({ profile }) {
  const update = useUpdateOwnProfile()
  const { refreshProfile } = useAuth()
  const [timezone, setTimezone] = useState(profile.timezone || DEFAULT_TIMEZONE)
  const [saved, setSaved] = useState(false)

  const dirty = timezone !== (profile.timezone || DEFAULT_TIMEZONE)

  async function save() {
    // timezone_confirmed_at (Prompt 283) marks that the rep has explicitly
    // set this themselves — profiles.timezone defaults every row to
    // 'America/Chicago' with no way otherwise to tell "genuinely Central"
    // from "never touched Settings". MyLeads' header prompt reads this.
    await update.mutateAsync({ profileId: profile.id, updates: { timezone, timezone_confirmed_at: new Date().toISOString() } })
    await refreshProfile()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card className="mb-5" id="regional">
      <CardHeader>
        <CardTitle>Regional</CardTitle>
      </CardHeader>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8, marginBottom: 14 }}>
        Sets your timezone explicitly — not inferred from your browser or device. This is what your
        daily lead reset and appointment times are based on, so get it right once and it stays locked in.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
        <Select label="Timezone" value={timezone} onChange={e => setTimezone(e.target.value)}>
          {SELECTABLE_TIMEZONES.map(tz => (
            <option key={tz.value} value={tz.value}>{tz.label}</option>
          ))}
        </Select>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={!dirty || update.isPending}>
            {update.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
          </Button>
          <SavedTick show={saved && !dirty} />
        </div>
      </div>
    </Card>
  )
}

// Self-service password change (Prompt 281) — one modal: verify the current
// password (signInWithPassword against the session's own email, same step-up
// as the payout gate), then updateUser({ password }). Matters most for
// invite-flow accounts: admin doesn't know their password and email resets
// stay dead until Resend is configured. Portaled per the Prompt 185 gotcha.
function ChangePasswordModal({ onClose }) {
  const { session } = useAuth()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [error, setError]   = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone]     = useState(false)

  async function handleSave() {
    setError('')
    if (!form.current) return setError('Enter your current password')
    if (form.next.length < 8) return setError('New password must be at least 8 characters')
    if (form.next !== form.confirm) return setError('New passwords do not match')
    setSaving(true)
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password: form.current,
    })
    if (authError) {
      setError('Current password is incorrect.')
      setSaving(false)
      return
    }
    const { error: updError } = await supabase.auth.updateUser({ password: form.next })
    if (updError) {
      setError(updError.message || 'Could not update the password — try again')
      setSaving(false)
      return
    }
    setDone(true)
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div className="glass-accent" style={{ position: 'relative', width: '100%', maxWidth: 360, padding: 24, borderRadius: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <KeyRound size={16} color="var(--accent)" />
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>Change password</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0', lineHeight: 1.5 }}>
              {done ? 'All set.' : 'Confirm your current password, then pick a new one.'}
            </p>
          </div>
        </div>
        {done ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs bg-[#22C55E]/8 border border-[#22C55E]/20 rounded-lg px-3 py-2.5">
              <Check size={13} className="text-[var(--success)] flex-shrink-0" />
              <span style={{ color: 'var(--success)' }}>Password updated — use it next time you sign in.</span>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4" onKeyDown={e => { if (e.key === 'Enter') handleSave() }}>
            <Input
              label="Current Password"
              type="password"
              value={form.current}
              onChange={e => setForm(f => ({ ...f, current: e.target.value }))}
              placeholder="••••••••"
              autoFocus
              autoComplete="current-password"
            />
            <Input
              label="New Password"
              type="password"
              value={form.next}
              onChange={e => setForm(f => ({ ...f, next: e.target.value }))}
              placeholder="Min 8 characters"
              autoComplete="new-password"
            />
            <Input
              label="Confirm New Password"
              type="password"
              value={form.confirm}
              onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
              placeholder="••••••••"
              autoComplete="new-password"
            />
            {error && (
              <div className="flex items-start gap-2.5 text-xs bg-[#EF4444]/8 border border-[#EF4444]/20 rounded-lg px-3 py-2.5">
                <span className="text-[#EF4444] leading-relaxed">{error}</span>
              </div>
            )}
            <div className="flex items-center gap-2 justify-end">
              <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : 'Update Password'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

function AccountSection({ profile }) {
  const update = useUpdateOwnProfile()
  const { refreshProfile } = useAuth()
  const [form, setForm] = useState({
    full_name: profile.full_name || '',
    username: profile.username || '',
    email: profile.email || '',
  })
  const [saved, setSaved] = useState(false)
  const [changingPw, setChangingPw] = useState(false)

  const dirty = form.full_name !== (profile.full_name || '') || form.username !== (profile.username || '') || form.email !== (profile.email || '')

  async function save() {
    await update.mutateAsync({ profileId: profile.id, updates: form })
    await refreshProfile()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>Account</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Full Name" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
        <Input label="Username" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
        <Input label="Email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        <div className="flex items-end gap-2">
          <Button size="sm" onClick={save} disabled={!dirty || update.isPending}>
            {update.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
          </Button>
          <SavedTick show={saved && !dirty} />
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <SectionRow
          label="Password"
          description="Change the password you sign in with."
          control={
            <Button size="sm" variant="secondary" onClick={() => setChangingPw(true)}>
              <KeyRound size={13} />
              Change password
            </Button>
          }
        />
      </div>
      {changingPw && <ChangePasswordModal onClose={() => setChangingPw(false)} />}
    </Card>
  )
}

// Step-up auth before the payout flow (Prompt 280) — re-verifies the CURRENT
// password via signInWithPassword against the session's own email (works for
// both legacy synthetic-email and invite-flow real-email accounts; Supabase's
// reauthenticate() is email-nonce-based and useless until SMTP exists).
// Portaled to document.body — required for any fixed-position modal in this
// app (the .page-enter transform gotcha, see Prompt 185).
function PasswordConfirmModal({ onConfirm, onClose }) {
  const { session } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [checking, setChecking] = useState(false)

  async function handleConfirm() {
    setError('')
    if (!password) { setError('Enter your password'); return }
    setChecking(true)
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password,
    })
    if (authError) {
      setError('Incorrect password — try again.')
      setChecking(false)
      return
    }
    onConfirm()
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div className="glass-accent" style={{ position: 'relative', width: '100%', maxWidth: 360, padding: 24, borderRadius: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Lock size={16} color="var(--accent)" />
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>Confirm your password</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0', lineHeight: 1.5 }}>
              Payout settings are sensitive — re-enter your password to continue.
            </p>
          </div>
        </div>
        <div className="space-y-4" onKeyDown={e => { if (e.key === 'Enter') handleConfirm() }}>
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            autoFocus
            autoComplete="current-password"
          />
          {error && (
            <div className="flex items-start gap-2.5 text-xs bg-[#EF4444]/8 border border-[#EF4444]/20 rounded-lg px-3 py-2.5">
              <span className="text-[#EF4444] leading-relaxed">{error}</span>
            </div>
          )}
          <div className="flex items-center gap-2 justify-end">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleConfirm} disabled={checking}>
              {checking ? <Loader2 size={13} className="animate-spin" /> : 'Confirm'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function PayoutsSection({ profile }) {
  const navigate = useNavigate()
  const connected = !!profile.stripe_onboarding_complete
  const dest = profile.role === 'closer' ? '/closer/revenue' : '/rep/commissions'
  const [confirming, setConfirming] = useState(false)

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>Payouts</CardTitle>
      </CardHeader>
      <SectionRow
        label="Payout account"
        description={connected ? 'Connected via Stripe' : 'Not connected yet'}
        control={
          <div className="flex items-center gap-2">
            <span style={{
              fontSize: 11, fontWeight: 500, textTransform: 'uppercase', borderRadius: 4, padding: '3px 8px',
              color: connected ? 'var(--success)' : 'var(--warning)',
              background: connected ? 'var(--success-dim)' : 'var(--warning-dim)',
              border: connected ? '0.5px solid rgba(34,197,94,0.20)' : '0.5px solid rgba(245,158,11,0.20)',
            }}>
              {connected ? 'Connected' : 'Not Connected'}
            </span>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
              Manage payout account
            </Button>
          </div>
        }
      />
      {confirming && (
        <PasswordConfirmModal
          onConfirm={() => navigate(dest)}
          onClose={() => setConfirming(false)}
        />
      )}
    </Card>
  )
}

export default function Settings() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  if (!profile) return null

  const showPayouts = profile.role === 'rep' || profile.role === 'closer'

  // Deep-link support (MyLeads' "Select Time Zone and Settings" prompt,
  // Prompt 283) — client-side routing doesn't auto-scroll to a #hash the
  // way a full page load would.
  useEffect(() => {
    if (!location.hash) return
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [location.hash])

  function close() {
    if (location.key !== 'default') navigate(-1)
    else navigate(ROLE_HOME[profile.role] || '/', { replace: true })
  }

  return (
    <div>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            Settings
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            Manage your account and timezone
          </p>
        </div>
        <button
          onClick={close}
          title="Close"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 6, flexShrink: 0,
            color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer',
          }}
        >
          <X size={18} />
        </button>
      </div>

      <RegionalSection profile={profile} />
      <AccountSection profile={profile} />
      {showPayouts && <PayoutsSection profile={profile} />}
    </div>
  )
}
