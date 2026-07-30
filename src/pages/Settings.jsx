import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Globe, Palette, Shield, IdCard, Plug, Check, Loader2, Moon, Sun, Plus, Trash2, Video,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { useUpdateOwnProfile } from '../hooks/useSettings'
import {
  useAgentLicenses, useSaveAgentLicense, useDeleteAgentLicense,
  useAgentAppointments, useSetAgentAppointment,
} from '../hooks/useLicensing'
import { useAppSettings, useUpdateAppSettings } from '../hooks/useAppSettings'
import { useCarriers } from '../hooks/useCarriers'
import { SELECTABLE_TIMEZONES, DEFAULT_TIMEZONE } from '../lib/timezones'
import { US_STATES } from '../lib/usStates'
import { Switch } from '../components/ui/Switch'
import {
  card, cardTitle, control, primaryBtn, ghostBtn, grid3,
} from '../lib/exportStyles'
import { GapNote, AnchoredSelectField, TextField } from '../components/ui/ExportForm'
import { SavedTick } from '../components/ui/SavedTick'

// Settings — literal port of the export's Settings screen (vault:
// media/claude-design-export-ohvara-dashboard-v3.html, lines 1483-1618): a
// 220px tab rail beside one panel card. Profile split out to its own page
// (pages/Profile.jsx) in Prompt 338 so the sidebar footer's "Profile" popover
// item lands somewhere distinct from clicking "Settings" in the main nav,
// rather than the same screen via two doors.
//
// What's real: timezone, weekend leads, theme, password change, agent
// licensing/appointments, and the Zoom integration link. Everything the
// export draws that this database can't back yet renders as an honest gap
// note instead of a plausible-looking fake value — date format, table
// density and 2FA all fall in that bucket. None of them are silently
// substituted.
//
// One deviation worth naming: the legacy close (X) button is gone — Settings
// is a normal nav destination in the approved design.
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
// agent compliance data (migration 091) and the Zoom Live Room connection
// (see [[Prompt 393]] in LIVE_STATE, still queued).

const TABS = [
  { key: 'regional',     label: 'Regional',                icon: Globe },
  { key: 'appearance',   label: 'Appearance',                icon: Palette },
  { key: 'security',     label: 'Security',                  icon: Shield },
  { key: 'licensing',    label: 'Licensing & Appointments',  icon: IdCard },
  { key: 'integrations', label: 'Integrations',              icon: Plug },
]

const inputBase = { ...control, background: 'var(--bg-base)', padding: '0 12px' }
const softLabel = { margin: '0 0 5px', fontSize: 11, color: 'var(--text-muted)' }

export default function Settings() {
  const { profile } = useAuth()
  const { hash } = useLocation()

  // Deep link from My Leads' "Select Time Zone and Settings" prompt
  // (Prompt 283) — it links to /settings#regional. Now that the page is
  // tabbed rather than stacked, the hash picks the tab instead of scrolling
  // to it; an explicit click wins from then on.
  const hashTab = TABS.some(t => t.key === hash.slice(1)) ? hash.slice(1) : null
  const [picked, setTab] = useState(null)
  const tab = picked || hashTab || 'regional'

  if (!profile) return null

  // The export's 220px rail sits beside the panel; below md it stacks and the
  // tabs run as a scrollable row, or the panel gets squeezed to ~150px on a
  // phone.
  return (
    <div
      className="grid gap-5 md:gap-8 md:grid-cols-[220px_minmax(0,1fr)]"
      style={{ alignItems: 'start', maxWidth: 940 }}
    >
      <div className="flex-row overflow-x-auto md:flex-col scrollbar-thin" style={{ display: 'flex', gap: 2, minWidth: 0 }}>
        {TABS.map(t => {
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
        {tab === 'regional'     && <RegionalPanel profile={profile} />}
        {tab === 'appearance'   && <AppearancePanel />}
        {tab === 'security'     && <SecurityPanel />}
        {tab === 'licensing'    && <LicensingPanel profile={profile} />}
        {tab === 'integrations' && <IntegrationsPanel profile={profile} />}
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
    <div style={{ ...card, padding: '20px 22px' }}>
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

// ── Licensing & Appointments (Prompt 392, migration 091) ────────────────────
function LicensingPanel({ profile }) {
  const update = useUpdateOwnProfile()
  const { refreshProfile } = useAuth()
  const [npn, setNpn] = useState(profile.npn || '')
  const [eoCarrier, setEoCarrier] = useState(profile.eo_carrier || '')
  const [eoExpires, setEoExpires] = useState(profile.eo_policy_expires_on || '')
  const [saved, setSaved] = useState(false)

  const dirty = npn !== (profile.npn || '')
    || eoCarrier !== (profile.eo_carrier || '')
    || eoExpires !== (profile.eo_policy_expires_on || '')

  async function save() {
    await update.mutateAsync({
      profileId: profile.id,
      updates: { npn: npn || null, eo_carrier: eoCarrier || null, eo_policy_expires_on: eoExpires || null },
    })
    await refreshProfile()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, padding: '20px 22px' }}>
        <p style={cardTitle}>Producer info</p>
        <div style={grid3}>
          <TextField label="NPN" value={npn} onChange={e => setNpn(e.target.value)} placeholder="National Producer Number" />
          <TextField label="E&O carrier" value={eoCarrier} onChange={e => setEoCarrier(e.target.value)} placeholder="e.g. Hanover" />
          <TextField label="E&O policy expires" type="date" value={eoExpires} onChange={e => setEoExpires(e.target.value)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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

      <LicenseList profile={profile} />
      <AppointmentsList profile={profile} />
    </div>
  )
}

function LicenseList({ profile }) {
  const { data: licenses = [] } = useAgentLicenses(profile.id)
  const save = useSaveAgentLicense(profile.id)
  const del = useDeleteAgentLicense(profile.id)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ state: '', license_number: '', expires_on: '' })

  function submit() {
    if (!form.state) return
    save.mutate(
      { state: form.state, license_number: form.license_number || null, expires_on: form.expires_on || null },
      { onSuccess: () => { setForm({ state: '', license_number: '', expires_on: '' }); setAdding(false) } }
    )
  }

  return (
    <div style={{ ...card, padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <p style={{ ...cardTitle, margin: 0 }}>State licenses</p>
        {!adding && (
          <button onClick={() => setAdding(true)} style={ghostBtn}>
            <Plus size={12} /> Add license
          </button>
        )}
      </div>

      {licenses.length === 0 && !adding && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>No licenses on file yet.</p>
      )}

      {licenses.map(l => (
        <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', borderBottom: 'var(--border-w) solid var(--border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
              {US_STATES.find(s => s.code === l.state)?.name || l.state}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
              {l.license_number ? `#${l.license_number}` : 'No license number on file'}
              {l.expires_on ? ` · expires ${l.expires_on}` : ''}
            </p>
          </div>
          <button
            onClick={() => del.mutate(l.id)}
            title="Remove license"
            style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', padding: 4, flexShrink: 0 }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}

      {adding && (
        <>
          <div style={{ ...grid3, marginTop: 12, marginBottom: 0 }}>
            <AnchoredSelectField
              label="State" value={form.state} onChange={v => setForm(f => ({ ...f, state: v }))}
              options={US_STATES.map(s => ({ value: s.code, label: s.name }))}
            />
            <TextField label="License number" value={form.license_number} onChange={e => setForm(f => ({ ...f, license_number: e.target.value }))} />
            <TextField label="Expires" type="date" value={form.expires_on} onChange={e => setForm(f => ({ ...f, expires_on: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={submit}
              disabled={!form.state || save.isPending}
              style={{ ...primaryBtn, height: 32, padding: '0 16px', fontSize: 12, opacity: !form.state || save.isPending ? 0.5 : 1 }}
            >
              {save.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Add'}
            </button>
            <button
              onClick={() => { setAdding(false); setForm({ state: '', license_number: '', expires_on: '' }) }}
              style={ghostBtn}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// One status dropdown per real carrier (directory-driven, not a fixed list) —
// appointed_on is set automatically the first time a carrier flips to Active
// and left alone after, rather than a second field to hand-maintain.
function AppointmentsList({ profile }) {
  const { data: carriers = [] } = useCarriers()
  const { data: appointments = [] } = useAgentAppointments(profile.id)
  const setAppointment = useSetAgentAppointment(profile.id)

  const byCarrier = Object.fromEntries(appointments.map(a => [a.carrier_id, a]))

  function changeStatus(carrierId, status) {
    const existing = byCarrier[carrierId]
    const appointedOn = status === 'active'
      ? (existing?.appointed_on || new Date().toISOString().slice(0, 10))
      : existing?.appointed_on
    setAppointment.mutate({ carrierId, status, appointedOn })
  }

  return (
    <div style={{ ...card, padding: '20px 22px' }}>
      <p style={cardTitle}>Carrier appointments</p>
      {carriers.length === 0 && <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>No carriers in the directory yet.</p>}
      {carriers.map(c => {
        const appt = byCarrier[c.id]
        const status = appt?.status || 'pending'
        return (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', borderBottom: 'var(--border-w) solid var(--border)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{c.name}</p>
              {appt?.appointed_on && (
                <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>Appointed {appt.appointed_on}</p>
              )}
            </div>
            <AnchoredSelectField
              value={status} onChange={v => changeStatus(c.id, v)}
              options={[{ value: 'pending', label: 'Pending' }, { value: 'active', label: 'Active' }]}
              style={{ width: 140 }}
            />
          </div>
        )
      })}
    </div>
  )
}

// ── Integrations (Prompt 392, migration 091) ─────────────────────────────────
// Zoom is the only real integration today — its room link is what Prompt 393
// (Team → Meetings Live Room, still queued in LIVE_STATE pending Brayden's
// real Zoom URL) will read. Editing is admin-only since it's one company-wide
// link, not a per-agent setting.
function IntegrationsPanel({ profile }) {
  const { data: settings } = useAppSettings()
  const updateSettings = useUpdateAppSettings()
  const isAdmin = profile.role === 'admin'
  const [url, setUrl] = useState('')
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)

  const connected = !!settings?.zoom_room_url

  function startEditing() {
    setUrl(settings?.zoom_room_url || '')
    setEditing(true)
  }

  async function save() {
    await updateSettings.mutateAsync({ zoom_room_url: url.trim() || null })
    setEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8, background: 'var(--bg-elevated)',
            border: 'var(--border-w) solid var(--border)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexShrink: 0,
          }}>
            <Video size={16} style={{ color: 'var(--text-secondary)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Zoom</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
              Powers the always-open Live Room on Team → Meetings
            </p>
          </div>
          <span style={{
            fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 4, flexShrink: 0,
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
            <TextField label="Zoom room URL" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://zoom.us/j/…" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <button
                onClick={save}
                disabled={updateSettings.isPending}
                style={{ ...primaryBtn, height: 32, padding: '0 16px', fontSize: 12, opacity: updateSettings.isPending ? 0.6 : 1 }}
              >
                {updateSettings.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
              </button>
              <button
                onClick={() => { setEditing(false); setUrl(settings?.zoom_room_url || '') }}
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

      <div style={{ ...card, padding: '20px 22px' }}>
        <p style={cardTitle}>More integrations</p>
        <GapNote>
          A dialer connection (Live Call) is a reasonable future addition here, but nothing's been specified yet —
          this section stays empty rather than shipping speculative settings with no real requirement behind them.
        </GapNote>
      </div>
    </div>
  )
}

