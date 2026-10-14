import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAllProfiles } from '../../hooks/useProfiles'
import { useFixHours, usePayWeek, usePayoutAccounts, usePayouts, usePayoutsLive, useWeekDays } from '../../hooks/useFulfillmentPayouts'
import { Avatar } from '../../components/ui/Avatar'
import { addDaysStr } from '../../lib/scheduling'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../../lib/timezones'

// Admin Payouts (Prompt 761), ported from media/admin-redesign/admin-payouts.dc.html.
// Reads left to right: the selected week's amount waiting + Approve all (left),
// pay by week for the last 8 weeks + this one (right; a bar picks the week),
// then one strip per Fulfillment person for that week (Mon–Sun hours, pay,
// actions). Amounts are always the server's (fulfillment_payouts, filled from
// fulfillment_week_figures); the page never sends one. Approve calls
// fulfillment-pay-week per person; while payouts_live is off that only marks
// the week approved and nothing reaches Stripe. Fix hours writes an audited
// correction (fulfillment_fix_hours, migration 143) and is refused once a week
// is approved or paid. URL: ?week=YYYY-MM-DD (that week's Monday).

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const FULL_DAY = 8 // hours that fill a day box

const utc = s => new Date(`${s}T12:00:00Z`)
const mondayOf = s => addDaysStr(s, -((utc(s).getUTCDay() + 6) % 7))
const md = s => utc(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const span = mon => `${md(mon)} to ${md(addDaysStr(mon, 6))}`
const money = cents => {
  const v = (cents || 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })
}
const hrs = h => String(Math.round((Number(h) || 0) * 100) / 100)
const paidDay = (iso, tz) => (iso ? new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }) : '')
const canPay = a => !!a && a.payouts_enabled && a.transfers_active // same as the server's canPay
const bankLine = a => (a?.last4 ? `${a.bank_name || 'Bank'} ···· ${a.last4}` : 'No bank connected')

// Where one person's week stands, from the admin's side.
//   paid · approved (off: no money moved) · waiting (needs Approve) · held · failed · open (week not over)
function stateOf(row, ended, live) {
  if (row.status === 'paid') return 'paid'
  if (!ended) return 'open'
  if (row.status === 'approved') return live ? 'waiting' : 'approved'
  if (row.status === 'held' || row.status === 'failed') return row.status
  return 'waiting'
}
const isWaiting = s => s === 'waiting' || s === 'held' || s === 'failed'
const RANK = { failed: 0, held: 0, waiting: 0, open: 1, approved: 2, paid: 3 }

export default function AdminPayouts() {
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const thisMon = mondayOf(zonedDateStr(Date.now(), tz))
  const [params, setParams] = useSearchParams()

  const payouts = usePayouts(null)
  const accounts = usePayoutAccounts(null)
  const liveQ = usePayoutsLive()
  const profiles = useAllProfiles()
  const payWeek = usePayWeek()
  const live = !!liveQ.data

  const [fixFor, setFixFor] = useState(null)
  const [confirm, setConfirm] = useState(null) // { rows } waiting for "Send" while live
  const [busy, setBusy] = useState({})          // repId → true while approving
  const [errs, setErrs] = useState({})          // repId → message
  const [notice, setNotice] = useState(null)

  const people = useMemo(() => new Map((profiles.data || []).map(p => [p.id, p])), [profiles.data])
  const acctBy = useMemo(() => new Map((accounts.data || []).map(a => [a.rep_id, a])), [accounts.data])

  // The last 8 weeks plus this one, with each week's rows and totals.
  const weeks = useMemo(() => {
    const rows = payouts.data || []
    return Array.from({ length: 9 }, (_, i) => {
      const mon = addDaysStr(thisMon, (i - 8) * 7)
      const ended = mon < thisMon
      const list = rows.filter(r => r.period_start === mon)
      const states = list.map(r => stateOf(r, ended, live))
      const total = list.reduce((s, r) => s + (r.amount_cents || 0), 0)
      const waiting = list.filter((r, j) => isWaiting(states[j]))
      const kind = !ended ? 'open'
        : waiting.length ? 'wait'
          : !list.length ? 'none'
            : states.every(s => s === 'paid') ? 'paid' : 'approved'
      return { mon, ended, list, total, waiting, waitCents: waiting.reduce((s, r) => s + (r.amount_cents || 0), 0), kind }
    })
  }, [payouts.data, thisMon, live])

  // Selected week: ?week=, else the latest finished week with pay waiting, else last week.
  const asked = params.get('week')
  const fallback = [...weeks].reverse().find(w => w.ended && w.waiting.length)?.mon || addDaysStr(thisMon, -7)
  const sel = weeks.find(w => w.mon === (DAY_RE.test(asked || '') ? mondayOf(asked) : fallback)) || weeks.find(w => w.mon === fallback)
  const pick = mon => setParams(p => { const n = new URLSearchParams(p); n.set('week', mon); return n }, { replace: true })

  const strips = useMemo(() => sel.list
    .map(r => ({ row: r, rep: people.get(r.rep_id), account: acctBy.get(r.rep_id) || null, state: stateOf(r, sel.ended, live) }))
    // Waiting on the admin first, paid last (as in the mockup), then by name.
    .sort((a, b) => (RANK[a.state] - RANK[b.state]) || (a.rep?.full_name || '').localeCompare(b.rep?.full_name || '')), [sel, people, acctBy, live])
  const repIds = useMemo(() => strips.map(s => s.row.rep_id), [strips])
  const days = useWeekDays(sel.mon, repIds)

  async function approve(list) {
    setNotice(null)
    const out = { paid: 0, approved: 0, held: 0, failed: 0, other: 0 }
    for (const r of list) { // one call per person, same function, idempotent
      setBusy(b => ({ ...b, [r.rep_id]: true }))
      setErrs(e => ({ ...e, [r.rep_id]: null }))
      try {
        const res = await payWeek.mutateAsync({ repId: r.rep_id, periodStart: r.period_start })
        if (res?.approved_only) out.approved++; else out.paid++
      } catch (e) {
        if (e.code === 'held') out.held++
        else if (e.code === 'transfer_failed') out.failed++
        else { out.other++; setErrs(x => ({ ...x, [r.rep_id]: e.message })) }
      } finally {
        setBusy(b => ({ ...b, [r.rep_id]: false }))
      }
    }
    const parts = [
      out.paid && `${out.paid} paid`, out.approved && `${out.approved} approved, no money moved`,
      out.held && `${out.held} held`, out.failed && `${out.failed} failed`, out.other && `${out.other} not done`,
    ].filter(Boolean)
    if (list.length > 1 || out.approved) setNotice(parts.join(' · '))
  }
  const start = list => (live ? setConfirm({ rows: list }) : approve(list))

  const loading = payouts.isLoading || liveQ.isLoading
  const n = sel.waiting.length
  const allLabel = n === 2 ? 'Approve and pay both' : n > 2 ? `Approve and pay all ${n}` : 'Approve and pay'
  const anyBusy = Object.values(busy).some(Boolean)
  const maxTotal = Math.max(1, ...weeks.map(w => w.total))

  return (
    <div className="ap-page">
      {!liveQ.isLoading && !live && (
        <p className="ap-banner" role="status">Payouts aren’t live yet. Approving marks the week approved; no money moves.</p>
      )}

      <div className="ap-top">
        <section className="ap-hero" aria-label={`Week of ${span(sel.mon)}`}>
          <div className="ap-hero-head">
            <div>
              <div className="ap-hero-week">Week of {span(sel.mon)}</div>
              <div className="ap-hero-amt">
                <b>{money(!sel.ended || !n ? sel.total : sel.waitCents)}</b>
                <span>{!sel.ended ? 'so far' : n ? 'waiting on you' : !sel.list.length ? 'nobody on pay' : sel.kind === 'paid' ? 'all paid' : 'approved'}</span>
              </div>
            </div>
            {sel.list.length > 0 && <span className="ap-chip">{sel.ended ? `${n} of ${sel.list.length}` : `${sel.list.length} on pay`}</span>}
          </div>
          <div className="ap-hero-foot">
            {sel.ended && n > 0 ? (
              <button type="button" className="ap-all" disabled={anyBusy} onClick={() => start(sel.waiting)}>
                <Check size={18} strokeWidth={2.4} />{anyBusy ? 'Working…' : allLabel}
              </button>
            ) : (
              <span className="ap-all is-off">{!sel.ended ? 'Pays after Sunday' : 'Nothing waiting'}</span>
            )}
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
        <span>Hours come from each person’s shifts. Check them, then approve.</span>
      </div>
      {notice && <p className="ap-notice" role="status">{notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><X size={14} /></button></p>}

      <div className="ap-strips">
        {loading && <section className="ov-card ap-empty">Loading…</section>}
        {payouts.isError && <section className="ov-card ap-empty">Couldn’t load pay: {payouts.error.message}</section>}
        {!loading && !payouts.isError && !strips.length && (
          <section className="ov-card ap-empty">Nobody on Fulfillment has pay for this week. Set a rate and shift in Settings → Fulfillment pay.</section>
        )}
        {strips.map(s => (
          <Strip key={s.row.id} s={s} days={days.data?.[s.row.rep_id]} tz={tz}
            busy={!!busy[s.row.rep_id]} err={errs[s.row.rep_id]}
            onApprove={() => start([s.row])} onFix={() => setFixFor(s)} />
        ))}
      </div>

      {fixFor && <FixHours s={fixFor} weekMon={sel.mon} days={days.data?.[fixFor.row.rep_id]} onClose={() => setFixFor(null)} />}
      {confirm && (
        <Confirm rows={confirm.rows} people={people} acctBy={acctBy} weekMon={sel.mon}
          onCancel={() => setConfirm(null)} onSend={() => { const r = confirm.rows; setConfirm(null); approve(r) }} />
      )}
    </div>
  )
}

function Strip({ s, days, tz, busy, err, onApprove, onFix }) {
  const { row, rep, account, state } = s
  const tone = state === 'paid' ? 'is-paid' : state === 'open' || state === 'approved' ? 'is-open' : 'is-wait'
  const editable = !['paid', 'approved'].includes(row.status)
  const bankReady = canPay(account)
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
        {DAYS.map((l, i) => {
          const d = days?.[i]
          const h = d ? d.hours : null
          return (
            <div key={l} className={`ap-day ${tone}${h ? '' : ' is-off'}`}
              title={d?.fixed != null ? `Fixed: schedule said ${hrs(d.scheduled)} h` : undefined}>
              <span className="ap-day-f" style={{ height: `${Math.min(100, Math.round(((h || 0) / FULL_DAY) * 100))}%` }} />
              <span className="ap-day-l">{l}{d?.fixed != null && <i aria-label="fixed" />}</span>
              <span className="ap-day-v">{h == null ? '' : h ? hrs(h) : '—'}</span>
            </div>
          )
        })}
      </div>

      <div className="ap-pay">
        <b>{money(row.amount_cents)}</b>
        <span>{hrs(row.hours)} hrs × {money(row.rate_cents)}</span>
      </div>

      <div className="ap-act">
        {state === 'paid' && <span className="ap-pill is-paid"><Check size={15} strokeWidth={2.6} />Paid {paidDay(row.paid_at, tz)}</span>}
        {state === 'approved' && <span className="ap-pill is-info">Approved · no money moved</span>}
        {(state === 'held' || ((state === 'waiting' || state === 'open') && !bankReady)) && (
          <span className="ap-pill is-warn" title={row.failure_reason || undefined}>Held · bank not connected</span>
        )}
        {state === 'failed' && <span className="ap-pill is-bad">Failed</span>}
        {state === 'failed' && row.failure_reason && <span className="ap-why">{row.failure_reason}</span>}
        {editable && (
          <span className="ap-btns">
            <button type="button" className="ap-ghost" onClick={onFix} disabled={busy}>Fix hours</button>
            {state === 'open'
              ? <span className="ap-open">Week still open</span>
              : <button type="button" className="ap-solid" onClick={onApprove} disabled={busy || !(row.amount_cents > 0)}
                  title={!(row.amount_cents > 0) ? 'Nothing to pay' : undefined}>
                  {busy ? 'Working…' : state === 'held' || state === 'failed' ? 'Retry' : row.status === 'approved' ? 'Pay' : 'Approve'}
                </button>}
          </span>
        )}
        {err && <span className="ap-err" role="alert">{err}</span>}
      </div>
    </section>
  )
}

function FixHours({ s, weekMon, days, onClose }) {
  const fix = useFixHours()
  const [vals, setVals] = useState(() => DAYS.map((_, i) => (days?.[i] ? hrs(days[i].hours) : '0')))
  const [reason, setReason] = useState('')
  const parsed = vals.map(v => (v.trim() === '' ? NaN : Number(v)))
  const bad = parsed.map(v => !Number.isFinite(v) || v < 0 || v > 24)
  const changed = {}
  parsed.forEach((v, i) => {
    const before = days?.[i] ? Math.round(days[i].hours * 100) / 100 : 0
    if (!bad[i] && Math.round(v * 100) / 100 !== before) changed[addDaysStr(weekMon, i)] = Math.round(v * 100) / 100
  })
  const total = parsed.reduce((t, v, i) => t + (bad[i] ? 0 : v), 0)
  const ok = !bad.some(Boolean) && Object.keys(changed).length > 0 && reason.trim().length >= 3 && !!days

  function save() {
    fix.mutate({ repId: s.row.rep_id, periodStart: weekMon, days: changed, reason: reason.trim() }, { onSuccess: onClose })
  }

  return createPortal(
    <>
      <div className="ov-scrim ap-scrim" onClick={() => !fix.isPending && onClose()} aria-hidden="true" />
      <div className="ov-card ap-modal" role="dialog" aria-modal="true" aria-label="Fix hours">
        <div className="ap-modal-head">
          <div>
            <h2>Fix hours · {s.rep?.full_name || 'Unknown'}</h2>
            <p>{span(weekMon)}. Change a day, say why. It’s kept with your name.</p>
          </div>
          <button type="button" className="ap-x" aria-label="Close" onClick={onClose} disabled={fix.isPending}><X size={18} /></button>
        </div>
        <div className="ap-fix-days">
          {DAYS.map((l, i) => (
            <label key={l} className={bad[i] ? 'is-bad' : ''}>
              <span>{l} {md(addDaysStr(weekMon, i))}</span>
              <input value={vals[i]} inputMode="decimal" aria-label={`${l} hours`}
                onChange={e => setVals(v => v.map((x, j) => (j === i ? e.target.value : x)))} />
              <em>{days?.[i] ? `Shift ${hrs(days[i].scheduled)}` : ''}</em>
            </label>
          ))}
        </div>
        <label className="ap-fix-why">
          <span>Why (required)</span>
          <textarea rows={2} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} placeholder="Left 2 hours early on Friday" />
        </label>
        <div className="ap-fix-foot">
          <span>{hrs(total)} hrs × {money(s.row.rate_cents)} = <b>{money(Math.round(total * s.row.rate_cents))}</b></span>
          <button type="button" className="ap-solid" disabled={!ok || fix.isPending} onClick={save}>{fix.isPending ? 'Saving…' : 'Save'}</button>
        </div>
        {fix.isError && <p className="ap-err" role="alert">{fix.error.message}</p>}
      </div>
    </>,
    document.body,
  )
}

function Confirm({ rows, people, acctBy, weekMon, onCancel, onSend }) {
  const total = rows.reduce((t, r) => t + (r.amount_cents || 0), 0)
  return createPortal(
    <>
      <div className="ov-scrim ap-scrim" onClick={onCancel} aria-hidden="true" />
      <div className="ov-card ap-modal" role="dialog" aria-modal="true" aria-label="Approve and pay">
        <div className="ap-modal-head">
          <div>
            <h2>Send {money(total)}?</h2>
            <p>{span(weekMon)}. Each amount is worked out again from the hours before it’s sent. This can’t be undone here.</p>
          </div>
          <button type="button" className="ap-x" aria-label="Close" onClick={onCancel}><X size={18} /></button>
        </div>
        <ul className="ap-confirm">
          {rows.map(r => (
            <li key={r.id}>
              <span>{people.get(r.rep_id)?.full_name || 'Unknown'}<em>{bankLine(acctBy.get(r.rep_id))}</em></span>
              <b>{money(r.amount_cents)}</b>
            </li>
          ))}
        </ul>
        <div className="ap-fix-foot">
          <button type="button" className="ap-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="ap-solid" onClick={onSend}>Approve and pay</button>
        </div>
      </div>
    </>,
    document.body,
  )
}
