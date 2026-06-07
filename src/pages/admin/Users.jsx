import { useState } from 'react'
import { useAllProfiles, useCreateProfile } from '../../hooks/useProfiles'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Card } from '../../components/ui/Card'
import { UserPlus, X } from 'lucide-react'

export default function Users() {
  const { data: profiles, isLoading } = useAllProfiles()
  const createProfile = useCreateProfile()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'rep', phone: '' })
  const [error, setError] = useState('')

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    try {
      await createProfile.mutateAsync(form)
      setShowForm(false)
      setForm({ email: '', password: '', full_name: '', role: 'rep', phone: '' })
    } catch (err) {
      setError(err.message || 'Failed to create user')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Users</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage reps, closers, and admins</p>
        </div>
        <Button onClick={() => setShowForm(v => !v)} size="sm">
          <UserPlus size={14} />
          New User
        </Button>
      </div>

      {showForm && (
        <Card className="mb-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-slate-100">Create New User</p>
            <button onClick={() => setShowForm(false)} className="text-slate-500 hover:text-slate-300">
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3">
            <Input label="Full Name" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} required />
            <Input label="Email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
            <Input label="Password" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={8} />
            <Input label="Phone (optional)" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            <Select label="Role" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="rep">Rep</option>
              <option value="closer">Closer</option>
              <option value="admin">Admin</option>
            </Select>
            <div className="flex items-end">
              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
            <div className="col-span-2 flex gap-2">
              <Button type="submit" disabled={createProfile.isPending}>
                {createProfile.isPending ? 'Creating…' : 'Create User'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="bg-[#161b24] border border-[#2a3347] rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a3347]">
                <th className="px-4 py-3 text-xs text-slate-500 font-medium text-left">Name</th>
                <th className="px-4 py-3 text-xs text-slate-500 font-medium text-left">Email</th>
                <th className="px-4 py-3 text-xs text-slate-500 font-medium text-left">Role</th>
                <th className="px-4 py-3 text-xs text-slate-500 font-medium text-left">Status</th>
                <th className="px-4 py-3 text-xs text-slate-500 font-medium text-left">Joined</th>
              </tr>
            </thead>
            <tbody>
              {(profiles || []).map(p => (
                <tr key={p.id} className="border-b border-[#2a3347]/50 hover:bg-[#1e2433]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-indigo-900/30 flex items-center justify-center text-xs font-medium text-indigo-300">
                        {p.full_name.charAt(0)}
                      </div>
                      <p className="text-slate-200 font-medium">{p.full_name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{p.email}</td>
                  <td className="px-4 py-3"><Badge label={p.role} /></td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${p.is_active ? 'text-green-400' : 'text-red-400'}`}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {new Date(p.created_at).toLocaleDateString()}
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
