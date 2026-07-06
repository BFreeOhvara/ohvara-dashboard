import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Loader2, Check, X } from 'lucide-react'
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
  const { refreshProfile } = useAuth()
  const [form, setForm] = useState({
    full_name: profile.full_name || '',
    email: profile.email || '',
    phone: profile.phone || '',
  })
  const [saved, setSaved] = useState(false)

  const dirty = form.full_name !== (profile.full_name || '') || form.email !== (profile.email || '') || form.phone !== (profile.phone || '')

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

export default function Settings() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  if (!profile) return null

  const showPayouts = profile.role === 'rep' || profile.role === 'closer'

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
