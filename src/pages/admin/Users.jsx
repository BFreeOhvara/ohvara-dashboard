import { useState, useMemo } from 'react'
import { useAllProfiles, useCreateProfile, useToggleUserActive, useDeleteUser, useRepCredentials } from '../../hooks/useProfiles'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Card } from '../../components/ui/Card'
import { UserPlus, X, CheckCircle, Copy, Check, Search, Trash2, AlertTriangle, KeyRound, Eye, EyeOff } from 'lucide-react'

function CredentialsReveal({ profileId }) {
  const { data, isLoading, error } = useRepCredentials(profileId, true)
  const [showUser, setShowUser] = useState(false)
  const [showPass, setShowPass] = useState(false)

  if (isLoading) {
    return <p className="text-[10px] text-[var(--text-muted)] mt-1.5">Loading…</p>
  }
  if (error || !data) {
    return <p className="text-[10px] text-[#EF4444] mt-1.5">No saved login for this account.</p>
  }

  return (
    <div className="flex items-center gap-3 mt-1.5 font-mono text-[10px]">
      <span className="flex items-center gap-1 text-[var(--text-muted)]">
        User: <span className="text-[var(--text-secondary)]">{showUser ? data.username : '••••••••'}</span>
        <button onClick={() => setShowUser(v => !v)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          {showUser ? <EyeOff size={11} /> : <Eye size={11} />}
        </button>
      </span>
      <span className="flex items-center gap-1 text-[var(--text-muted)]">
        Pass: <span className="text-[var(--text-secondary)]">{showPass ? data.password : '••••••••'}</span>
        <button onClick={() => setShowPass(v => !v)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          {showPass ? <EyeOff size={11} /> : <Eye size={11} />}
        </button>
      </span>
    </div>
  )
}

function formatDate(iso) {
  if (!iso) return <span className="text-[var(--text-muted)] opacity-40">Never</span>
  const d = new Date(iso)
  const now = new Date()
  const diff = now - d
  if (diff < 60000)       return 'Just now'
  if (diff < 3600000)     return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000)    return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

export default function Users() {
  const { data: profiles, isLoading } = useAllProfiles()
  const createProfile = useCreateProfile()
  const toggleActive  = useToggleUserActive()
  const deleteUser    = useDeleteUser()

  const [showForm,     setShowForm]     = useState(false)
  const [form,         setForm]         = useState({ username: '', password: '', full_name: '', role: 'rep' })
  const [formError,    setFormError]    = useState('')
  const [createdCreds, setCreatedCreds] = useState(null)
  const [copied,       setCopied]       = useState(false)

  const [search,       setSearch]       = useState('')
  const [roleFilter,   setRoleFilter]   = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const [confirmDelete, setConfirmDelete] = useState(null) // profile object
  const [viewingCreds,  setViewingCreds]  = useState(null) // profile id with login panel open

  // Filtered profiles
  const filtered = useMemo(() => {
    if (!profiles) return []
    return profiles.filter(p => {
      const matchSearch = !search ||
        p.full_name.toLowerCase().includes(search.toLowerCase()) ||
        (p.username || '').toLowerCase().includes(search.toLowerCase())
      const matchRole = roleFilter === 'all' || p.role === roleFilter
      const matchStatus = statusFilter === 'all'
        || (statusFilter === 'active' && p.is_active)
        || (statusFilter === 'inactive' && !p.is_active)
      return matchSearch && matchRole && matchStatus
    })
  }, [profiles, search, roleFilter, statusFilter])

  async function handleCreate() {
    setFormError('')
    try {
      await createProfile.mutateAsync(form)
      setCreatedCreds({ username: form.username, password: form.password, full_name: form.full_name })
      setShowForm(false)
      setForm({ username: '', password: '', full_name: '', role: 'rep' })
    } catch (err) {
      setFormError(err.message || 'Failed to create user')
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(
      `Username: ${createdCreds.username}\nPassword: ${createdCreds.password}`
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleToggle(profile) {
    await toggleActive.mutateAsync({ userId: profile.id, isActive: !profile.is_active })
  }

  async function handleDelete() {
    if (!confirmDelete) return
    await deleteUser.mutateAsync({ userId: confirmDelete.id })
    setConfirmDelete(null)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1>Users</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            {profiles?.length ?? '…'} accounts · {profiles?.filter(p => p.is_active).length ?? '…'} active
          </p>
        </div>
        <Button onClick={() => { setShowForm(v => !v); setCreatedCreds(null) }} size="sm">
          <UserPlus size={14} />
          New User
        </Button>
      </div>

      {/* Credential handoff */}
      {createdCreds && (
        <div className="flex items-start justify-between gap-3 bg-[#22C55E]/8 border border-[#22C55E]/20 rounded-[10px] px-4 py-3 mb-4">
          <div className="flex items-start gap-2.5">
            <CheckCircle size={15} className="text-[#22C55E] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">{createdCreds.full_name} — account ready</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Username: <span className="font-mono text-[var(--text-secondary)]">{createdCreds.username}</span>
                <span className="mx-2 opacity-40">·</span>
                Password: <span className="font-mono text-[var(--text-secondary)]">{createdCreds.password}</span>
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={handleCopy} className="flex-shrink-0">
            {copied ? <><Check size={12} />Copied</> : <><Copy size={12} />Copy</>}
          </Button>
        </div>
      )}

      {/* Create user form */}
      {showForm && (
        <Card className="mb-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-[var(--text-primary)]">Create New User</p>
            <button onClick={() => setShowForm(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Full Name"
              value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              placeholder="Jordan Smith"
              required
            />
            <Input
              label="Username"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))}
              placeholder="jsmith"
              autoComplete="off"
              required
            />
            <Input
              label="Password"
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="Min 8 characters"
              autoComplete="new-password"
              required
              minLength={8}
            />
            <Select
              label="Role"
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            >
              <option value="rep">Rep</option>
              <option value="closer">Closer</option>
              <option value="admin">Admin</option>
            </Select>
            {formError && (
              <div className="col-span-2">
                <p className="text-xs text-[#EF4444]">{formError}</p>
              </div>
            )}
            <div className="col-span-2 flex items-center gap-2 pt-1">
              <Button onClick={handleCreate} size="sm" disabled={createProfile.isPending}>
                {createProfile.isPending ? 'Creating…' : 'Create User'}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            className="w-full bg-[var(--bg-1)] border border-[var(--border)] rounded-lg pl-8 pr-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[#6C63FF]/30 transition-all"
            placeholder="Search name or username…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="bg-[var(--bg-1)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
        >
          <option value="all">All roles</option>
          <option value="rep">Rep</option>
          <option value="closer">Closer</option>
          <option value="admin">Admin</option>
        </select>
        <select
          className="bg-[var(--bg-1)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* User table */}
      <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-[10px] overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-[var(--text-muted)] text-sm">No users match this filter</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-3 text-left text-xs text-[var(--text-muted)] font-medium">User</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--text-muted)] font-medium">Role</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--text-muted)] font-medium">Status</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--text-muted)] font-medium">Joined</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--text-muted)] font-medium">Last Login</th>
                <th className="px-4 py-3 text-right text-xs text-[var(--text-muted)] font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-b border-[var(--border)]/40 hover:bg-[var(--bg-2)] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0
                        ${p.is_active ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' : 'bg-[var(--bg-3)] text-[var(--text-muted)]'}`}>
                        {p.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className={`font-medium text-[var(--text-primary)] text-sm leading-tight ${!p.is_active ? 'opacity-60' : ''}`}>
                          {p.full_name}
                        </p>
                        <p className="font-mono text-[10px] text-[var(--text-muted)] leading-tight mt-0.5">
                          {p.username ? `@${p.username}` : <span className="opacity-40">no username</span>}
                        </p>
                        {viewingCreds === p.id && <CredentialsReveal profileId={p.id} />}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge label={p.role} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${p.is_active ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${p.is_active ? 'bg-[#22C55E]' : 'bg-[#EF4444]'}`} />
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] text-xs">
                    {formatDate(p.created_at)}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] text-xs">
                    {formatDate(p.last_login_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setViewingCreds(v => v === p.id ? null : p.id)}
                        className={`p-1.5 rounded-lg transition-all ${viewingCreds === p.id ? 'text-[var(--accent)] bg-[var(--accent-subtle)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-3)]'}`}
                        title="View login"
                      >
                        <KeyRound size={13} />
                      </button>
                      <Button
                        variant={p.is_active ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => handleToggle(p)}
                        disabled={toggleActive.isPending}
                      >
                        {p.is_active ? 'Deactivate' : 'Reactivate'}
                      </Button>
                      <button
                        onClick={() => setConfirmDelete(p)}
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-all"
                        title="Delete account"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-[var(--bg-1)] border border-[var(--border)] rounded-[10px] p-6 w-full max-w-sm page-enter">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-[10px] bg-[#EF4444]/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={18} className="text-[#EF4444]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Delete account permanently?</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  <span className="text-[var(--text-secondary)] font-medium">{confirmDelete.full_name}</span>
                  {confirmDelete.username ? ` (@${confirmDelete.username})` : ''} will be permanently removed from auth and profiles. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 justify-end">
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleteUser.isPending}>
                {deleteUser.isPending ? 'Deleting…' : 'Delete Account'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
