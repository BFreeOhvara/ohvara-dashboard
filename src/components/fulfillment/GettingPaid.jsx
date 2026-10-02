import { useMemo, useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { card, cardTitle, eyebrow, fieldLabel, control, primaryBtn, ghostBtn, MONO } from '../../lib/exportStyles'
import { GapNote } from '../ui/ExportForm'
import { Segmented } from '../ui/Segmented'
import { SavedTick } from '../ui/SavedTick'
import { Avatar } from '../ui/Avatar'
import { ClockCard } from './ClockCard'
import {
  useFulfillmentPay, useTimeEntries, useFulfillmentReps, useSavePay, useAdminCloseEntry,
} from '../../hooks/useFulfillmentPay'
import {
  WEEKDAYS, payPeriod, fmtPeriod, entryHours, totalHours, fmtHours, fmtCents, estimateCents,
  fmtShift, scheduledHours, fmtTime,
} from '../../lib/payPeriod'
import { useNow } from '../../lib/agentBookings'

// Getting Paid page (Prompt 681, moved out of Settings in 683). Tracking only: the rep's scheduled
// shift, the hours they clocked this pay period, their hourly rate, and
// hours × rate. No payroll processor sits behind it — Brayden pays by hand
// from these numbers. Admin gets the whole team on one table and is the only
// one who can set a rate or shift (RLS, migration 115).

const PERIODS = [{ value: 'this', label: 'This week' }, { value: 'last', label: 'Last week' }]

function usePeriod(which, now) {
  return useMemo(() => payPeriod(which === 'last' ? now - 7 * 864e5 : now), [which, now])
}

function Figure({ label, value, sub }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)' }}>
      <p style={eyebrow}>{label}</p>
      <p style={{ margin: '6px 0 0', fontFamily: MONO, fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      {sub && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  )
}

const fmtClock = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const fmtDay = iso => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

function EntryList({ entries, period, now }) {
  // An open shift always shows, even in the seconds before `now` catches up to it.
  const rows = entries.filter(e => entryHours(e, period.start, period.end, now) > 0
    || (!e.clock_out && new Date(e.clock_in) >= period.start && new Date(e.clock_in) < period.end))
  if (!rows.length) {
    return <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>No time logged in this period.</p>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((e, i) => (
        <div key={e.id} style={{
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, alignItems: 'center',
          padding: '10px 0', borderTop: i ? 'var(--border-w) solid var(--border)' : 'none',
        }}>
          <span style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>
            {fmtDay(e.clock_in)}
            <span style={{ fontFamily: MONO, color: 'var(--text-secondary)', marginLeft: 10 }}>
              {fmtClock(e.clock_in)} – {e.clock_out ? fmtClock(e.clock_out) : 'now'}
            </span>
          </span>
          <span style={{ fontFamily: MONO, fontSize: 13.5, color: e.clock_out ? 'var(--text-primary)' : 'var(--success)' }}>
            {fmtHours(entryHours(e, period.start, period.end, now))}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── rep ─────────────────────────────────────────────────────────────────────

export function GettingPaidPanel({ profile }) {
  const now = useNow(30e3)
  const [which, setWhich] = useState('this')
  const period = usePeriod(which, now)
  const { data: payRows = [], isLoading: payLoading } = useFulfillmentPay(profile.id)
  const { data: entries = [], isLoading } = useTimeEntries(profile.id, payPeriod(now - 7 * 864e5).start.toISOString())
  const pay = payRows[0]
  const hours = totalHours(entries, period, now)
  const sched = scheduledHours(pay)
  const est = estimateCents(hours, pay?.hourly_rate_cents)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ClockCard entries={entries} pay={pay} now={now} loading={isLoading || payLoading} />

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <p style={{ ...cardTitle, margin: 0, flex: 1 }}>
            Getting paid <span style={{ fontFamily: MONO, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>{fmtPeriod(period)}</span>
          </p>
          <Segmented size="sm" value={which} onChange={setWhich} options={PERIODS} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 10 }}>
          <Figure label="Hours logged" value={fmtHours(hours)} sub={sched != null ? `of ${fmtHours(sched)} scheduled` : 'no shift set'} />
          <Figure label="Hourly rate" value={pay?.hourly_rate_cents != null ? fmtCents(pay.hourly_rate_cents) : '—'} sub={pay?.hourly_rate_cents != null ? 'per hour' : 'not set yet'} />
          <Figure label="Estimated pay" value={est != null ? fmtCents(est) : '—'} sub="hours × rate" />
        </div>

        <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
          Scheduled shift: <span style={{ fontFamily: MONO, color: 'var(--text-primary)' }}>{fmtShift(pay) || 'not set yet'}</span>
        </p>

        <GapNote>
          This is an estimate to check against, not a paycheck. Pay is sent by hand for each weekly period (Monday
          to Sunday). If a clock-in or clock-out is wrong, message Brayden and he'll fix it.
        </GapNote>
      </div>

      <div style={card}>
        <p style={cardTitle}>Time log</p>
        {isLoading ? <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</p>
          : <EntryList entries={entries} period={period} now={now} />}
      </div>
    </div>
  )
}

// ── admin ───────────────────────────────────────────────────────────────────

export function FulfillmentPayAdminPanel() {
  const now = useNow(30e3)
  const [which, setWhich] = useState('this')
  const period = usePeriod(which, now)
  const [openId, setOpenId] = useState(null)
  const { data: reps = [], isLoading: repsLoading } = useFulfillmentReps()
  const { data: pays = [] } = useFulfillmentPay(null)
  const { data: entries = [] } = useTimeEntries(null, payPeriod(now - 7 * 864e5).start.toISOString())

  const rows = reps.map(r => {
    const pay = pays.find(p => p.profile_id === r.id)
    const mine = entries.filter(e => e.profile_id === r.id)
    const hours = totalHours(mine, period, now)
    return { rep: r, pay, entries: mine, hours, est: estimateCents(hours, pay?.hourly_rate_cents), open: mine.find(e => !e.clock_out) }
  })
  const totalEst = rows.reduce((s, r) => s + (r.est || 0), 0)
  const totalHrs = rows.reduce((s, r) => s + r.hours, 0)

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <p style={{ ...cardTitle, margin: 0, flex: 1 }}>
          Fulfillment pay <span style={{ fontFamily: MONO, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>{fmtPeriod(period)}</span>
        </p>
        <Segmented size="sm" value={which} onChange={setWhich} options={PERIODS} />
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
        What to pay each rep by hand for the period. Click a rep to set their rate and shift.
      </p>

      {repsLoading ? <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</p>
        : rows.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>No Fulfillment reps yet.</p>
          : (
            <div style={{ border: 'var(--border-w) solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div className="hidden md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_90px_90px_100px_14px] gap-x-4"
                style={{ ...eyebrow, padding: '10px 16px', background: 'var(--bg-elevated)' }}>
                <span>Rep</span><span>Shift</span><span style={{ justifySelf: 'end' }}>Rate</span>
                <span style={{ justifySelf: 'end' }}>Hours</span><span style={{ justifySelf: 'end' }}>Owed</span><span />
              </div>
              {rows.map((r, i) => (
                <div key={r.rep.id}>
                  <div
                    onClick={() => setOpenId(openId === r.rep.id ? null : r.rep.id)}
                    className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_90px_90px_100px_14px] gap-x-4 gap-y-1 items-center table-row-hover"
                    style={{ padding: '12px 16px', cursor: 'pointer', borderTop: i ? 'var(--border-w) solid var(--border)' : 'none' }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <Avatar profile={r.rep} size={26} />
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.rep.full_name}</span>
                      {r.open && <span title="On the clock" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />}
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
    </div>
  )
}

const toTimeInput = t => (t ? t.slice(0, 5) : '')

function RepPayEditor({ row, period, now }) {
  const save = useSavePay()
  const close = useAdminCloseEntry()
  const pay = row.pay
  const [rate, setRate] = useState(pay?.hourly_rate_cents != null ? (pay.hourly_rate_cents / 100).toFixed(2) : '')
  const [days, setDays] = useState(pay?.shift_days || [1, 2, 3, 4, 5])
  const [start, setStart] = useState(toTimeInput(pay?.shift_start))
  const [end, setEnd] = useState(toTimeInput(pay?.shift_end))
  const [closeAt, setCloseAt] = useState('')
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

      {row.open && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: 'var(--border-w) solid var(--border)' }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)' }}>
            On the clock since <span style={{ fontFamily: MONO }}>{fmtDay(row.open.clock_in)} {fmtClock(row.open.clock_in)}</span>.
            Forgot to clock out? Close it at:
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="datetime-local" value={closeAt} onChange={e => setCloseAt(e.target.value)}
              style={{ ...control, width: 'auto', fontFamily: MONO }} />
            <button
              disabled={!closeAt || new Date(closeAt) <= new Date(row.open.clock_in) || close.isPending}
              onClick={() => close.mutate({ id: row.open.id, clockOut: new Date(closeAt).toISOString() }, { onSuccess: () => setCloseAt('') })}
              style={{ ...ghostBtn, opacity: !closeAt ? 0.5 : 1 }}
            >
              Close shift
            </button>
            {close.isError && <span style={{ fontSize: 12.5, color: 'var(--danger)' }}>{close.error?.message}</span>}
          </div>
        </div>
      )}

      <p style={{ ...fieldLabel, marginTop: 18 }}>Time log · {fmtPeriod(period)}</p>
      <EntryList entries={row.entries} period={period} now={now} />
      {pay?.shift_start && (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
          Scheduled {fmtTime(pay.shift_start)}–{fmtTime(pay.shift_end)}, {fmtHours(scheduledHours(pay))} a week.
        </p>
      )}
    </div>
  )
}
