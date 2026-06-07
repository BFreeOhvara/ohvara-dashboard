import { useState } from 'react'
import { useAllProfiles, useCreateProfile, useToggleUserActive } from '../../hooks/useProfiles'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Card } from '../../components/ui/Card'
import { UserPlus, X, CheckCircle, Mail } from 'lucide-react'

export default function Users() {
  const { data: profiles, isLoading } = useAllProfiles()
  const createProfile = useCreateProfile()
  const toggleActive = useToggleUserActive()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'rep', phone: '' })
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    setSuccessMsg('')
    try {
      const result = await createProfile.mutateAsync(form)
      const emailNote = result?.email_sent
        ? `Welcome email sent to ${form.email}.`
        : `Account created. No welcome email sent — add SENDGRID_API_KEY to Edge Function secrets to enable.`
      setSuccessMsg(emailNote)
      setShowForm(false)
      setForm({ email: '', password: '', full_name: '', role: 'rep', phone: '' })
    } catch (err) {
      setError(err.message || 'Failed to create user')
    }
  }

  async function handleToggle(profile) {
    await toggleActive.mutateAsync({ userId: profile.id, isActive: !profile.is_active })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Users</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">
            Create and manage reps, closers, and admins
          </p>
        </div>
        <Button onClick={() => { setShowForm(v => !v); setSuccessMsg('') }} size="sm">
          <UserPlus size={14} />
          New User
        </Button>
      </div>

      {/* Success message */}
      {successMsg && (
        <div className="flex items-start gap-2 bg-green-900/20 border border-green-800 rounded-lg px-4 py-3 mb-4">
          <CheckCircle size={15} className="text-green-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-300">{successMsg}</p>
        </div>
      )}

      {/* Create user form */}
      {showForm && (
        <Card className="mb-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Create New User</p>
            <button onClick={() => setShowForm(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3">
            <Input
              label="Full Name"
              value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              placeholder="Jordan Smith"
              required
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="jordan@ohvara.com"
              required
            />
            <Input
              label="Temporary Password"
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="Min 8 characters"
              required
              minLength={8}
            />
            <Input
              label="Phone (optional)"
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="+1 555 000 0000"
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
            <div className="flex items-end">
              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
            <div className="col-span-2 flex items-center gap-2 pt-1">
              <Button type="submit" disabled={createProfile.isPending}>
                {createProfile.isPending ? 'Creating…' : 'Create User'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <p className="text-xs text-[var(--text-muted)] ml-2 flex items-center gap-1">
                <Mail size={11} />
                Welcome email sent automatically if SendGrid is configured
              </p>
            </div>
          </form>
        </Card>
      )}

      {/* User table */}
      <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium text-left">Name</th>
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium text-left">Email</th>
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium text-left">Role</th>
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium text-left">Status</th>
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium text-left">Joined</th>
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(profiles || []).map(p => (
                <tr key={p.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-2)] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-indigo-900/30 flex items-center justify-center text-xs font-semibold text-indigo-300 flex-shrink-0">
                        {p.full_name.charAt(0).toUpperCase()}
                      </div>
                      <p className="text-[var(--text-secondary)] font-medium">{p.full_name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{p.email}</td>
                  <td className="px-4 py-3"><Badge label={p.role} /></td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${p.is_active ? 'text-green-400' : 'text-red-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${p.is_active ? 'bg-green-400' : 'bg-red-400'}`} />
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] text-xs">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant={p.is_active ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => handleToggle(p)}
                      disabled={toggleActive.isPending}
                    >
                      {p.is_active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
