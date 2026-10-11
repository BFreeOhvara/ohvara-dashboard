import { CalendarDays, Check, ChevronRight, Clock, Minus } from 'lucide-react'
import { eyebrow, MONO, DISPLAY } from '../../lib/exportStyles'
import { Pill, StagePill, IconChip } from '../agent/AgentUI'
import { fullName } from '../../lib/policyFormat'
import { flagsFor } from '../../lib/fulfillmentFlags'

// Team-wide submission rows for the Fulfillment Overview and Pipeline
// (Prompt 681). Same table shell as the agent side's ListCard/ClientRow
// (Restorix's tables), with the columns Fulfillment cares about: which agent
// booked it and which rep has it, instead of the carrier being left.

const COLS = 'md:grid-cols-[168px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_168px_14px]'

export function FulfillHead() {
  return (
    <div className={`hidden md:grid ${COLS} items-center gap-x-4`} style={{ ...eyebrow, padding: '11px 20px', background: 'var(--bg-elevated)' }}>
      <span>Call</span><span>Client</span><span>Agent</span><span>Rep</span><span style={{ justifySelf: 'end' }}>Status</span><span />
    </div>
  )
}

export function FulfillRow({ p, now, onClick, active, first }) {
  const when = p.scheduled_call_at
    ? new Date(p.scheduled_call_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'No time'
  const { stale, liveStale } = flagsFor(p, now)
  const done = p.fulfillment_stage === 'Complete'
  const rep = p.assigned?.full_name || (done ? '—' : 'Unassigned')
  return (
    <div
      onClick={onClick}
      className={`grid grid-cols-[minmax(0,1fr)_auto] ${COLS} items-center gap-x-4 gap-y-1 table-row-hover`}
      style={{
        padding: '14px 20px', cursor: onClick ? 'pointer' : 'default',
        borderTop: first ? 'none' : 'var(--border-w) solid var(--border)',
        background: active ? 'var(--bg-elevated)' : undefined,
      }}
    >
      <span className="order-2 md:order-none col-span-2 md:col-span-1"
        style={{ fontFamily: MONO, fontSize: 13, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {when}
        <span className="md:hidden" style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-muted)' }}> · {p.agent?.full_name || '—'} → {rep}</span>
      </span>
      <p className="order-1 md:order-none" style={{ margin: 0, minWidth: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {fullName(p)}
      </p>
      <span className="hidden md:block" style={{ fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {p.agent?.full_name || '—'}
      </span>
      <span className="hidden md:block" style={{ fontSize: 14, color: p.assigned ? 'var(--text-secondary)' : 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {rep}
      </span>
      <span className="order-1 md:order-none" style={{ justifySelf: 'end', display: 'inline-flex', gap: 6 }}>
        {liveStale && <Pill tone="danger" icon={Clock}>Still live?</Pill>}
        {stale && p.last_call_outcome && <Pill tone="warning" icon={Clock}>Stale</Pill>}
        <StagePill p={p} now={now} />
      </span>
      <ChevronRight size={14} className="hidden md:block"
        style={{ color: 'var(--text-muted)', transform: active ? 'rotate(90deg)' : 'none', transition: 'transform 120ms', visibility: onClick ? 'visible' : 'hidden' }} />
    </div>
  )
}

// ── Prompt 745 — "Your day", the Overview's right-hand box ────────────────
// Built from the agent Overview's ComingUpCard parts: .ov-card, IconChip, the
// booked-tint "Up next" tile, .ov-up-row rows and the .ov-primary button.
// Entries come from buildDay (lib/fulfillmentDay.js), already worded.
//   next / later: { id, time, period, name, sub, subNext, tone: booked | noAnswer }
//   done:         { id, at, name, result, tone: cancelled | noAnswer | live }
// Same as the agent cards' title style.
const OV_TITLE = { margin: 0, fontFamily: DISPLAY, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ov-hi)' }
const BOOKED_TILE = 'color-mix(in srgb, var(--ov-st-booked) 22%, transparent)'
const DONE_TONE = {
  cancelled: { bg: 'var(--ov-st-cancelled-tint)', fg: 'var(--ov-st-cancelled)', Icon: Check },
  noAnswer: { bg: 'var(--ov-st-noanswer-tint)', fg: 'var(--ov-st-noanswer)', Icon: Minus },
  live: { bg: 'color-mix(in srgb, var(--ov-live) 14%, transparent)', fg: 'var(--ov-live)', Icon: Clock },
}

function TimeTile({ time, period, tone, big }) {
  const booked = tone === 'booked'
  return (
    <span style={{
      width: 50, height: big ? 50 : 42, flexShrink: 0, boxSizing: 'border-box', borderRadius: big ? 13 : 12,
      background: big ? BOOKED_TILE : booked ? 'var(--ov-st-booked-tint)' : 'var(--ov-st-noanswer-tint)',
      color: booked ? 'var(--ov-st-booked)' : 'var(--ov-st-noanswer)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
    }}>
      <span style={{ fontFamily: DISPLAY, fontSize: big ? 17 : 15, fontWeight: 700 }}>{time}</span>
      <span style={{ marginTop: big ? 3 : 2, fontSize: big ? 10.5 : 10, fontWeight: 700, letterSpacing: big ? '0.02em' : 0 }}>{period}</span>
    </span>
  )
}

const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

export function YourDayCard({
  title = 'Your day', dateLabel, countLine, loading, next, nextIn, later = [], more = 0, done = [],
  doneTime, onOpen, onCalendar, calendarLabel = 'See your calendar',
}) {
  const empty = !loading && !next && later.length === 0 && done.length === 0
  const label = text => <p style={{ margin: '16px 0 2px', fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }}>{text}</p>

  return (
    <div className="ov-card flex flex-col p-[18px] sm:px-6 sm:pt-6 sm:pb-5" style={{ gridArea: 'attn', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <IconChip icon={CalendarDays} color="var(--ov-st-booked)" tint="var(--ov-st-booked-tint)" iconSize={18} />
        <h2 style={{ ...OV_TITLE, flex: 1, minWidth: 0 }} className="text-[18px] sm:text-[19px]">{title}</h2>
        {dateLabel && <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--ov-faint)', whiteSpace: 'nowrap' }}>{dateLabel}</span>}
      </div>
      <p style={{ margin: '12px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--ov-soft)' }}>{loading ? 'Loading the calendar…' : countLine}</p>

      {loading && (
        <div aria-hidden="true" style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span className="ov-skel" style={{ height: 78, borderRadius: 16 }} />
          <span className="ov-skel" style={{ height: 42 }} />
          <span className="ov-skel" style={{ height: 42 }} />
        </div>
      )}

      {empty && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '28px 10px' }}>
          <span style={{
            width: 68, height: 68, borderRadius: 22, background: 'var(--ov-st-booked-tint)', color: 'var(--ov-st-booked)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CalendarDays size={30} strokeWidth={1.8} />
          </span>
          <div style={{ marginTop: 18, fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ov-hi)' }}>
            Nothing on your calendar today
          </div>
          <div style={{ marginTop: 6, maxWidth: 250, fontSize: 14, lineHeight: 1.5, color: 'var(--ov-mute)' }}>
            New calls show up here as agents book them.
          </div>
        </div>
      )}

      {next && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '20px 0 10px' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }}>Up next</span>
            <span style={{ fontSize: 12.5, color: 'var(--ov-faint)' }}>{nextIn}</span>
          </div>
          <button type="button" className="fd-row fd-next" onClick={() => onOpen(next.id)}>
            <TimeTile time={next.time} period={next.period} tone="booked" big />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--ov-hi)', ...ellipsis }}>{next.name}</span>
              <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--ov-mid)', ...ellipsis }}>{next.subNext}</span>
            </span>
            <ChevronRight size={16} strokeWidth={2.3} style={{ color: 'var(--ov-st-booked)', flexShrink: 0 }} />
          </button>
        </>
      )}

      {later.length > 0 && (
        <>
          {label('Later today')}
          {later.map(r => (
            <button key={`${r.id}-${r.at}`} type="button" className="fd-row ov-up-row" onClick={() => onOpen(r.id)}>
              <TimeTile time={r.time} period={r.period} tone={r.tone} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)', ...ellipsis }}>{r.name}</span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: r.tone === 'noAnswer' ? 'var(--ov-st-noanswer)' : 'var(--ov-mute)', ...ellipsis }}>{r.sub}</span>
              </span>
            </button>
          ))}
          {more > 0 && (
            <button type="button" className="fd-more" onClick={onCalendar}>+{more} more</button>
          )}
        </>
      )}

      {done.length > 0 && (
        <>
          {label('Done today')}
          {done.map(r => {
            const t = DONE_TONE[r.tone]
            return (
              <button key={`${r.id}-${r.at}`} type="button" className="fd-row fd-done" onClick={() => onOpen(r.id)}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: t.bg, color: t.fg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <t.Icon size={11} strokeWidth={3.2} />
                </span>
                <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--ov-faint)', width: 62, flexShrink: 0 }}>{doneTime(r.at)}</span>
                <span style={{ flex: 1, minWidth: 0, color: 'var(--ov-mid)', ...ellipsis }}>{r.name}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: t.fg, whiteSpace: 'nowrap' }}>{r.result}</span>
              </button>
            )
          })}
        </>
      )}

      <div style={{ flex: 1, minHeight: 14 }} />
      <button type="button" className="ov-primary" onClick={onCalendar}>
        <CalendarDays size={17} strokeWidth={2.1} /> {calendarLabel}
      </button>
    </div>
  )
}
