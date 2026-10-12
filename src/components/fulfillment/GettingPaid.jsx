import { useMemo, useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { eyebrow, fieldLabel, control, primaryBtn, MONO, DISPLAY } from '../../lib/exportStyles'
import { Segmented } from '../ui/Segmented'
import { SavedTick } from '../ui/SavedTick'
import { Avatar } from '../ui/Avatar'
import { useFulfillmentPay, useFulfillmentReps, useSavePay } from '../../hooks/useFulfillmentPay'
import {
  WEEKDAYS, payPeriod, fmtPeriod, shiftSegments, workedHours, fmtHours, fmtCents, estimateCents,
  fmtShift, scheduledHours, fmtTime,
} from '../../lib/payPeriod'
import { useNow } from '../../lib/agentBookings'
import { Switch } from '../ui/Switch'
import { ConfirmDialog } from '../agent/ManageBilling'
import { usePayouts, usePayoutAccounts, usePayoutsLive, useSetPayoutsLive, usePayWeek } from '../../hooks/useFulfillmentPayouts'
import { accountStatus, destination, isoDay } from '../../lib/myPay'

// Fulfillment pay, the admin's team table (Prompt 681; in Settings → Team
// tools since 720). Each rep's scheduled shift, the hours it adds up to this
// pay period (automatic, nothing to punch in; Prompt 685), their hourly rate,
// and hours × rate. Admin is the only one who can set a rate or shift (RLS,
// migration 115). The rep's own view is My pay (pages/fulfillment/MyPay.jsx,
// Prompt 753).
// Prompt 753 — Approve & pay per rep for a finished week: a Stripe Transfer to
// the rep's connected account, through fulfillment-pay-week (which recomputes
// the amount on the server). Disabled until payouts_live is on; the switch
// sits on this card.

const PERIODS = [{ value: 'this', label: 'This week' }, { value: 'last', label: 'Last week' }]

function usePeriod(which, now) {
  return useMemo(() => payPeriod(which === 'last' ? now - 7 * 864e5 : now), [which, now])
}

const fmtClock = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const fmtDay = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

// One row per scheduled shift in the period. Today's row accrues as the day goes.
function ShiftList({ pay, period, now }) {
  const rows = shiftSegments(pay, period, now)
  if (!rows.length) {
    return <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{pay?.shift_start ? 'No shifts scheduled in this period.' : 'No shift set yet.'}</p>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((g, i) => {
        const live = g.hours > 0 && g.hours < g.full
        const upcoming = g.hours === 0
        return (
          <div key={g.start.getTime()} style={{
            display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, alignItems: 'center',
            padding: '10px 0', borderTop: i ? 'var(--border-w) solid var(--border)' : 'none',
          }}>
            <span style={{ fontSize: 13.5, color: upcoming ? 'var(--text-muted)' : 'var(--text-primary)' }}>
              {fmtDay(g.start)}
              <span style={{ fontFamily: MONO, color: 'var(--text-secondary)', marginLeft: 10 }}>
                {fmtClock(g.start)} – {fmtClock(g.end)}
              </span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: 13.5, color: live ? 'var(--success)' : upcoming ? 'var(--text-muted)' : 'var(--text-primary)' }}>
              {upcoming ? 'upcoming' : fmtHours(g.hours)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── admin ───────────────────────────────────────────────────────────────────

export function FulfillmentPayAdminPanel() {
  const now = useNow(30e3)
  const [which, setWhich] = useState('this')
  const period = usePeriod(which, now)
  const [openId, setOpenId] = useState(null)
  const [confirm, setConfirm] = useState(null) // the row being paid
  const [notice, setNotice] = useState(null) // { tone, text }
  const { data: reps = [], isLoading: repsLoading } = useFulfillmentReps()
  const { data: pays = [] } = useFulfillmentPay(null)
  const { data: payouts = [] } = usePayouts(null)
  const { data: accounts = [] } = usePayoutAccounts(null)
  const { data: live = false } = usePayoutsLive()
  const setLive = useSetPayoutsLive()
  const payWeek = usePayWeek()
  const startIso = isoDay(period.start)
  const ended = now >= period.end.getTime()

  const rows = reps.map(r => {
    const pay = pays.find(p => p.profile_id === r.id)
    const hours = workedHours(pay, period, now)
    const payout = payouts.find(p => p.rep_id === r.id && p.period_start === startIso)
    const account = accounts.find(a => a.rep_id === r.id) || null
    return { rep: r, pay, hours, est: estimateCents(hours, pay?.hourly_rate_cents), payout, account }
  })
  const totalEst = rows.reduce((s, r) => s + (r.est || 0), 0)
  const totalHrs = rows.reduce((s, r) => s + r.hours, 0)

  function pay(r) {
    setNotice(null)
    payWeek.mutate({ repId: r.rep.id, periodStart: startIso }, {
      onSuccess: d => { setConfirm(null); setNotice({ tone: 'ok', text: `Paid ${r.rep.full_name} ${fmtCents(d.amount_cents)}${d.paid_to ? ` to ${d.paid_to}` : ''}.` }) },
      onError: e => { setConfirm(null); setNotice({ tone: 'error', text: e.message }) },
    })
  }

  return (
    // Prompt 720 — sits in Settings → Team tools as a v16 card; table unchanged.
    <section className="ov-card ov-set-card" aria-label="Fulfillment pay" style={{ gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h2 style={{ margin: 0, flex: 1, fontFamily: DISPLAY, fontSize: 18, fontWeight: 600, color: 'var(--ov-hi)' }}>
          Fulfillment pay <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 400, color: 'var(--ov-mute)', marginLeft: 6 }}>{fmtPeriod(period)}</span>
        </h2>
        <Segmented size="sm" value={which} onChange={setWhich} options={PERIODS} />
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 13.5, color: 'var(--ov-mute)' }}>
        What each rep earned for the period, from their scheduled shift. Click a rep to set their rate and shift. Approve & pay sends a finished week to the rep's bank through Stripe.
      </p>

      {/* Prompt 753 — the off switch (recovery_config.payouts_live). */}
      <div className="fp-live">
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ov-hi)' }}>Payouts {live ? 'on' : 'off'}</p>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--ov-mute)' }}>
            {live ? 'Approve & pay sends real money.' : "Turn on payouts when you're ready. Stripe payouts suit 1099 contractors; W-2 employees need a payroll service."}
          </p>
        </div>
        <Switch checked={live} disabled={setLive.isPending} onChange={v => setLive.mutate(v)} />
      </div>

      {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`fp-notice is-${notice.tone}`}>{notice.text}</p>}

      {repsLoading ? <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</p>
        : rows.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>No Fulfillment reps yet.</p>
          : (
            <div style={{ border: 'var(--border-w) solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div className="hidden md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_80px_80px_90px_150px_14px] gap-x-4"
                style={{ ...eyebrow, padding: '10px 16px', background: 'var(--bg-elevated)' }}>
                <span>Rep</span><span>Shift</span><span style={{ justifySelf: 'end' }}>Rate</span>
                <span style={{ justifySelf: 'end' }}>Hours</span><span style={{ justifySelf: 'end' }}>Owed</span><span style={{ justifySelf: 'end' }}>Payout</span><span />
              </div>
              {rows.map((r, i) => (
                <div key={r.rep.id}>
                  <div
                    onClick={() => setOpenId(openId === r.rep.id ? null : r.rep.id)}
                    className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_80px_80px_90px_150px_14px] gap-x-4 gap-y-1 items-center table-row-hover"
                    style={{ padding: '12px 16px', cursor: 'pointer', borderTop: i ? 'var(--border-w) solid var(--border)' : 'none' }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <Avatar profile={r.rep} size={26} />
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.rep.full_name}</span>
                    </span>
                    <span className="hidden md:block" style={{ fontSize: 13, fontFamily: MONO, color: r.pay?.shift_start ? 'var(--text-secondary)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fmtShift(r.pay) || 'Not set'}
                    </span>
                    <span className="hidden md:block" style={{ justifySelf: 'end', fontFamily: MONO, fontSize: 13, color: r.pay?.hourly_rate_cents != null ? 'var(--text-primary)' : 'var(--warning)' }}>
                      {r.pay?.hourly_rate_cents != null ? fmtCents(r.pay.hourly_rate_cents) : 'Not set'}
                    </span>
                    <span className="hidden md:block" style={{ justifySelf: 'end', fontFamily: MONO, fontSize: 13, color: 'var(--text-primary)' }}>{fmtHours(r.hours)}</span>
                    <span style={{ justifySelf: 'end', fontFamily: MONO, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {r.est != null ? fmtCents(r.est) : '—'}
                      <span className="md:hidden" style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>{fmtHours(r.hours)}</span>
                    </span>
                    <span className="col-span-2 md:col-span-1" style={{ justifySelf: 'end' }} onClick={e => e.stopPropagation()}>
                      <PayCell row={r} live={live} ended={ended} busy={payWeek.isPending} onPay={() => { setNotice(null); setConfirm(r) }} />
                    </span>
                    <ChevronRight size={14} className="hidden md:block" style={{ color: 'var(--text-muted)', transform: openId === r.rep.id ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }} />
                  </div>
                  {openId === r.rep.id && <RepPayEditor row={r} period={period} now={now} />}
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 18, padding: '12px 16px', borderTop: 'var(--border-w) solid var(--border)', background: 'var(--bg-elevated)' }}>
                <span style={{ ...eyebrow, color: 'var(--text-muted)' }}>Total</span>
                <span style={{ fontFamily: MONO, fontSize: 13, color: 'var(--text-secondary)' }}>{fmtHours(totalHrs)}</span>
                <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{fmtCents(totalEst)}</span>
              </div>
            </div>
          )}

      {confirm && (
        <ConfirmDialog
          title={`Pay ${confirm.rep.full_name}?`}
          confirmLabel="Approve & pay" busy={payWeek.isPending}
          onConfirm={() => pay(confirm)} onClose={() => setConfirm(null)}
        >
          Sends <b style={{ fontFamily: MONO }}>{fmtCents(confirm.est)}</b> for {fmtPeriod(period)} ({fmtHours(confirm.hours)} × {fmtCents(confirm.pay?.hourly_rate_cents)}/hr)
          {destination(confirm.account) ? <> to {destination(confirm.account)}</> : null}. The amount is worked out again from the schedule before it's sent. This can't be undone here.
        </ConfirmDialog>
      )}
    </section>
  )
}

// The Payout column: Approve & pay, or where that week stands (P753).
function PayCell({ row, live, ended, busy, onPay }) {
  const st = row.payout?.status
  if (st === 'paid') return <span className="fp-chip is-up">Paid</span>
  if (st === 'approved') return <span className="fp-chip is-warn">Sending…</span>
  const why = !live ? "Turn on payouts when you're ready"
    : !ended ? 'Pay after the week ends'
      : !(row.est > 0) ? 'Nothing to pay'
        : accountStatus(row.account) !== 'ready' ? `${row.rep.full_name} hasn't finished payout setup`
          : null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {st === 'failed' && <span className="fp-chip is-bad" title={row.payout.failure_reason || ''}>Failed</span>}
      {st === 'held' && <span className="fp-chip is-warn" title={row.payout.failure_reason || ''}>On hold</span>}
      <button type="button" className="ov-solid ov-mb-btn is-small" disabled={!!why || busy} title={why || undefined} onClick={onPay}>
        {st === 'failed' || st === 'held' ? 'Retry' : 'Approve & pay'}
      </button>
    </span>
  )
}

const toTimeInput = t => (t ? t.slice(0, 5) : '')

function RepPayEditor({ row, period, now }) {
  const save = useSavePay()
  const pay = row.pay
  const [rate, setRate] = useState(pay?.hourly_rate_cents != null ? (pay.hourly_rate_cents / 100).toFixed(2) : '')
  const [days, setDays] = useState(pay?.shift_days || [1, 2, 3, 4, 5])
  const [start, setStart] = useState(toTimeInput(pay?.shift_start))
  const [end, setEnd] = useState(toTimeInput(pay?.shift_end))
  const [saved, setSaved] = useState(false)

  const rateNum = rate.trim() === '' ? null : Number(rate)
  const rateBad = rateNum != null && (!isFinite(rateNum) || rateNum < 0 || rateNum > 1000)
  const timeBad = (!!start !== !!end) || (start && end && end <= start)
  const toggleDay = d => setDays(ds => (ds.includes(d) ? ds.filter(x => x !== d) : [...ds, d].sort((a, b) => a - b)))

  function submit() {
    save.mutate({
      profileId: row.rep.id,
      hourlyRateCents: rateNum == null ? null : Math.round(rateNum * 100),
      shiftDays: days, shiftStart: start, shiftEnd: end,
    }, { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000) } })
  }

  return (
    <div style={{ padding: '16px 16px 18px', background: 'var(--bg-elevated)', borderTop: 'var(--border-w) solid var(--border)', boxShadow: 'inset 3px 0 0 var(--accent)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 14 }}>
        <div>
          <p style={fieldLabel}>Hourly rate ($)</p>
          <input value={rate} onChange={e => setRate(e.target.value)} inputMode="decimal" placeholder="18.00"
            style={{ ...control, fontFamily: MONO, borderColor: rateBad ? 'var(--danger)' : undefined }} />
        </div>
        <div>
          <p style={fieldLabel}>Shift start</p>
          <input type="time" value={start} onChange={e => setStart(e.target.value)} style={{ ...control, fontFamily: MONO }} />
        </div>
        <div>
          <p style={fieldLabel}>Shift end</p>
          <input type="time" value={end} onChange={e => setEnd(e.target.value)}
            style={{ ...control, fontFamily: MONO, borderColor: timeBad ? 'var(--danger)' : undefined }} />
        </div>
      </div>
      <p style={{ ...fieldLabel, marginTop: 14 }}>Shift days</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {WEEKDAYS.map(d => {
          const on = days.includes(d.value)
          return (
            <button key={d.value} type="button" onClick={() => toggleDay(d.value)} aria-pressed={on} className="tab-transition"
              style={{
                height: 32, minWidth: 48, padding: '0 10px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                border: `var(--border-w) solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                background: on ? 'var(--accent)' : 'var(--bg-surface)', color: on ? '#fff' : 'var(--text-secondary)',
              }}>
              {d.short}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <button onClick={submit} disabled={rateBad || timeBad || save.isPending} style={{ ...primaryBtn, height: 36, opacity: rateBad || timeBad || save.isPending ? 0.5 : 1 }}>
          {save.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
        </button>
        <SavedTick show={saved} />
        {timeBad && <span style={{ fontSize: 12.5, color: 'var(--danger)' }}>Set both times, end after start.</span>}
        {save.isError && <span style={{ fontSize: 12.5, color: 'var(--danger)' }}>{save.error?.message}</span>}
      </div>

      <p style={{ ...fieldLabel, marginTop: 18 }}>Shifts · {fmtPeriod(period)}</p>
      <ShiftList pay={pay} period={period} now={now} />
      {pay?.shift_start && (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
          Scheduled {fmtTime(pay.shift_start)}–{fmtTime(pay.shift_end)}, {fmtHours(scheduledHours(pay))} a week.
        </p>
      )}
    </div>
  )
}
