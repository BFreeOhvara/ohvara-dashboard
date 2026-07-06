import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Check } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useUpdateOwnProfile, useChangeOwnPassword } from '../hooks/useSettings'
import { SELECTABLE_TIMEZONES, DEFAULT_TIMEZONE } from '../lib/timezones'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Input'
import { Button } from '../components/ui/Button'

// Settings (Prompt 226) — Regional (self-service timezone, the whole reason
// this page exists — drives assign_daily_batches()'s per-rep local-midnight
// gate), Account, Payouts (rep/closer only — a pointer to the existing
// Stripe Connect flow, not a new form), Notifications (rep/closer only —
// the categorized system genuinely has distinct types to toggle), Calling
// (rep/closer only, informational working hours — explicitly the
// first-to-cut section per the prompt).

function SavedTick({ show }) {
  if (!show) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--success)' }}>
      <Check size={13} /> Saved
    </span>
  )
}

function SectionRow({ label, description, control }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
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
    await update.mutateAsync({ profileId: profile.id, updates: { timezone } })
    await refreshProfile()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>Regional</CardTitle>
      </CardHeader>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8, marginBottom: 14 }}>
        Sets your timezone explicitly — not inferred from your browser or device. This is what your
        daily lead reset and appointment times are based on, so get it right once and it stays locked in.
      </p>
      <div className="grid grid-cols-2 gap-3 items-end">
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

function AccountSection({ profile }) {
  const update = useUpdateOwnProfile()
  const changePassword = useChangeOwnPassword()
  const { refreshProfile } = useAuth()
  const [form, setForm] = useState({
    full_name: profile.full_name || '',
    email: profile.email || '',
    phone: profile.phone || '',
  })
  const [saved, setSaved] = useState(false)
  const [pw, setPw] = useState({ next: '', confirm: '' })
  const [pwError, setPwError] = useState('')
  const [pwSaved, setPwSaved] = useState(false)

  const dirty = form.full_name !== (profile.full_name || '') || form.email !== (profile.email || '') || form.phone !== (profile.phone || '')

  async function save() {
    await update.mutateAsync({ profileId: profile.id, updates: form })
    await refreshProfile()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function savePassword() {
    setPwError('')
    if (pw.next.length < 8) return setPwError('Password must be at least 8 characters.')
    if (pw.next !== pw.confirm) return setPwError('Passwords do not match.')
    try {
      await changePassword.mutateAsync(pw.next)
      setPw({ next: '', confirm: '' })
      setPwSaved(true)
      setTimeout(() => setPwSaved(false), 2000)
    } catch (err) {
      setPwError(err.message || 'Failed to change password.')
    }
  }

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>Account</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Full Name" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
        <Input label="Email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        <Input label="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 555-5555" />
        <div className="flex items-end gap-2">
          <Button size="sm" onClick={save} disabled={!dirty || update.isPending}>
            {update.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
          </Button>
          <SavedTick show={saved && !dirty} />
        </div>
      </div>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '0.5px solid var(--border)' }}>
        <p className="section-label" style={{ marginBottom: 10 }}>Change Password</p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="New Password" type="password" autoComplete="new-password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} placeholder="Min 8 characters" />
          <Input label="Confirm Password" type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
          {pwError && <p style={{ fontSize: 12, color: 'var(--danger)', gridColumn: 'span 2' }}>{pwError}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={savePassword} disabled={!pw.next || !pw.confirm || changePassword.isPending}>
              {changePassword.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Update Password'}
            </Button>
            <SavedTick show={pwSaved} />
          </div>
        </div>
      </div>
    </Card>
  )
}

function PayoutsSection({ profile }) {
  const navigate = useNavigate()
  const connected = !!profile.stripe_onboarding_complete
  const dest = profile.role === 'closer' ? '/closer/revenue' : '/rep/commissions'

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
            <Button size="sm" variant="secondary" onClick={() => navigate(dest)}>
              Manage payout account
            </Button>
          </div>
        }
      />
    </Card>
  )
}

function CallingSection({ profile }) {
  const update = useUpdateOwnProfile()
  const { refreshProfile } = useAuth()
  const [form, setForm] = useState({
    working_hours_start: profile.working_hours_start || '',
    working_hours_end: profile.working_hours_end || '',
  })
  const [saved, setSaved] = useState(false)

  const dirty = form.working_hours_start !== (profile.working_hours_start || '') || form.working_hours_end !== (profile.working_hours_end || '')

  async function save() {
    await update.mutateAsync({
      profileId: profile.id,
      updates: {
        working_hours_start: form.working_hours_start || null,
        working_hours_end: form.working_hours_end || null,
      },
    })
    await refreshProfile()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>Calling</CardTitle>
      </CardHeader>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8, marginBottom: 14 }}>
        Informational only for now — nothing is gated on these hours yet.
      </p>
      <div className="grid grid-cols-2 gap-3 items-end">
        <Input label="Start" type="time" value={form.working_hours_start} onChange={e => setForm(f => ({ ...f, working_hours_start: e.target.value }))} />
        <Input label="End" type="time" value={form.working_hours_end} onChange={e => setForm(f => ({ ...f, working_hours_end: e.target.value }))} />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={save} disabled={!dirty || update.isPending}>
            {update.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
          </Button>
          <SavedTick show={saved && !dirty} />
        </div>
      </div>
    </Card>
  )
}

export default function Settings() {
  const { profile } = useAuth()
  if (!profile) return null

  const showPayouts = profile.role === 'rep' || profile.role === 'closer'
  const showCalling = profile.role === 'rep' || profile.role === 'closer'

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          Settings
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          Manage your account and timezone
        </p>
      </div>

      <RegionalSection profile={profile} />
      <AccountSection profile={profile} />
      {showPayouts && <PayoutsSection profile={profile} />}
      {showCalling && <CallingSection profile={profile} />}
    </div>
  )
}
