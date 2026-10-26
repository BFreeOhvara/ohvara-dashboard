import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { DISPLAY, MONO } from '../../lib/exportStyles'

// Prepaid lead balance. Reads agent_lead_balance (one row per agent), the
// per-lead price from recovery_config.mp_lead_price_cents, and the ledger.
// Top-ups go through the create-balance-topup edge function, which maps the
// button to an amount on the server and hands back a Stripe Checkout URL.
// Three blocks, as in Dot's mockup: balance hero, price card, history card.
const TOPUPS = [100, 250, 500]

const money = cents => {
  const d = (cents || 0) / 100
  return d.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(d) ? 0 : 2 })
}
const TZ = 'America/Chicago'
const dayKey = d => d.toLocaleDateString('en-CA', { timeZone: TZ })
const when = iso => {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
  const now = new Date()
  const key = dayKey(d)
  if (key === dayKey(now)) return `Today, ${time}`
  if (key === dayKey(new Date(now.getTime() - 864e5))) return `Yesterday, ${time}`
  return `${d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' })}, ${time}`
}

function usePrepaid(agentId) {
  return useQuery({
    queryKey: ['prepaid-balance', agentId],
    enabled: !!agentId,
    queryFn: async () => {
      const [bal, cfg, ledger] = await Promise.all([
        supabase.from('agent_lead_balance').select('balance_cents').eq('agent_id', agentId).maybeSingle(),
        supabase.from('recovery_config').select('mp_lead_price_cents').limit(1).maybeSingle(),
        supabase.from('agent_lead_ledger').select('id, kind, amount_cents, balance_after_cents, note, created_at')
          .eq('agent_id', agentId).order('created_at', { ascending: false }).limit(20),
      ])
      if (bal.error) throw bal.error
      return {
        balance: bal.data?.balance_cents ?? 0,
        price: cfg.data?.mp_lead_price_cents ?? null,
        ledger: ledger.data || [],
      }
    },
  })
}

const H2 = { margin: 0, fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, color: 'var(--ov-hi)' }
const CARD = { borderRadius: 18, padding: 16, marginBottom: 14, minWidth: 0 }

export function PrepaidBalanceCard({ agentId }) {
  const { data, isLoading, isError } = usePrepaid(agentId)
  const qc = useQueryClient()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  async function topUp(dollars) {
    setError(''); setBusy(dollars)
    try {
      const { data: res, error: err } = await supabase.functions.invoke('create-balance-topup', {
        body: { amount_dollars: dollars, return_url: `${window.location.origin}/agent/billing` },
      })
      if (err || !res?.url) throw err || new Error('No checkout link')
      window.location.assign(res.url)
    } catch {
      setError("Couldn't start the top-up. Try again.")
      setBusy(null)
      qc.invalidateQueries({ queryKey: ['prepaid-balance', agentId] })
    }
  }

  const ready = !isLoading && !isError

  return (
    <>
      <section className="ov-hero" aria-label="Prepaid balance" style={{ padding: '20px 18px', marginBottom: 14, minWidth: 0 }}>
        <div style={{ color: 'var(--ov-hero-soft)', fontSize: 13.5 }}>Prepaid balance</div>
        {isLoading && <Loader2 size={18} className="animate-spin" style={{ marginTop: 10, color: 'var(--ov-hero-soft)' }} />}
        {isError && <div style={{ marginTop: 6, fontSize: 13.5, color: 'var(--ov-hero-soft)' }}>Balance isn't available right now.</div>}
        {ready && (
          <>
            <div style={{ fontFamily: MONO, fontSize: 44, fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.02em', margin: '6px 0 4px', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
              {money(data.balance)}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
              {TOPUPS.map(d => (
                <button
                  key={d} type="button" className="ov-hero-btn" disabled={busy != null} onClick={() => topUp(d)}
                  aria-label={`Add ${money(d * 100)}`}
                  style={{ flex: '1 1 80px', minHeight: 46, fontFamily: MONO, fontSize: 14.5 }}
                >
                  {busy === d ? <Loader2 size={16} className="animate-spin" /> : `+$${d}`}
                </button>
              ))}
            </div>
            {error && <div role="alert" style={{ marginTop: 10, fontSize: 13, color: 'var(--ov-hero-soft)' }}>{error}</div>}
          </>
        )}
      </section>

      {ready && (
        <>
          <section className="ov-card" aria-label="Price per lead" style={CARD}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                <h2 style={H2}>Price per lead</h2>
                <div style={{ fontSize: 13.5, color: 'var(--ov-mute)' }}>Charged when a lead is delivered</div>
              </div>
              {data.price != null && (
                <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, color: 'var(--ov-hi)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {money(data.price)}
                </div>
              )}
            </div>
          </section>

          <section className="ov-card" aria-label="History" style={CARD}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <h2 style={{ ...H2, flex: 1 }}>History</h2>
              <span style={{ fontSize: 13.5, color: 'var(--ov-mute)' }}>Newest first</span>
            </div>
            {data.ledger.length === 0 ? (
              <div style={{ fontSize: 13.5, color: 'var(--ov-mute)', padding: '6px 0' }}>No activity yet.</div>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {data.ledger.map((r, i) => {
                  const credit = r.amount_cents > 0
                  return (
                    <li key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderTop: i === 0 ? 0 : '1px solid var(--ov-line)' }}>
                      <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                        <div style={{ fontWeight: 600, color: 'var(--ov-hi)' }}>{credit ? 'Funds added' : 'Lead delivered'}</div>
                        <div style={{ fontSize: 13.5, color: 'var(--ov-mute)' }}>{r.note ? `${r.note} · ` : ''}{when(r.created_at)}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
                        <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', color: credit ? 'var(--ov-up)' : 'var(--ov-hi)' }}>
                          {credit ? '+' : '−'}{money(Math.abs(r.amount_cents))}
                        </div>
                        {r.balance_after_cents != null && (
                          <div style={{ fontSize: 12.5, color: 'var(--ov-mute)' }}>{money(r.balance_after_cents)}</div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  )
}
