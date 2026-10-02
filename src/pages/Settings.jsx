import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Globe, Palette, Shield, Plug, Check, Loader2, Moon, Sun, Trash2, Video, PhoneCall, User, CreditCard,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { useUpdateOwnProfile } from '../hooks/useSettings'
import { useAppSettings, useUpdateAppSettings } from '../hooks/useAppSettings'
import { SELECTABLE_TIMEZONES, DEFAULT_TIMEZONE } from '../lib/timezones'
import { Switch } from '../components/ui/Switch'
import {
  card, cardTitle, control, primaryBtn, ghostBtn, MONO,
} from '../lib/exportStyles'
import { invokeCallerId, formatUsPhone } from '../lib/callerId'
import { GapNote, AnchoredSelectField, TextField } from '../components/ui/ExportForm'
import {
  BILLING_STATUS, TONE_STYLE, formatWeekly, formatBillingDate, daysUntil, invokeBilling,
} from '../lib/billing'
import { SavedTick } from '../components/ui/SavedTick'
import { ProfilePanel } from './Profile'

// Settings — literal port of the export's Settings screen (vault:
// media/claude-design-export-ohvara-dashboard-v3.html, lines 1483-1618): a
// 220px tab rail beside one panel card. Profile split out to its own page
// (pages/Profile.jsx) in Prompt 338 so the sidebar footer's "Profile" popover
// item lands somewhere distinct from clicking "Settings" in the main nav,
// rather than the same screen via two doors.
//
// What's real: timezone, weekend leads, theme, password change, agent
// licensing/appointments, and the Daily.co integration link. Everything the
// export draws that this database can't back yet renders as an honest gap
// note instead of a plausible-looking fake value — date format, table
// density and 2FA all fall in that bucket. None of them are silently
// substituted.
//
// One deviation worth naming: the legacy close (X) button is gone — Settings
// is a normal nav destination in the approved design.
//
// Prompt 674 — Profile folded back in as the first (default) tab, matching
// Restorix Portal where profile editing lives in Settings. The sidebar
// account card no longer has a Profile item; /profile redirects to
// /settings#profile so old links still land.
//
// Prompt 669 — restyled to Restorix Portal's Settings hub: the 220px tab rail
// became one full-width segmented tab bar above a single 768px column, and
// the panels' type is bumped to the 14px Manrope scale the rest of the app
// now uses. Every panel's fields, RPCs and behavior are unchanged.
//
// Payouts tab removed (Prompt 339) — current pay model is carrier-direct with
// no bank-account-connect step, so the Stripe payout pointer had nothing left
// to do.
//
// Notifications tab removed (Prompt 392) — it never did anything (every
// toggle was inert, no preferences table behind it) and matched the page's
// own disclaimer text saying so; a toggle that forgets itself is worse than
// none, so it's gone rather than left disabled. Licensing & Appointments and
// Integrations added in its place plus a new tab, covering real insurance-
// agent compliance data (migration 091) and the Live Room connection (see
// [[Prompt 393]] in LIVE_STATE — originally scoped for Zoom, pivoted to
// Daily.co in migration 097 since per-user Zoom licensing doesn't scale with
// a growing team).

const TABS = [
  { key: 'profile',      label: 'Profile',                   icon: User },
  { key: 'regional',     label: 'Regional',                icon: Globe },
  { key: 'appearance',   label: 'Appearance',                icon: Palette },
  { key: 'security',     label: 'Security',                  icon: Shield },
  { key: 'integrations', label: 'Integrations',              icon: Plug },
  { key: 'callerid',     label: 'Caller ID',                 icon: PhoneCall, roles: ['agent', 'admin'] },
  { key: 'billing',      label: 'Billing',                   icon: CreditCard, roles: ['agent'] },
]

const inputBase = { ...control, background: 'var(--bg-base)', padding: '0 12px' }
const softLabel = { margin: '0 0 6px', fontSize: 14, color: 'var(--text-secondary)' }

export default function Settings() {
  const { profile } = useAuth()
  const { hash, key: locKey } = useLocation()

  // Deep links (e.g. /settings#regional, or the old /profile route's
  // redirect to /settings#profile) pick the tab from the hash; an explicit click wins
  // until the next navigation. The click is tied to the location key so
  // following a deep link while already on Settings still switches tabs.
  const [picked, setPicked] = useState(null)
  const setTab = key => setPicked({ locKey, key })

  if (!profile) return null

  const tabs = TABS.filter(t => !t.roles || t.roles.includes(profile.role))
  const hashTab = tabs.some(t => t.key === hash.slice(1)) ? hash.slice(1) : null
  const tab = (picked?.locKey === locKey && picked.key) || hashTab || 'profile'

  // Restorix's tab bar: one bordered box, equal segments on desktop. Prompt 677:
  // wraps onto a second row instead of scrolling sideways, so no tab (Caller ID,
  // Billing) is ever cut off at any width.
  return (
    <div style={{ maxWidth: 880, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 4, padding: 4, minWidth: 0,
          border: 'var(--border-w) solid var(--border)', borderRadius: 12, background: 'var(--bg-surface)',
        }}
      >
        {tabs.map(t => {
          const on = tab === t.key
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="tab-transition"
              style={{
                flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '8px 12px', border: 'none', borderRadius: 8, fontSize: 13.5,
                whiteSpace: 'nowrap', fontWeight: on ? 600 : 500,
                background: on ? 'var(--accent)' : 'transparent',
                color: on ? '#fff' : 'var(--text-secondary)',
              }}
            >
              <Icon size={15} style={{ flexShrink: 0 }} />
              {t.label}
            </button>
          )
        })}
      </div>

      <div style={{ minWidth: 0 }}>
        {tab === 'profile'      && <ProfilePanel profile={profile} />}
        {tab === 'regional'     && <RegionalPanel profile={profile} />}
        {tab === 'appearance'   && <AppearancePanel />}
        {tab === 'security'     && <SecurityPanel />}
        {tab === 'integrations' && <IntegrationsPanel profile={profile} />}
        {tab === 'callerid'     && <CallerIdPanel profile={profile} />}
        {tab === 'billing'      && <BillingPanel profile={profile} />}
      </div>
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
    <div style={{ ...card }}>
      <p style={cardTitle}>Regional</p>

      <p style={softLabel}>Timezone — call schedules &amp; reminders display in this zone</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <AnchoredSelectField
          value={timezone} onChange={setTimezone} style={{ width: 320 }}
          options={SELECTABLE_TIMEZONES.map(tz => ({ value: tz.value, label: tz.label }))}
        />
        <button
          onClick={save}
          disabled={!dirty || update.isPending}
          style={{ ...primaryBtn, height: 32, padding: '0 16px', fontSize: 13, opacity: !dirty || update.isPending ? 0.5 : 1 }}
        >
          {update.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
        </button>
        <SavedTick show={saved && !dirty} />
      </div>

      {profile.role === 'rep' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: 'var(--border-w) solid var(--border)', marginBottom: 18 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Weekend leads</p>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
              Off by default — your batch pauses Saturday and Sunday.
            </p>
          </div>
          <Switch checked={!!profile.weekend_leads_enabled} onChange={toggleWeekendLeads} disabled={weekendPending} />
        </div>
      )}

      <p style={softLabel}>Currency</p>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--text-primary)' }}>
        USD — US Dollar
        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>(fixed for US operations)</span>
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
        {/* Literal previews of the other theme's tokens (index.css) — they
            can't read var() because they show the theme that isn't active. */}
        <div style={{ height: 88, background: dark ? '#0A0A0F' : '#F3F4F6', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ width: '60%', height: 8, borderRadius: 4, background: dark ? '#192C4F' : '#008674' }} />
          <div style={{ width: '85%', height: 8, borderRadius: 4, background: dark ? '#13131A' : '#FFFFFF', border: `1px solid ${dark ? '#2A2A3A' : 'rgba(0,134,116,0.36)'}` }} />
          <div style={{ width: '38%', height: 8, borderRadius: 4, background: dark ? '#4B79CE' : '#024F46' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderTop: 'var(--border-w) solid var(--border)' }}>
          {dark ? <Moon size={12} style={{ color: 'var(--text-secondary)' }} /> : <Sun size={12} style={{ color: 'var(--text-secondary)' }} />}
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{dark ? 'Dark' : 'Light'}</span>
          {on && <Check size={13} style={{ color: 'var(--accent)' }} />}
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...card }}>
      <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Appearance</p>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--text-muted)' }}>
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
    <div style={{ ...card }}>
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

      {error && <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--danger)' }}>{error}</p>}
      {done && (
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Check size={13} /> Password updated — use it next time you sign in.
        </p>
      )}

      <div>
        <button onClick={save} disabled={saving} style={{ ...primaryBtn, height: 32, padding: '0 16px', fontSize: 13, marginBottom: 22, opacity: saving ? 0.6 : 1 }}>
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
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Two-factor authentication</p>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
            Not available — MFA isn't enabled on this Supabase project, so no account has it.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Integrations (Prompt 392, migration 091; pivoted Zoom→Daily.co in
// migration 097/Prompt 393) ──────────────────────────────────────────────────
// Daily.co is the only real integration today — its room URL is what the
// Team → Meetings Live Room joins. No API key lives here or anywhere
// client-side; a Daily room only needs its URL to join, same as the Zoom
// link this replaced. Editing is admin-only since it's one company-wide
// link, not a per-agent setting.
function IntegrationsPanel({ profile }) {
  const { data: settings } = useAppSettings()
  const updateSettings = useUpdateAppSettings()
  const isAdmin = profile.role === 'admin'
  const [url, setUrl] = useState('')
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)

  const connected = !!settings?.daily_room_url

  function startEditing() {
    setUrl(settings?.daily_room_url || '')
    setEditing(true)
  }

  async function save() {
    await updateSettings.mutateAsync({ daily_room_url: url.trim() || null })
    setEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8, background: 'var(--bg-elevated)',
            border: 'var(--border-w) solid var(--border)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexShrink: 0,
          }}>
            <Video size={16} style={{ color: 'var(--text-secondary)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Daily.co</p>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
              Powers the always-open Live Room on Team → Meetings
            </p>
          </div>
          <span style={{
            fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 4, flexShrink: 0,
            color: connected ? 'var(--success)' : 'var(--text-muted)',
            background: connected ? 'var(--success-dim)' : 'var(--bg-elevated)',
          }}>
            {connected ? 'Connected' : 'Not connected'}
          </span>
        </div>

        {isAdmin && !editing && (
          <button onClick={startEditing} style={{ ...ghostBtn, marginTop: 14 }}>
            {connected ? 'Update room link' : 'Set room link'}
          </button>
        )}

        {isAdmin && editing && (
          <div style={{ marginTop: 14, maxWidth: 420 }}>
            <TextField label="Daily.co room URL" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://your-team.daily.co/live-room" />
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6 }}>
              Create a free room at daily.co (Rooms → Create room) and paste its URL here.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <button
                onClick={save}
                disabled={updateSettings.isPending}
                style={{ ...primaryBtn, height: 32, padding: '0 16px', fontSize: 13, opacity: updateSettings.isPending ? 0.6 : 1 }}
              >
                {updateSettings.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
              </button>
              <button
                onClick={() => { setEditing(false); setUrl(settings?.daily_room_url || '') }}
                style={ghostBtn}
              >
                Cancel
              </button>
              <SavedTick show={saved} />
            </div>
          </div>
        )}

        {!isAdmin && (
          <GapNote>Only an admin can set or change the Live Room link.</GapNote>
        )}
      </div>

      <div style={{ ...card }}>
        <p style={cardTitle}>More integrations</p>
        <GapNote>
          A dialer connection (Live Call) is a reasonable future addition here, but nothing's been specified yet —
          this section stays empty rather than shipping speculative settings with no real requirement behind them.
        </GapNote>
      </div>
    </div>
  )
}

// ── Caller ID (Prompt 666, migration 108) ───────────────────────────────────
// The agent verifies their own cell with Twilio once; after that, when
// Fulfillment calls one of their clients about a cancellation, the client sees
// the agent's number (one they already know) and Fulfillment says they're
// calling on the agent's behalf. Verification is Twilio's own: it calls the
// number and the agent keys in the code shown here, so nobody can borrow a
// number they don't hold. The switch is the agent's to flip any time.
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

  return (
    <div style={{ ...card }}>
      <p style={cardTitle}>Caller ID</p>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 560 }}>
        When Fulfillment calls one of your clients to work their cancellation, the client sees <b>your</b> number,
        the one they already know from your call, so they're more likely to pick up. Fulfillment always says
        they're calling <b>on your behalf</b>. They never say they are you.
      </p>

      {configured === false && !verified && (
        <GapNote>
          Calling isn't connected yet, so there's nothing to verify. This switches on once the phone account is set up.
        </GapNote>
      )}

      {/* Verified: the number + the agent's kill switch */}
      {verified && !changing && !pending && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 8, maxWidth: 560,
            background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', fontFamily: MONO }}>
                {formatUsPhone(profile.caller_id_number)}
              </p>
              <p style={{ margin: '3px 0 0', fontSize: 12.5, color: profile.caller_id_enabled ? 'var(--success)' : 'var(--text-muted)' }}>
                {profile.caller_id_enabled
                  ? "On: Fulfillment's calls to your clients show this number"
                  : 'Off: Fulfillment calls from their own number'}
              </p>
            </div>
            <Switch checked={!!profile.caller_id_enabled} onChange={toggle} disabled={update.isPending} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => { setChanging(true); setPhone('') }} style={ghostBtn}>Change number</button>
            {confirmRemove ? (
              <>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Remove this number?</span>
                <button onClick={remove} disabled={busy} style={{ ...ghostBtn, color: 'var(--danger)' }}>Remove</button>
                <button onClick={() => setConfirmRemove(false)} style={ghostBtn}>Keep</button>
              </>
            ) : (
              <button onClick={() => setConfirmRemove(true)} style={ghostBtn}><Trash2 size={12} /> Remove</button>
            )}
          </div>
        </>
      )}

      {/* Not verified yet, or changing: enter a number */}
      {configured && (!verified || changing) && !pending && (
        <div style={{ maxWidth: 420 }}>
          <p style={softLabel}>Your cell number</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="(602) 555-0143"
              inputMode="tel"
              style={{ ...inputBase, fontFamily: MONO, flex: '1 1 180px' }}
            />
            <button
              onClick={start}
              disabled={busy || digits.length < 10}
              style={{ ...primaryBtn, height: 32, padding: '0 16px', fontSize: 13, opacity: busy || digits.length < 10 ? 0.5 : 1 }}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : 'Verify number'}
            </button>
            {changing && <button onClick={() => setChanging(false)} style={ghostBtn}>Cancel</button>}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
            We'll call this number once. Keep your phone handy.
          </p>
        </div>
      )}

      {/* Mid-verification: the code Twilio's call will ask for */}
      {pending && (
        <div style={{
          maxWidth: 420, padding: '16px 18px', borderRadius: 8,
          background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
        }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            Calling <span style={{ fontFamily: MONO }}>{formatUsPhone(pending.phone)}</span> now. Answer, and when asked, key in:
          </p>
          <p style={{ margin: '10px 0', fontSize: 30, fontWeight: 600, letterSpacing: 6, color: 'var(--text-primary)', fontFamily: MONO }}>
            {pending.code}
          </p>
          {timedOut ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--warning)' }}>Didn't hear back from that call.</span>
              <button onClick={start} disabled={busy} style={ghostBtn}>Call me again</button>
              <button onClick={cancelPending} style={ghostBtn}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Loader2 size={13} className="animate-spin" style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1 }}>Waiting for you to enter the code…</span>
              <button onClick={cancelPending} style={ghostBtn}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {error && <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}

// ── Billing (Prompt 673) ────────────────────────────────────────────────────
// The agent's $350/week retainer. Card entry, cancelling and invoices all
// happen on Stripe-hosted pages (Checkout to subscribe, Customer Portal to
// manage), so no card data ever touches this app. Until the agent-billing
// edge function is deployed with a Stripe key, `status` fails and the panel
// says billing isn't connected, same pattern as Caller ID.
function BillingPanel({ profile }) {
  const { refreshProfile } = useAuth()
  const { data: settings } = useAppSettings()
  const [configured, setConfigured] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const price = formatWeekly(settings?.agent_billing_weekly_cents)
  const status = profile.billing_status || 'none'
  const meta = BILLING_STATUS[status] || BILLING_STATUS.none
  const periodEnd = formatBillingDate(profile.billing_current_period_end)
  const graceEnd = formatBillingDate(profile.billing_grace_until)
  const subscribed = ['active', 'past_due', 'canceled'].includes(status)

  // Prompt 677 — time-remaining at a glance: days to the next charge while
  // active, days of paid access left once cancelled.
  const days = ['active', 'canceled'].includes(status) ? daysUntil(profile.billing_current_period_end) : null
  const countdown = days === null ? null : {
    value: days === 0 ? 'Today' : `${days} ${days === 1 ? 'day' : 'days'}`,
    caption: status === 'canceled' ? 'until access ends' : `until next ${price} charge`,
  }

  // canceled = cancel-at-period-end, still inside the paid week: renewing goes
  // through the Customer Portal so it un-cancels the same subscription rather
  // than Checkout starting a second one.

  // Coming back from Stripe: the webhook has usually landed by now, so pull
  // the fresh row once. refreshProfile isn't memoized; run this on mount only.
  useEffect(() => {
    invokeBilling('status')
      .then(d => setConfigured(!!d.configured))
      .catch(() => setConfigured(false))
    refreshProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const detail = {
    none:     'No subscription yet.',
    active:   periodEnd ? `Paid through ${periodEnd}. Renews automatically.` : 'Paid up. Renews automatically.',
    past_due: graceEnd ? `Your last payment failed. Update your card by ${graceEnd} to keep access.` : 'Your last payment failed. Update your card to keep access.',
    lapsed:   'Your subscription has lapsed. Subscribe again to get back in.',
    canceled: periodEnd ? `Cancelled. Access runs through ${periodEnd}.` : 'Cancelled.',
    exempt:   "Your account isn't billed.",
  }[status]

  async function go(action) {
    setError(''); setBusy(true)
    try {
      const d = await invokeBilling(action)
      if (!d?.url) throw new Error('Stripe did not return a page to open')
      window.location.assign(d.url)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div style={{ ...card }}>
      <p style={cardTitle}>Billing</p>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 560 }}>
        Portal access is a flat <span style={{ fontFamily: MONO, color: 'var(--text-primary)' }}>{price}</span> a week,
        charged weekly to your card, and it covers that week's batch of cancellations. Cancel any time: you keep
        access through the end of the week you've paid for.
      </p>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '14px 16px', borderRadius: 8, maxWidth: 560,
        background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
      }}>
        <span style={{
          display: 'inline-flex', padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 600,
          whiteSpace: 'nowrap', ...TONE_STYLE[meta.tone],
        }}>
          {meta.label}
        </span>
        <span style={{ flex: 1, minWidth: 200, fontSize: 13.5, color: 'var(--text-secondary)' }}>{detail}</span>
        {countdown && (
          <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            <p style={{ margin: 0, fontFamily: MONO, fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>{countdown.value}</p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{countdown.caption}</p>
          </div>
        )}
      </div>

      {status !== 'exempt' && configured === false && (
        <GapNote>
          Billing isn't connected yet, so nothing is being charged and your access isn't affected. Subscribing
          switches on here once it is.
        </GapNote>
      )}

      {status !== 'exempt' && configured && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          {!subscribed && (
            <button onClick={() => go('checkout')} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <>Subscribe · <span style={{ fontFamily: MONO }}>{price}</span>/week</>}
            </button>
          )}
          {subscribed && (
            <button onClick={() => go('portal')} disabled={busy} style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>
              {status === 'past_due' ? 'Update card' : status === 'canceled' ? 'Renew or manage' : 'Manage billing'}
            </button>
          )}
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Opens on Stripe's secure site.</span>
        </div>
      )}

      {error && <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}
