import { useMemo, useState } from 'react'
import { Search, Users as UsersIcon, Copy, Check, Trash2, AlertTriangle, KeyRound, Eye, EyeOff, X } from 'lucide-react'
import {
  useAllProfiles, useCreateProfile, useToggleUserActive, useDeleteUser,
  useRepCredentials, usePendingInvites, useCreateInvite, useRevokeInvite,
} from '../../hooks/useProfiles'
import { useAuth } from '../../hooks/useAuth'
import { SELECTABLE_TIMEZONES, DEFAULT_TIMEZONE } from '../../lib/timezones'
import { roleLabel } from '../../lib/roleLabels'
import { MONO, card, grid3, primaryBtn, ghostBtn } from '../../lib/exportStyles'
import { TextField, AnchoredSelectField, GapNote } from '../../components/ui/ExportForm'
import { Avatar } from '../../components/ui/Avatar'

// Users & Access — literal port of the export's "Admin · Users" screen
// (vault: media/claude-design-export-ohvara-dashboard-v3.html, lines
// 1044-1093): search + Invite user toolbar, one bordered table (User / Role /
// Status / 2FA / Last active / actions), and the pending-invite bar beneath
// it.
//
// Flagged deviations:
//  · The export's per-row "Edit" button has no screen behind it — there's no
//    admin profile-edit form in this app — so the row keeps the actions that
//    are real: reveal login, deactivate/reactivate, delete.
//  · 2FA renders an em-dash for every user. Supabase MFA isn't enabled on the
//    project, so a green check would be a lie.
//  · "Resend" on an invite needs email infrastructure that doesn't exist —
//    invites are shared by hand, so it's Copy instead.
//  · The export has no create-user form. Kept behind a second button: it's
//    the only way to make the first account (Nate's), before any invite
//    link can exist.

const th = {
  padding: '11px 16px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'left',
  borderBottom: 'var(--border-w) solid var(--border)', whiteSpace: 'nowrap',
}
const td = { padding: '12px 16px', borderBottom: 'var(--border-w) solid var(--border)' }

const ROLE_STYLE = {
  admin:       { color: 'var(--accent)',  dim: 'var(--accent-dim)',  bd: 'var(--accent-border)' },
  closer:      { color: 'var(--info)',    dim: 'var(--info-dim)',    bd: 'var(--info-bd)' },
  rep:         { color: 'var(--text-secondary)', dim: 'var(--bg-elevated)', bd: 'var(--border)' },
  client:      { color: 'var(--text-secondary)', dim: 'var(--bg-elevated)', bd: 'var(--border)' },
  fulfillment: { color: 'var(--warning)', dim: 'var(--warning-dim)', bd: 'var(--warning-bd)' },
}

function Pill({ children, style }) {
  return (
    <span style={{
      display: 'inline-flex', padding: '2px 7px', borderRadius: 4,
      fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', ...style,
    }}>
      {children}
    </span>
  )
}

function lastActive(iso) {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function Users() {
  const { profile } = useAuth()
  const { data: profiles, isLoading } = useAllProfiles()
  const createProfile = useCreateProfile()
  const toggleActive = useToggleUserActive()
  const deleteUser = useDeleteUser()
  const { data: invites = [] } = usePendingInvites()
  const createInvite = useCreateInvite()
  const revokeInvite = useRevokeInvite()

  const [search, setSearch] = useState('')
  const [inviteRole, setInviteRole] = useState('closer')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', full_name: '', role: 'closer', timezone: DEFAULT_TIMEZONE })
  const [formError, setFormError] = useState('')
  const [createdCreds, setCreatedCreds] = useState(null)
  const [copied, setCopied] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [viewingCreds, setViewingCreds] = useState(null)

  const rows = useMemo(() => {
    if (!profiles) return []
    const q = search.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter(p =>
      [p.full_name, p.username, p.email].filter(Boolean).join(' ').toLowerCase().includes(q)
    )
  }, [profiles, search])

  const linkFor = token => `${window.location.origin}/join/${token}`

  async function copyLink(inv) {
    try {
      await navigator.clipboard.writeText(linkFor(inv.token))
      setCopied(inv.id)
      setTimeout(() => setCopied(null), 2000)
    } catch { /* clipboard can be blocked — the link is on screen anyway */ }
  }

  async function generateInvite() {
    setFormError('')
    try {
      const inv = await createInvite.mutateAsync({ role: inviteRole, createdBy: profile.id })
      copyLink(inv)
    } catch (err) {
      setFormError(err.message || 'Failed to create invite')
    }
  }

  async function handleCreate() {
    setFormError('')
    try {
      await createProfile.mutateAsync(form)
      setCreatedCreds({ username: form.username, password: form.password, full_name: form.full_name })
      setFormOpen(false)
      setForm({ username: '', password: '', full_name: '', role: 'closer', timezone: DEFAULT_TIMEZONE })
    } catch (err) {
      setFormError(err.message || 'Failed to create user')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 10px',
          background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
          borderRadius: 6, width: 240,
        }}>
          <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search users…"
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }}
          />
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => { setFormOpen(v => !v); setInviteOpen(false); setCreatedCreds(null) }} style={{ ...ghostBtn, height: 30 }}>
          New user
        </button>
        <button
          onClick={() => { setInviteOpen(v => !v); setFormOpen(false) }}
          style={{ ...primaryBtn, height: 30, padding: '0 14px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <UsersIcon size={12} /> Invite user
        </button>
      </div>

      {inviteOpen && (
        <div style={{ ...card, marginBottom: 16 }}>
          <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Invite link</p>
          <p style={{ margin: '0 0 14px', fontSize: 11.5, color: 'var(--text-muted)' }}>
            Single-use, 7-day expiry. They pick their own password — you only pick the role. Whoever claims it
            joins under you in the hierarchy.
          </p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <AnchoredSelectField
              label="Role" value={inviteRole} onChange={setInviteRole} style={{ width: 160 }}
              options={[
                { value: 'closer', label: 'Closer' },
                { value: 'rep', label: 'Setter' },
                { value: 'admin', label: 'Admin' },
                { value: 'fulfillment', label: 'Fulfillment' },
              ]}
            />
            <button onClick={generateInvite} disabled={createInvite.isPending} style={{ ...primaryBtn, height: 34, opacity: createInvite.isPending ? 0.6 : 1 }}>
              {createInvite.isPending ? 'Generating…' : 'Generate & copy link'}
            </button>
          </div>
        </div>
      )}

      {formOpen && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <p style={{ margin: 0, flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Create user directly</p>
            <button onClick={() => setFormOpen(false)} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', display: 'inline-flex', padding: 2 }}>
              <X size={14} />
            </button>
          </div>
          <div style={grid3}>
            <TextField label="Full name" placeholder="Nate Rivera" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
            <TextField label="Username" mono placeholder="nrivera" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))} />
            <TextField label="Password" type="password" placeholder="Min 8 characters" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            <AnchoredSelectField
              label="Role" value={form.role} onChange={val => setForm(f => ({ ...f, role: val }))}
              options={[
                { value: 'closer', label: 'Closer' },
                { value: 'rep', label: 'Setter' },
                { value: 'admin', label: 'Admin' },
                { value: 'fulfillment', label: 'Fulfillment' },
              ]}
            />
            <AnchoredSelectField
              label="Timezone" value={form.timezone} onChange={val => setForm(f => ({ ...f, timezone: val }))}
              options={SELECTABLE_TIMEZONES.map(tz => ({ value: tz.value, label: tz.label }))}
            />
          </div>
          <button onClick={handleCreate} disabled={createProfile.isPending} style={{ ...primaryBtn, height: 34, opacity: createProfile.isPending ? 0.6 : 1 }}>
            {createProfile.isPending ? 'Creating…' : 'Create user'}
          </button>
          <GapNote>
            An account made here has no upline, so it starts its own chain on Hierarchy. Invite links are the
            normal path — they stamp the recruiter automatically.
          </GapNote>
        </div>
      )}

      {formError && <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--danger)' }}>{formError}</p>}

      {createdCreds && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16,
          padding: '14px 18px', borderRadius: 8,
          background: 'var(--success-dim)', border: '1px solid var(--success-bd)',
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
              {createdCreds.full_name} — account ready
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO }}>
              {createdCreds.username} · {createdCreds.password}
            </p>
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(`Username: ${createdCreds.username}\nPassword: ${createdCreds.password}`)
              setCopied('creds'); setTimeout(() => setCopied(null), 2000)
            }}
            style={{ ...ghostBtn, height: 28 }}
          >
            {copied === 'creds' ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
          </button>
        </div>
      )}

      <div style={{ background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>User</th>
                <th style={th}>Role</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'center' }}>2FA</th>
                <th style={{ ...th, textAlign: 'right' }}>Last active</th>
                <th style={{ ...th, textAlign: 'right' }} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} style={{ ...td, fontSize: 12.5, color: 'var(--text-muted)' }}>Loading users…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} style={{ ...td, fontSize: 12.5, color: 'var(--text-muted)' }}>No users match this search.</td></tr>
              ) : rows.map(u => {
                const rs = ROLE_STYLE[u.role] || ROLE_STYLE.rep
                return (
                  <tr key={u.id}>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar profile={u} size={26} style={{ opacity: u.is_active ? 1 : 0.45 }} />
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{u.full_name}</p>
                          <p style={{ margin: '1px 0 0', fontSize: 10.5, color: 'var(--text-muted)', fontFamily: MONO }}>
                            {u.username ? `@${u.username}` : u.email || 'no username'}
                          </p>
                          {viewingCreds === u.id && <CredentialsReveal profileId={u.id} />}
                        </div>
                      </div>
                    </td>
                    <td style={td}>
                      <Pill style={{ background: rs.dim, color: rs.color, border: `1px solid ${rs.bd}` }}>{roleLabel(u.role)}</Pill>
                    </td>
                    <td style={td}>
                      <Pill style={u.is_active
                        ? { background: 'var(--success-dim)', color: 'var(--success)', border: '1px solid var(--success-bd)' }
                        : { background: 'var(--danger-dim)', color: 'var(--danger)', border: '1px solid var(--danger-bd)' }}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </Pill>
                    </td>
                    <td style={{ ...td, textAlign: 'center', color: 'var(--text-muted)', fontFamily: MONO, fontSize: 12 }}>—</td>
                    <td style={{ ...td, textAlign: 'right', fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
                      {lastActive(u.last_login_at)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => setViewingCreds(v => (v === u.id ? null : u.id))}
                        title="Reveal saved login"
                        style={{
                          height: 26, width: 26, marginRight: 6, borderRadius: 6,
                          border: 'var(--border-w) solid var(--border)',
                          background: viewingCreds === u.id ? 'var(--accent-dim)' : 'transparent',
                          color: viewingCreds === u.id ? 'var(--accent)' : 'var(--text-muted)',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <KeyRound size={12} />
                      </button>
                      <button
                        onClick={() => toggleActive.mutate({ userId: u.id, isActive: !u.is_active })}
                        disabled={toggleActive.isPending}
                        style={{
                          height: 26, padding: '0 10px', marginRight: 6, borderRadius: 6, fontSize: 11,
                          border: u.is_active ? '1px solid var(--danger-bd)' : 'var(--border-w) solid var(--border)',
                          background: u.is_active ? 'var(--danger-dim)' : 'transparent',
                          color: u.is_active ? 'var(--danger)' : 'var(--text-secondary)',
                        }}
                      >
                        {u.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(u)}
                        title="Delete account"
                        style={{ height: 26, width: 26, borderRadius: 6, border: 'var(--border-w) solid var(--border)', background: 'transparent', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <GapNote>
        2FA reads as an em-dash for everyone — MFA isn't enabled on this Supabase project, so no account can
        have it yet.
      </GapNote>

      {invites.length > 0 && invites.map(inv => (
        <div
          key={inv.id}
          style={{
            marginTop: 14, ...card, padding: '16px 20px',
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}
        >
          <UsersIcon size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 200, fontSize: 12, color: 'var(--text-secondary)' }}>
            Pending invite — <span style={{ color: 'var(--text-primary)' }}>{roleLabel(inv.role)}</span>, expires{' '}
            {new Date(inv.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
          <button onClick={() => copyLink(inv)} style={{ ...ghostBtn, height: 26, background: 'transparent' }}>
            {copied === inv.id ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy link</>}
          </button>
          <button onClick={() => revokeInvite.mutate(inv.id)} style={{ ...ghostBtn, height: 26, background: 'transparent' }}>
            Revoke
          </button>
        </div>
      ))}

      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} onClick={() => setConfirmDelete(null)} />
          <div style={{
            position: 'relative', width: '100%', maxWidth: 380, padding: 24, borderRadius: 12,
            background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--danger-dim)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <AlertTriangle size={17} style={{ color: 'var(--danger)' }} />
              </span>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Delete account permanently?</p>
                <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  {confirmDelete.full_name} will be removed from auth and profiles. Anyone they recruited keeps
                  their own account but loses this upline. This can't be undone.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelete(null)} style={{ ...ghostBtn, height: 32 }}>Cancel</button>
              <button
                onClick={async () => { await deleteUser.mutateAsync({ userId: confirmDelete.id }); setConfirmDelete(null) }}
                disabled={deleteUser.isPending}
                style={{ height: 32, padding: '0 14px', borderRadius: 6, border: '1px solid var(--danger-bd)', background: 'var(--danger-dim)', color: 'var(--danger)', fontSize: 12, fontWeight: 700 }}
              >
                {deleteUser.isPending ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CredentialsReveal({ profileId }) {
  const { data, isLoading, error } = useRepCredentials(profileId, true)
  const [show, setShow] = useState(false)

  if (isLoading) return <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--text-muted)' }}>Loading…</p>
  if (error || !data) return <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--danger)' }}>No saved login for this account.</p>

  return (
    <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {show ? `${data.username} · ${data.password}` : '•••••••• · ••••••••'}
      <button onClick={() => setShow(v => !v)} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', display: 'inline-flex', padding: 0 }}>
        {show ? <EyeOff size={11} /> : <Eye size={11} />}
      </button>
    </p>
  )
}
