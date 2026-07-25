import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useUpdateOwnProfile } from '../hooks/useSettings'
import { Loader2 } from 'lucide-react'
import {
  MONO, card, cardTitle, control, primaryBtn,
} from '../lib/exportStyles'
import { GapNote } from '../components/ui/ExportForm'
import { SavedTick } from '../components/ui/SavedTick'

// Profile — split out of Settings (Prompt 338) so the sidebar footer's
// account popover has a genuinely distinct destination for "Profile" versus
// clicking "Settings" in the main nav, rather than the same tabbed screen via
// two doors. Content ported verbatim from Settings' old Profile tab.
//
// What's real: name, email, phone, username, and (closers only) the monthly
// AP goal. NPN, licensed states, and a profile photo are in the approved
// design but `profiles` has no column for any of the three yet — shown as an
// honest gap note rather than a placeholder that looks like real license data.

const inputBase = { ...control, background: 'var(--bg-base)', padding: '0 12px' }
const softLabel = { margin: '0 0 5px', fontSize: 11, color: 'var(--text-muted)' }

const initialsOf = name =>
  (name || '?').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()

const ROLE_LABEL = { admin: 'Admin', closer: 'Closer', rep: 'Setter', client: 'Client' }

export default function Profile() {
  const { profile } = useAuth()
  if (!profile) return null

  return (
    <div style={{ maxWidth: 620 }}>
      <ProfilePanel profile={profile} />
    </div>
  )
}

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
