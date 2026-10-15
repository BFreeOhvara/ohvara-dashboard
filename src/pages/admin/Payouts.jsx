import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAllProfiles } from '../../hooks/useProfiles'
import { useCancels, usePaySettings, usePayoutAccounts, usePayouts } from '../../hooks/useFulfillmentPayouts'
import { Avatar } from '../../components/ui/Avatar'
import { addDaysStr } from '../../lib/scheduling'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../../lib/timezones'
import { isVerified } from '../../lib/myPay'
import { useNow } from '../../lib/agentBookings'

// Admin Payouts (Prompt 761, media/admin-redesign/admin-payouts.dc.html).
// Prompt 764: pay is per verified cancel and goes out by itself every Monday
// 8 AM Central (fulfillment-pay-week), so there is no Approve and no Fix
// hours here; the full redesign is Prompt 765. Reads left to right: the
// selected week's amount (left), pay by week for the last 8 weeks + this one
// (right; a bar picks the week), then one strip per Fulfillment person:
// cancels Mon–Sun, "N cancels × $10", and where that week's payout stands.
// A week with no payout row yet shows its verified cancels as upcoming.
// URL: ?week=YYYY-MM-DD (that week's Monday).

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const FULL_DAY = 10 // cancels that fill a day box

const utc = s => new Date(`${s}T12:00:00Z`)
const mondayOf = s => addDaysStr(s, -((utc(s).getUTCDay() + 6) % 7))
const md = s => utc(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const span = mon => `${md(mon)} to ${md(addDaysStr(mon, 6))}`
const money = cents => {
  const v = (cents || 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })
}
const paidDay = (iso, tz) => (iso ? new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }) : '')
const canPay = a => !!a && a.payouts_enabled && a.transfers_active // same as the server's canPay
const bankLine = a => (a?.last4 ? `${a.bank_name || 'Bank'} ···· ${a.last4}` : 'No bank connected')

// Where one person's week stands: paid · sending · held · failed · waiting (Monday's run) · open
function stateOf(row, ended) {
  if (row.status === 'paid') return 'paid'
  if (row.status === 'approved') return 'sending'
  if (row.status === 'held' || row.status === 'failed') return row.status
  return ended ? 'waiting' : 'open'
}
const RANK = { failed: 0, held: 0, waiting: 1, sending: 1, open: 2, paid: 3 }

export default function AdminPayouts() {
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const now = useNow(60e3)
  const thisMon = mondayOf(zonedDateStr(now, tz))
  const firstMon = addDaysStr(thisMon, -8 * 7)
  const [params, setParams] = useSearchParams()

  const payouts = usePayouts(null)
  const cancels = useCancels(null, firstMon)
  const accounts = usePayoutAccounts(null)
  const settings = usePaySettings()
  const profiles = useAllProfiles()
  const live = !!settings.data?.payouts_live
  const paused = !!settings.data?.payouts_paused

  const people = useMemo(() => new Map((profiles.data || []).map(p => [p.id, p])), [profiles.data])
  const acctBy = useMemo(() => new Map((accounts.data || []).map(a => [a.rep_id, a])), [accounts.data])

  // The last 8 weeks plus this one: payout rows, and an upcoming row per
  // person with verified cancels that week and no payout yet.
  const weeks = useMemo(() => {
    const rows = payouts.data || []
    const all = cancels.data || []
    return Array.from({ length: 9 }, (_, i) => {
      const mon = addDaysStr(thisMon, (i - 8) * 7)
      const ended = mon < thisMon
      const list = rows.filter(r => r.period_start === mon)
      const weekCancels = all.filter(c => c.week_start === mon)
      for (const repId of new Set(weekCancels.map(c => c.rep_id))) {
        if (list.some(r => r.rep_id === repId)) continue
        const v = weekCancels.filter(c => c.rep_id === repId && isVerified(c) && !c.paid_at)
        list.push({ id: `up-${repId}-${mon}`, rep_id: repId, period_start: mon, status: 'upcoming', cancels: v.length, topup_cents: 0, amount_cents: v.reduce((s, c) => s + c.amount_cents, 0) })
      }
      const states = list.map(r => stateOf(r, ended))
      const total = list.reduce((s, r) => s + (r.amount_cents || 0), 0)
      const kind = !ended ? 'open'
        : states.some(s => s === 'waiting' || s === 'held' || s === 'failed') ? 'wait'
          : !list.length ? 'none' : 'paid'
      return { mon, ended, list, weekCancels, total, kind }
    })
  }, [payouts.data, cancels.data, thisMon])

  const asked = params.get('week')
  const fallback = addDaysStr(thisMon, -7)
  const sel = weeks.find(w => w.mon === (DAY_RE.test(asked || '') ? mondayOf(asked) : fallback)) || weeks.find(w => w.mon === fallback)
  const pick = mon => setParams(p => { const n = new URLSearchParams(p); n.set('week', mon); return n }, { replace: true })

  const rate = settings.data?.pay_per_cancel_cents ?? 1000
  const strips = useMemo(() => sel.list
    .map(r => ({
      row: r, rep: people.get(r.rep_id), account: acctBy.get(r.rep_id) || null, state: stateOf(r, sel.ended),
      days: DAYS.map((_, i) => sel.weekCancels.filter(c => c.rep_id === r.rep_id && zonedDateStr(Date.parse(c.logged_at), tz) === addDaysStr(sel.mon, i)).length),
    }))
    .sort((a, b) => (RANK[a.state] - RANK[b.state]) || (a.rep?.full_name || '').localeCompare(b.rep?.full_name || '')), [sel, people, acctBy, tz])

  const loading = payouts.isLoading || settings.isLoading || cancels.isLoading
  const maxTotal = Math.max(1, ...weeks.map(w => w.total))

  return (
    <div className="ap-page">
      {!settings.isLoading && (!live || paused) && (
        <p className="ap-banner" role="status">{!live ? 'Payouts aren’t live yet. Monday runs move no money.' : 'Payouts are paused. Monday runs are skipped until you turn this off in Settings.'}</p>
      )}

      <div className="ap-top">
        <section className="ap-hero" aria-label={`Week of ${span(sel.mon)}`}>
          <div className="ap-hero-head">
            <div>
              <div className="ap-hero-week">Week of {span(sel.mon)}</div>
              <div className="ap-hero-amt">
                <b>{money(sel.total)}</b>
                <span>{!sel.ended ? 'verified so far' : !sel.list.length ? 'nobody on pay' : sel.kind === 'paid' ? 'all paid' : 'to pay Monday'}</span>
              </div>
            </div>
            {sel.list.length > 0 && <span className="ap-chip">{sel.list.length} on pay</span>}
          </div>
          <div className="ap-hero-foot">
            <span className="ap-all is-off">Pays by itself Monday 8 AM</span>
            <span className="ap-hero-note">{live ? 'Through Stripe, lands in 1 to 2 days' : 'Payouts are off: no money moves'}</span>
          </div>
        </section>

        <section className="ov-card ap-chart">
          <div className="ap-chart-head">
            <div>
              <h2>Pay by week</h2>
              <p>Pick a week to see it below</p>
            </div>
            <div className="ap-key">
              <span><i className="is-paid" />Paid</span>
              <span><i className="is-wait" />Waiting</span>
              <span><i className="is-open" />Still open</span>
            </div>
          </div>
          <div className="ap-bars" role="tablist" aria-label="Pay weeks">
            {weeks.map(w => (
              <button key={w.mon} type="button" role="tab" aria-selected={w.mon === sel.mon}
                className={`ap-bar is-${w.kind}${w.mon === sel.mon ? ' is-sel' : ''}`} onClick={() => pick(w.mon)}
                title={`${span(w.mon)} · ${money(w.total)}`}>
                <span className="ap-bar-a">{w.kind === 'open' ? 'So far' : money(w.total)}</span>
                <span className="ap-bar-b" style={{ height: Math.max(10, Math.round((w.total / maxTotal) * 96)) }} />
                <span className="ap-bar-l">{md(w.mon)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="ap-sec">
        <h2>{span(sel.mon)}</h2>
        <span>Verified cancels are paid the Monday after the week ends.</span>
      </div>

      <div className="ap-strips">
        {loading && <section className="ov-card ap-empty">Loading…</section>}
        {payouts.isError && <section className="ov-card ap-empty">Couldn’t load pay: {payouts.error.message}</section>}
        {!loading && !payouts.isError && !strips.length && (
          <section className="ov-card ap-empty">Nobody on Fulfillment logged a cancel this week.</section>
        )}
        {strips.map(s => <Strip key={s.row.id} s={s} tz={tz} rate={rate} />)}
      </div>
    </div>
  )
}

function Strip({ s, tz, rate }) {
  const { row, rep, account, state, days } = s
  const tone = state === 'paid' ? 'is-paid' : state === 'open' || state === 'sending' ? 'is-open' : 'is-wait'
  const bankReady = canPay(account)
  const each = row.cancels ? Math.round((row.amount_cents - (row.topup_cents || 0)) / row.cancels) : rate
  return (
    <section className={`ov-card ap-strip${state === 'paid' ? ' is-done' : ''}`}>
      <div className="ap-who">
        {rep ? <Avatar profile={rep} size={44} /> : <span className="ap-av-none">?</span>}
        <span>
          <b>{rep?.full_name || 'Unknown'}</b>
          <span className={`ap-bank${account?.last4 ? '' : ' is-none'}`}>{bankLine(account)}</span>
        </span>
      </div>

      <div className="ap-days">
        {DAYS.map((l, i) => (
          <div key={l} className={`ap-day ${tone}${days[i] ? '' : ' is-off'}`}>
            <span className="ap-day-f" style={{ height: `${Math.min(100, Math.round((days[i] / FULL_DAY) * 100))}%` }} />
            <span className="ap-day-l">{l}</span>
            <span className="ap-day-v">{days[i] || '—'}</span>
          </div>
        ))}
      </div>

      <div className="ap-pay">
        <b>{money(row.amount_cents)}</b>
        <span>{row.cancels || 0} cancel{row.cancels === 1 ? '' : 's'} × {money(each)}{row.topup_cents ? ` + ${money(row.topup_cents)} minimum` : ''}</span>
      </div>

      <div className="ap-act">
        {state === 'paid' && <span className="ap-pill is-paid"><Check size={15} strokeWidth={2.6} />Paid {paidDay(row.paid_at, tz)}</span>}
        {state === 'sending' && <span className="ap-pill is-info">Sending</span>}
        {(state === 'held' || ((state === 'waiting' || state === 'open') && !bankReady)) && (
          <span className="ap-pill is-warn" title={row.failure_reason || undefined}>Held · bank not connected</span>
        )}
        {state === 'failed' && <span className="ap-pill is-bad">Failed</span>}
        {state === 'failed' && row.failure_reason && <span className="ap-why">{row.failure_reason}</span>}
        {state === 'waiting' && bankReady && <span className="ap-open">Pays Monday</span>}
        {state === 'open' && bankReady && <span className="ap-open">Week still open</span>}
      </div>
    </section>
  )
}
