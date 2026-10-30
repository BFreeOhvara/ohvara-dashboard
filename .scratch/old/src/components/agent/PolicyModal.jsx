import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Trash2, Bell, Hourglass } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { AnchoredSelectField } from '../ui/ExportForm'
import { useAuth } from '../../hooks/useAuth'
import {
  LIVE_POLICY_STATUSES, CANCELLATION_STATUSES,
  useUpdatePolicy, useDeletePolicy, pendingEffectuation,
  pendingUnderwriting, pendingLapseCheck, useAdvanceLapseCheck,
} from '../../hooks/usePolicies'
import { money, fullName, formatDate } from '../../lib/policyFormat'

// Row-click detail popup for My Policies.
//
// Centered modal, not a right-edge panel (Round 36); horizontal orientation,
// wider than tall (Round 37); rendered on --bg-elevated, the established
// modal/popover surface — never the accent color (Round 36 item 2, DESIGN v13).
export function PolicyModal({ policy, canEdit, onClose }) {
  const { profile } = useAuth()
  const update = useUpdatePolicy()
  const del = useDeletePolicy()
  const advanceLapseCheck = useAdvanceLapseCheck()
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Prompt 399 — the submitting agent, and only them, can answer either
  // banner below; `canEdit` (isAdmin-or-owner) is deliberately NOT the gate
  // here since it would let admin answer on another agent's behalf while
  // viewing "Everyone" on My Policies. `canEdit` still governs the unrelated
  // status/cancellation fields and delete further down.
  const isOwner = policy?.agent_id === profile?.id

  // Moved here from My Policies' list-view banner (Prompt 345) — same
  // condition, same mutation, just relocated onto the record itself. Prompt
  // 399: visibility no longer requires `canEdit` — anyone who can open this
  // record (own row, downline, or admin) sees the banner for awareness, same
  // as the list-row version; only answering it requires `isOwner`.
  const needsEffectuation = policy && pendingEffectuation([policy]).length > 0
  function answerEffectuation(status) {
    update.mutate({ id: policy.id, status, effectuation_answered_at: new Date().toISOString() })
  }

  // Prompt 369 — same two new banners as My Policies' list row, same
  // conditions, relocated onto the record itself (same pattern as
  // effectuation above).
  const needsUnderwriting = policy && pendingUnderwriting([policy]).length > 0
  function answerUnderwriting(approved) {
    update.mutate({ id: policy.id, pending_underwriting: false, status: approved ? policy.status : 'Not Approved' })
  }
  const needsLapseCheck = canEdit && policy && pendingLapseCheck([policy]).length > 0
  function answerLapseCheck(stillActive) {
    if (stillActive) advanceLapseCheck.mutate(policy.id)
    else update.mutate({ id: policy.id, status: 'Lapsed' })
  }

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
    ['Product',         policy.product_name || '—'],
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

        {needsEffectuation && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', margin: '18px 0 0',
            background: 'var(--warning-dim)', border: '1px solid var(--warning-bd)', borderRadius: 8,
          }}>
            <Bell size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-primary)' }}>
              Reached its effective date ({formatDate(policy.effective_date)}) — did this policy go into effect?
            </span>
            <button
              onClick={() => answerEffectuation('In Effect')}
              disabled={update.isPending || !isOwner}
              title={isOwner ? undefined : 'Only the submitting agent can answer this'}
              style={{ height: 28, padding: '0 14px', border: 'none', borderRadius: 6, background: 'var(--success)', color: '#fff', fontSize: 11.5, fontWeight: 700, opacity: isOwner ? 1 : 0.45, cursor: isOwner ? 'pointer' : 'not-allowed' }}
            >
              Yes
            </button>
            <button
              onClick={() => answerEffectuation('Undrafted')}
              disabled={update.isPending || !isOwner}
              title={isOwner ? undefined : 'Only the submitting agent can answer this'}
              style={{ height: 28, padding: '0 14px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 11.5, fontWeight: 700, opacity: isOwner ? 1 : 0.45, cursor: isOwner ? 'pointer' : 'not-allowed' }}
            >
              No
            </button>
          </div>
        )}

        {/* Underwriting decision banner (Prompt 369) — deliberately NOT the
            yellow/Bell effectuation look above (Brayden's explicit misclick
            concern): --pink + Hourglass instead. */}
        {needsUnderwriting && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', margin: '18px 0 0',
            background: 'var(--pink-dim)', border: '1px solid var(--pink-bd)', borderRadius: 8,
          }}>
            <Hourglass size={15} style={{ color: 'var(--pink)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-primary)' }}>
              Submitted for underwriting — has {policy.carrier_name || 'the carrier'}'s decision come back? Was it approved?
            </span>
            <button
              onClick={() => answerUnderwriting(true)}
              disabled={update.isPending || !isOwner}
              title={isOwner ? undefined : 'Only the submitting agent can answer this'}
              style={{ height: 28, padding: '0 14px', border: 'none', borderRadius: 6, background: 'var(--success)', color: '#fff', fontSize: 11.5, fontWeight: 700, opacity: isOwner ? 1 : 0.45, cursor: isOwner ? 'pointer' : 'not-allowed' }}
            >
              Yes
            </button>
            <button
              onClick={() => answerUnderwriting(false)}
              disabled={update.isPending || !isOwner}
              title={isOwner ? undefined : 'Only the submitting agent can answer this'}
              style={{ height: 28, padding: '0 14px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 11.5, fontWeight: 700, opacity: isOwner ? 1 : 0.45, cursor: isOwner ? 'pointer' : 'not-allowed' }}
            >
              No
            </button>
          </div>
        )}

        {/* Lapse check-in banner (Prompt 369) — same yellow/Bell look as the
            effectuation banner (schema item 3: reuse the exact same visual). */}
        {needsLapseCheck && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', margin: '18px 0 0',
            background: 'var(--warning-dim)', border: '1px solid var(--warning-bd)', borderRadius: 8,
          }}>
            <Bell size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-primary)' }}>
              Is this policy still on the book, or did it lapse?
            </span>
            <button
              onClick={() => answerLapseCheck(true)}
              disabled={update.isPending || advanceLapseCheck.isPending}
              style={{ height: 28, padding: '0 14px', border: 'none', borderRadius: 6, background: 'var(--success)', color: '#fff', fontSize: 11.5, fontWeight: 700 }}
            >
              Yes
            </button>
            <button
              onClick={() => answerLapseCheck(false)}
              disabled={update.isPending || advanceLapseCheck.isPending}
              style={{ height: 28, padding: '0 14px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 11.5, fontWeight: 700 }}
            >
              No
            </button>
          </div>
        )}

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
              <AnchoredSelectField
                label="Status"
                value={policy.status}
                onChange={val => update.mutate({ id: policy.id, status: val })}
                options={LIVE_POLICY_STATUSES.map(s => ({ value: s, label: s }))}
              />
              <AnchoredSelectField
                label="Cancellation (old policy)"
                value={policy.cancellation_status || ''}
                onChange={val => update.mutate({ id: policy.id, cancellation_status: val || null })}
                options={[
                  { value: '', label: 'Not started' },
                  ...CANCELLATION_STATUSES.map(s => ({ value: s, label: s })),
                ]}
              />
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
