import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Wallet, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { DISPLAY, MONO } from '../../lib/exportStyles'

// Prepaid lead balance. Reads agent_lead_balance (one row per agent), the
// per-lead price from recovery_config.mp_lead_price_cents, and the ledger.
// Top-ups go through the create-balance-topup edge function, which maps the
// button to an amount on the server and hands back a Stripe Checkout URL.
const TOPUPS = [100, 250, 500]

const money = cents => {
  const d = (cents || 0) / 100
  return d.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(d) ? 0 : 2 })
}
const when = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

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

  const leads = data && data.price > 0 ? Math.floor(data.balance / data.price) : null

  return (
    <section className="ov-card" aria-label="Prepaid balance" style={{ borderRadius: 18, padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ov-soft)', fontSize: 13.5, fontWeight: 600 }}>
        <Wallet size={16} strokeWidth={2.1} /> Prepaid balance
      </div>

      {isLoading ? (
        <Loader2 size={18} className="animate-spin" style={{ color: 'var(--ov-mute)' }} />
      ) : isError ? (
        <div style={{ fontSize: 13.5, color: 'var(--ov-mute)' }}>Balance isn't available right now.</div>
      ) : (
        <>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 38, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.03em', color: 'var(--ov-hi)', fontVariantNumeric: 'tabular-nums' }}>
              {money(data.balance)}
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ov-mute)' }}>
              {data.price != null && (
                <><span style={{ fontFamily: MONO, color: 'var(--ov-soft)' }}>{money(data.price)}</span> per lead</>
              )}
              {leads != null && <> · about <span style={{ fontFamily: MONO, color: 'var(--ov-soft)' }}>{leads}</span> leads left</>}
            </div>
          </div>

          <div>
            <div style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 600, color: 'var(--ov-soft)', marginBottom: 8 }}>Add funds</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {TOPUPS.map(d => (
                <button
                  key={d} type="button" className="ov-ghost" disabled={busy != null} onClick={() => topUp(d)}
                  style={{ flex: '1 1 80px', height: 44, borderRadius: 999, fontFamily: MONO, fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {busy === d ? <Loader2 size={16} className="animate-spin" /> : `$${d}`}
                </button>
              ))}
            </div>
            {error && <div role="alert" style={{ marginTop: 8, fontSize: 13, color: 'var(--danger)' }}>{error}</div>}
          </div>

          <div>
            <div style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 600, color: 'var(--ov-soft)', marginBottom: 4 }}>History</div>
            {data.ledger.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--ov-mute)' }}>No activity yet.</div>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {data.ledger.map(r => {
                  const credit = r.amount_cents > 0
                  return (
                    <li key={r.id} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderTop: '1px solid var(--ov-line)', fontSize: 13.5 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: 'var(--ov-hi)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.note || (credit ? 'Added funds' : 'Lead')}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ov-mute)' }}>{when(r.created_at)}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
                        <div style={{ fontWeight: 600, color: credit ? 'var(--ov-up)' : 'var(--ov-soft)' }}>
                          {credit ? '+' : '−'}{money(Math.abs(r.amount_cents))}
                        </div>
                        {r.balance_after_cents != null && (
                          <div style={{ fontSize: 12, color: 'var(--ov-mute)' }}>{money(r.balance_after_cents)}</div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  )
}
