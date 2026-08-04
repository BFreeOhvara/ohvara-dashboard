import { useMemo, useState } from 'react'
import { CheckCircle2, Clock, Phone, User } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useFulfillmentQueue, useUpdatePolicy } from '../../hooks/usePolicies'
import { card, cardTitle, primaryBtn, MONO } from '../../lib/exportStyles'
import { Segmented } from '../../components/ui/Segmented'
import { money, fullName } from '../../lib/policyFormat'

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

const TABS = [
  { value: 'open',      label: 'Open' },
  { value: 'completed', label: 'Completed' },
]

export default function FulfillmentQueue() {
  const { profile } = useAuth()
  const { data: rows = [], isLoading } = useFulfillmentQueue()
  const update = useUpdatePolicy()
  const [tab, setTab] = useState('open')

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
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
