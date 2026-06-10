import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DollarSign, TrendingUp, Users, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

// ── Commission constants ───────────────────────────────────────────────────────
const SETUP_FEE = 497

const TIER_MONTHLY = { basic: 497, pro: 797, premium: 1297, elite: 1797 }

// Commission rates by role
// Setter (rep):  50% setup
// Closer:        50% setup + 50% recurring
// Admin:         0% setup  + 50% recurring
const RATES = {
  rep:    { setup: 0.5, recurring: 0 },
  closer: { setup: 0.5, recurring: 0.5 },
  admin:  { setup: 0,   recurring: 0.5 },
}

function calcCommission(role, type, tier) {
  const rate = RATES[role]
  if (!rate) return 0
  if (type === 'setup')     return Math.round(SETUP_FEE * rate.setup * 100) / 100
  if (type === 'recurring') {
    const monthly = TIER_MONTHLY[tier?.toLowerCase()] || 0
    return Math.round(monthly * rate.recurring * 100) / 100
  }
  return 0
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useCommissions() {
  return useQuery({
    queryKey: ['commissions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commissions')
        .select(`
          *,
          recipient:profiles!recipient_id(id, full_name, username, role),
          lead:leads(business_name, niche, city),
          appointment:appointments(closed_tier, deal_value, scheduled_at)
        `)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })
}

function useClosedAppointments() {
  return useQuery({
    queryKey: ['closed-appointments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          *,
          rep:profiles!rep_id(id, full_name, username, role),
          closer:profiles!closer_id(id, full_name, username, role),
          lead:leads(business_name, niche, city)
        `)
        .eq('outcome', 'closed')
        .order('closed_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })
}

function useAllProfiles() {
  return useQuery({
    queryKey: ['all-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('role')
      if (error) throw error
      return data || []
    },
  })
}

// ── Create commissions for a closed deal ─────────────────────────────────────

async function createCommissionsForDeal({ appointment, adminProfile }) {
  if (!appointment) return

  const tier = appointment.closed_tier || 'pro'
  const rows = []

  // Rep (setter): 50% setup
  if (appointment.rep) {
    const amount = calcCommission('rep', 'setup', tier)
    if (amount > 0) rows.push({
      recipient_id:    appointment.rep.id,
      recipient_role:  'rep',
      lead_id:         appointment.lead_id,
      appointment_id:  appointment.id,
      commission_type: 'setup',
      tier,
      tier_amount:     SETUP_FEE,
      amount,
    })
  }

  // Closer: 50% setup + 50% recurring
  if (appointment.closer) {
    const setupAmt = calcCommission('closer', 'setup', tier)
    if (setupAmt > 0) rows.push({
      recipient_id:    appointment.closer.id,
      recipient_role:  'closer',
      lead_id:         appointment.lead_id,
      appointment_id:  appointment.id,
      commission_type: 'setup',
      tier,
      tier_amount:     SETUP_FEE,
      amount:          setupAmt,
    })
    const recurAmt = calcCommission('closer', 'recurring', tier)
    if (recurAmt > 0) rows.push({
      recipient_id:    appointment.closer.id,
      recipient_role:  'closer',
      lead_id:         appointment.lead_id,
      appointment_id:  appointment.id,
      commission_type: 'recurring',
      tier,
      tier_amount:     TIER_MONTHLY[tier.toLowerCase()] || 0,
      amount:          recurAmt,
    })
  }

  // Admin: 50% recurring
  if (adminProfile) {
    const recurAmt = calcCommission('admin', 'recurring', tier)
    if (recurAmt > 0) rows.push({
      recipient_id:    adminProfile.id,
      recipient_role:  'admin',
      lead_id:         appointment.lead_id,
      appointment_id:  appointment.id,
      commission_type: 'recurring',
      tier,
      tier_amount:     TIER_MONTHLY[tier.toLowerCase()] || 0,
      amount:          recurAmt,
    })
  }

  if (rows.length) {
    const { error } = await supabase.from('commissions').insert(rows)
    if (error) throw error
  }

  return rows.length
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const TIER_COLOR = {
  basic:   '#6C63FF',
  pro:     '#22C55E',
  premium: '#F59E0B',
  elite:   '#EF4444',
}

const STATUS_COLOR = {
  pending:  '#F59E0B',
  approved: '#6C63FF',
  paid:     '#22C55E',
  voided:   '#64748B',
}

// ── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, prefix = '$', color, icon: Icon }) {
  return (
    <div style={{
      flex: 1, minWidth: 160,
      background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
      borderRadius: 10, padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
        {Icon && <Icon size={14} style={{ color: 'var(--text-muted)' }} />}
      </div>
      <p style={{ fontSize: 22, fontWeight: 600, color: color || 'var(--text-primary)', fontFamily: 'var(--font-mono)', margin: 0 }}>
        {prefix}{typeof value === 'number' ? fmt(value) : value}
      </p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Commissions() {
  const { profile } = useAuth()
  const { data: commissions = [], isLoading: loadingComm } = useCommissions()
  const { data: closedDeals = [], isLoading: loadingDeals } = useClosedAppointments()
  const { data: profiles = [] }                             = useAllProfiles()
  const qc = useQueryClient()

  const [expandedRep, setExpandedRep]     = useState(null)
  const [generating, setGenerating]       = useState(null)
  const [updatingStatus, setUpdatingStatus] = useState(null)

  const adminProfile = profiles.find(p => p.role === 'admin')

  // Group commissions by recipient
  const byRecipient = commissions.reduce((acc, c) => {
    const id = c.recipient?.id || c.recipient_id
    if (!acc[id]) acc[id] = { person: c.recipient, rows: [] }
    acc[id].rows.push(c)
    return acc
  }, {})

  const recipientSummaries = Object.values(byRecipient).map(({ person, rows }) => ({
    person,
    totalSetup:     rows.filter(r => r.commission_type === 'setup').reduce((s, r) => s + r.amount, 0),
    totalRecurring: rows.filter(r => r.commission_type === 'recurring').reduce((s, r) => s + r.amount, 0),
    totalPaid:      rows.filter(r => r.status === 'paid').reduce((s, r) => s + r.amount, 0),
    pending:        rows.filter(r => r.status === 'pending').length,
    rows,
  }))

  // Deals without commissions yet
  const commissionsApptIds = new Set(commissions.map(c => c.appointment_id))
  const dealsNeedingComms = closedDeals.filter(d => !commissionsApptIds.has(d.id))

  async function generateForDeal(appt) {
    setGenerating(appt.id)
    try {
      await createCommissionsForDeal({ appointment: appt, adminProfile })
      qc.invalidateQueries({ queryKey: ['commissions'] })
    } catch (err) {
      console.error('Commission generation failed:', err)
    } finally {
      setGenerating(null)
    }
  }

  async function updateStatus(commId, status) {
    setUpdatingStatus(commId)
    try {
      await supabase.from('commissions')
        .update({ status, paid_at: status === 'paid' ? new Date().toISOString() : null })
        .eq('id', commId)
      qc.invalidateQueries({ queryKey: ['commissions'] })
    } finally {
      setUpdatingStatus(null)
    }
  }

  const grandTotalPending = commissions.filter(c => c.status === 'pending').reduce((s, c) => s + c.amount, 0)
  const grandTotalPaid    = commissions.filter(c => c.status === 'paid').reduce((s, c) => s + c.amount, 0)
  const totalClosedDeals  = closedDeals.length

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          Commissions
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          Setup (50% to setter + 50% to closer) · Recurring (50% to closer + 50% to admin)
        </p>
      </div>

      {/* Summary row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <SummaryCard label="Pending Payout"  value={grandTotalPending} color="var(--warning)"  icon={DollarSign} />
        <SummaryCard label="Total Paid Out"  value={grandTotalPaid}    color="var(--success)"  icon={Check} />
        <SummaryCard label="Closed Deals"    value={totalClosedDeals}  prefix="" color="var(--accent)"   icon={TrendingUp} />
        <SummaryCard label="Team Members"    value={recipientSummaries.length} prefix="" color="var(--text-primary)" icon={Users} />
      </div>

      {/* Deals needing commission generation */}
      {dealsNeedingComms.length > 0 && (
        <div style={{
          background: 'rgba(245,158,11,0.06)', border: '0.5px solid rgba(245,158,11,0.25)',
          borderRadius: 10, padding: '14px 16px', marginBottom: 20,
        }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--warning)', marginBottom: 10 }}>
            {dealsNeedingComms.length} closed deal{dealsNeedingComms.length > 1 ? 's' : ''} without commissions
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dealsNeedingComms.map(deal => (
              <div key={deal.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{deal.lead?.business_name || 'Unknown'}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                    {deal.closed_tier || 'pro'} · {formatDate(deal.closed_at || deal.updated_at)}
                  </span>
                </div>
                <button
                  onClick={() => generateForDeal(deal)}
                  disabled={generating === deal.id}
                  style={{
                    padding: '5px 12px', borderRadius: 6, border: 'none',
                    background: 'rgba(245,158,11,0.15)', color: 'var(--warning)',
                    fontSize: 12, cursor: 'pointer', fontWeight: 500,
                    opacity: generating === deal.id ? 0.6 : 1,
                  }}
                >
                  {generating === deal.id ? 'Generating…' : 'Generate'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-person breakdown */}
      {loadingComm ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} style={{ height: 64, borderRadius: 8, background: 'var(--bg-surface)', border: '0.5px solid var(--border)', animation: 'pulse 2s infinite' }} />
          ))}
        </div>
      ) : recipientSummaries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', background: 'var(--bg-surface)', border: '0.5px solid var(--border)', borderRadius: 10 }}>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>No commissions yet. Close a deal to generate.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recipientSummaries.map(({ person, totalSetup, totalRecurring, totalPaid, pending, rows }) => {
            const isOpen = expandedRep === person?.id
            const roleColor = person?.role === 'admin' ? 'var(--accent)' : person?.role === 'closer' ? 'var(--warning)' : 'var(--success)'

            return (
              <div key={person?.id} style={{
                background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
                borderRadius: 10, overflow: 'hidden',
              }}>
                {/* Summary row */}
                <button
                  onClick={() => setExpandedRep(isOpen ? null : person?.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center',
                    gap: 14, padding: '14px 16px',
                    background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: `${roleColor}18`, border: `0.5px solid ${roleColor}35`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 500, color: roleColor,
                  }}>
                    {person?.full_name?.charAt(0) || '?'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                      {person?.full_name || 'Unknown'}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
                      {person?.role} · @{person?.username}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Setup</p>
                      <p style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', margin: 0 }}>${fmt(totalSetup)}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recurring</p>
                      <p style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', margin: 0 }}>${fmt(totalRecurring)}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Paid</p>
                      <p style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--success)', margin: 0 }}>${fmt(totalPaid)}</p>
                    </div>
                    {pending > 0 && (
                      <span style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 20,
                        background: 'rgba(245,158,11,0.1)', color: 'var(--warning)',
                        border: '0.5px solid rgba(245,158,11,0.25)', whiteSpace: 'nowrap',
                      }}>
                        {pending} pending
                      </span>
                    )}
                    {isOpen ? <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                  </div>
                </button>

                {/* Drill-down */}
                {isOpen && (
                  <div style={{ borderTop: '0.5px solid var(--border)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-elevated)' }}>
                          {['Business', 'Type', 'Tier', 'Amount', 'Status', 'Date', ''].map(h => (
                            <th key={h} style={{ padding: '8px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500, fontSize: 11 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(row => (
                          <tr key={row.id} style={{ borderTop: '0.5px solid var(--border)/30' }}>
                            <td style={{ padding: '9px 14px', color: 'var(--text-primary)' }}>
                              {row.lead?.business_name || '—'}
                            </td>
                            <td style={{ padding: '9px 14px' }}>
                              <span style={{
                                fontSize: 10, padding: '2px 7px', borderRadius: 4,
                                background: row.commission_type === 'setup' ? 'rgba(108,99,255,0.1)' : 'rgba(34,197,94,0.08)',
                                color: row.commission_type === 'setup' ? 'var(--accent)' : 'var(--success)',
                                textTransform: 'uppercase', letterSpacing: '0.05em',
                              }}>
                                {row.commission_type}
                              </span>
                            </td>
                            <td style={{ padding: '9px 14px' }}>
                              <span style={{ color: TIER_COLOR[row.tier?.toLowerCase()] || 'var(--text-muted)', textTransform: 'capitalize' }}>
                                {row.tier || '—'}
                              </span>
                            </td>
                            <td style={{ padding: '9px 14px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 500 }}>
                              ${fmt(row.amount)}
                            </td>
                            <td style={{ padding: '9px 14px' }}>
                              <span style={{
                                fontSize: 10, padding: '2px 7px', borderRadius: 4,
                                background: `${STATUS_COLOR[row.status] || '#64748B'}15`,
                                color: STATUS_COLOR[row.status] || 'var(--text-muted)',
                                textTransform: 'capitalize',
                              }}>
                                {row.status}
                              </span>
                            </td>
                            <td style={{ padding: '9px 14px', color: 'var(--text-muted)' }}>
                              {formatDate(row.created_at)}
                            </td>
                            <td style={{ padding: '9px 14px' }}>
                              {row.status === 'pending' && (
                                <button
                                  onClick={() => updateStatus(row.id, 'paid')}
                                  disabled={updatingStatus === row.id}
                                  style={{
                                    padding: '3px 10px', borderRadius: 5, border: 'none',
                                    background: 'rgba(34,197,94,0.1)', color: 'var(--success)',
                                    fontSize: 11, cursor: 'pointer', fontWeight: 500,
                                    opacity: updatingStatus === row.id ? 0.6 : 1,
                                  }}
                                >
                                  Mark Paid
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
