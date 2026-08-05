import { useMemo, useState } from 'react'
import { CheckCircle2, Clock, Phone, User, ChevronDown, ChevronUp, Eye, EyeOff, ShieldAlert } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useFulfillmentQueue, useUpdatePolicy } from '../../hooks/usePolicies'
import { usePolicyFulfillmentDetails } from '../../hooks/useFulfillmentDetails'
import { card, cardTitle, primaryBtn, ghostBtn, fieldLabel, MONO } from '../../lib/exportStyles'
import { Segmented } from '../../components/ui/Segmented'
import { money, fullName, formatDate, maskLast4 } from '../../lib/policyFormat'

// Fulfillment Queue (Prompt 418) — every policy an agent routed to the
// Fulfillment Team via Submissions' new "Send to Fulfillment Team" toggle.
// Visible to the `fulfillment` role + admin (App.jsx route gate). Any
// fulfillment team member can see and claim any unclaimed item — claiming
// isn't scoped to who's currently signed in until someone actually claims
// it. Ownership/commission on the underlying deal never changes here; this
// only tracks Fulfillment's own back-end work on it.

const STAGE_STYLE = {
  'Pending':     { color: 'var(--warning)', dim: 'var(--warning-dim)', bd: 'var(--warning-bd)' },
  'In Progress': { color: 'var(--info)',    dim: 'var(--info-dim)',    bd: 'var(--info-bd)'    },
  'Complete':    { color: 'var(--success)', dim: 'var(--success-dim)', bd: 'var(--success-bd)' },
}

function StagePill({ stage }) {
  const s = STAGE_STYLE[stage] || STAGE_STYLE.Pending
  return (
    <span style={{
      display: 'inline-flex', padding: '2px 8px', borderRadius: 4,
      fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
      background: s.dim, color: s.color, border: `1px solid ${s.bd}`,
    }}>
      {stage || 'Pending'}
    </span>
  )
}

function fmtCallback(iso) {
  if (!iso) return 'No callback time set'
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

// Prompt 419 — driver's license/routing/account numbers default masked
// (last 4 visible) wherever displayed, with an explicit per-field reveal —
// never default-shown even inside an already-claim-gated detail panel.
function MaskedField({ label, value, revealed, onToggleReveal }) {
  return (
    <div>
      <p style={fieldLabel}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-primary)', fontFamily: MONO }}>
          {value ? (revealed ? value : maskLast4(value)) : '—'}
        </span>
        {value && (
          <button
            onClick={onToggleReveal}
            title={revealed ? 'Hide' : 'Reveal'}
            style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', display: 'inline-flex', padding: 2 }}
          >
            {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        )}
      </div>
    </div>
  )
}

function PlainField({ label, value }) {
  return (
    <div>
      <p style={fieldLabel}>{label}</p>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-primary)' }}>{value || '—'}</p>
    </div>
  )
}

function IntakeDetails({ policyId, canView }) {
  const { data, isLoading } = usePolicyFulfillmentDetails(policyId, canView)
  const [revealed, setRevealed] = useState(new Set())

  const toggleReveal = key => setRevealed(r => {
    const next = new Set(r)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  if (!canView) {
    return (
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>
        Claim this handoff to see the full intake.
      </p>
    )
  }
  if (isLoading) {
    return <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-muted)' }}>Loading intake…</p>
  }
  if (!data) {
    return (
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--danger)' }}>
        No intake details found for this policy — the agent's submission may not have completed cleanly.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Prominent — the one number Fulfillment actually calls to cancel
          the old policy. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 12px', borderRadius: 6,
        background: 'var(--warning-dim)', border: '1px solid var(--warning-bd)',
      }}>
        <ShieldAlert size={13} style={{ color: 'var(--warning)', flexShrink: 0 }} />
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-primary)' }}>
          Current carrier being replaced — <strong>{data.current_carrier || '—'}</strong>
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <PlainField label="Full legal name" value={data.full_legal_name} />
        <PlainField label="Date of birth" value={formatDate(data.date_of_birth)} />
        <PlainField label="State of birth" value={data.state_of_birth} />
        <PlainField label="State of residence" value={data.state_of_residence} />
        <PlainField label="Email" value={data.email} />
        <PlainField label="Height" value={data.height} />
        <PlainField label="Weight" value={data.weight} />
        <PlainField label="Draft day" value={data.draft_day} />
        <MaskedField
          label="Driver's license #" value={data.drivers_license_number}
          revealed={revealed.has('dl')} onToggleReveal={() => toggleReveal('dl')}
        />
        <PlainField
          label="Address"
          value={[data.address_street, data.address_city, data.address_state, data.address_zip].filter(Boolean).join(', ')}
        />
        <PlainField label="Beneficiary" value={[data.beneficiary_name, data.beneficiary_relationship].filter(Boolean).join(' · ')} />
        <PlainField label="Bank" value={data.bank_name} />
        <MaskedField
          label="Routing #" value={data.routing_number}
          revealed={revealed.has('routing')} onToggleReveal={() => toggleReveal('routing')}
        />
        <MaskedField
          label="Account #" value={data.account_number}
          revealed={revealed.has('account')} onToggleReveal={() => toggleReveal('account')}
        />
      </div>
    </div>
  )
}

const TABS = [
  { value: 'open',      label: 'Open' },
  { value: 'completed', label: 'Completed' },
]

export default function FulfillmentQueue() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { data: rows = [], isLoading } = useFulfillmentQueue()
  const update = useUpdatePolicy()
  const [tab, setTab] = useState('open')
  const [expandedId, setExpandedId] = useState(null)

  const { open, completed } = useMemo(() => ({
    open: rows.filter(p => p.fulfillment_stage !== 'Complete'),
    completed: rows.filter(p => p.fulfillment_stage === 'Complete'),
  }), [rows])

  const list = tab === 'open' ? open : completed

  function claim(p) {
    update.mutate({ id: p.id, assigned_fulfillment_id: profile.id, fulfillment_stage: 'In Progress' })
  }

  function markComplete(p) {
    update.mutate({ id: p.id, fulfillment_stage: 'Complete', status: 'In Effect' })
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <Segmented value={tab} onChange={setTab} options={TABS} style={{ marginBottom: 20 }} />

      <div style={card}>
        <p style={cardTitle}>{tab === 'open' ? 'Open handoffs' : 'Completed handoffs'}</p>

        {isLoading ? (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>Loading queue…</p>
        ) : list.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
            {tab === 'open' ? 'Nothing waiting — every handoff is complete.' : 'Nothing completed yet.'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {list.map(p => {
              const claimedByMe = p.assigned_fulfillment_id === profile?.id
              const canViewDetails = claimedByMe || isAdmin
              const expanded = expandedId === p.id
              return (
                <div key={p.id} style={{
                  padding: '14px 16px', borderRadius: 7,
                  background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
                  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14,
                }}>
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {fullName(p)}
                      </p>
                      <StagePill stage={p.fulfillment_stage} />
                    </div>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
                      {[p.carrier_name, p.product_name, p.state].filter(Boolean).join(' · ') || 'No carrier/product on file'}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 10.5, color: 'var(--text-muted)' }}>
                      Submitted by {p.agent?.full_name || 'unknown agent'}
                    </p>
                  </div>

                  <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 150 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                      <Clock size={11} /> {fmtCallback(p.scheduled_call_at)}
                    </span>
                    {p.client_phone && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-secondary)', fontFamily: MONO }}>
                        <Phone size={11} /> {p.client_phone}
                      </span>
                    )}
                  </div>

                  <div style={{ flex: '0 0 auto', textAlign: 'right', minWidth: 90 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: MONO }}>
                      {money(p.monthly_premium)}/mo
                    </p>
                    {p.annual_premium != null && (
                      <p style={{ margin: '2px 0 0', fontSize: 10.5, color: 'var(--text-muted)', fontFamily: MONO }}>
                        {money(p.annual_premium)}/yr
                      </p>
                    )}
                  </div>

                  {p.notes && (
                    <p style={{ flex: '1 1 100%', margin: 0, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {p.notes}
                    </p>
                  )}

                  <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {p.fulfillment_stage === 'Complete' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--success)', fontWeight: 700 }}>
                        <CheckCircle2 size={13} /> Done
                      </span>
                    ) : !p.assigned_fulfillment_id ? (
                      <button onClick={() => claim(p)} disabled={update.isPending} style={{ ...primaryBtn, height: 32, opacity: update.isPending ? 0.6 : 1 }}>
                        Claim
                      </button>
                    ) : claimedByMe ? (
                      <button onClick={() => markComplete(p)} disabled={update.isPending} style={{ ...primaryBtn, height: 32, opacity: update.isPending ? 0.6 : 1 }}>
                        Mark complete
                      </button>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-muted)' }}>
                        <User size={12} /> Claimed by {p.assigned?.full_name || 'someone'}
                      </span>
                    )}
                    <button
                      onClick={() => setExpandedId(expanded ? null : p.id)}
                      style={{ ...ghostBtn, height: 32 }}
                    >
                      Details {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  </div>

                  {expanded && (
                    <div style={{
                      flex: '1 1 100%', paddingTop: 12, marginTop: 4,
                      borderTop: 'var(--border-w) solid var(--border)',
                    }}>
                      <IntakeDetails policyId={p.id} canView={canViewDetails} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
