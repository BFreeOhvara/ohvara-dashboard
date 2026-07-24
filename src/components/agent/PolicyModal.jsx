import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Trash2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Select } from '../ui/Input'
import { POLICY_STATUSES, CANCELLATION_STATUSES, useUpdatePolicy, useDeletePolicy } from '../../hooks/usePolicies'
import { money, fullName, formatDate } from '../../lib/policyFormat'

// Row-click detail popup for My Policies.
//
// Centered modal, not a right-edge panel (Round 36); horizontal orientation,
// wider than tall (Round 37); rendered on --bg-elevated, the established
// modal/popover surface — never the accent color (Round 36 item 2, DESIGN v13).
export function PolicyModal({ policy, canEdit, onClose }) {
  const update = useUpdatePolicy()
  const del = useDeletePolicy()
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Scroll-lock the page behind the modal (Round 37 item 2). Restores the
  // original value rather than blanking it, so a page that had its own
  // overflow rule isn't left changed after the modal closes.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!policy) return null

  const fields = [
    ['Policy #',        policy.policy_number || '—'],
    ['Client',          fullName(policy)],
    ['Phone',           policy.client_phone || '—'],
    ['Carrier',         policy.carrier_name || '—'],
    ['Product Type',    policy.product_type || '—'],
    ['Insurance Type',  policy.insurance_type || '—'],
    ['State',           policy.state || '—'],
    ['Sold Date',       formatDate(policy.policy_sold_date)],
    ['Effective Date',  formatDate(policy.effective_date)],
    ['Agent',           policy.agent?.full_name || '—'],
  ]

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="scrollbar-thin"
        style={{
          width: '100%', maxWidth: 780, maxHeight: '86vh', overflowY: 'auto',
          background: 'var(--bg-elevated)',
          border: '0.5px solid var(--border)',
          borderRadius: 10,
          padding: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
              {fullName(policy)}
            </h2>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <Badge label={policy.status} />
              {policy.cancellation_status && <Badge label={policy.cancellation_status} />}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Premium block — money always mono */}
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '22px 0 20px' }}>
          <Figure label="Monthly Premium" value={money(policy.monthly_premium)} />
          <Figure label="Annual Premium" value={money(policy.annual_premium)} />
        </div>

        {/* Horizontal orientation: fields flow in columns, not one tall stack */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '14px 24px',
          paddingTop: 18,
          borderTop: '0.5px solid var(--border)',
        }}>
          {fields.map(([label, value]) => (
            <div key={label}>
              <p className="section-label" style={{ margin: 0 }}>{label}</p>
              <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: '4px 0 0' }}>{value}</p>
            </div>
          ))}
        </div>

        {policy.notes && (
          <div style={{ marginTop: 18, paddingTop: 18, borderTop: '0.5px solid var(--border)' }}>
            <p className="section-label" style={{ margin: 0 }}>Notes</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '6px 0 0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {policy.notes}
            </p>
          </div>
        )}

        {canEdit && (
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: '0.5px solid var(--border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
              <Select
                label="Status"
                value={policy.status}
                onChange={e => update.mutate({ id: policy.id, status: e.target.value })}
              >
                {POLICY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Select
                label="Cancellation (old policy)"
                value={policy.cancellation_status || ''}
                onChange={e => update.mutate({ id: policy.id, cancellation_status: e.target.value || null })}
              >
                <option value="">Not started</option>
                {CANCELLATION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              {confirmDelete ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Delete this policy?</span>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={del.isPending}
                    onClick={() => del.mutate(policy.id, { onSuccess: onClose })}
                  >
                    Delete
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={13} /> Delete
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

function Figure({ label, value }) {
  return (
    <div>
      <p className="section-label" style={{ margin: 0 }}>{label}</p>
      <p style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em',
        color: 'var(--text-primary)', margin: '6px 0 0',
      }}>
        {value}
      </p>
    </div>
  )
}
