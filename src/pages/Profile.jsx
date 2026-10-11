import { useState, useRef, lazy, Suspense } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useUpdateOwnProfile, useUploadAvatar, useRemoveAvatar } from '../hooks/useSettings'
import { Loader2, Camera, Phone, Check } from 'lucide-react'
import { DISPLAY } from '../lib/exportStyles'
import { roleLabel } from '../lib/roleLabels'
import { Switch } from '../components/ui/Switch'
import { Segmented } from '../components/ui/Segmented'
import { Avatar } from '../components/ui/Avatar'
import { OvField } from '../components/agent/AgentUI'
// Prompt 422 — lazy, not a top-level import: react-easy-crop pushed the
// main bundle bigger. It's only
// ever needed inside this one rarely-opened modal, so it belongs in its own
// chunk rather than in every user's initial load.
const AvatarCropModal = lazy(() =>
  import('../components/ui/AvatarCropModal').then(m => ({ default: m.AvatarCropModal }))
)

// Profile — the first section of Settings (Prompt 674 folded it back in;
// /profile redirects to /settings#profile).
//
// Prompt 720 — rebuilt on the v16 language. What's editable: photo, full
// name and phone. Username and email are gone from here: usernames no longer
// exist in the portal, and the sign-in email changes only in Sign-in &
// security (through Supabase auth) so profiles.email can't drift from it.
// The email is shown in one place only (Sign-in & security); Profile has no
// email row (P741).
// The NPN / licensed-states gap note is gone too (no "not available" notes
// on Settings).

export function ProfilePanel({ profile }) {
  const update = useUpdateOwnProfile()
  const { refreshProfile } = useAuth()
  const [form, setForm] = useState({
    full_name: profile.full_name || '',
    phone: profile.phone || '',
  })
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const dirty = Object.entries(form).some(([k, v]) => v !== (profile[k] || ''))

  async function save() {
    setError('')
    if (!form.full_name.trim()) return setError('Name can’t be empty')
    try {
      await update.mutateAsync({ profileId: profile.id, updates: { full_name: form.full_name.trim(), phone: form.phone.trim() || null } })
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
    <section className="ov-card ov-set-card" aria-label="Profile" style={{ gap: 22 }}>
      <AvatarUpload profile={profile} joined={joined} />

      <div className="ov-set-2">
        <OvField label="Full name" autoComplete="name" value={form.full_name}
          onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} error={!!error && !form.full_name.trim()} />
        <OvField label="Phone" icon={Phone} inputMode="tel" autoComplete="tel" placeholder="(602) 555-0143" value={form.phone}
          onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
      </div>

      {error && <p style={{ margin: 0, fontSize: 13.5, color: 'var(--danger)' }}>{error}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="ov-buy ov-set-btn" onClick={save} disabled={!dirty || update.isPending}>
          {update.isPending ? <Loader2 size={15} className="animate-spin" />
            : saved && !dirty ? <><Check size={15} strokeWidth={2.4} /> Saved</> : 'Save changes'}
        </button>
        <span style={{ fontSize: 13, color: 'var(--ov-mute)' }}>Changes show on your bookings and in Messages</span>
      </div>

      {profile.role === 'admin' && <WritesBusinessField profile={profile} />}

      {profile.role === 'admin' && profile.also_writes_business && (
        <DefaultViewScopeField profile={profile} />
      )}
    </section>
  )
}

// Profile photo upload (Prompt 407) — uploads to the `avatars` bucket and
// updates profiles.avatar_url immediately. Falls back to the shared
// two-initial colored Avatar (avatar_color, migration 096) when no photo is
// set. Prompt 422 — a picked file opens a crop/zoom modal first; "Remove"
// drops back to initials and deletes the stored file too. P720: the avatar
// circle and "Upload photo" both open the picker.
function AvatarUpload({ profile, joined }) {
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', paddingBottom: 22, borderBottom: '1px solid var(--ov-line)' }}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label="Change profile photo"
        style={{ position: 'relative', width: 84, height: 84, flexShrink: 0, border: 'none', padding: 0, borderRadius: '50%', cursor: busy ? 'default' : 'pointer', background: 'transparent' }}
      >
        <Avatar profile={profile} size={84} style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 600 }} />
        {busy && (
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}>
            <Loader2 size={18} color="#fff" className="animate-spin" />
          </span>
        )}
        <span className="ov-solid" style={{
          position: 'absolute', right: -2, bottom: -2, width: 32, height: 32, borderRadius: '50%', boxSizing: 'border-box',
          border: '3px solid var(--ov-page)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Camera size={14} strokeWidth={2.2} />
        </span>
      </button>
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 600, color: 'var(--ov-hi)', overflowWrap: 'anywhere' }}>{profile.full_name}</div>
        <div style={{ marginTop: 3, fontSize: 14, color: 'var(--ov-mute)' }}>
          {roleLabel(profile.role)}{joined ? ` · joined ${joined}` : ''}
        </div>
        {error && <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--danger)' }}>{error}</p>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="ov-ghost ov-set-btn" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Camera size={15} strokeWidth={2} /> Upload photo
        </button>
        {profile.avatar_url && (
          <button type="button" className="ov-set-link" style={{ padding: '0 12px', height: 44 }} onClick={onRemove} disabled={busy}>Remove</button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
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

const rowStyle = { display: 'flex', alignItems: 'center', gap: 14, paddingTop: 18, borderTop: '1px solid var(--ov-line)' }

// "Default view" (Prompt 405/413) — only meaningful once a You/Everyone(/Team)
// toggle exists for this account: admin AND "I'm also actively writing
// business" on. Same `overview_default_scope` column and write path; it
// drives Overview, My Policies' and Performance's initial scope.
function DefaultViewScopeField({ profile }) {
  const update = useUpdateOwnProfile()
  const { refreshProfile } = useAuth()

  async function setDefaultScope(next) {
    await update.mutateAsync({ profileId: profile.id, updates: { overview_default_scope: next } })
    await refreshProfile()
  }

  return (
    <div style={rowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>Default view</p>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--ov-mute)' }}>
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
// You/Team toggle on Performance (Prompt 396).
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
    <div style={rowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>
          I'm also actively writing business
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--ov-mute)' }}>
          On shows a personal You view (and goal) alongside your team numbers, on Overview and Performance.
        </p>
      </div>
      <Switch checked={!!profile.also_writes_business} onChange={toggle} disabled={pending} />
    </div>
  )
}
