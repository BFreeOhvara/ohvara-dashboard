import { useState } from 'react'
import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCarriers, useSaveCarrier, useDeleteCarrier } from '../../hooks/useCarriers'
import { MONO, card, grid3, primaryBtn, ghostBtn } from '../../lib/exportStyles'
import { TextField, GapNote } from '../../components/ui/ExportForm'

// Carrier Portals — literal port of the export's "Closer · Carrier Portals"
// screen (vault: media/claude-design-export-ohvara-dashboard-v3.html, lines
// 1456-1471): one 820px card, a titled header strip, then a divided row per
// carrier — name, phone, Open Portal.
//
// Flagged deviations:
//  · The export's row carries a single phone number; the real `carriers` table
//    holds two (new business + agent service), which is the distinction that
//    actually matters on a call. Both render, labelled.
//  · Admin add/remove isn't in the export at all. It has to be here: the
//    directory ships EMPTY on purpose — which carriers the team is appointed
//    with, and their real URLs and numbers, is still an open question back to
//    Brayden, and inventing plausible carriers would be worse than none.
const BLANK = { name: '', portal_url: '', new_business_phone: '', agent_service_phone: '' }

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
      },
      {
        onSuccess: () => { setForm(BLANK); setAdding(false) },
        onError: err => setError(err.message || 'Could not save this carrier'),
      }
    )
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 24px', borderBottom: 'var(--border-w) solid var(--border)',
        }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Carrier portals</span>
          {isAdmin && (
            <button onClick={() => setAdding(v => !v)} style={{ ...ghostBtn, height: 30 }}>
              <Plus size={12} /> Add carrier
            </button>
          )}
        </div>

        {isLoading ? (
          <p style={{ margin: 0, padding: '18px 24px', fontSize: 12.5, color: 'var(--text-muted)' }}>Loading carriers…</p>
        ) : carriers.length === 0 ? (
          <div style={{ padding: '40px 24px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>No carriers yet</p>
            <p style={{ margin: '6px auto 0', maxWidth: 420, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {isAdmin
                ? 'Add the carriers the team is actually appointed with, with their portal link and the numbers to call.'
                : 'Ask an admin to add the carriers your team is appointed with.'}
            </p>
          </div>
        ) : carriers.map(c => (
          <div
            key={c.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
              padding: '13px 24px', borderBottom: 'var(--border-w) solid var(--border)',
            }}
          >
            <span style={{ flex: 1, minWidth: 140, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              {c.name}
            </span>
            <PhoneCell label="New business" value={c.new_business_phone} />
            <PhoneCell label="Agent service" value={c.agent_service_phone} />
            {c.portal_url ? (
              <a href={c.portal_url} target="_blank" rel="noreferrer" style={{ ...ghostBtn, height: 30, textDecoration: 'none' }}>
                Open Portal <ArrowRight size={11} />
              </a>
            ) : (
              <button disabled title="No portal URL on file for this carrier" style={{ ...ghostBtn, height: 30, opacity: 0.5 }}>
                Open Portal <ArrowRight size={11} />
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => del.mutate(c.id)}
                title="Remove carrier"
                style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', display: 'inline-flex', padding: 2 }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      {isAdmin && adding && (
        <div style={{ ...card, marginTop: 16 }}>
          <div style={grid3}>
            <TextField label="Carrier name" placeholder="Carrier" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <TextField label="Portal URL" placeholder="https://…" value={form.portal_url} onChange={e => setForm(f => ({ ...f, portal_url: e.target.value }))} />
            <TextField label="New business phone" mono placeholder="(602) 555-0184" value={form.new_business_phone} onChange={e => setForm(f => ({ ...f, new_business_phone: e.target.value }))} />
            <TextField label="Agent service phone" mono placeholder="(602) 555-0184" value={form.agent_service_phone} onChange={e => setForm(f => ({ ...f, agent_service_phone: e.target.value }))} />
          </div>
          {error && <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--danger)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={submit} disabled={save.isPending} style={{ ...primaryBtn, opacity: save.isPending ? 0.6 : 1 }}>
              {save.isPending ? 'Saving…' : 'Save carrier'}
            </button>
            <button onClick={() => { setAdding(false); setForm(BLANK); setError('') }} style={{ ...ghostBtn, height: 36 }}>
              Cancel
            </button>
          </div>
          <GapNote>
            Only real appointed carriers belong here — this directory feeds the provider field on New Submission
            and the "verify in portal" link.
          </GapNote>
        </div>
      )}
    </div>
  )
}

function PhoneCell({ label, value }) {
  if (!value) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
      <a
        href={`tel:${value.replace(/[^\d+]/g, '')}`}
        style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontFamily: MONO, textDecoration: 'none' }}
      >
        {value}
      </a>
    </span>
  )
}
