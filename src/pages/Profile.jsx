import { useState, useRef, lazy, Suspense } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useUpdateOwnProfile, useUploadAvatar, useRemoveAvatar } from '../hooks/useSettings'
import { useMonthlyGoal, useSetMonthlyGoal } from '../hooks/useMonthlyGoals'
import { todayISO } from '../lib/policyFormat'
import { Loader2, X, Camera } from 'lucide-react'
import {
  MONO, card, cardTitle, control, primaryBtn,
} from '../lib/exportStyles'
import { GapNote } from '../components/ui/ExportForm'
import { SavedTick } from '../components/ui/SavedTick'
import { Switch } from '../components/ui/Switch'
import { Segmented } from '../components/ui/Segmented'
import { Avatar } from '../components/ui/Avatar'
// Prompt 422 — lazy, not a top-level import: react-easy-crop pushed the
// main bundle just over vite-plugin-pwa's 2 MiB precache limit (a hard
// build failure, not just the pre-existing chunk-size warning). It's only
// ever needed inside this one rarely-opened modal, so it belongs in its own
// chunk rather than in every user's initial load.
const AvatarCropModal = lazy(() =>
  import('../components/ui/AvatarCropModal').then(m => ({ default: m.AvatarCropModal }))
)

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

const ROLE_LABEL = { admin: 'Admin', closer: 'Closer', rep: 'Setter', client: 'Client' }

// Where "X" falls back to when there's no in-app history to go back to
// (direct URL load, hard refresh) — each role's own home route.
const ROLE_HOME = { admin: '/admin', closer: '/agent', rep: '/setter', client: '/client' }

export default function Profile() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  if (!profile) return null

  // Prompt 404: Profile is always reached by clicking into it from
  // somewhere (sidebar footer popover, or the Monthly Goal card's
  // "set your goal" hotlink) — react-router's location.key is 'default'
  // only when there's no actual in-app navigation history behind it (a
  // direct URL load or hard refresh), so that's the one case that needs a
  // real fallback instead of just going back.
  function close() {
    if (location.key !== 'default') navigate(-1)
    else navigate(ROLE_HOME[profile.role] || '/')
  }

  return (
    <div style={{ maxWidth: 620 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button
          onClick={close}
          aria-label="Close"
          style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
        >
          <X size={18} />
        </button>
      </div>
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
        <AvatarUpload profile={profile} />
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

      {profile.role === 'admin' && <WritesBusinessField profile={profile} />}

      {(profile.role === 'closer' || (profile.role === 'admin' && profile.also_writes_business)) && (
        <MonthlyGoalField profile={profile} />
      )}

      {profile.role === 'admin' && profile.also_writes_business && (
        <DefaultViewScopeField profile={profile} />
      )}

      <GapNote>
        The approved design also shows NPN (producer number) and licensed states. `profiles` has no column
        for either yet — they need a migration, so nothing is shown rather than a placeholder that looks
        like real license data.
      </GapNote>
    </div>
  )
}

// Profile photo upload (Prompt 407) — click the avatar circle to pick a new
// image; uploads to the `avatars` bucket and updates profiles.avatar_url
// immediately. Falls back to the shared two-initial colored Avatar
// (avatar_color, migration 096) when no photo is set, same as every other
// avatar in the app now renders.
// Prompt 422 — a picked file now opens a crop/zoom modal instead of
// uploading as-is (whatever was picked used to land off-center or
// stretched into the circle); a "Remove photo" action also drops the
// upload back to the initials fallback, deleting the stored file too.
function AvatarUpload({ profile }) {
  const upload = useUploadAvatar()
  const remove = useRemoveAvatar()
  const { refreshProfile } = useAuth()
  const inputRef = useRef(null)
  const [error, setError] = useState('')
  const [pendingImage, setPendingImage] = useState(null) // object URL awaiting crop confirm

  const busy = upload.isPending || remove.isPending

  function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file next time
    if (!file) return
    setError('')
    setPendingImage(URL.createObjectURL(file))
  }

  function closeCropModal() {
    if (pendingImage) URL.revokeObjectURL(pendingImage)
    setPendingImage(null)
  }

  async function onCropConfirm(blob) {
    setError('')
    try {
      const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
      await upload.mutateAsync({ profileId: profile.id, file })
      await refreshProfile()
      closeCropModal()
    } catch (err) {
      setError(err.message || 'Could not upload your photo')
    }
  }

  async function onRemove() {
    setError('')
    try {
      await remove.mutateAsync({ profileId: profile.id })
      await refreshProfile()
    } catch (err) {
      setError(err.message || 'Could not remove your photo')
    }
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        title="Change profile photo"
        style={{
          position: 'relative', width: 52, height: 52, border: 'none', padding: 0,
          borderRadius: '50%', cursor: busy ? 'default' : 'pointer', background: 'transparent',
        }}
      >
        <Avatar profile={profile} size={52} style={{ fontSize: 17, border: '1px solid var(--accent-border)' }} />
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.45)', opacity: busy ? 1 : 0,
          transition: 'opacity 120ms',
        }}
          onMouseEnter={e => { if (!busy) e.currentTarget.style.opacity = 1 }}
          onMouseLeave={e => { if (!busy) e.currentTarget.style.opacity = 0 }}
        >
          {busy ? <Loader2 size={16} color="#fff" className="animate-spin" /> : <Camera size={16} color="#fff" />}
        </div>
        {/* Persistent camera badge (Prompt 409) — visible at rest, not just on
            hover, so the circle reads as clickable/uploadable at a glance. */}
        {!busy && (
          <div style={{
            position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--accent)', border: '2px solid var(--bg-elevated)',
          }}>
            <Camera size={11} color="#fff" />
          </div>
        )}
      </button>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
      {profile.avatar_url && (
        <button
          onClick={onRemove}
          disabled={busy}
          style={{
            display: 'block', marginTop: 6, border: 'none', background: 'transparent',
            color: 'var(--text-muted)', fontSize: 10.5, padding: 0, cursor: busy ? 'default' : 'pointer',
          }}
        >
          Remove photo
        </button>
      )}
      {error && (
        <p style={{ marginTop: 4, fontSize: 10.5, color: 'var(--danger)', whiteSpace: 'nowrap' }}>
          {error}
        </p>
      )}
      {pendingImage && (
        <Suspense fallback={null}>
          <AvatarCropModal
            imageSrc={pendingImage}
            onCancel={closeCropModal}
            onConfirm={onCropConfirm}
            saving={upload.isPending}
          />
        </Suspense>
      )}
    </div>
  )
}

// Overview's monthly goal progress box (Prompt 329, month-scoped in Prompt
// 404 / migration 095) needs a per-agent target for the CURRENT month to
// compare submitted AP against — no row means unset, no carryover from last
// month. Shown to closers always, and to admin/upline accounts only once
// they've flagged themselves as also writing business (see
// WritesBusinessField above) — otherwise there's nothing for it to drive.
function MonthlyGoalField({ profile }) {
  const month = todayISO().slice(0, 7)
  const { data: goalRow } = useMonthlyGoal(profile.id, month)
  const setGoal = useSetMonthlyGoal()
  const [value, setValue] = useState('')
  const [touched, setTouched] = useState(false)
  const [saved, setSaved] = useState(false)

  const current = touched ? value : String(goalRow?.goal ?? '')
  const dirty = touched && Number(current) !== Number(goalRow?.goal ?? NaN)

  async function save() {
    const goal = Math.max(0, Number(current) || 0)
    await setGoal.mutateAsync({ profileId: profile.id, month, goal })
    setTouched(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ paddingTop: 16, marginTop: 4, borderTop: 'var(--border-w) solid var(--border)' }}>
      <p style={softLabel}>
        This month's AP goal — drives the progress bar on your Overview · resets unset every new month
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input
          type="number" min="0" step="100"
          placeholder="Not set"
          value={current}
          onChange={e => { setTouched(true); setValue(e.target.value) }}
          style={{ ...inputBase, width: 160, fontFamily: MONO }}
        />
        <button
          onClick={save}
          disabled={!dirty || setGoal.isPending}
          style={{ ...primaryBtn, height: 32, padding: '0 16px', fontSize: 12, opacity: !dirty || setGoal.isPending ? 0.5 : 1 }}
        >
          {setGoal.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
        </button>
        <SavedTick show={saved && !dirty} />
      </div>
    </div>
  )
}

// "Default view" (Prompt 405, moved here from Settings → Regional; renamed
// + broadened in Prompt 413) — only meaningful once a You/Everyone(/Team)
// toggle actually exists somewhere for this account, which is exactly the
// same gate as MonthlyGoalField above: admin/upline role AND "I'm also
// actively writing business" on. Same `overview_default_scope` column and
// write path as Prompt 405 — the name was Overview-specific back when
// Overview was the only page with this toggle; Prompt 413 wired the same
// setting into My Policies' and Performance's initial scope too, so the
// label and copy now describe it as the one shared preference it actually
// is, not an Overview-only setting.
function DefaultViewScopeField({ profile }) {
  const update = useUpdateOwnProfile()
  const { refreshProfile } = useAuth()

  async function setDefaultScope(next) {
    await update.mutateAsync({ profileId: profile.id, updates: { overview_default_scope: next } })
    await refreshProfile()
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '16px 0', marginTop: 4,
      borderTop: 'var(--border-w) solid var(--border)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Default view</p>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
          Which side you land on for Overview, My Policies, and Performance — only applies when their You/Everyone toggle is showing.
        </p>
      </div>
      <Segmented
        size="sm"
        value={profile.overview_default_scope || 'you'}
        onChange={setDefaultScope}
        options={[{ value: 'you', label: 'You' }, { value: 'everyone', label: 'Everyone' }]}
      />
    </div>
  )
}

// "I'm also actively writing business" (Prompt 404) — off by default for
// the upline/admin role, since a pure agency manager has nothing behind a
// personal "You" view. Gates the You/Everyone toggle on Overview and the
// You/Team toggle on Performance (Prompt 396), and reveals the personal
// monthly-goal field above once turned on. Doesn't touch regular closers —
// they always write business.
function WritesBusinessField({ profile }) {
  const update = useUpdateOwnProfile()
  const { refreshProfile } = useAuth()
  const [pending, setPending] = useState(false)

  async function toggle(next) {
    setPending(true)
    await update.mutateAsync({ profileId: profile.id, updates: { also_writes_business: next } })
    await refreshProfile()
    setPending(false)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '16px 0', marginTop: 4,
      borderTop: 'var(--border-w) solid var(--border)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
          I'm also actively writing business
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
          On shows a personal You view (and goal) alongside your team numbers, on Overview and Performance.
        </p>
      </div>
      <Switch checked={!!profile.also_writes_business} onChange={toggle} disabled={pending} />
    </div>
  )
}
