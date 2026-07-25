import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { User, Bell, Globe, Palette, Shield, Wallet, Check, Loader2, Moon, Sun } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { useUpdateOwnProfile } from '../hooks/useSettings'
import { SELECTABLE_TIMEZONES, DEFAULT_TIMEZONE } from '../lib/timezones'
import { Switch } from '../components/ui/Switch'
import {
  MONO, card, cardTitle, control, fieldLabel, primaryBtn, ghostBtn,
} from '../lib/exportStyles'
import { GapNote } from '../components/ui/ExportForm'

// Settings — literal port of the export's Settings screen (vault:
// media/claude-design-export-ohvara-dashboard-v3.html, lines 1483-1618): a
// 220px tab rail beside one panel card, with Profile / Notifications /
// Regional / Appearance / Security.
//
// What's real: name, email, phone, username, timezone, weekend leads, theme,
// password change, and the Stripe payout pointer. Everything the export draws
// that this database can't back yet renders as an honest gap note instead of
// a plausible-looking fake value — NPN, licensed states, per-alert
// notification toggles, date format, table density and 2FA all fall in that
// bucket. None of them are silently substituted.
//
// Two deviations worth naming: the export has no Payouts tab (Stripe Connect
// is real and reachable nowhere else, so it's kept for rep/closer), and the
// legacy close (X) button is gone — Settings is a normal nav destination in
// the approved design.

const TABS = [
  { key: 'profile',    label: 'Profile',       icon: User },
  { key: 'notifs',     label: 'Notifications', icon: Bell },
  { key: 'regional',   label: 'Regional',      icon: Globe },
  { key: 'appearance', label: 'Appearance',    icon: Palette },
  { key: 'security',   label: 'Security',      icon: Shield },
]

const initialsOf = name =>
  (name || '?').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()

const ROLE_LABEL = { admin: 'Admin', closer: 'Closer', rep: 'Setter', client: 'Client' }

const inputBase = { ...control, background: 'var(--bg-base)', padding: '0 12px' }
const softLabel = { margin: '0 0 5px', fontSize: 11, color: 'var(--text-muted)' }

function SavedTick({ show }) {
  if (!show) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--success)' }}>
      <Check size={13} /> Saved
    </span>
  )
}

export default function Settings() {
  const { profile } = useAuth()
  const { hash } = useLocation()

  // Deep link from My Leads' "Select Time Zone and Settings" prompt
  // (Prompt 283) — it links to /settings#regional. Now that the page is
  // tabbed rather than stacked, the hash picks the tab instead of scrolling
  // to it; an explicit click wins from then on.
  const hashTab = TABS.some(t => t.key === hash.slice(1)) ? hash.slice(1) : null
  const [picked, setTab] = useState(null)
  const tab = picked || hashTab || 'profile'

  if (!profile) return null

  const showPayouts = profile.role === 'rep' || profile.role === 'closer'
  const tabs = showPayouts ? [...TABS, { key: 'payouts', label: 'Payouts', icon: Wallet }] : TABS

  // The export's 220px rail sits beside the panel; below md it stacks and the
  // tabs run as a scrollable row, or the panel gets squeezed to ~150px on a
  // phone.
  return (
    <div
      className="grid gap-5 md:gap-8 md:grid-cols-[220px_minmax(0,1fr)]"
      style={{ alignItems: 'start', maxWidth: 940 }}
    >
      <div className="flex-row overflow-x-auto md:flex-col scrollbar-thin" style={{ display: 'flex', gap: 2, minWidth: 0 }}>
        {tabs.map(t => {
          const on = tab === t.key
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px',
                border: 'none', borderRadius: 6, textAlign: 'left', fontSize: 12.5,
                whiteSpace: 'nowrap', flexShrink: 0,
                fontWeight: on ? 700 : 400,
                background: on ? 'var(--accent-dim)' : 'transparent',
                color: on ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              <Icon size={14} style={{ color: on ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }} />
              {t.label}
            </button>
          )
        })}
      </div>

      <div style={{ minWidth: 0 }}>
        {tab === 'profile'    && <ProfilePanel profile={profile} />}
        {tab === 'notifs'     && <NotificationsPanel />}
        {tab === 'regional'   && <RegionalPanel profile={profile} />}
        {tab === 'appearance' && <AppearancePanel />}
        {tab === 'security'   && <SecurityPanel />}
        {tab === 'payouts'    && <PayoutsPanel profile={profile} />}
      </div>
    </div>
  )
}

// ── Profile ─────────────────────────────────────────────────────────────────
function ProfilePanel({ profile }) {
  const update = useUpdateOwnProfile()
  const { refreshProfile } = useAuth()
  const [form, setForm] = useState({
    full_name: profile.full_name || '',
    email: profile.email || '',
    phone: profile.phone || '',
    username: profile.username || '',
  })
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const dirty = Object.entries(form).some(([k, v]) => v !== (profile[k] || ''))

  async function save() {
    setError('')
    if (!form.full_name.trim()) return setError('Name can’t be empty')
    try {
      await update.mutateAsync({ profileId: profile.id, updates: form })
      await refreshProfile()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err.message || 'Could not save your profile')
    }
  }

  const joined = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null

  return (
    <div style={{ ...card, padding: '20px 22px' }}>
      <p style={cardTitle}>Profile</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <span style={{
          width: 52, height: 52, borderRadius: '50%',
          background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 17, fontWeight: 700, color: 'var(--accent)', flexShrink: 0,
        }}>
          {initialsOf(profile.full_name)}
        </span>
        <div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{profile.full_name}</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
            {ROLE_LABEL[profile.role] || profile.role}{joined ? ` · joined ${joined}` : ''}
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 16 }}>
        <label>
          <p style={softLabel}>Full name</p>
          <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} style={inputBase} />
        </label>
        <label>
          <p style={softLabel}>Email</p>
          <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={inputBase} />
        </label>
        <label>
          <p style={softLabel}>Phone</p>
          <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(602) 555-0143" style={{ ...inputBase, fontFamily: MONO }} />
        </label>
        <label>
          <p style={softLabel}>Username</p>
          <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} style={{ ...inputBase, fontFamily: MONO }} />
        </label>
      </div>

      {error && <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--danger)' }}>{error}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={save}
          disabled={!dirty || update.isPending}
          style={{ ...primaryBtn, height: 32, padding: '0 16px', fontSize: 12, opacity: !dirty || update.isPending ? 0.5 : 1 }}
        >
          {update.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Save changes'}
        </button>
        <SavedTick show={saved && !dirty} />
      </div>

      {profile.role === 'closer' && <MonthlyGoalField profile={profile} />}

      <GapNote>
        The approved design also shows a profile photo, NPN (producer number) and licensed states. `profiles`
        has no column for any of the three yet — they need a migration, so nothing is shown rather than a
        placeholder that looks like real license data.
      </GapNote>
    </div>
  )
}

// Overview's monthly goal progress box (Prompt 329) needs a per-closer
// target to compare submitted AP against — `monthly_ap_goal` defaults to
// 20000 for everyone until a closer sets their own here.
function MonthlyGoalField({ profile }) {
  const update = useUpdateOwnProfile()
  const { refreshProfile } = useAuth()
  const [value, setValue] = useState(String(profile.monthly_ap_goal ?? 20000))
  const [saved, setSaved] = useState(false)

  const dirty = Number(value) !== Number(profile.monthly_ap_goal ?? 20000)

  async function save() {
    const goal = Math.max(0, Number(value) || 0)
    await update.mutateAsync({ profileId: profile.id, updates: { monthly_ap_goal: goal } })
    await refreshProfile()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ paddingTop: 16, marginTop: 4, borderTop: 'var(--border-w) solid var(--border)' }}>
      <p style={softLabel}>Monthly AP goal — drives the progress bar on your Overview</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input
          type="number" min="0" step="100"
          value={value}
          onChange={e => setValue(e.target.value)}
          style={{ ...inputBase, width: 160, fontFamily: MONO }}
        />
        <button
          onClick={save}
          disabled={!dirty || update.isPending}
          style={{ ...primaryBtn, height: 32, padding: '0 16px', fontSize: 12, opacity: !dirty || update.isPending ? 0.5 : 1 }}
        >
          {update.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
        </button>
        <SavedTick show={saved && !dirty} />
      </div>
    </div>
  )
}

// ── Notifications ───────────────────────────────────────────────────────────
// Every row the export lists, rendered inert: there is no preferences table,
// so a toggle here would forget itself on reload and quietly imply an alert
// was switched off when it wasn't.
const PREFS = [
  ['Incoming transfer', 'Rings your headset the moment a call is routed to you'],
  ['Policy effective date', 'The day a submitted policy is due to go into effect'],
  ['Cancellation call due', 'Ahead of a booked 3-way with the old carrier'],
  ['Undrafted policy', 'A policy that failed to draft'],
  ['New recruit joined', 'Someone claimed your invite link'],
  ['Commission released', 'A policy cleared reserve'],
]

function NotificationsPanel() {
  return (
    <div style={{ ...card, padding: '20px 22px' }}>
      <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Notifications</p>
      <p style={{ margin: '0 0 14px', fontSize: 11, color: 'var(--text-muted)' }}>
        Delivered in-app; the transfer alert also rings your headset.
      </p>
      {PREFS.map(([label, sub]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: 'var(--border-w) solid var(--border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>{sub}</p>
          </div>
          <div
            title="Not adjustable yet"
            style={{ width: 34, height: 19, borderRadius: 10, background: 'var(--border)', position: 'relative', flexShrink: 0, opacity: 0.5 }}
          >
            <span style={{ position: 'absolute', top: 2, left: 17, width: 15, height: 15, borderRadius: '50%', background: '#fff' }} />
          </div>
        </div>
      ))}
      <GapNote>
        These are on for everyone and can't be changed yet — there's no preferences table behind them, and a
        toggle that forgets itself is worse than none. Wiring it up is its own piece of work.
      </GapNote>
    </div>
  )
}

// ── Regional ────────────────────────────────────────────────────────────────
function RegionalPanel({ profile }) {
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
    <div style={{ ...card, padding: '20px 22px' }}>
      <p style={cardTitle}>Regional</p>

      <p style={softLabel}>Timezone — call schedules &amp; reminders display in this zone</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <select value={timezone} onChange={e => setTimezone(e.target.value)} style={{ ...inputBase, width: 320, padding: '0 10px' }}>
          {SELECTABLE_TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
        </select>
        <button
          onClick={save}
          disabled={!dirty || update.isPending}
          style={{ ...primaryBtn, height: 32, padding: '0 16px', fontSize: 12, opacity: !dirty || update.isPending ? 0.5 : 1 }}
        >
          {update.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
        </button>
        <SavedTick show={saved && !dirty} />
      </div>

      {profile.role === 'rep' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: 'var(--border-w) solid var(--border)', marginBottom: 18 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Weekend leads</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
              Off by default — your batch pauses Saturday and Sunday.
            </p>
          </div>
          <Switch checked={!!profile.weekend_leads_enabled} onChange={toggleWeekendLeads} disabled={weekendPending} />
        </div>
      )}

      <p style={softLabel}>Currency</p>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-primary)' }}>
        USD — US Dollar
        <span style={{ marginLeft: 8, fontSize: 10.5, color: 'var(--text-muted)' }}>(fixed for US operations)</span>
      </p>

      <GapNote>
        The approved design also offers a date-format choice. Dates are formatted in one shared helper today
        with nowhere to store a per-user preference, so the option isn't shown rather than shown and ignored.
      </GapNote>
    </div>
  )
}

// ── Appearance ──────────────────────────────────────────────────────────────
function AppearancePanel() {
  const [theme, setTheme] = useTheme()

  const swatch = (mode) => {
    const on = theme === mode
    const dark = mode === 'dark'
    return (
      <div
        key={mode}
        onClick={() => setTheme(mode)}
        style={{
          flex: 1, maxWidth: 230, cursor: 'pointer', borderRadius: 8, overflow: 'hidden',
          border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
        }}
      >
        <div style={{ height: 88, background: dark ? '#0A0A0F' : '#FAFAFC', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ width: '60%', height: 8, borderRadius: 3, background: dark ? '#192C4F' : '#F1F1F6' }} />
          <div style={{ width: '85%', height: 8, borderRadius: 3, background: dark ? '#13131A' : '#FFFFFF', border: `1px solid ${dark ? '#2A2A3A' : '#E4E4EE'}` }} />
          <div style={{ width: '38%', height: 8, borderRadius: 3, background: '#4B79CE' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderTop: 'var(--border-w) solid var(--border)' }}>
          {dark ? <Moon size={12} style={{ color: 'var(--text-secondary)' }} /> : <Sun size={12} style={{ color: 'var(--text-secondary)' }} />}
          <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{dark ? 'Dark' : 'Light'}</span>
          {on && <Check size={13} style={{ color: 'var(--accent)' }} />}
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...card, padding: '20px 22px' }}>
      <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Appearance</p>
      <p style={{ margin: '0 0 14px', fontSize: 11, color: 'var(--text-muted)' }}>
        Theme applies instantly, everywhere, and is remembered on this device.
      </p>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {swatch('dark')}
        {swatch('light')}
      </div>
      <GapNote>
        Table density is in the approved design too, but nothing reads it yet — the ported tables use one
        spacing. It arrives with the setting that actually drives it.
      </GapNote>
    </div>
  )
}

// ── Security ────────────────────────────────────────────────────────────────
// Verify the current password (signInWithPassword against the session's own
// email — the same step-up used by the payout gate), then updateUser. Matters
// most for invite-flow accounts: nobody else knows their password and email
// resets stay dead until SMTP exists.
function SecurityPanel() {
  const { session } = useAuth()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  async function save() {
    setError(''); setDone(false)
    if (!form.current) return setError('Enter your current password')
    if (form.next.length < 8) return setError('New password must be at least 8 characters')
    if (form.next !== form.confirm) return setError('New passwords do not match')

    setSaving(true)
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password: form.current,
    })
    if (authError) {
      setSaving(false)
      return setError('Current password is incorrect.')
    }
    const { error: updError } = await supabase.auth.updateUser({ password: form.next })
    setSaving(false)
    if (updError) return setError(updError.message || 'Could not update the password — try again')
    setForm({ current: '', next: '', confirm: '' })
    setDone(true)
  }

  return (
    <div style={{ ...card, padding: '20px 22px' }}>
      <p style={cardTitle}>Security</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, maxWidth: 520, marginBottom: 16 }}>
        <label>
          <p style={softLabel}>Current password</p>
          <input type="password" autoComplete="current-password" value={form.current} onChange={e => setForm(f => ({ ...f, current: e.target.value }))} style={inputBase} />
        </label>
        <label>
          <p style={softLabel}>New password</p>
          <input type="password" autoComplete="new-password" placeholder="8+ characters" value={form.next} onChange={e => setForm(f => ({ ...f, next: e.target.value }))} style={inputBase} />
        </label>
        <label>
          <p style={softLabel}>Confirm new password</p>
          <input type="password" autoComplete="new-password" value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} style={inputBase} />
        </label>
      </div>

      {error && <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--danger)' }}>{error}</p>}
      {done && (
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Check size={13} /> Password updated — use it next time you sign in.
        </p>
      )}

      <div>
        <button onClick={save} disabled={saving} style={{ ...primaryBtn, height: 32, padding: '0 16px', fontSize: 12, marginBottom: 22, opacity: saving ? 0.6 : 1 }}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : 'Update password'}
        </button>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px',
        background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
        borderRadius: 8, maxWidth: 520,
      }}>
        <Shield size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Two-factor authentication</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
            Not available — MFA isn't enabled on this Supabase project, so no account has it.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Payouts (not in the export — Stripe Connect is real and lives nowhere
// else in the approved nav) ─────────────────────────────────────────────────
function PayoutsPanel({ profile }) {
  const navigate = useNavigate()
  const { session } = useAuth()
  const connected = !!profile.stripe_onboarding_complete
  const dest = profile.role === 'closer' ? '/closer/revenue' : '/setter/commissions'

  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  // Step-up auth before payout settings (Prompt 280) — re-verify the current
  // password rather than trusting an already-open session.
  async function open() {
    setError('')
    if (!password) return setError('Enter your password')
    setChecking(true)
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password,
    })
    setChecking(false)
    if (authError) return setError('Incorrect password — try again.')
    navigate(dest)
  }

  return (
    <div style={{ ...card, padding: '20px 22px' }}>
      <p style={cardTitle}>Payouts</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Payout account</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
            {connected ? 'Connected via Stripe' : 'Not connected yet'}
          </p>
        </div>
        <span style={{
          display: 'inline-flex', padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
          color: connected ? 'var(--success)' : 'var(--warning)',
          background: connected ? 'var(--success-dim)' : 'var(--warning-dim)',
          border: `1px solid ${connected ? 'var(--success-bd)' : 'var(--warning-bd)'}`,
        }}>
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <p style={fieldLabel}>Confirm your password to continue</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: 520 }}>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') open() }}
          style={{ ...inputBase, flex: 1, minWidth: 200 }}
        />
        <button onClick={open} disabled={checking} style={{ ...ghostBtn, height: 34 }}>
          {checking ? 'Checking…' : 'Manage payout account'}
        </button>
      </div>
      {error && <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}
