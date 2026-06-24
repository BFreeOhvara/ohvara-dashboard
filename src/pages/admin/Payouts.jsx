import { useState, useMemo } from 'react'
import { DollarSign, Plus, Loader2, AlertCircle } from 'lucide-react'
import { useReps } from '../../hooks/useProfiles'
import { useAllPayouts, usePayCommission, useCreatePayout } from '../../hooks/usePayouts'

const STATUS = {
  pending:  { label: 'Pending',  color: '#F59E0B', dim: 'rgba(245,158,11,0.12)' },
  approved: { label: 'Approved', color: '#38BDF8', dim: 'rgba(56,189,248,0.12)' },
  paid:     { label: 'Paid',     color: '#22C55E', dim: 'rgba(34,197,94,0.12)' },
  failed:   { label: 'Failed',   color: '#EF4444', dim: 'rgba(239,68,68,0.12)' },
}
const STATUS_FILTERS = ['all', 'pending', 'approved', 'paid', 'failed']

function StatusChip({ status }) {
  const s = STATUS[status] || STATUS.pending
  return (
    <span style={{
      fontSize: 11, fontWeight: 500, color: s.color, background: s.dim,
      padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

const fmtUsd = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`

export default function Payouts() {
  const { data: payouts, isLoading } = useAllPayouts()
  const { data: reps } = useReps()
  const pay = usePayCommission()
  const create = useCreatePayout()

  const [repFilter, setRepFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [payingId, setPayingId] = useState(null)
  const [rowError, setRowError] = useState({}) // payoutId → message
  const [showCreate, setShowCreate] = useState(false)

  const filtered = useMemo(() => {
    return (payouts || []).filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (repFilter && !(p.rep?.full_name || '').toLowerCase().includes(repFilter.toLowerCase())) return false
      return true
    })
  }, [payouts, statusFilter, repFilter])

  async function handlePay(p) {
    setPayingId(p.id)
    setRowError(e => ({ ...e, [p.id]: '' }))
    try {
      await pay.mutateAsync(p.id)
    } catch (err) {
      setRowError(e => ({ ...e, [p.id]: err.message || 'Payment failed' }))
    } finally {
      setPayingId(null)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            Payouts
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            Approve &amp; pay rep commissions — money lands in their bank in ~2 days
          </p>
        </div>
        <button
          onClick={() => setShowCreate(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 7, height: 36, padding: '0 14px',
            background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 8,
            fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          <Plus size={14} /> Create payout
        </button>
      </div>

      {showCreate && <CreatePayoutForm reps={reps} create={create} onDone={() => setShowCreate(false)} />}

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <input
          value={repFilter}
          onChange={e => setRepFilter(e.target.value)}
          placeholder="Filter by rep name…"
          style={{
            height: 34, padding: '0 12px', flex: '0 0 240px',
            background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
            borderRadius: 8, fontSize: 13, color: 'var(--text-primary)',
          }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                height: 34, padding: '0 12px', borderRadius: 8, cursor: 'pointer',
                fontSize: 12, fontWeight: 500, textTransform: 'capitalize',
                background: statusFilter === s ? 'var(--accent)' : 'var(--bg-elevated)',
                border: `0.5px solid ${statusFilter === s ? 'var(--accent)' : 'var(--border)'}`,
                color: statusFilter === s ? 'white' : 'var(--text-muted)',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 0.8fr 0.8fr 1fr',
          gap: 12, padding: '12px 16px', borderBottom: '0.5px solid var(--border)',
          fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)',
        }}>
          <span>Rep</span><span>Business</span><span>Amount</span><span>Status</span><span style={{ textAlign: 'right' }}>Action</span>
        </div>

        {isLoading ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '24px' }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '24px' }}>
            No payouts match these filters.
          </p>
        ) : filtered.map(p => {
          const repOnboarded = !!p.rep?.stripe_onboarding_complete
          const canPay = p.status !== 'paid'
          return (
            <div key={p.id} style={{
              display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 0.8fr 0.8fr 1fr',
              gap: 12, padding: '12px 16px', borderBottom: '0.5px solid var(--border)', alignItems: 'center',
            }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.rep?.full_name || '—'}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.appointment?.lead?.business_name || 'Closed deal'}
              </span>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {fmtUsd(p.amount_cents)}
              </span>
              <span><StatusChip status={p.status} /></span>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                {canPay ? (
                  <button
                    onClick={() => handlePay(p)}
                    disabled={payingId === p.id || !repOnboarded}
                    title={repOnboarded ? '' : "Rep hasn't connected their bank yet"}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
                      borderRadius: 7, whiteSpace: 'nowrap',
                      background: repOnboarded ? 'var(--success)' : 'var(--bg-elevated)',
                      color: repOnboarded ? 'white' : 'var(--text-muted)',
                      fontSize: 12, fontWeight: 500,
                      cursor: (payingId === p.id || !repOnboarded) ? 'not-allowed' : 'pointer',
                      border: repOnboarded ? 'none' : '0.5px solid var(--border)',
                    }}
                  >
                    {payingId === p.id
                      ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Paying…</>
                      : <><DollarSign size={13} /> Approve &amp; Pay</>}
                  </button>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {p.paid_at ? new Date(p.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Paid'}
                  </span>
                )}
                {!repOnboarded && canPay && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--warning)' }}>
                    <AlertCircle size={10} /> Bank not connected
                  </span>
                )}
                {rowError[p.id] && (
                  <span style={{ fontSize: 10, color: 'var(--danger)', textAlign: 'right' }}>{rowError[p.id]}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Back-fill form: admin manually enters rep + appointment id + dollar amount.
function CreatePayoutForm({ reps, create, onDone }) {
  const [repId, setRepId] = useState('')
  const [appointmentId, setAppointmentId] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    const dollars = parseFloat(amount)
    if (!repId || !appointmentId.trim() || !(dollars > 0)) {
      setError('Pick a rep, paste the appointment ID, and enter an amount.')
      return
    }
    try {
      await create.mutateAsync({
        repProfileId: repId,
        appointmentId: appointmentId.trim(),
        amountCents: Math.round(dollars * 100),
      })
      onDone()
    } catch (err) {
      setError(err.message || 'Could not create payout')
    }
  }

  const inputStyle = {
    height: 34, padding: '0 10px', background: 'var(--bg-elevated)',
    border: '0.5px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--text-primary)',
  }

  return (
    <div className="glass" style={{ padding: '16px', borderRadius: 12, marginBottom: 14 }}>
      <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 10px' }}>Create payout (back-fill)</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={repId} onChange={e => setRepId(e.target.value)} style={{ ...inputStyle, flex: '0 0 200px' }}>
          <option value="">Select rep…</option>
          {(reps || []).map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
        </select>
        <input
          value={appointmentId} onChange={e => setAppointmentId(e.target.value)}
          placeholder="Appointment ID (uuid)" style={{ ...inputStyle, flex: '1 1 260px' }}
        />
        <input
          type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
          placeholder="Amount $" style={{ ...inputStyle, flex: '0 0 120px' }}
        />
        <button
          onClick={submit}
          disabled={create.isPending}
          style={{
            height: 34, padding: '0 16px', background: 'var(--accent)', border: 'none', borderRadius: 8,
            fontSize: 13, fontWeight: 500, color: 'white', cursor: create.isPending ? 'not-allowed' : 'pointer',
          }}
        >
          {create.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <p style={{ fontSize: 12, color: 'var(--danger)', margin: '10px 0 0' }}>{error}</p>}
    </div>
  )
}
