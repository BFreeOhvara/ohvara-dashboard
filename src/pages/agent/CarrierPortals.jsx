import { useState } from 'react'
import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCarriers, useSaveCarrier, useDeleteCarrier } from '../../hooks/useCarriers'
import { MONO, card, grid3, primaryBtn, ghostBtn } from '../../lib/exportStyles'
import { TextField, GapNote } from '../../components/ui/ExportForm'

// Carrier Portals — Prompt 331 card grid, replacing the directory-list layout
// from Prompt 327/328 to match Brayden's Liberated Financial reference.
//
// "Open portal" is a plain new-tab link, not an in-dashboard iframe embed.
// Every one of the 12 real carrier login pages was checked for
// X-Frame-Options / CSP frame-ancestors before building this — all of them
// (the 10 that could be reached from this environment) send explicit
// anti-framing headers, standard practice for a login page. There's no
// carrier here an iframe route could actually serve, so building one would
// be dead code. Flagged back to Brayden — if a carrier's real portal ever
// turns out to allow framing, this is the file to revisit.
const BLANK = { name: '', portal_url: '', new_business_phone: '', agent_service_phone: '' }

const portalBtn = {
  border: 'none', borderRadius: 6, background: 'var(--accent)', color: '#fff',
  fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center',
  justifyContent: 'center', gap: 6, padding: '9px 12px', textDecoration: 'none',
}

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
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
          {carriers.length} carrier{carriers.length === 1 ? '' : 's'}
        </span>
        {isAdmin && (
          <button onClick={() => setAdding(v => !v)} style={ghostBtn}>
            <Plus size={12} /> Add carrier
          </button>
        )}
      </div>

      {isLoading ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>Loading carriers…</p>
      ) : carriers.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '40px 24px' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>No carriers yet</p>
          <p style={{ margin: '6px auto 0', maxWidth: 420, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {isAdmin
              ? 'Add the carriers the team is actually appointed with, with their portal link and the numbers to call.'
              : 'Ask an admin to add the carriers your team is appointed with.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {carriers.map(c => <CarrierCard key={c.id} carrier={c} isAdmin={isAdmin} onDelete={() => del.mutate(c.id)} />)}
        </div>
      )}

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
            and the "verify in portal" link. Logo, core-carrier flag, and portal system name can be set later
            directly in the database.
          </GapNote>
        </div>
      )}
    </div>
  )
}

function CarrierInitials({ name }) {
  const initials = name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  return (
    <span style={{
      fontSize: 22, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.02em',
    }}>
      {initials || '?'}
    </span>
  )
}

function CarrierCard({ carrier: c, isAdmin, onDelete }) {
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        position: 'relative', height: 84, overflow: 'hidden',
        padding: c.logo_fit_mode === 'cover' ? 0 : '6px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#fff', borderBottom: 'var(--border-w) solid var(--border)',
      }}>
        {c.logo_url
          ? <img
              src={c.logo_url} alt={`${c.name} logo`}
              style={c.logo_fit_mode === 'cover'
                // Absolutely positioned so it fills the banner exactly, independent of
                // flex sizing — a flex item's default min-height:auto is derived from
                // its intrinsic aspect ratio, which was letting cover-mode logos render
                // taller than the 84px banner and get cropped off-center (anchored high).
                ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', transform: `scale(${(c.logo_zoom_pct ?? 100) / 100})` }
                : { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', objectPosition: 'center', transform: `scale(${(c.logo_zoom_pct ?? 100) / 100})` }}
            />
          : <CarrierInitials name={c.name} />}
        {isAdmin && (
          <button
            onClick={onDelete}
            title="Remove carrier"
            style={{
              position: 'absolute', top: 6, right: 6, border: 'none', background: 'rgba(0,0,0,0.06)',
              color: 'var(--text-muted)', display: 'inline-flex', padding: 4, borderRadius: 6,
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      <div style={{ padding: '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{c.name}</span>
          {c.portal_name && (
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>{c.portal_name}</p>
          )}
        </div>

        <div style={{ borderTop: 'var(--border-w) solid var(--border)' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <PhoneRow label="New business" value={c.new_business_phone} />
          <PhoneRow label="Agent service" value={c.agent_service_phone} />
        </div>

        {c.portal_url ? (
          <a href={c.portal_url} target="_blank" rel="noreferrer" style={{ ...portalBtn, marginTop: 'auto' }}>
            Open portal <ExternalLink size={11} />
          </a>
        ) : (
          <button disabled title="No portal URL on file for this carrier" style={{ ...portalBtn, opacity: 0.5, marginTop: 'auto' }}>
            Open portal <ExternalLink size={11} />
          </button>
        )}
      </div>
    </div>
  )
}

function PhoneRow({ label, value }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{label}</span>
      <a
        href={`tel:${value.replace(/[^\d+]/g, '')}`}
        style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontFamily: MONO, textDecoration: 'none' }}
      >
        {value}
      </a>
    </div>
  )
}
