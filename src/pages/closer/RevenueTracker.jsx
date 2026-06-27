import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { StatCard } from '../../components/ui/StatCard'
import { Card } from '../../components/ui/Card'
import { DollarSign, TrendingUp, BarChart2, Target, Landmark, X, Handshake } from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'

function AddBankModal({ onClose }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#13131F', border: '0.5px solid var(--border)',
          borderRadius: 12, padding: 24, width: 360,
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'var(--accent-dim)', border: '0.5px solid var(--accent-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Landmark size={15} style={{ color: 'var(--accent)' }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>Add Bank Account</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
            <X size={16} />
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
          Bank account linking is handled securely via Stripe. Ohvara never stores your account or routing numbers directly.
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
          Stripe Connect onboarding hasn't been activated yet. Contact Brayden to get your payout account set up — you'll receive a secure Stripe link to complete the process.
        </p>
        <button
          onClick={onClose}
          style={{
            width: '100%', height: 38, borderRadius: 8, border: 'none',
            background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
            fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}
        >
          Got it
        </button>
      </div>
    </div>
  )
}

function RevenueTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#13131F', border: '0.5px solid var(--border)',
      borderRadius: 8, padding: '8px 12px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
    }}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
        ${Number(payload[0]?.value || 0).toLocaleString()}
      </p>
    </div>
  )
}

export default function RevenueTracker() {
  const { profile } = useAuth()
  const [showBankModal, setShowBankModal] = useState(false)

  const { data: revenue } = useQuery({
    queryKey: ['revenue', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select('deal_value, outcome, updated_at')
        .eq('closer_id', profile.id)
        .eq('outcome', 'closed')
      if (error) throw error

      const now = new Date()
      const weekAgo = new Date(now - 7 * 86400000)
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

      const all = data || []
      const week = all.filter(d => new Date(d.updated_at) >= weekAgo)
      const month = all.filter(d => new Date(d.updated_at) >= monthStart)

      const sum = arr => arr.reduce((s, d) => s + (d.deal_value || 0), 0)
      const avg = arr => arr.length ? sum(arr) / arr.length : 0

      // Weekly breakdown for chart (last 8 weeks)
      const weeks = []
      for (let i = 7; i >= 0; i--) {
        const start = new Date(now - (i + 1) * 7 * 86400000)
        const end = new Date(now - i * 7 * 86400000)
        const wDeals = all.filter(d => {
          const dt = new Date(d.updated_at)
          return dt >= start && dt < end
        })
        weeks.push({ label: `W${8 - i}`, value: sum(wDeals), count: wDeals.length })
      }

      return {
        allTime: sum(all),
        thisMonth: sum(month),
        thisWeek: sum(week),
        avgDeal: avg(all),
        totalDeals: all.length,
        weeklyChart: weeks,
      }
    },
    enabled: !!profile?.id,
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="text-xl font-medium text-[var(--text-primary)]">Revenue Tracker</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">Your closed revenue across all time</p>
        </div>
        <button
          onClick={() => setShowBankModal(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            height: 34, padding: '0 14px',
            background: 'var(--bg-elevated)',
            border: '0.5px solid var(--border)',
            borderRadius: 8, cursor: 'pointer',
            fontSize: 13, fontWeight: 500,
            color: 'var(--text-secondary)',
            transition: 'border-color 150ms, color 150ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
        >
          <Landmark size={14} />
          Add Bank Account
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="All Time" value={`$${(revenue?.allTime || 0).toLocaleString()}`} icon={DollarSign} color="green" />
        <StatCard label="This Month" value={`$${(revenue?.thisMonth || 0).toLocaleString()}`} icon={TrendingUp} color="indigo" />
        <StatCard label="This Week" value={`$${(revenue?.thisWeek || 0).toLocaleString()}`} icon={BarChart2} color="blue" />
        <StatCard label="Avg Deal" value={`$${Math.round(revenue?.avgDeal || 0).toLocaleString()}`} icon={Target} color="yellow" />
      </div>

      <Card>
        <p className="text-sm font-medium text-[var(--text-primary)] mb-4">Weekly Revenue (last 8 weeks)</p>
        {!revenue?.weeklyChart?.length ? (
          <p className="text-[var(--text-muted)] text-sm text-center py-8">No closed deals yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={revenue.weeklyChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--accent)" stopOpacity={0.20} />
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                axisLine={false} tickLine={false}
                tickFormatter={v => v === 0 ? '$0' : `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`}
                width={48}
              />
              <Tooltip content={<RevenueTooltip />} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--accent)"
                strokeWidth={2}
                fill="url(#revenueGrad)"
                dot={false}
                activeDot={{ r: 4, fill: 'var(--accent)', strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      <DealsSection closerId={profile?.id} />

      {showBankModal && <AddBankModal onClose={() => setShowBankModal(false)} />}
    </div>
  )
}

function DealsSection({ closerId }) {
  const { data: deals = [], isLoading } = useQuery({
    queryKey: ['closer-deals', closerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commission_payouts')
        .select('id, amount_cents, status, created_at, appointment:appointments!appointment_id ( lead:leads ( business_name ) )')
        .eq('rep_id', closerId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!closerId,
  })

  return (
    <Card style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Handshake size={14} style={{ color: 'var(--text-muted)' }} />
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>Deals</p>
      </div>
      {isLoading ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0', margin: 0 }}>Loading…</p>
      ) : deals.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0', margin: 0 }}>No closed deals yet</p>
      ) : (
        <div>
          {deals.map((d, i) => {
            const biz = d.appointment?.lead?.business_name || '—'
            const payout = d.amount_cents != null ? `$${(d.amount_cents / 100).toLocaleString()}` : '—'
            return (
              <div
                key={d.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: i < deals.length - 1 ? '0.5px solid var(--border)' : 'none',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{biz}</span>
                <span style={{ fontSize: 13, color: 'var(--success)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{payout}</span>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
