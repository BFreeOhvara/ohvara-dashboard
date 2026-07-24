import { useState } from 'react'
import { ExternalLink, Phone, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCarriers, useSaveCarrier, useDeleteCarrier } from '../../hooks/useCarriers'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

// Carrier Portals — its own page as of Round 38 (split out of Submissions).
//
// Ships with an empty directory on purpose: which carriers the team is
// actually appointed with, and their real portal URLs and phone numbers, is
// an open question flagged back to Brayden. Admin fills it in here rather
// than the app shipping invented carriers that look real.
const BLANK = { name: '', portal_url: '', new_business_phone: '', agent_service_phone: '', notes: '' }

export default function CarrierPortals() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { data: carriers = [], isLoading } = useCarriers()
  const save = useSaveCarrier()
  const del = useDeleteCarrier()

  const [form, setForm] = useState(BLANK)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  function submit() {
    setError('')
    if (!form.name.trim()) return setError('Enter the carrier name')
    save.mutate(
      {
        name: form.name.trim(),
        portal_url: form.portal_url.trim() || null,
        new_business_phone: form.new_business_phone.trim() || null,
        agent_service_phone: form.agent_service_phone.trim() || null,
        notes: form.notes.trim() || null,
      },
      {
        onSuccess: () => { setForm(BLANK); setAdding(false) },
        onError: err => setError(err.message || 'Could not save this carrier'),
      }
    )
  }

  return (
    <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
            Carrier Portals
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Portal links and the numbers to call for new business or agent service.
          </p>
        </div>
        {isAdmin && (
          <Button size="md" onClick={() => setAdding(v => !v)}>
            <Plus size={14} /> Add carrier
          </Button>
        )}
      </div>

      {isAdmin && adding && (
        <div className="glass" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <Input label="Carrier Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Carrier" />
            <Input label="Portal URL" value={form.portal_url} onChange={e => setForm(f => ({ ...f, portal_url: e.target.value }))} placeholder="https://…" />
            <Input label="New Business Phone" value={form.new_business_phone} onChange={e => setForm(f => ({ ...f, new_business_phone: e.target.value }))} placeholder="(555) 010-0000" />
            <Input label="Agent Service Phone" value={form.agent_service_phone} onChange={e => setForm(f => ({ ...f, agent_service_phone: e.target.value }))} placeholder="(555) 010-0000" />
          </div>
          {error && <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="md" onClick={submit} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save carrier'}
            </Button>
            <Button size="md" variant="ghost" onClick={() => { setAdding(false); setForm(BLANK); setError('') }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading carriers…</p>
      ) : carriers.length === 0 ? (
        <div className="glass" style={{ padding: 40, textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--text-primary)', margin: 0 }}>No carriers added yet</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.6 }}>
            {isAdmin
              ? 'Add the carriers the team is appointed with, along with their portal link and phone numbers.'
              : 'Ask an admin to add the carriers your team is appointed with.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {carriers.map(c => (
            <div key={c.id} className="glass" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{c.name}</p>
                {isAdmin && (
                  <button
                    onClick={() => del.mutate(c.id)}
                    title="Remove carrier"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <PhoneLine label="New business" value={c.new_business_phone} />
                <PhoneLine label="Agent service" value={c.agent_service_phone} />
              </div>

              {c.portal_url && (
                <a
                  href={c.portal_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 12, color: 'var(--accent)', textDecoration: 'none', marginTop: 2,
                  }}
                >
                  <ExternalLink size={13} /> Open Portal
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PhoneLine({ label, value }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Phone size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <a
        href={`tel:${value.replace(/[^\d+]/g, '')}`}
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)', textDecoration: 'none', marginLeft: 'auto' }}
      >
        {value}
      </a>
    </div>
  )
}
