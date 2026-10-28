import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Wallet, Lock, CircleAlert } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { DISPLAY, MONO } from '../../lib/exportStyles'

// Prepaid lead balance (Roadmap Goal 3). Reads agent_lead_balance (one row per
// agent), the active lead_prices and prepaid_topup_options rows, and the last
// 20 agent_lead_ledger rows (migration 176). Top-ups go through the
// create-balance-topup edge function: the app sends one of the amounts it read
// from prepaid_topup_options and a same-origin return_url, the server re-checks
// the amount and hands back a Stripe Checkout URL. No card data is handled here.
// Three blocks, as in Dot's approved mockup: balance hero, price card, history.

const prepaidKey = agentId => ['prepaid-balance', agentId]

// The balance and every amount: two decimals, JetBrains Mono at the call site.
const money = cents => ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
// Top-up buttons: whole dollars, cents only when the option isn't a whole dollar.
const topupLabel = cents => {
  const d = cents / 100
  return `+$${d.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(d) ? 0 : 2, maximumFractionDigits: 2 })}`
}
const TYPE_LABEL = { mortgage_protection: 'Meta lead', policy_help: 'Google call' }
const typeLabel = t => TYPE_LABEL[t] || (t ? t.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : '')

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

const HISTORY_ROWS = 20

function usePrepaid(agentId) {
  return useQuery({
    queryKey: prepaidKey(agentId),
    enabled: !!agentId,
    retry: 1,
    queryFn: async () => {
      const [bal, prices, options, ledger] = await Promise.all([
        supabase.from('agent_lead_balance').select('balance_cents').eq('agent_id', agentId).maybeSingle(),
        supabase.from('lead_prices').select('lead_type, price_cents').eq('active', true).order('price_cents', { ascending: true }),
        supabase.from('prepaid_topup_options').select('amount_cents').eq('active', true).order('sort', { ascending: true }),
        supabase.from('agent_lead_ledger').select('id, kind, amount_cents, balance_after_cents, lead_type, created_at')
          .eq('agent_id', agentId).order('created_at', { ascending: false }).limit(HISTORY_ROWS),
      ])
      for (const r of [bal, prices, options, ledger]) if (r.error) throw r.error
      return {
        balance: bal.data?.balance_cents ?? 0,
        prices: prices.data || [],
        options: (options.data || []).map(o => o.amount_cents),
        ledger: ledger.data || [],
      }
    },
  })
}

const H2 = { margin: 0, fontFamily: DISPLAY, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ov-hi)' }
const SUB = { margin: 0, fontSize: 13.5, color: 'var(--ov-mute)' }
const MONO_NUM = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }

function Skel({ w, h, style }) {
  return <span className="ov-bal-skel" style={{ width: w, height: h, ...style }} />
}

export function PrepaidBalanceCard({ agentId }) {
  const { data, isLoading, isError, refetch } = usePrepaid(agentId)
  const qc = useQueryClient()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  async function topUp(cents) {
    setError(''); setBusy(cents)
    try {
      const { data: res, error: err } = await supabase.functions.invoke('create-balance-topup', {
        body: { amount_cents: cents, return_url: `${window.location.origin}/agent/billing` },
      })
      if (err || !res?.url) throw err || new Error('No checkout link')
      window.location.assign(res.url)
    } catch {
      setError("Couldn't start the top-up. Try again.")
      setBusy(null)
      qc.invalidateQueries({ queryKey: prepaidKey(agentId) })
    }
  }

  if (isLoading) {
    return (
      <>
        <section className="ov-hero ov-bal" aria-label="Prepaid balance" aria-busy="true">
          <Skel w={132} h={30} style={{ borderRadius: 999 }} />
          <Skel w={190} h={44} style={{ margin: '16px 0 8px' }} />
          <Skel w="85%" h={14} />
          <div className="ov-bal-topups" style={{ marginTop: 28 }}>
            {[0, 1, 2].map(i => <Skel key={i} w="auto" h={46} style={{ flex: '1 1 80px', borderRadius: 999 }} />)}
          </div>
        </section>
        <section className="ov-card ov-bal-card" aria-busy="true">
          <h2 style={H2}>Price per lead</h2>
          <Skel w="100%" h={20} style={{ marginTop: 16, background: 'var(--ov-stub)' }} />
          <Skel w="100%" h={20} style={{ marginTop: 14, background: 'var(--ov-stub)' }} />
        </section>
        <section className="ov-card ov-bal-card" aria-busy="true">
          <h2 style={H2}>History</h2>
          {[0, 1, 2].map(i => <Skel key={i} w="100%" h={36} style={{ margin: '10px 0', background: 'var(--ov-stub)' }} />)}
        </section>
      </>
    )
  }

  if (isError || !data) {
    return (
      <section className="ov-hero ov-bal" aria-label="Prepaid balance">
        <div className="ov-bal-top"><span className="ov-hero-chip"><Wallet size={14} strokeWidth={2.2} />Prepaid balance</span></div>
        <h3 style={{ margin: '16px 0 0', fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', color: 'inherit' }}>We couldn't load your balance</h3>
        <p className="ov-bal-line" style={{ marginTop: 6 }}>Your money is safe. Check your connection and try again.</p>
        <div className="ov-bal-topups" style={{ marginTop: 12 }}>
          <button type="button" className="ov-hero-btn" onClick={() => refetch()} style={{ flex: '0 0 auto', height: 46, padding: '0 22px', fontSize: 15, fontFamily: 'inherit' }}>
            Try again
          </button>
        </div>
      </section>
    )
  }

  const { balance, prices, options, ledger } = data
  const lowest = prices.length ? Math.min(...prices.map(p => p.price_cents)) : null
  // A brand-new account (no ledger rows) is a fresh start, not a warning.
  const low = lowest != null && ledger.length > 0 && balance < lowest
  const fresh = ledger.length === 0 && balance === 0

  let line = "Each lead is paid from this balance when it's delivered to you."
  if (low) line = <>That's less than one lead (<strong>{money(lowest)}</strong>). Add funds to keep getting leads.</>
  else if (fresh) line = "Add funds to start getting leads. Each one is paid from this balance when it's delivered."

  return (
    <>
      <section className="ov-hero ov-bal" aria-label="Prepaid balance">
        <div className="ov-bal-top">
          <span className="ov-hero-chip"><Wallet size={14} strokeWidth={2.2} />Prepaid balance</span>
          {low && <span className="ov-bill-chip is-warn"><i />Low balance</span>}
        </div>
        <div className="ov-bal-num" style={MONO_NUM}>{money(balance)}</div>
        <p className="ov-bal-line">{line}</p>

        {options.length > 0 ? (
          <>
            <p className="ov-bal-label">Add funds</p>
            <div className="ov-bal-topups">
              {options.map(c => (
                <button
                  key={c} type="button" className="ov-hero-btn" disabled={busy != null} onClick={() => topUp(c)}
                  aria-label={busy === c ? `Opening checkout for ${money(c)}` : `Add ${money(c)}`}
                  aria-busy={busy === c || undefined}
                >
                  {busy === c ? <Loader2 size={17} strokeWidth={2.4} className="animate-spin" /> : topupLabel(c)}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="ov-bal-line" style={{ marginTop: 16 }}>Adding funds isn't available right now.</p>
        )}

        {error && (
          <p className="ov-bal-err" role="alert"><CircleAlert size={16} strokeWidth={2.2} /><span>{error}</span></p>
        )}
        {options.length > 0 && !error && (
          <p className="ov-bal-lock">
            {busy != null ? 'Opening Stripe checkout…' : <><Lock size={13} strokeWidth={2} />Secure checkout by Stripe. Your card never touches Ohvara.</>}
          </p>
        )}
      </section>

      {prices.length > 0 && (
        <section className="ov-card ov-bal-card" aria-labelledby="ov-bal-prices">
          <div style={{ marginBottom: 6 }}>
            <h2 id="ov-bal-prices" style={H2}>Price per lead</h2>
            <p style={SUB}>Charged once, when a lead is delivered</p>
          </div>
          {prices.map((p, i) => (
            <div key={p.lead_type} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: i === 0 ? 0 : '1px solid var(--ov-line)' }}>
              <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>{typeLabel(p.lead_type)}</div>
              <div style={{ ...MONO_NUM, fontSize: 20, fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--ov-hi)' }}>{money(p.price_cents)}</div>
            </div>
          ))}
        </section>
      )}

      <section className="ov-card ov-bal-card" aria-labelledby="ov-bal-history" style={{ paddingBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <h2 id="ov-bal-history" style={{ ...H2, flex: 1 }}>History</h2>
          {ledger.length > 0 && <span style={SUB}>Newest first</span>}
        </div>
        {ledger.length === 0 ? (
          <p style={{ ...SUB, padding: '10px 0 14px' }}>No activity yet. Funds you add and leads you get show up here.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {ledger.map((r, i) => {
              const credit = r.amount_cents > 0
              const type = !credit && r.lead_type ? typeLabel(r.lead_type) : ''
              return (
                <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: i === 0 ? 0 : '1px solid var(--ov-line)' }}>
                  <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>{credit ? 'Funds added' : 'Lead delivered'}</div>
                    <div style={SUB}>{type ? `${type} · ` : ''}{when(r.created_at)}</div>
                  </div>
                  <div style={{ ...MONO_NUM, textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', color: credit ? 'var(--ov-up)' : 'var(--ov-hi)' }}>
                      {credit ? '+' : '−'}{money(Math.abs(r.amount_cents))}
                    </div>
                    {r.balance_after_cents != null && (
                      <div style={{ fontSize: 12, whiteSpace: 'nowrap', color: 'var(--ov-mute)' }}>Bal. {money(r.balance_after_cents)}</div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {ledger.length >= HISTORY_ROWS && (
          <p style={{ margin: 0, padding: '10px 0 6px', borderTop: '1px solid var(--ov-line)', fontSize: 12.5, color: 'var(--ov-faint)', textAlign: 'center' }}>
            Showing your last {HISTORY_ROWS}
          </p>
        )}
      </section>
    </>
  )
}
