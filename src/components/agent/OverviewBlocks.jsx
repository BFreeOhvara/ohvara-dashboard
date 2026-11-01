import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Check, ChevronRight, ClipboardList, ListChecks, Phone, ShieldCheck, TriangleAlert } from 'lucide-react'
import { MONO } from '../../lib/exportStyles'
import { formatReset } from '../../lib/billing'
import { fmtSlotTime } from '../../lib/scheduling'
import { zonedDateStr } from '../../lib/timezones'
import { IconChip, LoadError, OV_NUM, OV_TITLE, CallDateTile, comingWhen, shortDate } from './AgentUI'

// Servicing Overview blocks (Agent Portal Servicing Spec, Overview): Your book, This week, Coming up,
// Steps done and Get leads. The data comes from useOverviewBook() (src/hooks/useOverviewBook.js) and the
// styles are the .ov-bk / .ov-wk / .ov-cu / .ov-sd / .ov-gl rules in index.css. Each block loads, fails and
// is empty on its own, in plain words, and a block that has not loaded draws a dash, never a zero.
// The data-ov attributes are what scripts/overview-fit-shots.mjs finds the blocks by.

const dashStyle = { color: 'var(--ov-mute)' }

// Your book: four tiles that open Clients on that slice (Clients reads ?stage=<key>).
const BOOK_TILES = [
  { key: 'protected', field: 'protected', label: 'Protected', sub: 'Payments on time', icon: ShieldCheck },
  { key: 'setting_up', field: 'settingUp', label: 'Setting up', sub: 'First 30 days', icon: ListChecks },
  { key: 'needs_attention', field: 'needsAttention', label: 'Needs attention', sub: 'See who and why', zero: 'All caught up', icon: TriangleAlert },
  { key: 'requests', field: 'requestsOpen', label: 'Requests open', sub: 'In progress', zero: 'None open', icon: ClipboardList },
]

export function BookRow({ book, onRetry }) {
  const failed = book.status === 'error'
  const dash = book.status !== 'ready' || !book.available
  const empty = !dash && BOOK_TILES.every(t => book[t.field] === 0)
  const note = book.status === 'ready' && !book.available ? 'Your book numbers aren’t ready yet. They’ll show here as soon as they are.'
    : empty ? 'No clients yet. Submit your first sale and they show here.'
      : 'Open a box to see those clients.'
  return (
    <section data-ov="book" aria-label="Your book" className="ov-bk">
      <div className="ov-bk-head">
        <h2 style={OV_TITLE} className="text-[18px] sm:text-[19px]">Your book</h2>
        {!failed && <p>{note}</p>}
      </div>
      {failed && <LoadError what="your book" onRetry={onRetry} />}
      <div className="ov-bk-row">
        {BOOK_TILES.map(t => {
          const n = dash ? null : book[t.field]
          const warn = t.key === 'needs_attention' && n > 0
          const calm = t.key === 'needs_attention' && n === 0
          return (
            <Link key={t.key} to={`/agent/clients?stage=${t.key}`} aria-label={`${t.label}${n == null ? '' : `: ${n}`}`}
              className={`${warn ? 'ov-attn' : 'ov-card'} ov-link ov-bk-tile`}>
              <IconChip className="ov-bk-chip" icon={calm ? Check : t.icon} size={34} radius={10} iconSize={17}
                color={warn ? 'var(--ov-warn)' : calm ? 'var(--ov-up)' : 'var(--ov-st-booked)'}
                tint={warn ? 'var(--ov-warn-tint)' : calm ? 'var(--ov-up-tint)' : 'var(--ov-st-booked-tint)'} />
              <span className="ov-bk-t">
                <b>{t.label}</b>
                {n != null && <span>{n === 0 && t.zero ? t.zero : t.sub}</span>}
              </span>
              <span className="ov-bk-n" style={{ ...OV_NUM, ...(n == null ? dashStyle : null) }}>{n == null ? '—' : n}</span>
              <ArrowUpRight className="ov-bk-go" size={14} strokeWidth={2} aria-hidden="true" />
            </Link>
          )
        })}
      </div>
    </section>
  )
}

// This week: X of N submissions used (7 or 16 from the plan) and the day the count resets. Opens Submit.
export function WeekSubmissions({ submissions, tz, onRetry }) {
  const { status, used, cap, resetsAt } = submissions
  if (status === 'error') {
    return (
      <section data-ov="week" aria-label="This week" className="ov-card ov-wk">
        <div className="ov-wk-foot" style={{ marginTop: 0 }}><span>This week</span></div>
        <LoadError what="your weekly count" onRetry={onRetry} style={{ marginTop: 8 }} />
      </section>
    )
  }
  const loading = status === 'loading'
  const known = !loading && used != null
  const capped = !loading && cap != null
  const full = capped && known && used >= cap
  const left = capped && known ? Math.max(0, cap - used) : null
  const segs = capped && cap > 0 && cap <= 24 ? cap : 0
  return (
    <Link to="/agent/submit" data-ov="week" className="ov-card ov-link ov-wk" aria-label="This week’s submissions. Open Submit.">
      <div className="ov-wk-top">
        <span>
          <b style={{ ...OV_NUM, ...(known ? null : dashStyle) }}>{known ? used : '—'}</b>
          {loading ? ' of — submissions used' : capped ? ` of ${cap} submissions used` : ' submissions this week'}
        </span>
        {full ? <i className="ov-wk-full">Limit reached</i> : left != null && <i>{left} left</i>}
      </div>
      <div className="ov-wk-segs" aria-hidden="true">
        {Array.from({ length: loading ? 7 : segs }, (_, i) => (
          <span key={i} className={full ? 'full' : known && i < used ? 'used' : undefined} />
        ))}
      </div>
      <div className="ov-wk-foot">
        <span>This week · resets {formatReset(resetsAt, tz)}</span>
        <span className="ov-wk-go">Submit <ArrowRight size={13} strokeWidth={2.2} aria-hidden="true" /></span>
      </div>
    </Link>
  )
}

// Coming up: open steps with a due_at (review calls, saves, packet checks), soonest first.
// "Fri, 10:00 AM" for a step still ahead; "Was due Thu, 11:00 AM" for one past due.
function dueWhen(s, now, tz) {
  if (!s.overdue) return comingWhen(s.dueAt, now, tz)
  const sameDay = zonedDateStr(new Date(s.dueAt).getTime(), tz) === zonedDateStr(now, tz)
  const day = sameDay ? 'today' : new Date(s.dueAt).toLocaleDateString('en-US', { weekday: 'short', timeZone: tz })
  return `Was due ${day}, ${fmtSlotTime(s.dueAt, tz)}`
}
const stepTo = s => (s.policyId ? `/agent/clients?open=${s.policyId}` : s.leadId ? `/agent/inbounds/${s.leadId}` : '/agent/clients')

export function ComingUpSteps({ steps, status, now, tz, onRetry, fit }) {
  const n = steps.length
  const rows = fit ? steps : steps.slice(0, 5)
  const count = status === 'ready' ? (n === 0 ? 'No steps' : `${n} ${n === 1 ? 'step' : 'steps'}`) : '—'
  return (
    <section data-ov="coming-up" aria-label="Coming up" className="ov-card ov-cu">
      <div className="ov-cu-head">
        <h2 style={OV_TITLE} className="text-[18px] sm:text-[19px]">Coming up</h2>
        <span>{count}</span>
      </div>
      {status === 'loading' ? (
        <div className="ov-cu-skel" aria-busy="true">{[0, 1, 2].map(i => <span key={i}><i /><i /></span>)}</div>
      ) : status === 'error' ? (
        <div className="ov-cu-mid"><LoadError what="your next steps" onRetry={onRetry} /></div>
      ) : n === 0 ? (
        <p className="ov-cu-mid ov-cu-empty">Nothing scheduled yet. New steps show here once you submit a client.</p>
      ) : (
        <div className="ov-cu-list">
          {rows.map(s => (
            <Link key={s.id} to={stepTo(s)} className="ov-cu-row" aria-label={`${s.label} for ${s.clientName}`}>
              <CallDateTile iso={s.dueAt} tz={tz} booked={!s.overdue} />
              <span className="ov-cu-t">
                <b>{s.clientName}<em> · {s.label}</em></b>
                <span style={s.overdue ? { color: 'var(--ov-warn)' } : undefined}>{dueWhen(s, now, tz)}</span>
              </span>
              <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

// Steps done: last Monday to Sunday, per day, in the four kinds. It replaces the Booked / Cancelled chart
// and reuses its .ov-lw* classes.
const STEP_KINDS = [
  { key: 'packet_check', label: 'Packet checks', color: 'var(--ov-step-packet)' },
  { key: 'review_call', label: 'Review calls', color: 'var(--ov-step-review)' },
  { key: 'cancellation', label: 'Cancellations', color: 'var(--ov-step-cancel)' },
  { key: 'save', label: 'Saves', color: 'var(--ov-step-save)' },
]
const labelOf = day => new Date(`${day}T12:00:00Z`)

export function StepsDoneChart({ days, status, savesKnown = true, onRetry, fit }) {
  const failed = status === 'error'
  const blank = status !== 'ready'
  const sum = k => days.reduce((a, d) => a + (d[k] || 0), 0)
  const total = days.reduce((a, d) => a + (d.total || 0), 0)
  const empty = !blank && total === 0
  const m = Math.max(0, ...days.map(d => d.total || 0))
  const step = Math.max(1, Math.ceil(m / 4))
  const top = step * 4
  const rows = [0, 1, 2, 3, 4]
  const range = days.length ? `${shortDate(labelOf(days[0].date))} to ${shortDate(labelOf(days[days.length - 1].date))}` : ''
  const dayName = d => labelOf(d).toLocaleDateString('en-US', { weekday: 'short' })
  const count = k => (blank || (k === 'save' && !savesKnown) ? '—' : sum(k))
  const barH = v => (v ? `${(v / top) * 100}%` : 3)
  return (
    <section data-ov="steps-done" aria-label="Steps done" className={`ov-card ov-lw ov-sd${fit ? ' ag-lw' : ''}`}>
      <div className="ov-sd-head">
        <b className="ov-sd-total" style={{ ...OV_NUM, ...(blank ? dashStyle : null) }}>{blank ? '—' : total}</b>
        <div className="ov-lw-titles ov-sd-titles">
          <h2 style={OV_TITLE} className="text-[18px] sm:text-[19px]">Steps done</h2>
          <p style={{ margin: '3px 0 0', fontSize: 13.5, color: 'var(--ov-mute)' }}>Last week, {range}</p>
        </div>
        <span className="ov-sd-legend">
          {STEP_KINDS.map(k => (
            <span key={k.key}><i style={{ background: k.color }} />{k.label} <b>{count(k.key)}</b></span>
          ))}
        </span>
      </div>

      {failed ? (
        <div className="ov-sd-none"><LoadError what="your steps" onRetry={onRetry} /></div>
      ) : empty ? (
        <div className="ov-sd-none">No steps finished last week. They’ll show here as we work your clients.</div>
      ) : (
        <div className="ov-lw-chart ov-sd-chart">
          <div className="ov-lw-axis" aria-hidden="true">
            {rows.map(i => <span key={i} className="ov-lw-tick" style={{ bottom: `calc(${i * 25}% - 7px)` }}>{i * step}</span>)}
          </div>
          <div className={fit ? 'ov-lw-stack' : undefined} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="ov-lw-plot" role="img" aria-label={blank ? 'Steps done last week' : `Steps done last week: ${total}`}>
              {rows.map(i => <div key={i} className="ov-lw-line" style={{ bottom: `${i * 25}%`, background: i === 0 ? 'var(--ov-line)' : 'var(--ov-grid)' }} />)}
              <div className="ov-lw-cols">
                {days.map((d, i) => {
                  const t = blank ? 0 : d.total || 0
                  return (
                    <div key={i} className="ov-lw-col" title={`${dayName(d.date)}, ${shortDate(labelOf(d.date))}: ${blank ? '—' : t}`}>
                      <span className="ov-sd-bar" style={{ height: barH(t) }}>
                        {t > 0 && <em>{t}</em>}
                        {t > 0 && STEP_KINDS.map(k => (d[k.key] ? <span key={k.key} style={{ flex: `${d[k.key]} 1 0`, background: k.color }} /> : null))}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="ov-lw-xs">
              {days.map((d, i) => (
                <div key={i} style={{ flex: 1, minWidth: 0, textAlign: 'center', lineHeight: 1.25 }}>
                  <div style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: 'var(--ov-mid)' }}>{dayName(d.date)}</div>
                  <div className="ov-lw-date" style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ov-faint)' }}>{shortDate(labelOf(d.date))}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// For agents who do not buy Leads: one small card in the place the Today strip would take.
export function GetLeadsCard() {
  return (
    <Link to="/agent/leads" data-ov="get-leads" className="ov-card ov-link ov-gl" aria-label="Get leads. Open Leads.">
      <IconChip icon={Phone} size={34} radius={10} iconSize={17} color="var(--ov-st-booked)" tint="var(--ov-st-booked-tint)" />
      <span className="ov-gl-t"><b>Get leads</b><span>Appointments and live calls</span></span>
      <span className="ov-ghost ov-gl-btn">Start <ArrowRight size={14} strokeWidth={2.2} aria-hidden="true" /></span>
    </Link>
  )
}
