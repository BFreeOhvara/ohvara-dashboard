import { Children, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, MessageCircleMore, CalendarPlus, ArrowUpRight, ArrowRight, TrendingUp, TrendingDown, TriangleAlert, Check, Sun, Clock, User, MessageSquareText, Search, Building2, RefreshCw, Phone, PhoneMissed, X, MessageSquare, Inbox, CalendarX, ChevronLeft, CalendarDays, CreditCard, ShieldCheck, Headset, Send, MapPin, Moon, ChevronDown, PencilLine } from 'lucide-react'
import { card, eyebrow, control, MONO, DISPLAY } from '../../lib/exportStyles'
import { SLOTS, slotTo24h, slotToISO, localDateISO, callWhen, callAt, fmtSlotTime, clientSlotISO, slotState, dayIn, addDaysStr } from '../../lib/scheduling'
import { rankCarriers, exactCarrier } from '../../lib/carriers'
import { STAGE, TONE, stageOf, agentStageOf, isLive, recoveryLabel, canRebook, sameLocalDay, tabOf, PIPELINE_TABS, digits, matchClients, placeOf } from '../../lib/agentBookings'
import { US_STATES } from '../../lib/timezones'
import { DayClock } from '../ui/DayClock'
import { LiveDot } from '../ui/LiveDot'
import { Avatar } from '../ui/Avatar'
import { fullName } from '../../lib/policyFormat'
import { ACTIVITY_ROWS, rowMeta, rowTone, EVENT_ICON, kindTone, eventIconKey } from '../../lib/activityKinds'

// Shared pieces for the agent portal pages (Prompt 665).
// Prompt 669 — restyled to Restorix Portal's design system: eyebrow-labelled
// stat tiles, fully-rounded status badges, and client lists as one bordered
// card with hairline-divided rows and an eyebrow header (Restorix's tables),
// collapsing to two-line rows on a phone.

// Restorix's StatusBadge — mono caps in a rounded-full tint, no border.
export function Pill({ tone = 'neutral', icon: Icon, children }) {
  const t = TONE[tone]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999,
      fontFamily: MONO, fontSize: 10.5, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase',
      whiteSpace: 'nowrap', background: t.dim, color: t.color,
    }}>
      {Icon && <Icon size={11} />}{children}
    </span>
  )
}

// `agent` is the agent portal's status set (Prompt 702): no In progress — a live
// call keeps the row Booked and just pulses.
export function StagePill({ p, now, agent }) {
  const stage = agent ? agentStageOf(p) : stageOf(p)
  const live = stage === 'inProgress' || (agent && stage === 'booked' && isLive(p))
  const pill = (
    <Pill tone={STAGE[stage].tone} icon={live ? LiveDot : undefined}>
      {STAGE[stage].label}
    </Pill>
  )
  // Prompt 696 — a No answer lead in the text-and-retry flow says where it is.
  const sub = recoveryLabel(p, now)
  if (!sub) return pill
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
      {pill}
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{sub}</span>
    </span>
  )
}

// Restorix's Tile — eyebrow label over one big number. A warning/danger tone
// tints the whole tile (Restorix's Needs-Attention treatment) instead of
// adding an icon badge; every other tone stays a plain card.
export function StatTile({ label, value, sub, tone = 'neutral', onClick }) {
  const alert = tone === 'warning' || tone === 'danger'
  const t = TONE[tone]
  return (
    <div
      onClick={onClick}
      style={{
        ...card, padding: 20, cursor: onClick ? 'pointer' : 'default',
        ...(alert ? { background: t.dim, borderColor: t.bd } : null),
      }}
    >
      <p style={{ ...eyebrow, ...(alert ? { color: t.color } : null) }}>{label}</p>
      <p style={{
        margin: '8px 0 0', fontFamily: MONO, fontSize: 30, fontWeight: 500, lineHeight: 1.1,
        letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
        color: alert ? t.color : 'var(--text-primary)',
      }}>
        {value}
      </p>
      {sub && <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  )
}

export function StatGrid({ children }) {
  return <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">{children}</div>
}

// Section heading above a card (Restorix `h2 font-display text-lg`), with an
// optional action on the right.
export function SectionHead({ title, sub, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2>{title}</h2>
        {sub && <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>{sub}</p>}
      </div>
      {action}
    </div>
  )
}

export function EmptyNote({ children }) {
  return (
    // flex: 1 + centering so that inside a fixed-height flex-column box (My Pipeline, Activity, Messages) the
    // text sits at the exact center on both axes, not top-anchored (Prompt 707). In an auto-height box the
    // padding alone keeps it where it was.
    <p style={{ margin: 0, padding: '32px 20px', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 14, color: 'var(--text-secondary)' }}>
      {children}
    </p>
  )
}

// One bordered card holding a list of rows — Restorix's table shell. `head`
// renders the eyebrow header row (md and up only; phones get two-line rows
// with no header). `empty` shows in place of the rows when there are none.
export function ListCard({ head, timeOnly, empty, children, style }) {
  const hasRows = Children.toArray(children).length > 0
  return (
    // Empty state: a flex column so EmptyNote can fill and center itself in a fixed-height card (Prompt 707).
    <div style={{ ...card, padding: 0, overflow: 'hidden', ...(hasRows ? null : { display: 'flex', flexDirection: 'column' }), ...style }}>
      {head && hasRows && (
        <div
          className={`hidden md:grid ${timeOnly ? 'md:grid-cols-[96px_minmax(0,1.4fr)_minmax(0,1fr)_160px_14px]' : 'md:grid-cols-[176px_minmax(0,1.4fr)_minmax(0,1fr)_160px_14px]'} items-center gap-x-4`}
          style={{ ...eyebrow, padding: '11px 20px', background: 'var(--bg-elevated)', position: 'sticky', top: 0, zIndex: 1 }}
        >
          <span>{timeOnly ? 'Time' : 'Call'}</span><span>Client</span><span>Carrier</span><span style={{ justifySelf: 'end' }}>Status</span><span />
        </div>
      )}
      {hasRows ? children : empty}
    </div>
  )
}

// Eyebrow divider inside a ListCard ("Today" / "Coming up") — Restorix's
// Strategy Calls group rows.
export function GroupRow({ label, first }) {
  return (
    <div style={{
      ...eyebrow, color: 'var(--text-muted)', padding: '8px 20px', background: 'var(--bg-elevated)',
      borderTop: first ? 'none' : 'var(--border-w) solid var(--border)',
    }}>
      {label}
    </div>
  )
}

// One booked client as a row inside a ListCard. Used on Overview, Book a call
// and My Clients. `compact` keeps the two-line phone layout at every width,
// for narrow side panels.
const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1'
const COL = {
  when: 'order-2 md:order-none col-span-2 md:col-span-1',
  name: 'order-1 md:order-none',
  leaving: 'hidden md:block',
  leavingInline: 'md:hidden',
  status: 'order-1 md:order-none',
  chevron: 'hidden md:block',
}
const COL_COMPACT = { when: 'order-2 col-span-2', name: 'order-1', leaving: 'hidden', leavingInline: '', status: 'order-1', chevron: 'hidden' }

export function ClientRow({ p, now, onClick, onRebook, rebookLabel = 'Re-book', onConfirmNumber, showAgent, timeOnly, active, first, last, compact, tall }) {
  const c = compact ? COL_COMPACT : COL
  const cols = compact ? ''
    : timeOnly ? 'md:grid-cols-[96px_minmax(0,1.4fr)_minmax(0,1fr)_160px_14px]'
      : 'md:grid-cols-[176px_minmax(0,1.4fr)_minmax(0,1fr)_160px_14px]'
  const when = p.scheduled_call_at
    ? new Date(p.scheduled_call_at).toLocaleString('en-US', {
      ...(timeOnly
        ? { hour: 'numeric', minute: '2-digit' }
        : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
      // Prompt 724 — the client's local time when we know their zone.
      ...(p.client_timezone ? { timeZone: p.client_timezone } : null),
    })
    : 'No time'
  const leaving = p.current_carrier || 'Not noted'
  return (
    <div
      onClick={onClick}
      className={`${ROW_GRID} ${cols} table-row-hover`}
      style={{
        padding: tall ? '22px 20px' : '14px 20px', cursor: onClick ? 'pointer' : 'default',
        borderTop: first ? 'none' : 'var(--border-w) solid var(--border)',
        // Trailing divider under the last row, same as Activity's list (Prompt 707).
        borderBottom: last ? 'var(--border-w) solid var(--border)' : undefined,
        background: active ? 'var(--bg-elevated)' : undefined,
      }}
    >
      <span
        className={c.when}
        style={{ fontFamily: MONO, fontSize: 13, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {when}
        <span className={c.leavingInline} style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-muted)' }}> · {leaving}</span>
      </span>
      <div className={c.name} style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {fullName(p)}
        </p>
        {showAgent && (
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>{p.agent?.full_name || '—'}</p>
        )}
      </div>
      <span className={c.leaving} style={{ fontSize: 14, color: p.current_carrier ? 'var(--text-secondary)' : 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {leaving}
      </span>
      <span className={c.status} style={{ justifySelf: 'end', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {onConfirmNumber && (
          <button
            onClick={e => { e.stopPropagation(); onConfirmNumber() }}
            style={{
              height: 24, padding: '0 10px', borderRadius: 999, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
              background: 'var(--accent-dim)', color: 'var(--accent)', border: 'var(--border-w) solid var(--accent-border)',
            }}
          >
            Confirm number
          </button>
        )}
        {onRebook && (
          <button
            onClick={e => { e.stopPropagation(); onRebook() }}
            style={{
              height: 24, padding: '0 10px', borderRadius: 999, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
              background: 'transparent', color: 'var(--text-secondary)', border: 'var(--border-w) solid var(--border-strong)',
            }}
          >
            {rebookLabel}
          </button>
        )}
        <StagePill p={p} now={now} agent />
      </span>
      <ChevronRight
        size={14}
        className={c.chevron}
        style={{ color: 'var(--text-muted)', transform: active ? 'rotate(90deg)' : 'none', transition: 'transform 120ms', visibility: onClick ? 'visible' : 'hidden' }}
      />
    </div>
  )
}

// Date + fixed 30-minute slot picker. Today/Tomorrow are one tap; any other
// day goes through the date input. Slots already past (today) are disabled,
// and slots where this agent already has a booking say so — the agent can
// only see their own calendar, not Fulfillment's (RLS), so that's a hint, not
// a capacity check.
export function SlotPicker({ date, slot, onDate, onSlot, takenCounts = {}, error, now }) {
  const today = localDateISO(0)
  const tomorrow = localDateISO(1)
  const quick = [
    { value: today, label: 'Today' },
    { value: tomorrow, label: 'Tomorrow' },
  ]
  const isOther = date !== today && date !== tomorrow
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 10, border: 'var(--border-w) solid var(--border)', background: 'var(--bg-surface)' }}>
          {quick.map(q => {
            const on = date === q.value
            return (
              <button
                key={q.value} type="button" onClick={() => onDate(q.value)} className="tab-transition"
                style={{
                  height: 32, padding: '0 16px', borderRadius: 7, border: 'none', fontSize: 13.5, fontWeight: on ? 600 : 500,
                  background: on ? 'var(--accent)' : 'transparent', color: on ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {q.label}
              </button>
            )
          })}
        </div>
        <input
          type="date" value={date} min={today}
          onChange={e => e.target.value && onDate(e.target.value)}
          aria-label="Pick another day"
          className="date-field"
          style={{
            width: 'auto', height: 42, fontFamily: MONO, borderRadius: 10,
            ...(isOther ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : null),
          }}
        />
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
        {SLOTS.map(s => {
          const iso = slotToISO(date, s)
          const past = new Date(iso).getTime() <= now
          const on = slot === s
          const taken = takenCounts[iso] || 0
          return (
            <button
              key={s} type="button" disabled={past}
              onClick={() => onSlot(s)}
              title={past ? 'Already past' : taken ? `You already have ${taken} booked at this time` : undefined}
              aria-label={past ? `${s}, already past` : taken ? `${s}, you have ${taken} booked` : s}
              className="tab-transition"
              style={{
                ...control, height: 46, padding: 0, fontSize: 13, fontFamily: MONO,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
                border: `1px solid ${on ? 'var(--accent)' : (error ? 'var(--danger)' : 'var(--border)')}`,
                background: on ? 'var(--accent)' : 'var(--bg-base)',
                color: on ? '#fff' : 'var(--text-primary)',
                opacity: past ? 0.35 : 1, cursor: past ? 'not-allowed' : 'pointer',
                textDecoration: past ? 'line-through' : 'none',
              }}
            >
              {s}
              {taken > 0 && !past && (
                <span style={{ fontSize: 9.5, letterSpacing: '0.04em', color: on ? '#fff' : 'var(--warning)' }}>
                  {taken} booked
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Tinted callout for a line the agent reads to the client. Used on Book a call
// and in Training (Prompt 670).
export function ScriptHint({ children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
      padding: '12px 16px', borderRadius: 12,
      background: 'var(--accent-subtle)', border: 'var(--border-w) solid var(--accent-border)',
    }}>
      <MessageCircleMore size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
      <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-primary)', fontStyle: 'italic', lineHeight: 1.55 }}>
        {children}
      </p>
    </div>
  )
}

// ── Prompt 714 — Agent Overview v2 ─────────────────────────────────────────
// The pilot of the portal-wide visual upgrade: hero, trend cards, a 14-day
// chart and a per-client attention list. Colours come from the --ov-* tokens
// and the .ov-card / .ov-hero / .ov-attn / .ov-ghost classes in index.css;
// large numerals are Space Grotesk (mono stays on the chart's axis labels).
// Phone layouts (below 640px) are separate markup toggled with sm: classes,
// since inline styles can't carry breakpoints.

const OV_NUM = {
  fontFamily: DISPLAY, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: 'var(--ov-hi)',
}
const OV_TITLE = {
  margin: 0, fontFamily: DISPLAY, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ov-hi)',
}

function IconChip({ icon: Icon, color, tint, size = 36, radius = 11, iconSize = 18 }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0, background: tint, color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon size={iconSize} strokeWidth={2} />
    </span>
  )
}

export function HeroPanel({ greeting, sub, dateLong, dateShort, timezone, onBook }) {
  const dot = <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ov-hero-dot)' }} />
  return (
    <section className="ov-hero" style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Phone: date chip + clock, greeting, full-width button. */}
      <div className="flex sm:hidden" style={{ flexDirection: 'column', gap: 20, padding: '22px 20px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span className="ov-hero-chip">{dot}{dateShort}</span>
          <DayClock
            timezone={timezone}
            style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.03em' }}
            periodStyle={{ marginLeft: 5, fontSize: 13, fontWeight: 500, color: 'var(--ov-hero-soft)' }}
          />
        </div>
        <div>
          <h1 style={{ margin: 0, fontFamily: DISPLAY, fontSize: 32, fontWeight: 600, lineHeight: 1.08, letterSpacing: '-0.035em', color: 'inherit' }}>
            {greeting}
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 15.5, color: 'var(--ov-hero-soft)' }}>{sub}</p>
        </div>
        <button type="button" onClick={onBook} className="ov-hero-btn" style={{ width: '100%', height: 50, fontSize: 16 }}>
          <CalendarPlus size={18} strokeWidth={2.1} /> Book a call
        </button>
      </div>

      {/* Tablet and up: text left; big clock and Book a call right. */}
      <div className="hidden sm:flex" style={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 32, padding: '36px 40px' }}>
        <div style={{ flex: '1 1 380px', minWidth: 0 }}>
          <span className="ov-hero-chip">{dot}{dateLong}</span>
          <h1 style={{ margin: '18px 0 0', fontFamily: DISPLAY, fontSize: 46, fontWeight: 600, lineHeight: 1.05, letterSpacing: '-0.035em', color: 'inherit' }}>
            {greeting}
          </h1>
          <p style={{ margin: '12px 0 0', fontSize: 17, color: 'var(--ov-hero-soft)' }}>{sub}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 18 }}>
          <DayClock
            timezone={timezone}
            style={{ fontFamily: DISPLAY, fontSize: 64, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.04em' }}
            periodStyle={{ marginLeft: 10, fontSize: 22, fontWeight: 500, color: 'var(--ov-hero-soft)' }}
          />
          <button type="button" onClick={onBook} className="ov-hero-btn" style={{ height: 48, padding: '0 24px', fontSize: 15 }}>
            <CalendarPlus size={18} strokeWidth={2.1} /> Book a call
          </button>
        </div>
      </div>
    </section>
  )
}

// "N more" / "N fewer" / "Same as last week" against the previous Mon–Sun.
function TrendChip({ diff, small }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, fontWeight: 600, whiteSpace: 'nowrap',
    height: small ? 22 : 24, padding: small ? '0 8px' : '0 9px', fontSize: small ? 12 : 12.5,
  }
  const ic = small ? 12 : 13
  if (diff > 0) {
    return <span style={{ ...base, background: 'var(--ov-up-tint)', color: 'var(--ov-up)' }}><TrendingUp size={ic} strokeWidth={2.2} />{diff} more</span>
  }
  if (diff < 0) {
    return <span style={{ ...base, background: 'var(--ov-stub)', color: 'var(--ov-mid)' }}><TrendingDown size={ic} strokeWidth={2.2} />{-diff} fewer</span>
  }
  return <span style={{ ...base, background: 'var(--ov-stub)', color: 'var(--ov-mid)' }}>Same as last week</span>
}

// Mon–Sun bars: today full strength, earlier days 45%, days not reached yet
// a 4px stub.
function WeekStrip({ counts, todayIdx, color, small }) {
  const h = small ? 30 : 44
  const max = Math.max(0, ...counts)
  return (
    <span aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: small ? 3 : 5, height: h, flexShrink: 0 }}>
      {counts.map((c, i) => {
        const future = i > todayIdx
        return (
          <span key={i} style={{
            width: small ? 6 : 10, borderRadius: 3,
            height: future || !max ? 4 : Math.max(4, Math.round((c / max) * h)),
            background: future ? 'var(--ov-stub)' : color, opacity: future || i === todayIdx ? 1 : 0.45,
          }} />
        )
      })}
    </span>
  )
}

// A real <button>; spans inside (a button only takes phrasing content).
export function TrendCard({ label, icon, tone, value, diff, week, todayIdx, onClick }) {
  const color = `var(--ov-data-${tone})`
  const tint = `var(--ov-data-${tone}-tint)`
  return (
    <button
      type="button" onClick={onClick}
      className="ov-card ov-link px-4 pt-4 pb-[18px] sm:px-6 sm:pt-[22px] sm:pb-6"
      style={{ display: 'block', width: '100%', minWidth: 0 }}
    >
      <span className="hidden sm:flex" style={{ flexDirection: 'column', gap: 22 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <IconChip icon={icon} color={color} tint={tint} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-mid)' }}>{label}</span>
          <ArrowUpRight size={16} strokeWidth={2} style={{ color: 'var(--ov-faint)', flexShrink: 0 }} />
        </span>
        <span style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ display: 'block', minWidth: 0 }}>
            <span style={{ ...OV_NUM, display: 'block', fontSize: 52, letterSpacing: '-0.035em' }}>{value}</span>
            {diff != null && (
              <span style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px' }}>
                <TrendChip diff={diff} />
                {diff !== 0 && <span style={{ fontSize: 13, color: 'var(--ov-mute)' }}>than last week</span>}
              </span>
            )}
          </span>
          <WeekStrip counts={week} todayIdx={todayIdx} color={color} />
        </span>
      </span>

      <span className="flex sm:hidden" style={{ flexDirection: 'column', gap: 16 }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconChip icon={icon} color={color} tint={tint} size={34} radius={10} iconSize={17} />
          <WeekStrip counts={week} todayIdx={todayIdx} color={color} small />
        </span>
        <span style={{ display: 'block' }}>
          <span style={{ ...OV_NUM, display: 'block', fontSize: 40, letterSpacing: '-0.035em' }}>{value}</span>
          <span style={{ display: 'block', marginTop: 8, fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mid)' }}>{label}</span>
          {diff != null && <span style={{ display: 'block', marginTop: 8 }}><TrendChip diff={diff} small /></span>}
        </span>
      </span>
    </button>
  )
}

function Legend({ style }) {
  const key = (bg, text) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--ov-mid)', whiteSpace: 'nowrap' }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: bg }} />{text}
    </span>
  )
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', ...style }}>
      {key('var(--ov-data-a-key)', 'Booked')}{key('var(--ov-data-b-key)', 'Cancelled')}
    </span>
  )
}

const shortDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// `days`: [{ date, booked, cancelled }], oldest first, today last. Plain divs,
// no chart library. `compact` is the phone's 7-day version.
export function ActivityChart({ days, loading, compact, className = '' }) {
  const n = days.length
  const booked = days.reduce((s, d) => s + d.booked, 0)
  const cancelled = days.reduce((s, d) => s + d.cancelled, 0)
  const max = Math.max(0, ...days.map(d => Math.max(d.booked, d.cancelled)))
  const area = compact ? 120 : 150
  const top = area - 12
  const barW = compact ? 11 : 10
  const barH = v => (v && max ? Math.max(6, Math.round((v / max) * top)) : 3)
  const empty = !loading && booked === 0 && cancelled === 0

  const total = (v, word) => (
    <div>
      <div style={{ ...OV_NUM, fontSize: compact ? 30 : 34, letterSpacing: '-0.03em' }}>{loading ? '—' : v}</div>
      <div style={{ marginTop: 6, fontSize: 13, color: 'var(--ov-mute)' }}>{word}</div>
    </div>
  )

  const bars = empty ? (
    <div style={{ flex: 1, minWidth: 0, minHeight: area + 26, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 14, color: 'var(--ov-mute)' }}>
      No calls in the last {n} days. Book one when your next client says yes.
    </div>
  ) : (
    <div
      role="img" aria-label={`Last ${n} days: ${booked} booked, ${cancelled} cancelled`}
      className="ov-chart-bars"
      style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-end', gap: compact ? 2 : 4, backgroundSize: `100% ${top / 3}px` }}
    >
      {days.map((d, i) => {
        const today = i === n - 1
        const label = !compact && (i === 0 || d.date.getDate() === 1) ? shortDate(d.date) : d.date.getDate()
        return (
          <div key={i} title={`${shortDate(d.date)}: ${d.booked} booked, ${d.cancelled} cancelled`}
            style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ height: area, display: 'flex', alignItems: 'flex-end', gap: 4 }}>
              <span style={{ width: barW, height: barH(d.booked), borderRadius: '4px 4px 2px 2px', background: 'var(--ov-data-a-bar)' }} />
              <span style={{ width: barW, height: barH(d.cancelled), borderRadius: '4px 4px 2px 2px', background: 'var(--ov-data-b-bar)' }} />
            </div>
            <span style={{
              fontFamily: MONO, fontSize: 11, fontWeight: today ? 600 : 500, whiteSpace: 'nowrap',
              color: today ? 'var(--ov-hi)' : 'var(--ov-faint)',
            }}>
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )

  if (compact) {
    return (
      <div className={`ov-card flex-col w-full min-w-0 ${className}`} style={{ gap: 20, padding: '18px 18px 16px' }}>
        <div>
          <h2 style={{ ...OV_TITLE, fontSize: 18 }}>Your last {n} days</h2>
          <Legend style={{ marginTop: 10 }} />
        </div>
        <div style={{ display: 'flex', gap: 28 }}>{total(booked, 'booked')}{total(cancelled, 'cancelled')}</div>
        {bars}
      </div>
    )
  }
  return (
    <div className={`ov-card flex-col w-full min-w-0 ${className}`} style={{ gap: 24, padding: '24px 26px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px 20px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h2 style={{ ...OV_TITLE, fontSize: 19 }}>Your last {n} days</h2>
          <p style={{ margin: '3px 0 0', fontSize: 13.5, color: 'var(--ov-mute)' }}>Calls you booked and old policies confirmed cancelled</p>
        </div>
        <Legend />
      </div>
      <div style={{ marginTop: 'auto', display: 'flex', gap: 28, alignItems: 'stretch' }}>
        <div style={{
          width: 120, flexShrink: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center',
          gap: 22, paddingRight: 24, borderRight: '1px solid var(--ov-line)',
        }}>
          {total(booked, 'booked')}{total(cancelled, 'cancelled')}
        </div>
        {bars}
      </div>
    </div>
  )
}

const initialsOf = name => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean)
  return ((w[0]?.[0] || '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase() || '?'
}

// "2 tries, last on Monday" / "1 try, today" from call_attempts + last_call_at.
function triesLine(p, now) {
  const parts = []
  const n = p.call_attempts || 0
  if (n) parts.push(`${n} ${n === 1 ? 'try' : 'tries'}`)
  if (p.last_call_at) {
    const t = new Date(p.last_call_at)
    if (sameLocalDay(p.last_call_at, new Date(now))) parts.push('today')
    else if (now - t.getTime() < 6 * 864e5) parts.push(`last on ${t.toLocaleDateString('en-US', { weekday: 'long' })}`)
    else parts.push(`last on ${shortDate(t)}`)
  }
  return parts.join(', ')
}

const ATTN_ROWS = 4 // phones show 3

// Replaces the old "No answer" tile: each No answer client with its own
// next step. `items` arrive sorted (Needs attention, Confirm number, rest;
// oldest last call first). `onGo(path)` navigates.
export function AttentionPanel({ items, loading, now, onGo }) {
  const pad = 'p-[18px] sm:px-6 sm:pt-6 sm:pb-5'
  const area = { gridArea: 'attn', minWidth: 0 }
  const title = <h2 style={{ ...OV_TITLE, flex: 1, minWidth: 0, fontSize: 19 }}>Needs your attention</h2>

  if (loading) {
    return (
      <div className={`ov-card flex flex-col ${pad}`} style={area}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {title}
          <span style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 600, color: 'var(--ov-mute)' }}>—</span>
        </div>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className={`ov-card flex flex-col ${pad}`} style={area}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <IconChip icon={Check} color="var(--ov-up)" tint="var(--ov-up-tint)" />
          {title}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px 0 12px' }}>
          <p style={{ margin: 0, fontFamily: DISPLAY, fontSize: 26, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.02em', color: 'var(--ov-hi)' }}>
            You&rsquo;re all caught up
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--ov-mute)' }}>Nothing needs your attention right now.</p>
        </div>
      </div>
    )
  }

  const count = items.length
  const shown = items.slice(0, ATTN_ROWS)
  const more = n => (count > n ? `See all ${count} in My Pipeline` : 'Open in My Pipeline')

  return (
    <div className={`ov-attn flex flex-col ${pad}`} style={area}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <IconChip icon={TriangleAlert} color="var(--ov-warn)" tint="var(--ov-warn-tint)" />
        {title}
        <span style={{
          minWidth: 30, height: 30, boxSizing: 'border-box', padding: '0 10px', borderRadius: 999,
          background: 'var(--ov-badge-bg)', color: 'var(--ov-badge-fg)', fontFamily: DISPLAY, fontSize: 15, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontVariantNumeric: 'tabular-nums',
        }}>
          {count}
        </span>
      </div>
      <p style={{ margin: '14px 0 6px', fontSize: 14, lineHeight: 1.5, color: 'var(--ov-soft)' }}>
        {count === 1 ? 'This client didn’t' : 'These clients didn’t'} pick up. Re-book a time, or Fulfillment will try again.
      </p>

      {shown.map((p, i) => {
        const name = fullName(p)
        const stage = agentStageOf(p)
        const step = recoveryLabel(p, now) || triesLine(p, now)
        const meta = [p.current_carrier || 'Carrier not noted', step].filter(Boolean).join(' · ')
        const btn = { padding: '0 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer' }
        let action
        if (canRebook(p)) {
          action = (
            <button type="button" className="ov-ghost h-10 sm:h-[34px]" style={btn}
              onClick={() => onGo(`/agent/clients?stage=${stage}&open=${p.id}&rebook=1`)}>
              {stage === 'needsAttention' ? 'Call & rebook' : 'Re-book'}
            </button>
          )
        } else if (stage === 'confirmNumber') {
          action = (
            <button type="button" className="ov-ghost h-10 sm:h-[34px]" style={btn}
              onClick={() => onGo(`/agent/clients?stage=confirmNumber&open=${p.id}`)}>
              Confirm number
            </button>
          )
        } else {
          action = <span style={{ fontSize: 12.5, color: 'var(--ov-mute)', whiteSpace: 'nowrap', flexShrink: 0 }}>We&rsquo;re on it</span>
        }
        return (
          <div key={p.id} className={`ov-attn-row ${i >= 3 ? 'hidden sm:flex' : 'flex'}`} style={{ alignItems: 'center', gap: 12, padding: '14px 0' }}>
            <span style={{
              width: 38, height: 38, flexShrink: 0, borderRadius: '50%', background: 'var(--ov-warn-tint)', color: 'var(--ov-warn)',
              fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {initialsOf(name)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
              <div style={{ marginTop: 2, fontSize: 12.5, color: 'var(--ov-mute)' }}>{meta}</div>
            </div>
            {action}
          </div>
        )
      })}

      <div style={{ marginTop: 'auto', paddingTop: 8 }}>
        <button type="button" className="ov-ghost" onClick={() => onGo('/agent/clients?stage=noAnswer')}
          style={{ width: '100%', height: 44, borderRadius: 999, fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}>
          <span className="sm:hidden">{more(3)}</span>
          <span className="hidden sm:inline">{more(ATTN_ROWS)}</span>
          <ArrowRight size={15} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

// ── Prompt 715 — Book a call on the v16 language ──────────────────────────
// Same booking behaviour as before; these are only the new pieces of markup.
// Colours from the --ov-* tokens and the .ov-input / .ov-choice / .ov-step /
// .ov-note classes in index.css.

export function StepHead({ n, title, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span className="ov-step" style={{
        width: 36, height: 36, flexShrink: 0, borderRadius: 11, fontFamily: DISPLAY, fontSize: 16, fontWeight: 600,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {n}
      </span>
      <div style={{ minWidth: 0 }}>
        <h2 className="text-[18px] sm:text-[19px]" style={OV_TITLE}>{title}</h2>
        <p style={{ margin: '1px 0 0', fontSize: 13.5, color: 'var(--ov-mute)' }}>{sub}</p>
      </div>
    </div>
  )
}

// Label over an .ov-input box. Extra props go to the <input>.
// Prompt 730 — `changed` tints the box and `note` sits under it, outside the
// <label> so it isn't read as part of the field's name (Change a booking's
// "Changed · was …").
export function OvField({ label, optional, icon: Icon, error, changed, note, className = '', ...input }) {
  const field = (
    <label className={note ? '' : className} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mid)' }}>
        {label}
        {optional && <span style={{ fontWeight: 500, color: 'var(--ov-mute)' }}> optional</span>}
      </span>
      <span className={`ov-input${error ? ' is-error' : ''}${changed ? ' is-changed' : ''}`}>
        {Icon && <Icon size={17} strokeWidth={1.9} style={{ flexShrink: 0 }} />}
        <input aria-invalid={error || undefined} {...input} />
      </span>
    </label>
  )
  return note ? <NoteUnder className={className} note={note}>{field}</NoteUnder> : field
}

function NoteUnder({ className = '', note, children }) {
  return <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>{children}{note}</div>
}

// Prompt 735 — the portal's own dropdown, for every native <select> an agent
// would meet. WAI-ARIA select-only combobox: focus stays on the trigger button
// and the list (a listbox, portaled to <body> so a card or modal never clips
// it) is driven with aria-activedescendant. Opens below the trigger at its
// width, or above when there isn't room; the chosen row is scrolled into view
// and ticked. ↑ ↓ Home End move, Enter / Space choose, Esc closes, Tab closes,
// letters jump to the matching option. `options` = [{ value, label }];
// `metaOf(option)` is an optional muted, right-aligned string per row.
const SEL_MAX = 280
export function OvSelect({ value, onChange, options, placeholder = 'Choose', icon: Icon, error, changed, metaOf, 'aria-labelledby': labelledBy, 'aria-label': ariaLabel, id }) {
  const uid = useId()
  const trigger = useRef(null)
  const list = useRef(null)
  const typed = useRef({ text: '', at: 0 })
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState(null)
  const selectedIdx = options.findIndex(o => o.value === value)
  const selected = options[selectedIdx]
  const shown = open || closing
  const listId = `${uid}-list`
  const optId = i => `${uid}-opt-${i}`

  const openList = () => { typed.current.text = ''; setActive(Math.max(0, selectedIdx)); setClosing(false); setOpen(true) }
  const closeList = () => {
    typed.current.text = ''
    if (!open) return
    setOpen(false)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setClosing(true)
  }
  useEffect(() => {
    if (!closing) return
    const t = setTimeout(() => setClosing(false), 110)
    return () => clearTimeout(t)
  }, [closing])

  // Below the trigger at its width; above when below is too short and above is
  // roomier. Kept inside the screen sideways.
  useLayoutEffect(() => {
    if (!shown) return
    const measure = () => {
      const r = trigger.current.getBoundingClientRect()
      const want = Math.min(SEL_MAX, options.length * 40 + 12)
      const below = window.innerHeight - r.bottom - 12
      const above = r.top - 12
      const up = below < want && above > below
      const room = Math.max(120, Math.min(SEL_MAX, up ? above : below))
      const width = Math.min(r.width, window.innerWidth - 16)
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8)
      setPlace({ left, width, maxHeight: room, up, ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [shown, options.length])

  // Keep the active row visible inside the list (not the page).
  useLayoutEffect(() => {
    if (!open || !place || !list.current) return
    const box = list.current
    const el = box.children[active]
    if (!el) return
    if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop - 6
    else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight + 6
  }, [open, place, active])

  useEffect(() => {
    if (!open) return
    const down = e => { if (!trigger.current?.contains(e.target) && !list.current?.contains(e.target)) closeList() }
    document.addEventListener('pointerdown', down)
    return () => document.removeEventListener('pointerdown', down)
  })

  const choose = i => { const o = options[i]; if (o) onChange(o.value); closeList(); trigger.current?.focus() }

  // Letters jump to the next option starting with what was typed; one letter
  // pressed again steps through the matches.
  const typeAhead = ch => {
    const t = typed.current
    const now = Date.now()
    t.text = now - t.at > 700 ? ch : t.text + ch
    t.at = now
    const q = t.text.toLowerCase()
    const repeat = [...q].every(c => c === q[0])
    const needle = repeat ? q[0] : q
    const from = repeat ? active + 1 : active
    for (let n = 0; n < options.length; n++) {
      const i = (from + n) % options.length
      if (options[i].label.toLowerCase().startsWith(needle)) return i
    }
    return -1
  }

  const onKeyDown = e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const last = options.length - 1
    // A space in the middle of typing ("new m") belongs to the search, not to Choose.
    const typing = e.key === ' ' && typed.current.text && Date.now() - typed.current.at < 700
    if (typing) {
      const i = typeAhead(' ')
      e.preventDefault()
      if (i >= 0) { setActive(i); if (!open) { setClosing(false); setOpen(true) } }
      return
    }
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList() }
      else if (e.key.length === 1) {
        const i = typeAhead(e.key)
        if (i >= 0) { e.preventDefault(); setActive(i); setClosing(false); setOpen(true) }
      }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(last, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(last) }
    else if (e.key === 'PageDown') { e.preventDefault(); setActive(a => Math.min(last, a + 6)) }
    else if (e.key === 'PageUp') { e.preventDefault(); setActive(a => Math.max(0, a - 6)) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeList() }
    else if (e.key === 'Tab') closeList()
    else if (e.key.length === 1) {
      const i = typeAhead(e.key)
      if (i >= 0) { e.preventDefault(); setActive(i) }
    }
  }

  return (
    <>
      <button ref={trigger} id={id} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open}
        aria-controls={shown ? listId : undefined} aria-activedescendant={open ? optId(active) : undefined}
        aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : ariaLabel} aria-invalid={error || undefined}
        className={`ov-input ov-sel${error ? ' is-error' : ''}${changed ? ' is-changed' : ''}${selected ? '' : ' is-empty'}`}
        onClick={() => (open ? closeList() : openList())} onKeyDown={onKeyDown}>
        {Icon && <Icon size={17} strokeWidth={1.9} style={{ flexShrink: 0 }} />}
        <span className="ov-sel-value">{selected ? selected.label : placeholder}</span>
        <ChevronDown size={17} strokeWidth={2} className="ov-sel-chev" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {shown && place && createPortal(
        <div ref={list} id={listId} role="listbox" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : ariaLabel}
          className={`ov-card ov-pop ov-sel-list${closing ? ' is-closing' : ''}${place.up ? ' is-up' : ''}`}
          style={{ left: place.left, width: place.width, maxHeight: place.maxHeight, top: place.top, bottom: place.bottom }}>
          {options.map((o, i) => (
            <div key={o.value} id={optId(i)} role="option" aria-selected={o.value === value}
              className={`ov-sel-opt${i === active ? ' is-active' : ''}`}
              onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(i)}>
              <span className="ov-sel-label">{o.label}</span>
              {metaOf && <span className="ov-sel-meta">{metaOf(o)}</span>}
              <Check size={16} strokeWidth={2.4} className="ov-sel-check" aria-hidden="true" style={{ visibility: o.value === value ? 'visible' : 'hidden' }} />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

const STATE_OPTIONS = US_STATES.map(s => ({ value: s.code, label: s.name }))

// Prompt 724 — the state, shown by name and stored as its 2-letter code.
// (Moved here from BookCall by Prompt 730, which shares it. Prompt 735: the
// portal's own OvSelect instead of the browser's list.)
export function StateField({ value, onChange, error, changed, note }) {
  const uid = useId()
  const field = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <span id={`${uid}-label`} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mid)' }}>State</span>
      <OvSelect value={value} onChange={onChange} options={STATE_OPTIONS} placeholder="Choose a state"
        error={error} changed={changed} aria-labelledby={`${uid}-label`} />
    </div>
  )
  return note ? <NoteUnder note={note}>{field}</NoteUnder> : field
}

// Prompt 730 — "Changed · was Aetna" under a field Change a booking edited.
export function ChangedMark({ was }) {
  return (
    <span className="ov-changed">
      <PencilLine size={13} strokeWidth={2} style={{ flexShrink: 0 }} />
      <span style={{ flexShrink: 0 }}>Changed ·</span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{was ? `was ${was}` : 'was blank'}</span>
    </span>
  )
}

// Prompt 730 — Book a call's "New booking | Change a booking" switch.
export function BookSwitch({ value, onChange }) {
  const opts = [{ value: 'new', label: 'New booking' }, { value: 'change', label: 'Change a booking' }]
  return (
    <div className="ov-range ov-book-switch" role="group" aria-label="Book a call">
      {opts.map(o => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => value !== o.value && onChange(o.value)}
          className={value === o.value ? 'is-on' : ''} style={{ height: 40, padding: '0 18px', fontSize: 14.5 }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Prompt 728 — "Carrier they're leaving": a plain text box with type-ahead.
// Nothing shows on an empty focus; from the first letter, up to 6 carriers
// (rankCarriers) appear under the box and the top one completes inline as
// ghost text after the cursor. Tab / → / Enter take it, ↑ / ↓ move, Esc
// closes. A name that matches nothing can still be kept ("Use "<text>"").
// `picked` is the chosen carrier row; typing again clears it (onText).
export function CarrierInput({ carriers, text, picked, onText, onPick, onUseText, adding, error, changed, note, label = 'Carrier', autoFocus }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listId = 'carrier-suggest'
  const hits = useMemo(() => (picked ? [] : rankCarriers(carriers, text)), [carriers, text, picked])
  const trimmed = text.trim()
  const useRow = !picked && trimmed.length >= 2 && hits.length === 0
  const rows = useRow ? [{ use: trimmed }] : hits
  const shown = open && !picked && !!trimmed && rows.length > 0
  const at = Math.min(active, Math.max(rows.length - 1, 0))

  // Ghost completion: the top match's name, when it starts with what's typed.
  const top = hits[0]?.carrier
  const ghost = shown && top && top.name.toLowerCase().startsWith(text.toLowerCase()) && top.name.length > text.length
    ? top.name.slice(text.length) : ''

  const choose = row => {
    setOpen(false); setActive(0)
    if (row.use) onUseText(row.use)
    else onPick(row.carrier)
  }
  const onKeyDown = e => {
    if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, rows.length - 1)) }
    else if (e.key === 'ArrowUp' && rows.length) { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Escape') { if (shown) { e.preventDefault(); setOpen(false) } }
    else if (e.key === 'Enter') {
      if (picked || !trimmed) return
      e.preventDefault()
      choose(shown ? rows[at] : useRow ? rows[0] : hits[0] || { use: trimmed })
    } else if ((e.key === 'Tab' && !e.shiftKey) || e.key === 'ArrowRight') {
      const el = e.currentTarget
      const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length
      if (ghost && (e.key === 'Tab' || atEnd)) { e.preventDefault(); choose(hits[0]) }
    }
  }
  const onBlur = () => {
    setOpen(false)
    // Typed a carrier's exact name (or alias) without picking it: that's the pick.
    if (!picked && trimmed) {
      const exact = exactCarrier(carriers, trimmed)
      if (exact) onPick(exact)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, position: 'relative' }}>
      <label htmlFor="carrier-input" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mid)' }}>{label}</label>
      <span className={`ov-input${error ? ' is-error' : ''}${changed ? ' is-changed' : ''}`}>
        <Building2 size={17} strokeWidth={1.9} style={{ flexShrink: 0 }} />
        <span className="ov-complete-wrap">
          <input
            ref={inputRef} id="carrier-input" value={text} autoComplete="off" spellCheck={false} placeholder="e.g. Mutual of Omaha"
            role="combobox" aria-expanded={shown} aria-controls={listId} aria-autocomplete="both" aria-invalid={error || undefined}
            aria-activedescendant={shown ? `${listId}-${at}` : undefined} autoFocus={autoFocus}
            onChange={e => { onText(e.target.value); setOpen(true); setActive(0) }}
            onFocus={() => setOpen(true)} onBlur={onBlur} onKeyDown={onKeyDown}
          />
          {ghost && (
            <span className="ov-complete" aria-hidden="true">
              <span style={{ visibility: 'hidden' }}>{text}</span>{ghost}
            </span>
          )}
        </span>
        {adding && <span style={{ fontSize: 12.5, color: 'var(--ov-mute)', flexShrink: 0 }}>Adding…</span>}
        {picked && !adding && <Check size={17} strokeWidth={2.2} style={{ flexShrink: 0, color: 'var(--ov-pick)' }} aria-label="Carrier picked" />}
      </span>
      {shown && (
        <div id={listId} role="listbox" className="ov-card ov-suggest" aria-label="Carriers">
          {rows.map((row, i) => (
            <div
              key={row.use ? 'use' : row.carrier.id} id={`${listId}-${i}`} role="option" aria-selected={i === at}
              className={`ov-suggest-row${i === at ? ' is-active' : ''}`}
              onMouseDown={e => { e.preventDefault(); choose(row) }} onMouseEnter={() => setActive(i)}
            >
              {row.use ? (
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ov-mid)' }}>
                  Use “<span style={{ color: 'var(--ov-hi)', fontWeight: 600 }}>{row.use}</span>”
                </span>
              ) : (
                <>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--ov-hi)' }}>
                    {row.carrier.name}
                  </span>
                  {row.alias && (
                    <span style={{ minWidth: 0, flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, color: 'var(--ov-mute)' }}>
                      also {row.alias}
                    </span>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {note}
    </div>
  )
}

// One day card. `long` / `short` are the two date lines; the card shows the
// short one when it is narrow (container query in index.css).
export function DayChoice({ label, long, short, on, disabled, icon: Icon, onClick, ariaLabel, className = 'flex' }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-pressed={on} aria-label={ariaLabel}
      className={`ov-choice ov-day h-[60px] sm:h-16 px-3 sm:px-4${on ? ' is-on' : ''} ${className}`}
      style={{
        flex: 1, minWidth: 0, borderRadius: 14, textAlign: 'left',
        alignItems: 'center', gap: 12, ...(disabled ? { opacity: 0.5 } : null),
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: on ? 'var(--ov-pick)' : 'var(--ov-mute)' }}>{label}</span>
        <span className="text-[14.5px] sm:text-[15.5px]" style={{
          display: 'block', marginTop: 1, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          color: disabled ? 'var(--ov-mute)' : 'var(--ov-hi)',
        }}>
          {short ? <><span className="ov-day-long">{long}</span><span className="ov-day-short">{short}</span></> : long}
        </span>
      </span>
      {on ? (
        <span style={{
          width: 20, height: 20, flexShrink: 0, borderRadius: '50%', background: 'var(--ov-pick)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Check size={12} strokeWidth={3} />
        </span>
      ) : Icon ? (
        <Icon size={18} strokeWidth={1.9} style={{ flexShrink: 0, color: 'var(--ov-mute)' }} />
      ) : (
        <span style={{ width: 18, height: 18, flexShrink: 0, boxSizing: 'border-box', borderRadius: '50%', border: '1.5px solid var(--ov-faint)' }} />
      )}
    </button>
  )
}

// `gridClass` lets a narrow container (P717's client drawer) keep 3 columns.
// The fixed SLOTS, split at noon into Morning and Afternoon. Past slots are
// disabled; slots where this agent already has a booking say so (a hint from
// their own calendar, not a capacity check, same as SlotPicker).
//
// Prompt 724 — pass `openIsoSet` (the agent's other open bookings) to switch
// on the booking rules: slots are the client's wall-clock time in `tz`, a slot
// within 30 minutes is plain disabled gray like a past one (no caption) and
// one already booked is "Booked", both disabled (slotState). Without it the grid renders exactly as before.
//
// Prompt 728 — `slots` is the day's bookable times (the carrier's hours,
// carrierDaySlots), grouped Morning / Afternoon / Evening (5 PM on); a group
// with none is left out, and a day with none shows `emptyText`.
//
// Prompt 730 — `currentIso` (Change a booking) draws the booking's own time
// dashed with a "Current" caption; it stays pickable.
export function SlotGrid({ date, slot, onSlot, takenCounts = {}, error, now, gridClass = 'grid grid-cols-3 sm:grid-cols-6', tz, openIsoSet, slots: daySlots = SLOTS, emptyText, currentIso }) {
  const rules = openIsoSet !== undefined
  const hourOf = s => Number(slotTo24h(s).slice(0, 2))
  const groups = [
    { label: 'Morning', icon: Sun, slots: daySlots.filter(s => hourOf(s) < 12) },
    { label: 'Afternoon', icon: Clock, slots: daySlots.filter(s => hourOf(s) >= 12 && hourOf(s) < 17) },
    { label: 'Evening', icon: Moon, slots: daySlots.filter(s => hourOf(s) >= 17) },
  ].filter(g => g.slots.length)
  if (!groups.length && emptyText) {
    return (
      <div className="ov-note" style={{
        padding: '18px 16px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.55, color: 'var(--ov-mute)', textAlign: 'center',
        ...(error ? { outline: '1px solid var(--danger)', outlineOffset: 6 } : null),
      }}>
        {emptyText}
      </div>
    )
  }
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 16, borderRadius: 14,
      ...(error ? { outline: '1px solid var(--danger)', outlineOffset: 6 } : null),
    }}>
      {groups.map(({ label, icon: Icon, slots }) => (
        <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }}>
            <Icon size={15} strokeWidth={2} />{label}
          </div>
          <div className={gridClass} style={{ gap: 10 }}>
            {slots.map(s => {
              if (rules) return <RuleSlot key={s} s={s} date={date} tz={tz} now={now} openIsoSet={openIsoSet} on={slot === s} onSlot={onSlot} currentIso={currentIso} />
              const iso = slotToISO(date, s)
              const past = new Date(iso).getTime() <= now
              const on = slot === s
              const taken = takenCounts[iso] || 0
              const [time, ampm] = s.split(' ')
              return (
                <button
                  key={s} type="button" disabled={past} onClick={() => onSlot(s)} aria-pressed={on}
                  title={past ? 'Already past' : taken ? `You already have ${taken} booked at this time` : undefined}
                  aria-label={past ? `${s}, already past` : taken ? `${s}, you have ${taken} booked` : s}
                  className={`ov-choice h-[52px] sm:h-[54px]${on ? ' ov-slot-on' : ''}`}
                  style={{
                    borderRadius: 12, padding: 0, fontFamily: DISPLAY, fontSize: 16, fontWeight: 600, lineHeight: 1.1,
                    color: on ? '#fff' : 'var(--ov-hi)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
                  }}
                >
                  <span style={{ whiteSpace: 'nowrap' }}>
                    {time}
                    <span style={{ marginLeft: 5, fontSize: 12, fontWeight: 500, ...(on ? { opacity: 0.85 } : { color: 'var(--ov-mute)' }) }}>{ampm}</span>
                  </span>
                  {taken > 0 && !past && (
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, color: on ? '#fff' : 'var(--ov-warn)' }}>
                      {taken} booked
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// Prompt 728 — stand-in slots while a carrier's hours are being looked up.
export function SlotSkeleton({ gridClass = 'grid grid-cols-3 sm:grid-cols-6' }) {
  return (
    <div className={gridClass} style={{ gap: 10 }} aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => <span key={i} className="ov-skel h-[52px] sm:h-[54px]" style={{ borderRadius: 12 }} />)}
    </div>
  )
}

// Prompt 724 — one slot under the booking rules. Past slots are dimmed with
// no caption, and so are slots inside the notice window (Prompt 727: the reason
// lives in aria-label/title only); "Booked" dims only the time so its caption reads.
const SLOT_CAPTION = { booked: 'Booked' }
const SLOT_LABEL = { past: 'already past', soon: 'unavailable', booked: 'you already have a call booked at this time' }

function RuleSlot({ s, date, tz, now, openIsoSet, on, onSlot, currentIso }) {
  const iso = clientSlotISO(date, s, tz)
  const state = slotState(iso, { now, openIsoSet })
  const off = state !== 'open'
  const current = !!currentIso && new Date(currentIso).getTime() === new Date(iso).getTime()
  const caption = SLOT_CAPTION[state] || (current && !on ? 'Current' : null)
  const [time, ampm] = s.split(' ')
  return (
    <button
      type="button" disabled={off} onClick={() => onSlot(s)} aria-pressed={on}
      title={state === 'past' ? 'Already past' : state === 'soon' ? 'Unavailable' : undefined}
      aria-label={off ? `${s}, ${SLOT_LABEL[state]}` : current ? `${s}, their current time` : s}
      className={`ov-choice h-[52px] sm:h-[54px]${on ? ' ov-slot-on' : ''}${off && caption ? ' ov-slot-held' : ''}${current ? ' ov-slot-current' : ''}`}
      style={{
        borderRadius: 12, padding: 0, fontFamily: DISPLAY, fontSize: 16, fontWeight: 600, lineHeight: 1.1,
        color: on ? '#fff' : 'var(--ov-hi)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
      }}
    >
      <span style={{ whiteSpace: 'nowrap', ...(off && caption ? { opacity: 0.45 } : null) }}>
        {time}
        <span style={{ marginLeft: 5, fontSize: 12, fontWeight: 500, ...(on ? { opacity: 0.85 } : { color: 'var(--ov-mute)' }) }}>{ampm}</span>
      </span>
      {caption && (
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, color: off ? 'var(--ov-warn)' : 'var(--ov-pick)' }}>
          {caption}
        </span>
      )}
    </button>
  )
}

// { day: 'Today' | 'Tomorrow' | 'Mon, Oct 12', time: '10:30', period: 'AM',
//   full: 'Thursday, October 8' } for a booking time. Prompt 724 — with `tz`
// it's the client's time, Today/Tomorrow by the client's calendar.
function bookingWhen(iso, now = Date.now(), tz) {
  if (tz) {
    const d = new Date(iso)
    const date = dayIn(d.getTime(), tz)
    const today = dayIn(now, tz)
    const z = { timeZone: tz }
    const day = date === today ? 'Today'
      : date === addDaysStr(today, 1) ? 'Tomorrow'
        : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...z })
    const [time, period] = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...z }).split(/\s+/)
    return { day, time, period, full: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...z }) }
  }
  const d = new Date(iso)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const day = sameLocalDay(iso, new Date(now)) ? 'Today'
    : sameLocalDay(iso, tomorrow) ? 'Tomorrow'
      : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const [time, period] = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).split(/\s+/)
  return { day, time, period, full: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) }
}

export function ClientAvatar({ name }) {
  return (
    <span style={{
      width: 48, height: 48, flexShrink: 0, boxSizing: 'border-box', borderRadius: '50%',
      background: 'rgba(255,255,255,0.14)', border: name ? '1px solid rgba(255,255,255,0.18)' : '1px dashed rgba(255,255,255,0.4)',
      color: '#fff', fontFamily: DISPLAY, fontSize: 17, fontWeight: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {name ? initialsOf(name) : <User size={20} strokeWidth={1.9} />}
    </span>
  )
}

export function BookError({ children }) {
  return (
    <p role="alert" style={{
      margin: 0, padding: '10px 14px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.45, color: '#fff',
      background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.35)',
    }}>
      {children}
    </p>
  )
}

function BookButton({ onClick, busy, capped }) {
  const off = busy || capped
  return (
    <button type="button" onClick={onClick} disabled={off} className="ov-hero-btn"
      style={{ width: '100%', height: 52, fontSize: 16, flexShrink: 0, ...(off ? { opacity: 0.6, cursor: 'not-allowed' } : null) }}>
      <CalendarPlus size={18} strokeWidth={2.1} />
      {busy ? 'Booking…' : capped ? 'Weekly cap reached' : 'Book the call'}
    </button>
  )
}

// Prompt 724 — pin + "Pensacola, FL".
function PlaceLine({ location, size = 14, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, ...style }}>
      <MapPin size={size} strokeWidth={2} style={{ flexShrink: 0 }} />
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{location}</span>
    </div>
  )
}

// Live summary of what the agent has entered, with the Book button. `bar`
// is the phone version, fixed to the bottom of the screen.
// Prompt 724 — optional `location` ("Pensacola, FL") under the phone line and
// `tz`, the client's zone the call time is shown in.
export function BookingSummary({ name, phone, carrier, scheduledAt, now, onBook, busy, capped, error, bar, location, tz }) {
  const when = scheduledAt ? bookingWhen(scheduledAt, now, tz) : null
  if (bar) {
    return (
      <div className="ov-hero flex flex-col sm:hidden" style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 70, borderRadius: '22px 22px 0 0',
        padding: '16px 16px calc(20px + env(safe-area-inset-bottom))', gap: 14,
      }}>
        {error && <BookError>{error}</BookError>}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {name || 'New client'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ov-hero-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {when ? `${when.day}, ${when.time} ${when.period}` : 'Pick a time'}
              {location && ` · ${location}`}
            </div>
          </div>
          {name && when && <Check size={20} strokeWidth={2.4} style={{ color: 'var(--ov-hero-dot)', flexShrink: 0 }} />}
        </div>
        <BookButton onClick={onBook} busy={busy} capped={capped} />
      </div>
    )
  }
  const meta = [phone, carrier].filter(Boolean).join(' · ')
  const big = { marginTop: 6, fontFamily: DISPLAY, fontSize: 34, fontWeight: 600, lineHeight: 1.05, letterSpacing: '-0.035em' }
  return (
    <div className="ov-hero" style={{ display: 'flex', flexDirection: 'column', gap: 22, padding: '26px 26px 24px' }}>
      <span className="ov-hero-chip" style={{ alignSelf: 'flex-start' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ov-hero-dot)' }} />Booking summary
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <ClientAvatar name={name} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15, color: '#fff', overflowWrap: 'anywhere' }}>
            {name || 'New client'}
          </div>
          <div style={{ marginTop: 3, fontSize: 14, color: 'var(--ov-hero-soft)' }}>{meta || 'Add their name and number'}</div>
          {location && <PlaceLine location={location} style={{ marginTop: 3, fontSize: 14, color: 'var(--ov-hero-soft)' }} />}
        </div>
      </div>
      <div style={{ height: 1, background: 'rgba(255,255,255,0.14)' }} />
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-hero-soft)' }}>Fulfillment calls</div>
        {when ? (
          <>
            <div style={{ ...big, color: '#fff' }}>
              {when.day}, {when.time}
              <span style={{ marginLeft: 7, fontSize: 17, fontWeight: 500, letterSpacing: 0, color: 'var(--ov-hero-soft)' }}>{when.period}</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 14, color: 'var(--ov-hero-soft)' }}>{when.full}</div>
          </>
        ) : (
          <div style={{ ...big, color: 'var(--ov-hero-soft)' }}>Pick a time</div>
        )}
      </div>
      <BookButton onClick={onBook} busy={busy} capped={capped} />
      {error && <BookError>{error}</BookError>}
    </div>
  )
}

// "3 of 7 bookings this week" with one segment per allowed booking; at the
// cap everything turns amber. `pill` is the phone version.
// Prompt 730 — `note` replaces the plan line (Change a booking's "never uses one").
export function WeeklyUsage({ cap, resets, pill, note }) {
  const warn = cap.atCap
  if (pill) {
    return (
      <span className="ov-choice" style={{
        height: 30, padding: '0 11px', borderRadius: 999, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center',
        fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', color: warn ? 'var(--ov-warn)' : 'var(--ov-mid)',
        ...(warn ? { borderColor: 'var(--ov-warn)' } : null),
      }}>
        {cap.used} of {cap.cap} this week
      </span>
    )
  }
  return (
    <div className="ov-card" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...OV_NUM, fontSize: 30, letterSpacing: '-0.03em', ...(warn ? { color: 'var(--ov-warn)' } : null) }}>
          {cap.used}<span style={{ fontSize: 17, fontWeight: 500, color: 'var(--ov-mute)' }}> of {cap.cap}</span>
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ov-mid)' }}>bookings this week</span>
      </div>
      <div aria-hidden="true" style={{ display: 'flex', gap: 5 }}>
        {Array.from({ length: cap.cap }, (_, i) => (
          <span key={i} style={{
            flex: 1, height: 8, borderRadius: 4,
            background: warn ? 'var(--ov-warn)' : i < cap.used ? 'var(--ov-seg-on)' : 'var(--ov-stub)',
          }} />
        ))}
      </div>
      {note || <div style={{ fontSize: 13, color: 'var(--ov-mute)' }}>{cap.tierName} plan · resets {resets}</div>}
    </div>
  )
}

// "today at 2:30 PM" / "tomorrow at 10:30 AM" / "Monday at 10:30 AM".
function scriptWhen(iso, now, tz) {
  const { day, time, period } = bookingWhen(iso, now, tz)
  const d = day === 'Today' || day === 'Tomorrow' ? day.toLowerCase()
    : new Date(iso).toLocaleDateString('en-US', { weekday: 'long', ...(tz ? { timeZone: tz } : null) })
  return `${d} at ${time} ${period}`
}

// The success screen after a booking, with the line to read to the client.
// Prompt 724 — optional `tz` (the client's zone) and `location`.
export function BookedCard({ name, at, now, onAnother, onPipeline, tz, location }) {
  const { time, period, full } = bookingWhen(at, now, tz)
  return (
    <div className="pt-6 sm:pt-[72px]" style={{ maxWidth: 620, margin: '0 auto' }}>
      <section className="ov-hero px-5 pt-10 pb-8 sm:px-11 sm:pt-12 sm:pb-10"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <span style={{
          width: 76, height: 76, borderRadius: '50%', background: 'rgba(52,224,196,0.16)', border: '1px solid rgba(52,224,196,0.45)',
          boxShadow: '0 0 0 10px rgba(52,224,196,0.07), 0 0 60px rgba(52,224,196,0.35)', color: '#34E0C4',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Check size={34} strokeWidth={2.4} />
        </span>
        <span className="ov-hero-chip" style={{ marginTop: 26 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34E0C4' }} />Booked with Fulfillment
        </span>
        <h1 className="text-[32px] sm:text-[40px]" style={{ margin: '18px 0 0', fontFamily: DISPLAY, fontWeight: 600, lineHeight: 1.05, letterSpacing: '-0.035em', color: '#fff' }}>
          {name}
        </h1>
        <p style={{ margin: '10px 0 0', fontFamily: DISPLAY, fontSize: 20, fontWeight: 500, color: 'var(--ov-hero-soft)' }}>
          {full} at {time} {period}
        </p>
        {location && (
          <PlaceLine location={location} style={{ marginTop: 8, justifyContent: 'center', fontSize: 15, color: 'var(--ov-hero-soft)' }} />
        )}
        <div style={{
          marginTop: 30, width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'flex-start', gap: 14, textAlign: 'left',
          padding: '18px 20px', borderRadius: 16, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
        }}>
          <MessageSquareText size={19} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 2, color: 'var(--ov-hero-dot)' }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-hero-soft)' }}>Say this before you hang up</div>
            <p style={{ margin: '6px 0 0', fontSize: 16, lineHeight: 1.55, color: '#fff' }}>
              &ldquo;You&rsquo;re all set for {scriptWhen(at, now, tz)}. Our Underwriting Team will give you a call right at that time to get everything squared away.&rdquo;
            </p>
          </div>
        </div>
        <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button type="button" onClick={onAnother} className="ov-hero-btn" style={{ height: 50, padding: '0 26px', fontSize: 15 }}>
            <CalendarPlus size={18} strokeWidth={2.1} /> Book another
          </button>
          <button type="button" onClick={onPipeline} style={{
            height: 50, boxSizing: 'border-box', padding: '0 24px', borderRadius: 999, fontSize: 15, fontWeight: 600, color: '#fff',
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)',
            display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          }}>
            See it in My Pipeline <ArrowRight size={15} strokeWidth={2} />
          </button>
        </div>
      </section>
    </div>
  )
}

// ── Prompt 717 — My Pipeline on the v16 language ─────────────────────────
// A search hero that looks across every status, the pipeline box with four
// status tabs, one list for the selected status, and the client drawer.
// Status colours come from the --ov-st-* tokens; the four tabs are tabOf().

const PIPELINE_TAB = {
  booked:    { label: 'Booked',    meaning: 'Waiting for Fulfillment',    key: 'booked',    icon: Phone },
  noAnswer:  { label: 'No answer', meaning: 'Fulfillment will try again', key: 'noanswer',  icon: PhoneMissed },
  needs:     { label: 'Needs attention', meaning: 'Only you can move these on', key: 'needs',     icon: TriangleAlert },
  cancelled: { label: 'Cancelled', meaning: 'Old policy cancelled',       key: 'cancelled', icon: Check },
}
const stVar = (tab, part = '') => `var(--ov-st-${PIPELINE_TAB[tab].key}${part ? `-${part}` : ''})`

const monthDay = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const weekdayDate = iso => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const clockTime = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const triesText = n => `${n} ${n === 1 ? 'try' : 'tries'}`

// "last on Friday", or "last on Oct 1" more than six days ago.
function lastOn(p, now) {
  if (!p.last_call_at) return null
  if (sameLocalDay(p.last_call_at, new Date(now))) return 'last today'
  const t = new Date(p.last_call_at)
  return now - t.getTime() < 6 * 864e5
    ? `last on ${t.toLocaleDateString('en-US', { weekday: 'long' })}`
    : `last on ${monthDay(p.last_call_at)}`
}

// recoveryLabel as a sentence: "retry tomorrow" → "Retry call tomorrow".
function nextStep(p, now) {
  const label = recoveryLabel(p, now)
  if (!label) return 'Fulfillment will try again'
  const s = label.replace(/^retry/, 'retry call')
  return s[0].toUpperCase() + s.slice(1)
}

// The "what's happening" phrase in search results.
function searchPhrase(p) {
  const stage = agentStageOf(p)
  if (stage === 'booked') return isLive(p) ? 'On a call now' : `Call ${callWhen(p.scheduled_call_at, p.client_timezone)}`
  if (stage === 'cancelled') return `Cancelled ${monthDay(p.fulfillment_completed_at || p.updated_at)}`
  if (stage === 'confirmNumber') return 'Needs attention: confirm number'
  if (stage === 'needsAttention') return 'Needs attention: call & rebook'
  const n = p.call_attempts || 0
  return n ? `No answer · ${triesText(n)}` : 'No answer'
}

export function StatusPill({ tab }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 999,
      background: stVar(tab, 'tint'), color: stVar(tab), fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: stVar(tab) }} />
      {PIPELINE_TAB[tab].label}
    </span>
  )
}

export function StatusAvatar({ name, tab, size = 38, fontSize = 11.5 }) {
  return (
    <span style={{
      width: size, height: size, flexShrink: 0, borderRadius: '50%', background: stVar(tab, 'tint'), color: stVar(tab),
      fontSize, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {initialsOf(name)}
    </span>
  )
}

const isTyping = el => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
const SEARCH_ROWS = 8
const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

// "Find any client": searches every row it's given (the range/agent scope),
// whatever the selected tab. "/" focuses it while `hotkey` is on.
//
// Prompt 726 — a compact box: the search, then "Recently booked" (the three
// newest bookings, whatever their status; `recentRows` ignores the range).
export function ClientSearch({ rows, recentRows = rows, onOpen, hotkey = true, onBook }) {
  const input = useRef(null)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [hi, setHi] = useState(0)

  useEffect(() => {
    if (!hotkey) return undefined
    const onKey = e => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hotkey])

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => matchClients(rows, q), [rows, q])
  const recent = useMemo(
    () => [...recentRows].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 3),
    [recentRows],
  )
  const shown = matches.slice(0, SEARCH_ROWS)
  const open = !!q && focused
  const active = Math.min(hi, Math.max(0, shown.length - 1))

  const clear = () => { setQuery(''); setHi(0) }
  const pick = p => { clear(); input.current?.blur(); onOpen(p) }
  const onKeyDown = e => {
    if (e.key === 'Escape') { e.preventDefault(); clear(); input.current?.blur() }
    else if (e.key === 'ArrowDown' && shown.length) { e.preventDefault(); setHi(Math.min(active + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp' && shown.length) { e.preventDefault(); setHi(Math.max(active - 1, 0)) }
    else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); pick(shown[active]) }
  }

  return (
    <section className="ov-hero pl-find">
      <div>
        <h1 className="pl-find-h">Find any client</h1>
        <p className="pl-find-sub hidden sm:block">Searches everyone you&rsquo;ve booked, whatever their status.</p>
      </div>
      <div style={{ position: 'relative', marginTop: 16, flexShrink: 0 }}>
        <label className="ov-hero-search h-[50px] rounded-xl gap-[10px] pl-[14px] pr-2">
          <Search size={19} strokeWidth={2.2} style={{ flexShrink: 0 }} />
          <input
            ref={input} type="search" value={query} autoComplete="off" spellCheck={false}
            className="text-[15px]"
            placeholder="Name, phone, city or carrier" aria-label="Find any client"
            role="combobox" aria-expanded={open} aria-controls="ov-search-results" aria-autocomplete="list"
            aria-activedescendant={open && shown[active] ? `ov-search-${shown[active].id}` : undefined}
            onChange={e => { setQuery(e.target.value); setHi(0) }}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={onKeyDown}
          />
          <span className="hidden sm:inline-flex" aria-hidden="true" style={{
            height: 24, minWidth: 24, padding: '0 7px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.25)', flexShrink: 0,
            alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 12, color: 'rgba(255,255,255,0.75)',
          }}>
            /
          </span>
        </label>

        {open && (
          <div id="ov-search-results" role="listbox" aria-label="Matching clients" className="ov-card ov-pop pl-results"
            style={{ position: 'absolute', left: 0, top: 'calc(100% + 10px)', zIndex: 4, overflow: 'hidden', borderRadius: 18 }}>
            {shown.length ? (
              <>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 18px', fontSize: 12.5, fontWeight: 600,
                  color: 'var(--ov-mute)', background: 'var(--ov-table-head)', borderBottom: '1px solid var(--ov-line)',
                }}>
                  <span>{matches.length} client{matches.length === 1 ? '' : 's'} across every status</span>
                  <span className="hidden sm:inline">Enter to open</span>
                </div>
                {shown.map((p, i) => {
                  const tab = tabOf(p)
                  const name = fullName(p)
                  const phrase = searchPhrase(p)
                  return (
                    <div
                      key={p.id} id={`ov-search-${p.id}`} role="option" aria-selected={i === active}
                      className={`ov-row grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_150px_16px] items-center gap-3 sm:gap-4${i === active ? ' is-active' : ''}`}
                      style={{ padding: '12px 18px' }}
                      onMouseDown={e => e.preventDefault()} onMouseEnter={() => setHi(i)} onClick={() => pick(p)}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                        <StatusAvatar name={name} tab={tab} size={34} />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)', ...ellipsis }}>{name}</span>
                          <span className="hidden sm:block" style={{ fontSize: 12.5, color: 'var(--ov-mute)', ...ellipsis }}>{p.current_carrier || 'Carrier not noted'}</span>
                          <span className="block sm:hidden" style={{ fontSize: 12.5, color: 'var(--ov-mute)', ...ellipsis }}>{phrase}</span>
                        </span>
                      </span>
                      <span className="hidden sm:block" style={{ fontSize: 13, color: 'var(--ov-soft)', minWidth: 0, ...ellipsis }}>{phrase}</span>
                      <span style={{ justifySelf: 'end' }}><StatusPill tab={tab} /></span>
                      <ChevronRight size={16} strokeWidth={2} className="hidden sm:block" style={{ color: 'var(--ov-faint)' }} />
                    </div>
                  )
                })}
              </>
            ) : (
              <p style={{ margin: 0, padding: 20, fontSize: 14, color: 'var(--ov-mute)' }}>No client matches &ldquo;{query.trim()}&rdquo;</p>
            )}
          </div>
        )}
      </div>
      <p className="sm:hidden" style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--ov-hero-soft)' }}>
        Searches every status · {rows.length} client{rows.length === 1 ? '' : 's'}
      </p>

      <div className="pl-recent">
        <div className="pl-recent-hd">Recently booked{recent.length > 0 && <span>Click to open</span>}</div>
        {recent.length ? recent.map(p => {
          const tab = tabOf(p)
          const name = fullName(p)
          return (
            <button key={p.id} type="button" className="pl-rc" onClick={() => onOpen(p)} aria-label={`Open ${name}`}>
              <StatusAvatar name={name} tab={tab} size={32} fontSize={11.5} />
              <span className="nm">
                {name}
                <small>{[placeOf(p), p.current_carrier].filter(Boolean).join(' · ') || 'Carrier not noted'}</small>
              </span>
              <StatusPill tab={tab} />
            </button>
          )
        }) : (
          <div className="pl-recent-empty">
            Nobody booked yet
            {onBook && <button type="button" className="ov-hero-link" onClick={onBook}>Book a call</button>}
          </div>
        )}
      </div>
    </section>
  )
}

function RangeSwitch({ ranges, value, onChange, small, full }) {
  return (
    <div className="ov-range" role="group" aria-label="Booked in" style={full ? { display: 'grid', gridTemplateColumns: `repeat(${ranges.length}, 1fr)` } : undefined}>
      {ranges.map(r => (
        <button key={r.value} type="button" aria-pressed={value === r.value} onClick={() => onChange(r.value)}
          className={value === r.value ? 'is-on' : ''}
          style={{ height: small || full ? 30 : 32, padding: small || full ? '0 11px' : '0 14px', fontSize: small ? 12.5 : 13 }}>
          {r.label}
        </button>
      ))}
    </div>
  )
}

function PipelineBar({ counts, tab, height }) {
  const total = PIPELINE_TABS.reduce((s, t) => s + counts[t], 0)
  const radius = height > 8 ? 6 : height > 6 ? 5 : 3
  return (
    <div aria-hidden="true" style={{ display: 'flex', gap: height > 8 ? 4 : 3 }}>
      {total === 0 && <span style={{ flex: 1, height, borderRadius: radius, background: 'var(--ov-stub)' }} />}
      {PIPELINE_TABS.filter(t => counts[t] > 0).map(t => (
        <span key={t} style={{ flex: `${counts[t]} 1 0`, height, borderRadius: radius, background: stVar(t), opacity: t === tab ? 1 : 0.35 }} />
      ))}
    </div>
  )
}

// Counts per tab, plus the Needs attention split (Prompt 726): numbers to
// confirm vs clients the agent has to call.
function tabCounts(rows) {
  const counts = { booked: 0, noAnswer: 0, needs: 0, cancelled: 0 }
  let confirm = 0
  rows.forEach(p => {
    counts[tabOf(p)] += 1
    if (agentStageOf(p) === 'confirmNumber') confirm += 1
  })
  return { counts, confirm, call: counts.needs - confirm }
}

const tabSub = (t, { counts, confirm, call }) => (
  t !== 'needs' ? PIPELINE_TAB[t].meaning : counts.needs ? `${confirm} to confirm · ${call} to call` : 'All caught up'
)

// The "Your pipeline" box (Prompt 726, rows in 729): total, range switch, proportional bar,
// four plain status rows and the next Fulfillment call. `rows` are already
// range/agent scoped; `next` is the soonest booked call still ahead (ignores
// the range).
export function PipelineSummary({ rows, tab, range, ranges, onRange, agentFilter, next, onOpenNext, onBook }) {
  const split = useMemo(() => tabCounts(rows), [rows])
  const { counts } = split
  const total = rows.length
  const pct = n => (total ? Math.round((n / total) * 100) : 0)
  const tz = next?.client_timezone || undefined
  return (
    <section className="ov-card pl-pipe">
      <div className="pl-lbl">Your pipeline</div>
      <div className="pl-total">
        <b>{total}</b>client{total === 1 ? '' : 's'} · <em>{counts.cancelled} cancelled</em>
      </div>
      {agentFilter && <div style={{ marginTop: 12 }}>{agentFilter}</div>}
      <div style={{ marginTop: 12 }}><RangeSwitch ranges={ranges} value={range} onChange={onRange} full /></div>
      <div style={{ marginTop: 14 }}><PipelineBar counts={counts} tab={tab} height={6} /></div>
      <div className="pl-rows">
        {PIPELINE_TABS.map(t => (
          <div key={t} className="pl-row2">
            <i style={{ background: stVar(t) }} />
            <span className="l">{PIPELINE_TAB[t].label}</span>
            <span className="c">{counts[t]}</span>
            <span className="p">{pct(counts[t])}%</span>
          </div>
        ))}
      </div>
      <div className="pl-next">
        {next ? (
          <>
            <span className="pl-ntile">
              <small style={{ color: stVar('booked') }}>{new Date(next.scheduled_call_at).toLocaleDateString('en-US', { month: 'short', timeZone: tz }).toUpperCase()}</small>
              <b>{new Date(next.scheduled_call_at).toLocaleDateString('en-US', { day: 'numeric', timeZone: tz })}</b>
            </span>
            <span className="k">Next Fulfillment call<b>{fullName(next)}</b></span>
            <button type="button" className="ov-ghost" onClick={() => onOpenNext(next)}>Open</button>
          </>
        ) : (
          <>
            <span className="pl-ntile"><CalendarDays size={18} strokeWidth={1.9} style={{ color: 'var(--ov-faint)' }} /></span>
            <span className="k">Next Fulfillment call<b>No calls booked</b></span>
            {onBook && <button type="button" className="ov-primary" onClick={onBook}><CalendarPlus size={16} strokeWidth={2} aria-hidden="true" />Book a call</button>}
          </>
        )}
      </div>
    </section>
  )
}

// The list box (Prompt 726): the four status tabs in a row on top, then one
// list for the selected tab in a body that scrolls inside the box (from
// 1280px on a tall enough screen), so nothing on the page moves when the tab
// or the row count changes. Below 640px it's a scrolling row of chips and
// loose cards, with no box. `rows` are already range/agent scoped; `list` is
// the selected tab's sorted rows.
export function PipelineList({ rows, tab, onTab, list, ...status }) {
  const split = useMemo(() => tabCounts(rows), [rows])
  const { counts } = split
  const tabRefs = useRef({})
  const chipRefs = useRef({})
  // Phones: keep the selected chip inside the scrolling row.
  useEffect(() => {
    const chip = chipRefs.current[tab]
    const row = chip?.parentElement
    if (!row?.clientWidth) return
    const r = row.getBoundingClientRect()
    const c = chip.getBoundingClientRect()
    if (c.right > r.right) row.scrollLeft += c.right - r.right + 16
    else if (c.left < r.left) row.scrollLeft -= r.left - c.left + 16
  }, [tab])
  const onKeyDown = (e, refs) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = PIPELINE_TABS.indexOf(tab)
    const next = PIPELINE_TABS[(i + (e.key === 'ArrowRight' ? 1 : PIPELINE_TABS.length - 1)) % PIPELINE_TABS.length]
    onTab(next)
    refs.current[next]?.focus()
  }
  const select = t => { if (t !== tab) onTab(t) }

  return (
    <section className="ov-card pl-list">
      <div role="tablist" aria-label="Pipeline status" className="pl-tabs hidden sm:grid grid-cols-2 lg:grid-cols-4" onKeyDown={e => onKeyDown(e, tabRefs)}>
        {PIPELINE_TABS.map(t => {
          const on = t === tab
          return (
            <button
              key={t} ref={el => { tabRefs.current[t] = el }} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
              onClick={() => select(t)} className={`ov-tab pl-tab${on ? ' is-sel' : ''}${counts[t] ? '' : ' is-zero'}`}
              style={{ '--c': stVar(t), '--tint': stVar(t, 'tint'), '--edge': stVar(t, 'edge') }}
            >
              <span className="ic" aria-hidden="true">{(() => { const I = PIPELINE_TAB[t].icon; return <I size={18} strokeWidth={2} /> })()}</span>
              <span style={{ minWidth: 0 }}>
                <b className="nm">{PIPELINE_TAB[t].label}</b>
                <small>{tabSub(t, split)}</small>
              </span>
              <span className="n" style={{ ...OV_NUM, color: on ? 'var(--ov-hi)' : 'var(--c)' }}>{counts[t]}</span>
            </button>
          )
        })}
      </div>

      <div className="sm:hidden">
       <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div role="tablist" aria-label="Pipeline status" className="ov-chips flex -mx-4 px-4" style={{ gap: 8, overflowX: 'auto' }} onKeyDown={e => onKeyDown(e, chipRefs)}>
          {PIPELINE_TABS.map(t => {
            const on = t === tab
            return (
              <button
                key={t} ref={el => { chipRefs.current[t] = el }} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
                onClick={() => select(t)} className={`ov-tab pl-chip${on ? ' is-sel' : ''}`}
                style={{ '--c': stVar(t) }}
              >
                {(() => { const I = PIPELINE_TAB[t].icon; return <I size={16} strokeWidth={2} aria-hidden="true" /> })()}
                {PIPELINE_TAB[t].label}
                <span style={{ fontFamily: DISPLAY, fontWeight: 600 }}>{counts[t]}</span>
              </button>
            )
          })}
        </div>
        <span style={{ padding: '0 2px 4px', fontSize: 13, color: 'var(--ov-mute)' }}>{tabSub(tab, split)}</span>
       </div>
      </div>

      <div className="pl-body">
        <StatusList key={tab} tab={tab} rows={list} {...status} />
      </div>
    </section>
  )
}

const COLUMNS = {
  booked:    ['Client', 'Carrier', 'Fulfillment call', 'Status', ''],
  noAnswer:  ['Client', 'Carrier', 'Next try', 'Status', ''],
  needs:     ['Client', 'Carrier', 'What happened', '', ''],
  cancelled: ['Client', 'Carrier cancelled', 'Cancelled', 'Status', ''],
}
const PAGE = 10
const NEEDS_WHY = {
  confirmNumber: 'Two tries, no answer. Is their number right?',
  needsAttention: 'No reply to our texts. Call them and re-book.',
}
// Needs attention shows two groups (Prompt 726); a group with no rows is skipped.
const NEEDS_GROUPS = [
  {
    key: 'confirm', icon: Phone, title: 'Confirm the number',
    line: 'Fulfillment couldn’t get through. Check the number with the client and it goes back to No answer for more tries.',
    has: p => agentStageOf(p) === 'confirmNumber',
  },
  {
    key: 'call', icon: CalendarDays, title: 'Call and rebook',
    line: 'Texts and a retry call didn’t reach them. Call them on your own time and book a new call.',
    has: p => agentStageOf(p) !== 'confirmNumber',
  },
]

function CarrierCell({ p }) {
  return (
    <span style={{ minWidth: 0, fontSize: 14, color: p.current_carrier ? 'var(--ov-soft)' : 'var(--ov-mute)', ...ellipsis }}>
      {p.current_carrier || 'Not noted'}
    </span>
  )
}

// Prompt 724 — "Pensacola, FL · (602) 555-0184" under a client's name; rows
// booked before city/state just show the number.
function ClientSub({ p }) {
  const place = placeOf(p)
  const line = { display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--ov-mute)', ...ellipsis }
  if (!place) return <span style={line}>{p.client_phone || 'No number'}</span>
  return (
    <span style={{ ...line, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', whiteSpace: 'normal', overflow: 'visible', rowGap: 0 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%' }}>
        <MapPin size={12} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--ov-faint)' }} />
        <span style={ellipsis}>{place}</span>
      </span>
      <span style={{ display: 'inline-flex', gap: 6, whiteSpace: 'nowrap' }}>
        <span aria-hidden="true" style={{ color: 'var(--ov-faint)' }}>{'·'}</span>{p.client_phone || 'No number'}
      </span>
    </span>
  )
}

function DateTile({ iso, tz }) {
  if (!iso) return <span style={{ fontSize: 13, color: 'var(--ov-mute)' }}>No time booked</span>
  if (tz) return <ZonedDateTile iso={iso} tz={tz} />
  const d = new Date(iso)
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      <span className="ov-tile" style={{
        width: 44, height: 48, flexShrink: 0, boxSizing: 'border-box', borderRadius: 12, lineHeight: 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: stVar('booked') }}>{d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>
        <span style={{ marginTop: 4, fontFamily: DISPLAY, fontSize: 18, fontWeight: 600, color: 'var(--ov-hi)' }}>{d.getDate()}</span>
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ov-hi)', whiteSpace: 'nowrap' }}>{clockTime(iso)}</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--ov-mute)', whiteSpace: 'nowrap' }}>{weekdayDate(iso)}</span>
      </span>
    </span>
  )
}

// DateTile in the client's zone (Prompt 724).
function ZonedDateTile({ iso, tz }) {
  const d = new Date(iso)
  const z = { timeZone: tz }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      <span className="ov-tile" style={{
        width: 44, height: 48, flexShrink: 0, boxSizing: 'border-box', borderRadius: 12, lineHeight: 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: stVar('booked') }}>{d.toLocaleDateString('en-US', { month: 'short', ...z }).toUpperCase()}</span>
        <span style={{ marginTop: 4, fontFamily: DISPLAY, fontSize: 18, fontWeight: 600, color: 'var(--ov-hi)' }}>{d.toLocaleDateString('en-US', { day: 'numeric', ...z })}</span>
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ov-hi)', whiteSpace: 'nowrap' }}>{d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...z })}</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--ov-mute)', whiteSpace: 'nowrap' }}>{d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...z })}</span>
      </span>
    </span>
  )
}

function LiveLabel() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--ov-live)', whiteSpace: 'nowrap' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF4444', boxShadow: '0 0 0 4px rgba(239,68,68,0.2)' }} />On a call now
    </span>
  )
}

// A row's action: { label, icon, onClick, needs, solid }, a muted { note }, or
// null. Permission is the page's canMove (admin, or the agent's own client).
function rowAction(p, { canMove, onRebook, onConfirm }) {
  const stage = agentStageOf(p)
  const mine = canMove(p)
  if (stage === 'confirmNumber' && mine) return { label: 'Confirm number', onClick: () => onConfirm(p.id), needs: true, solid: true }
  if (stage === 'needsAttention' && mine && canRebook(p)) return { label: 'Rebook', onClick: () => onRebook(p.id), needs: true }
  return null
}

function ActionButton({ action, full }) {
  if (!action) return <span />
  if (action.note) return <span style={{ justifySelf: 'end', fontSize: 12.5, color: 'var(--ov-mute)', whiteSpace: 'nowrap' }}>{action.note}</span>
  const Icon = action.icon
  const look = action.solid
    ? { height: full ? 44 : 36, padding: '0 14px', fontSize: 13, fontWeight: 700, border: 'none', background: 'var(--ov-badge-bg)', color: 'var(--ov-badge-fg)' }
    : action.needs
      ? { height: full ? 44 : 36, padding: '0 14px', fontSize: 13, fontWeight: 700, border: `1px solid ${stVar('needs', 'edge')}`, background: stVar('needs', 'tint'), color: stVar('needs') }
      : { height: full ? 44 : 36, padding: '0 16px', fontSize: 13, fontWeight: 600 }
  return (
    <button type="button" onClick={e => { e.stopPropagation(); action.onClick() }} onKeyDown={e => e.stopPropagation()}
      className={action.needs ? 'ov-tab' : 'ov-ghost'}
      style={{
        justifySelf: 'end', borderRadius: full ? 999 : 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        whiteSpace: 'nowrap', cursor: 'pointer', ...(full ? { width: '100%' } : null), ...look,
      }}>
      {Icon && <Icon size={14} strokeWidth={2} />}{action.label}
    </button>
  )
}

// Centred in the list box, which keeps its size. On a phone (no box) it's a
// card of its own.
function EmptyState({ icon: Icon, tab, title, children, action }) {
  return (
    <div className="pl-empty ov-card">
      {Icon && <IconChip icon={Icon} color={stVar(tab)} tint={stVar(tab, 'tint')} size={44} radius={13} iconSize={20} />}
      {title && <b style={{ fontSize: 15, color: 'var(--ov-hi)' }}>{title}</b>}
      <p style={{ margin: 0, fontSize: title ? 13 : 14, color: 'var(--ov-mute)', maxWidth: 340 }}>{children}</p>
      {action}
    </div>
  )
}

// A group header band on Needs attention: amber icon tile, title + count, one
// grey line.
function NeedsGroupHead({ icon: Icon, title, count, line }) {
  return (
    <div className="pl-grp">
      <span className="ic"><Icon size={16} strokeWidth={2} /></span>
      <span style={{ minWidth: 0 }}>
        <b>{title}<span>{count}</span></b>
        <p>{line}</p>
      </span>
    </div>
  )
}

// The selected tab's list: a table from 1024px up, stacked cards below.
// `rows` arrive filtered and sorted. `emptyRange` ('week' | 'month') when
// nobody at all was booked in the range. Key it by tab so paging resets.
// Prompt 726 — the box, tabs and scrolling live in PipelineList; this is the
// body (sticky column row + rows, or cards).
export function StatusList({ tab, rows, now, showAgent, activeId, onOpen, onRebook, onConfirm, canMove, loading, emptyRange, onBook }) {
  const [limit, setLimit] = useState(PAGE)

  if (loading) return <EmptyState tab={tab}>Loading clients…</EmptyState>
  if (!rows.length) {
    if (emptyRange) return <EmptyState icon={CalendarX} tab={tab}>Nobody booked {emptyRange === 'week' ? 'this week' : 'this month'} yet.</EmptyState>
    if (tab === 'needs') {
      return (
        <EmptyState icon={Check} tab="cancelled" title="Nothing needs your attention">
          When a number needs confirming or a client needs a call from you, they’ll show up here.
        </EmptyState>
      )
    }
    if (tab === 'noAnswer') return <EmptyState icon={PhoneMissed} tab={tab}>No missed calls.</EmptyState>
    if (tab === 'cancelled') return <EmptyState icon={Inbox} tab={tab}>No cancellations yet.</EmptyState>
    return (
      <EmptyState icon={CalendarPlus} tab={tab} action={onBook && (
        <button type="button" className="ov-ghost" onClick={onBook}
          style={{ height: 40, padding: '0 18px', borderRadius: 999, fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
          <CalendarPlus size={15} strokeWidth={2} /> Book a call
        </button>
      )}>
        No calls waiting. Book one when your next client says yes.
      </EmptyState>
    )
  }

  const paged = tab === 'cancelled'
  const visible = paged ? rows.slice(0, limit) : rows
  const more = paged ? Math.min(PAGE, rows.length - visible.length) : 0
  const ctx = { canMove, onRebook, onConfirm }
  // Needs attention in its two groups; every other tab is one unlabelled group.
  const groups = tab === 'needs'
    ? NEEDS_GROUPS.map(g => ({ ...g, rows: rows.filter(g.has) })).filter(g => g.rows.length)
    : [{ key: 'all', rows: visible }]
  const rowProps = p => ({
    role: 'button', tabIndex: 0, 'aria-label': `Open ${fullName(p)}`,
    onClick: () => onOpen(p.id),
    onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p.id) } },
  })
  const chevron = <span style={{ justifySelf: 'end', display: 'flex' }}><ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--ov-faint)' }} /></span>
  const plain = { fontSize: 13.5, color: 'var(--ov-mute)' }

  const client = p => {
    const name = fullName(p)
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <StatusAvatar name={name} tab={tab} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)', ...ellipsis }}>{name}</span>
          <ClientSub p={p} />
          {showAgent && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ov-mute)', ...ellipsis }}>{p.agent?.full_name || '—'}</span>}
        </span>
      </span>
    )
  }

  const cells = p => {
    switch (tab) {
      case 'booked':
        return [
          <DateTile key="d" iso={p.scheduled_call_at} tz={p.client_timezone} />,
          <span key="s" style={plain}>{isLive(p) ? <LiveLabel /> : 'Waiting for Fulfillment'}</span>,
          <span key="c" style={{ display: 'flex', justifyContent: 'flex-end' }}>{chevron}</span>,
        ]
      case 'noAnswer':
        return [
          <span key="n" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 13, lineHeight: 1.4, color: 'var(--ov-soft)' }}>
            <RefreshCw size={15} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--ov-faint)' }} />{nextStep(p, now)}
          </span>,
          <span key="t" style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ov-hi)' }}>{triesText(p.call_attempts || 0)}</span>
            {lastOn(p, now) && <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--ov-mute)', whiteSpace: 'nowrap' }}>{lastOn(p, now)}</span>}
          </span>,
          <span key="c" style={{ display: 'flex', justifyContent: 'flex-end' }}>{chevron}</span>,
        ]
      case 'needs':
        return [
          <span key="w" style={{ gridColumn: '3 / 5', fontSize: 13.5, lineHeight: 1.45, color: 'var(--ov-soft)' }}>{NEEDS_WHY[agentStageOf(p)]}</span>,
          <ActionButton key="a" action={rowAction(p, ctx)} />,
        ]
      default:
        return [
          <span key="r" style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ov-hi)', whiteSpace: 'nowrap' }}>{monthDay(p.fulfillment_completed_at || p.updated_at)}</span>
            <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--ov-mute)', whiteSpace: 'nowrap' }}>Booked {monthDay(p.created_at)}</span>
          </span>,
          <span key="b" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600, color: stVar('cancelled'), whiteSpace: 'nowrap' }}>
            <Check size={15} strokeWidth={2.4} />Old policy cancelled
          </span>,
          <span key="c" style={{ display: 'flex', justifyContent: 'flex-end' }}>{chevron}</span>,
        ]
    }
  }

  // The status-specific line on a card.
  const cardLine = p => {
    if (tab === 'booked') return isLive(p) ? <LiveLabel /> : `Call ${callWhen(p.scheduled_call_at, p.client_timezone)}`
    if (tab === 'noAnswer') return [triesText(p.call_attempts || 0), lastOn(p, now), nextStep(p, now)].filter(Boolean).join(' · ')
    if (tab === 'needs') return NEEDS_WHY[agentStageOf(p)]
    return `Cancelled ${monthDay(p.fulfillment_completed_at || p.updated_at)} · booked ${monthDay(p.created_at)}`
  }

  const card = p => {
    const name = fullName(p)
    const action = rowAction(p, ctx)
    return (
      <div key={p.id} {...rowProps(p)} className="ov-tile ov-link"
        style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 14, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <StatusAvatar name={name} tab={tab} size={34} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ov-hi)', ...ellipsis }}>{name}</div>
            <div style={{ marginTop: 1, display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, fontSize: 12.5, color: 'var(--ov-mute)' }}>
              <Building2 size={13} strokeWidth={1.8} style={{ flexShrink: 0, color: 'var(--ov-faint)' }} />
              <span style={ellipsis}>{p.current_carrier || 'Not noted'}{showAgent ? ` · ${p.agent?.full_name || '—'}` : ''}</span>
            </div>
            {placeOf(p) && <PlaceLine location={placeOf(p)} size={13} style={{ marginTop: 1, gap: 5, fontSize: 12.5, color: 'var(--ov-mute)' }} />}
          </div>
          {!action?.onClick && <ChevronRight size={16} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--ov-faint)' }} />}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--ov-soft)' }}>{cardLine(p)}</div>
        {action?.onClick && <ActionButton action={action} full />}
      </div>
    )
  }

  return (
    <>
      <div className="hidden lg:block" style={{ flexShrink: 0 }}>
        <div className="pl-cols">
          {COLUMNS[tab].map((c, i) => <span key={i}>{c}</span>)}
        </div>
        {groups.map(g => (
          <div key={g.key}>
            {g.icon && <NeedsGroupHead icon={g.icon} title={g.title} count={g.rows.length} line={g.line} />}
            {g.rows.map(p => (
              <div key={p.id} {...rowProps(p)} className={`pl-row${activeId === p.id ? ' is-active' : ''}`}>
                {client(p)}
                <CarrierCell p={p} />
                {cells(p)}
              </div>
            ))}
          </div>
        ))}
        {more > 0 && (
          <button type="button" onClick={() => setLimit(limit + PAGE)} className="ov-row"
            style={{ width: '100%', height: 48, border: 'none', borderTop: '1px solid var(--ov-line)', background: 'transparent', fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mute)' }}>
            Show {more} more
          </button>
        )}
      </div>

      <div className="lg:hidden" style={{ flexShrink: 0 }}>
        {groups.map(g => (
          <div key={g.key}>
            {g.icon && <NeedsGroupHead icon={g.icon} title={g.title} count={g.rows.length} line={g.line} />}
            <div className="pl-cards">{g.rows.map(card)}</div>
          </div>
        ))}
        {more > 0 && (
          <div className="pl-cards">
            <button type="button" onClick={() => setLimit(limit + PAGE)} className="ov-ghost sm:col-span-2"
              style={{ height: 48, borderRadius: 999, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
              Show {more} more
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ── Client drawer ──────────────────────────────────────────────────────────

// Right-side panel (a full-screen sheet below 640px) over a scrim. Esc, the
// scrim or the close button slide it out and then call onClose; body scroll is locked while open.
// `children` is the scrolling body, `footer` the pinned action area.
// Prompt 733: Activity reuses it read-only: `name` and `meta` (one muted line) replace the
// name from `p` and the call / message buttons, and `p` / `tab` may be null (a client
// whose row isn't loaded).
export function ClientDrawer({ p, tab, name: nameProp, meta, onClose, onMessage, messageLabel, footer, children }) {
  const closeBtn = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const timer = useRef(null)
  // The X, the scrim and Esc slide the drawer out, then tell the parent
  // (Prompt 729). Repeat calls while sliding do nothing; reduced motion closes at once.
  const finish = useRef(() => { clearTimeout(timer.current); onCloseRef.current() })
  const requestClose = useRef(() => {
    if (closingRef.current) return
    closingRef.current = true
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { finish.current(); return }
    setClosing(true)
    timer.current = setTimeout(finish.current, 260)
  })
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = e => { if (e.key === 'Escape') requestClose.current() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); clearTimeout(timer.current) }
  }, [])
  useEffect(() => { closeBtn.current?.focus() }, [])

  const name = nameProp ?? fullName(p)
  const btn = {
    height: 46, boxSizing: 'border-box', borderRadius: 999, fontSize: 14.5, minWidth: 0, textDecoration: 'none',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, whiteSpace: 'nowrap', overflow: 'hidden', padding: '0 12px',
  }
  return createPortal(
    <>
      <div className={`ov-scrim${closing ? ' is-closing' : ''}`} onClick={() => requestClose.current()} aria-hidden="true" />
      <aside
        className={`ov-drawer${closing ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-label={name}
        onAnimationEnd={e => { if (closing && e.target === e.currentTarget) finish.current() }}
      >
        <div className="px-5 sm:px-[26px]" style={{
          paddingTop: 26, paddingBottom: 22, borderBottom: '1px solid var(--ov-line)',
          ...(tab ? { background: `radial-gradient(ellipse 90% 80% at 100% 0%, ${stVar(tab, 'tint')} 0%, transparent 70%)` } : null),
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }}>Client</span>
            <button ref={closeBtn} type="button" onClick={() => requestClose.current()} aria-label="Close" className="ov-ghost"
              style={{ width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <X size={16} strokeWidth={2} />
            </button>
          </div>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            {tab
              ? <StatusAvatar name={name} tab={tab} size={56} fontSize={15} />
              : (
                <span style={{ width: 56, height: 56, flexShrink: 0, borderRadius: '50%', background: 'var(--ov-stub)', color: 'var(--ov-mid)', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {initialsOf(name)}
                </span>
              )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15, color: 'var(--ov-hi)', overflowWrap: 'anywhere' }}>{name}</div>
              {tab && <div style={{ marginTop: 8 }}><StatusPill tab={tab} /></div>}
              {meta && <div style={{ marginTop: 6, fontSize: 13.5, color: 'var(--ov-mute)', overflowWrap: 'anywhere' }}>{meta}</div>}
            </div>
          </div>
          {meta === undefined && (
            <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              {p.client_phone ? (
                <a href={`tel:${digits(p.client_phone)}`} className="ov-solid" style={btn}>
                  <Phone size={16} strokeWidth={2.2} style={{ flexShrink: 0 }} />{p.client_phone}
                </a>
              ) : (
                <span className="ov-ghost" style={{ ...btn, fontWeight: 600, opacity: 0.6 }}>No number</span>
              )}
              <button type="button" onClick={onMessage} className="ov-ghost" style={{ ...btn, fontWeight: 600, cursor: 'pointer' }}>
                <MessageSquare size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
                <span className="sm:hidden">Message</span>
                <span className="hidden sm:inline" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{messageLabel}</span>
              </button>
            </div>
          )}
        </div>
        <div className="scrollbar-thin px-5 sm:px-[26px]" style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingTop: 22, paddingBottom: 22, display: 'flex', flexDirection: 'column', gap: 22 }}>
          {children}
        </div>
        {footer && (
          <div className="px-5 sm:px-[26px]" style={{ paddingTop: 18, paddingBottom: 'calc(24px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--ov-line)' }}>
            {footer}
          </div>
        )}
      </aside>
    </>,
    document.body,
  )
}

export function InfoTile({ label, value }) {
  return (
    <div className="ov-tile" style={{ padding: '14px 16px', borderRadius: 14, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ov-mute)' }}>{label}</div>
      <div style={{ marginTop: 5, fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: 1.25, color: 'var(--ov-hi)', overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  )
}

// The status sentence on its tint; a live call gets the red pulse instead.
export function StatusNote({ tab, live, children }) {
  const Icon = PIPELINE_TAB[tab].icon
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 14,
      background: live ? 'rgba(239,68,68,0.12)' : stVar(tab, 'tint'),
    }}>
      <span style={{ display: 'flex', alignItems: 'center', height: 21, flexShrink: 0, color: live ? 'var(--ov-live)' : stVar(tab) }}>
        {live ? <LiveDot /> : <Icon size={17} strokeWidth={2} />}
      </span>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--ov-hi)' }}>{children}</p>
    </div>
  )
}

// Vertical timeline. Each step: { label, at, done }. The first step not done
// is the current one (the status icon on its tint); later ones are dashed.
// Prompt 718 (Activity's client story) adds, all optional: a step's `sub`
// replaces its callWhen(at) line, its `tone` ({ fg, tint, edge }) recolours
// it when current or highlighted, `currentIcon` swaps the status icon, and
// `highlight` boxes one step with a "Selected" tag. Without them it renders
// exactly as My Pipeline's drawer.
export function Journey({ steps, tab, highlight = -1, currentIcon }) {
  const current = steps.findIndex(s => !s.done)
  const Icon = currentIcon || PIPELINE_TAB[tab].icon
  return (
    <div>
      <div style={{ marginBottom: 14, fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }}>Journey</div>
      {steps.map((s, i) => {
        const state = s.done ? 'done' : i === current ? 'current' : 'future'
        const last = i === steps.length - 1
        const tone = s.tone || { fg: stVar(tab), tint: stVar(tab, 'tint'), edge: stVar(tab, 'edge') }
        const hi = i === highlight
        const lift = hi ? { position: 'relative' } : null
        const sub = s.sub || (s.at && callWhen(s.at))
        return (
          <div key={i} style={{ display: 'flex', gap: 14, ...lift }}>
            {hi && (
              <span aria-hidden="true" style={{
                position: 'absolute', left: -12, right: -12, top: -8, bottom: last ? -8 : 6, borderRadius: 12,
                background: tone.tint, boxShadow: `inset 0 0 0 1px ${tone.edge}`,
              }} />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', ...lift }}>
              <span style={{
                width: 32, height: 32, flexShrink: 0, boxSizing: 'border-box', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                ...(state === 'done' ? { background: stVar('cancelled', 'tint'), color: stVar('cancelled') }
                  : state === 'current' ? { background: tone.tint, color: tone.fg }
                    : { border: '2px dashed var(--ov-faint)' }),
                ...(hi ? { boxShadow: `0 0 0 3px ${tone.edge}` } : null),
              }}>
                {state === 'done' ? <Check size={15} strokeWidth={2.2} /> : state === 'current' ? <Icon size={15} strokeWidth={2.2} /> : null}
              </span>
              {!last && <span style={{ flex: 1, width: 2, minHeight: 26, margin: '4px 0', background: 'var(--ov-line)' }} />}
            </div>
            <div style={{ paddingTop: 5, paddingBottom: last ? 0 : 14, minWidth: 0, ...lift }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: state === 'future' ? 'var(--ov-mute)' : 'var(--ov-hi)' }}>
                {s.label}
                {hi && (
                  <span style={{
                    marginLeft: 8, height: 20, padding: '0 8px', borderRadius: 999, verticalAlign: 'middle',
                    display: 'inline-flex', alignItems: 'center', background: tone.fg, color: 'var(--ov-on-kind)', fontSize: 11, fontWeight: 700,
                  }}>Selected</span>
                )}
              </div>
              {sub && state !== 'future' && <div style={{ marginTop: 2, fontSize: 13, color: 'var(--ov-mute)' }}>{sub}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Prompt 718 — Activity on the v16 language ────────────────────────────
// A coloured day hero with edge arrows, the activity box (Prompt 733: display
// only, a bar and plain status rows), the full-width feed as a timeline grouped
// by part of day, and a read-only client drawer (ClientDrawer's shell) that
// reuses Journey. Event kinds (colours, icons) are in lib/activityKinds.
// Each day-dependent block sits in an .ov-slide-frame whose keyed child
// carries data-day-slide; Activity.jsx animates the day change through them.

function DayArrow({ dir, disabled, onClick }) {
  const Icon = dir === 'prev' ? ChevronLeft : ChevronRight
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={dir === 'prev' ? 'Previous day' : 'Next day'}
      className="ov-day-arrow w-11 h-11 sm:w-14 sm:h-14">
      <Icon size={22} strokeWidth={2.2} />
    </button>
  )
}

// The coloured top section: ‹ | tag, date, summary, Pick a date | ›.
// `picker` (the month picker popover) is anchored under Pick a date, which
// carries data-pick-toggle so the popover's outside-click ignores it.
export function DayHero({ dayKey, slideClass, tag, dateLong, dateShort, summary, summaryShort, canNext, onPrev, onNext, pickOpen, onTogglePick, picker }) {
  return (
    <section className="ov-hero flex items-center gap-[10px] sm:gap-6 px-3 py-[18px] sm:px-7 sm:py-[30px]" style={{ position: 'relative', zIndex: 3 }}>
      <DayArrow dir="prev" onClick={onPrev} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div className="ov-slide-frame" style={{ width: '100%' }}>
          <div key={dayKey} data-day-slide="" className={slideClass}>
            <div className="hidden sm:flex" style={{ flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <span className="ov-hero-chip">
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ov-hero-dot)' }} />{tag}
              </span>
              <h1 style={{ margin: 0, fontFamily: DISPLAY, fontSize: 40, fontWeight: 600, lineHeight: 1.05, letterSpacing: '-0.035em', color: '#fff' }}>{dateLong}</h1>
              <div style={{ fontSize: 15.5, color: 'var(--ov-hero-soft)' }}>{summary}</div>
            </div>
            <div className="sm:hidden">
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ov-hero-soft)' }}>{tag}</div>
              <h1 style={{ margin: 0, fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.02em', color: '#fff' }}>{dateShort}</h1>
              <div style={{ fontSize: 12.5, color: 'var(--ov-hero-soft)' }}>{summaryShort}</div>
            </div>
          </div>
        </div>
        <div className="mt-1 sm:mt-[14px]" style={{ position: 'relative' }}>
          <button type="button" data-pick-toggle="" onClick={onTogglePick} aria-haspopup="dialog" aria-expanded={pickOpen}
            className="ov-hero-link hidden sm:inline-flex"
            style={{ height: 34, padding: '0 14px', borderRadius: 999, alignItems: 'center', gap: 7, fontSize: 13.5 }}>
            <CalendarDays size={15} strokeWidth={2} /> Pick a date
          </button>
          <button type="button" data-pick-toggle="" onClick={onTogglePick} aria-haspopup="dialog" aria-expanded={pickOpen} aria-label="Pick a date"
            className="ov-hero-link flex sm:hidden"
            style={{ width: 44, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' }}>
            <CalendarDays size={18} strokeWidth={2} />
          </button>
          {pickOpen && picker}
        </div>
      </div>
      <DayArrow dir="next" disabled={!canNext} onClick={onNext} />
    </section>
  )
}

function KindBar({ counts, height }) {
  const total = ACTIVITY_ROWS.reduce((s, k) => s + counts[k], 0)
  return (
    <div aria-hidden="true" style={{ display: 'flex', gap: height > 8 ? 4 : 3 }}>
      {total === 0 && <span style={{ flex: 1, height, borderRadius: 6, background: 'var(--ov-stub)' }} />}
      {ACTIVITY_ROWS.filter(k => counts[k] > 0).map(k => (
        <span key={k} style={{ flex: `${counts[k]} 1 0`, height, borderRadius: 6, background: rowTone(k).fg }} />
      ))}
    </div>
  )
}

// "Today's activity" (Prompt 733: display only, like "Your pipeline"): the total,
// a bar sized by status and one plain row per status with its count and share of
// the day. Nothing in it is a button. `counts` is keyed by ACTIVITY_ROWS; the
// Needs attention row shows only when it has something in it.
export function ActivityBox({ dayKey, slideClass, title, counts }) {
  const total = ACTIVITY_ROWS.reduce((s, k) => s + counts[k], 0)
  const pct = n => (total ? Math.round((n / total) * 100) : 0)
  return (
    <div className="ov-card p-4 sm:px-[22px] sm:pt-[22px] sm:pb-5">
      <div className="ov-slide-frame">
        <div key={dayKey} data-day-slide="" className={slideClass} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="sm:px-1" style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mute)' }}>{title}</span>
            <span style={{ marginLeft: 'auto', ...OV_NUM, fontSize: 30, letterSpacing: '-0.03em' }}>{total}</span>
            <span style={{ fontSize: 14.5, color: 'var(--ov-soft)' }}>
              event{total === 1 ? '' : 's'}
              {counts.cancelled > 0 && <span className="hidden sm:inline"> · <span style={{ fontWeight: 600, color: 'var(--ov-st-cancelled)' }}>{counts.cancelled} cancelled</span></span>}
            </span>
          </div>
          <div className="sm:px-1"><KindBar counts={counts} height={10} /></div>
          <div className="ov-actrows sm:px-1">
            {ACTIVITY_ROWS.filter(k => k !== 'needs' || counts.needs > 0).map(k => (
              <div key={k} className={`pl-row2${counts[k] ? '' : ' is-zero'}`}>
                <i style={{ background: rowTone(k).fg }} />
                <span className="l">{rowMeta(k).label}</span>
                <span className="c">{counts[k]}</span>
                <span className="p">{pct(counts[k])}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// One feed event: a button that opens that client's drawer. The pill is the status the
// event counts under (item.row), so a Moved or Edited event shows where the client is now;
// the node on the line keeps the event's own icon and colour.
function EventRow({ item, on, linked, showAgent, onOpen }) {
  const t = kindTone(item.kind)
  const pt = rowTone(item.row)
  const Icon = EVENT_ICON[eventIconKey(item)]
  const time = new Date(item.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const [clock, ampm] = time.split(/\s+/)
  return (
    <button type="button" aria-haspopup="dialog" onClick={() => onOpen(item)}
      className={`ov-event${on ? ' is-on' : ''} w-full flex items-start gap-3 sm:gap-4 px-2 py-3 sm:px-4 sm:py-[14px]`}
      style={{ position: 'relative', '--ev-tint': t.tint, ...(on ? { boxShadow: `inset 0 0 0 1px ${t.edge}` } : null) }}>
      {linked && <span aria-hidden="true" className="hidden sm:block" style={{ position: 'absolute', left: 105, top: 50, bottom: -14, width: 2, background: 'var(--ov-line)' }} />}
      <span className="hidden sm:block" style={{ width: 58, flexShrink: 0, paddingTop: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 600, color: 'var(--ov-hi)' }}>{clock}</span>
        <span style={{ marginLeft: 3, fontSize: 11, fontWeight: 600, color: 'var(--ov-mute)' }}>{ampm}</span>
      </span>
      <span className="w-8 h-8 sm:w-[34px] sm:h-[34px]" style={{
        position: 'relative', zIndex: 1, flexShrink: 0, borderRadius: '50%', background: t.tint, color: t.fg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 0 0 4px var(--ov-page)${on ? `, 0 0 0 6px ${t.edge}` : ''}`,
      }}>
        <Icon size={16} strokeWidth={2.2} />
      </span>
      <span style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ minWidth: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)', ...ellipsis }}>
            {item.client}
            {showAgent && item.agent && <span style={{ fontWeight: 500, color: 'var(--ov-mute)' }}> · {item.agent}</span>}
          </span>
          <span className="hidden sm:inline-flex" style={{
            flexShrink: 0, alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 999,
            background: pt.tint, color: pt.fg, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: pt.fg }} />{rowMeta(item.row).pill}
          </span>
          <span className="sm:hidden" style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--ov-mute)', whiteSpace: 'nowrap' }}>{time}</span>
        </span>
        <span style={{ display: 'block', marginTop: 3, fontSize: 13.5, lineHeight: 1.45, color: 'var(--ov-soft)' }}>{item.text}</span>
      </span>
      <ChevronRight size={18} strokeWidth={2} aria-hidden="true" style={{ alignSelf: 'center', flexShrink: 0, color: 'var(--ov-faint)' }} />
    </button>
  )
}

// Centred empty/loading/error note for the feed, with an optional icon chip.
export function FeedNote({ icon, tone, error, children }) {
  return (
    <div style={{ padding: 48, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
      {icon && <IconChip icon={icon} color={tone.fg} tint={tone.tint} size={36} radius={11} iconSize={18} />}
      <p style={{ margin: 0, maxWidth: 360, fontSize: 14, lineHeight: 1.5, color: error ? 'var(--danger)' : 'var(--ov-mute)' }}>{children}</p>
    </div>
  )
}

// The day's events as a timeline, grouped by part of day (newest first).
// `groups`: [{ key, label, icon, items }]; `note` replaces them when set.
// Touch handlers (the phone swipe) go on the card.
export function ActivityFeed({ dayKey, slideClass, groups, note, activeKey, onOpen, showAgent, ...touch }) {
  return (
    <section className="ov-card px-3 py-[6px] sm:py-4" style={{ minWidth: 0 }} aria-label="Events" {...touch}>
      <div className="ov-slide-frame">
        <div key={dayKey} data-day-slide="" className={slideClass}>
          {note || groups.map((g, gi) => {
            const GroupIcon = g.icon
            return (
              <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div className="px-1 sm:px-4" style={{
                  display: 'flex', alignItems: 'center', gap: 8, paddingTop: gi ? 14 : 6, paddingBottom: 6,
                  fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)',
                }}>
                  <GroupIcon size={15} strokeWidth={2} />{g.label}
                </div>
                {g.items.map((item, i) => (
                  <EventRow key={item.key} item={item} on={item.key === activeKey} linked={i < g.items.length - 1} showAgent={showAgent} onOpen={onOpen} />
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// One sentence for where the client stands now, beside the status pill.
function storyStatus(p, now) {
  const tab = tabOf(p)
  if (tab === 'booked') {
    if (isLive(p)) return 'On a call now'
    return p.scheduled_call_at ? `Fulfillment calls ${callAt(p.scheduled_call_at, p.client_timezone)}` : 'Waiting for Fulfillment'
  }
  if (tab === 'noAnswer') return nextStep(p, now)
  if (tab === 'needs') return NEEDS_WHY[agentStageOf(p)]
  return `Old policy cancelled ${monthDay(p.fulfillment_completed_at || p.updated_at)}`
}

// The clicked event's client (Prompt 733: a read-only drawer on ClientDrawer's shell, replacing
// the old Client story box): who they are and where they stand, the checked Journey built from
// every event, and one button to My Pipeline. `p` is their current row (null if it isn't
// loaded, e.g. an admin looking at a test row: then just the name, no status line).
export function ActivityDrawer({ p, name, agentName, steps, highlight, currentIcon, loading, now, onOpenPipeline, onClose }) {
  const tab = p ? tabOf(p) : null
  const meta = [p?.current_carrier, p?.client_phone, agentName].filter(Boolean).join(' · ')
  return (
    <ClientDrawer
      p={p} tab={tab} name={name} meta={meta} onClose={onClose}
      footer={(
        <button type="button" onClick={onOpenPipeline} className="ov-solid" style={{
          width: '100%', height: 50, borderRadius: 999, fontSize: 15, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          Go to My Pipeline <ArrowRight size={16} strokeWidth={2.2} />
        </button>
      )}
    >
      {p && (
        <div className="ov-well" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 12 }}>
          <StatusPill tab={tab} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--ov-soft)' }}>{storyStatus(p, now)}</span>
        </div>
      )}
      {steps.length
        ? <Journey steps={steps} tab={tab || 'noAnswer'} highlight={highlight} currentIcon={currentIcon} />
        : <p style={{ margin: 0, padding: '24px 0', textAlign: 'center', fontSize: 14, color: 'var(--ov-mute)' }}>{loading ? 'Loading…' : 'No history for this client yet.'}</p>}
    </ClientDrawer>
  )
}

// ── Prompt 719 — Billing ────────────────────────────────────────────────────

// Days left in the paid week (or the grace window) as a ring that empties
// toward the date. Sits on the hero, so it's white in both themes.
export function RenewalRing({ days, total = 7, label, todayLabel, size = 148 }) {
  const r = size / 2 - 10
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(1, days / total))
  const big = size >= 148
  const today = days === 0
  return (
    <div role="img" aria-label={today ? `Today: ${todayLabel}` : `${days} ${label}`} style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block', transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="10" />
        {p > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#FFFFFF" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${p * c} ${c}`} />
        )}
      </svg>
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <span style={{ fontFamily: DISPLAY, fontSize: today ? (big ? 30 : 22) : (big ? 44 : 32), fontWeight: 600, lineHeight: 1, letterSpacing: '-0.03em', color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>
          {today ? 'Today' : days}
        </span>
        <span style={{ marginTop: 4, maxWidth: size - 36, fontSize: big ? 12.5 : 11, fontWeight: 600, lineHeight: 1.25, color: 'var(--ov-hero-soft)' }}>
          {today ? todayLabel : label}
        </span>
      </div>
    </div>
  )
}

// This week's bookings against the plan's cap: one segment per booking the
// plan allows. `cap` null = no cap (number only, no meter).
export function BookingMeter({ used, cap, range, note, paused, upgrade }) {
  const capped = cap != null
  const full = capped && used >= cap
  const left = capped ? Math.max(0, cap - used) : null
  return (
    <section className="ov-card ov-bill-meter" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <IconChip icon={CalendarPlus} color="var(--ov-st-booked)" tint="var(--ov-st-booked-tint)" />
        <h2 style={{ ...OV_TITLE, flex: 1, fontSize: 18 }}>This week's bookings</h2>
        {range && <span className="hidden sm:inline" style={{ fontSize: 13, color: 'var(--ov-mute)', whiteSpace: 'nowrap' }}>{range}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="ov-bill-num" style={{ ...OV_NUM, letterSpacing: '-0.035em' }}>{used}</span>
        <span style={{ fontSize: 18, fontWeight: 500, color: 'var(--ov-mute)' }}>{capped ? `of ${cap} used` : 'this week'}</span>
        {capped && (
          <span style={{
            marginLeft: 'auto', alignSelf: 'center', height: 28, padding: '0 12px', borderRadius: 999, boxSizing: 'border-box',
            display: 'inline-flex', alignItems: 'center', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
            background: full ? 'var(--ov-st-needs-tint)' : 'var(--ov-st-cancelled-tint)',
            color: full ? 'var(--ov-st-needs)' : 'var(--ov-st-cancelled)',
          }}>
            {full ? 'Limit reached' : `${left} left`}
          </span>
        )}
      </div>
      {capped && cap > 0 && (
        <div aria-hidden="true" style={{ display: 'flex', gap: 4 }}>
          {Array.from({ length: cap }, (_, i) => (
            <span key={i} style={{
              flex: '1 1 0', height: 12, borderRadius: 4,
              background: full ? 'var(--ov-st-needs)' : i < used ? 'var(--ov-st-booked)' : 'var(--ov-stub)',
            }} />
          ))}
        </div>
      )}
      <div style={{ fontSize: 13.5, color: 'var(--ov-mute)' }}>{note}</div>
      {paused && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: -6 }}>
          <span style={{ flex: '1 1 220px', fontSize: 13.5, fontWeight: 600, color: 'var(--ov-st-needs)' }}>{paused}</span>
          {upgrade && (
            <button type="button" className="ov-ghost" onClick={upgrade.onClick} disabled={upgrade.disabled} style={{ height: 40, padding: '0 16px', borderRadius: 999, fontSize: 13.5, fontWeight: 600 }}>
              {upgrade.label}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function PlanFact({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--ov-soft)' }}>
      <span style={{
        width: 20, height: 20, flexShrink: 0, borderRadius: '50%', background: 'var(--ov-st-cancelled-tint)', color: 'var(--ov-st-cancelled)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Check size={11} strokeWidth={3} />
      </span>
      {children}
    </div>
  )
}

// One plan (a row of agent_billing_tiers). `big` = the no-plan page's larger
// card; `pick` = the highlighted one; `footer` = its button and notes.
export function PlanCard({ tier, price, big, pick, tag, sub, footer, className = '' }) {
  const capped = tier.weekly_cap != null
  return (
    <div className={`ov-card${pick ? ' is-pick' : ''} ${className}`} style={{
      flex: big ? '1 1 300px' : '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column',
      gap: big ? 18 : 16, padding: big ? '28px 28px 24px' : '24px 24px 20px', borderRadius: big ? 22 : 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ ...OV_TITLE, fontSize: big ? 22 : 19 }}>{tier.name}</span>
        {tag}
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ ...OV_NUM, fontSize: big ? 52 : 38, letterSpacing: big ? '-0.035em' : '-0.03em' }}>{price}</span>
          <span style={{ fontSize: big ? 15 : 14, color: 'var(--ov-mute)' }}>/ week</span>
        </div>
        {sub && <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--ov-mute)' }}>{sub}</div>}
      </div>
      <div className="ov-box" style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: big ? '14px 16px' : '12px 14px', borderRadius: big ? 14 : 12 }}>
        {capped ? (
          <>
            <span style={{ ...OV_NUM, fontSize: big ? 28 : 22 }}>{tier.weekly_cap}</span>
            <span style={{ fontSize: big ? 14 : 13.5, color: 'var(--ov-mute)' }}>bookings a week</span>
          </>
        ) : (
          <span style={{ ...OV_NUM, fontSize: big ? 22 : 18 }}>No weekly cap</span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: big ? 11 : 10 }}>
        <PlanFact>{capped ? `Up to ${tier.weekly_cap} bookings a week` : 'No limit on bookings'}</PlanFact>
        <PlanFact>Booking count resets every Monday</PlanFact>
        <PlanFact>Cancel anytime, keep access through your paid week</PlanFact>
      </div>
      {footer && <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>{footer}</div>}
    </div>
  )
}

const BILLING_FACTS = [
  { icon: CreditCard, title: 'Billed weekly', line: "Your card is charged on the same day each week, for that week's access." },
  { icon: User, title: 'One limit per account', line: 'Bookings count for the whole login, however many people use it.' },
  { icon: ShieldCheck, title: 'Cancel anytime', line: 'You keep access through the end of the week you paid for.' },
]

export function BillingFacts() {
  return (
    <section aria-label="How billing works" className="ov-card" style={{ display: 'flex', gap: 22, flexWrap: 'wrap', padding: '22px 24px' }}>
      {BILLING_FACTS.map(({ icon: Icon, title, line }) => (
        <div key={title} style={{ flex: '1 1 220px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span className="ov-box" style={{ width: 36, height: 36, flexShrink: 0, boxSizing: 'border-box', borderRadius: 11, color: 'var(--ov-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={17} strokeWidth={2} />
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ov-hi)' }}>{title}</div>
            <div style={{ marginTop: 2, fontSize: 13, lineHeight: 1.45, color: 'var(--ov-mute)' }}>{line}</div>
          </div>
        </div>
      ))}
    </section>
  )
}

// ── Prompt 720 — Settings on the v16 language ──────────────────────────────
// The section menu (side column on desktop, drill-in rows on a phone), the
// card every section is made of, the 6-digit code boxes shared by two-step
// setup / turn-off / sign-in, and the password strength bar. Classes are the
// .ov-set-* block in index.css.

// items: [{ key, label, sub, icon }]. `phone` draws rows with a chevron.
export function SettingsNav({ items, active, onPick, phone }) {
  return (
    <nav aria-label="Settings sections" className={`ov-card ov-set-nav${phone ? ' is-phone' : ''}`}>
      {items.map(({ key, label, sub, icon: Icon }) => {
        const on = !phone && key === active
        return (
          <button key={key} type="button" onClick={() => onPick(key)} aria-current={on ? 'page' : undefined}
            className={`ov-set-item${on ? ' is-on' : ''}`}>
            <span className="ov-set-ico"><Icon size={17} strokeWidth={2} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: phone ? 15 : 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>{label}</span>
              <span style={{ display: 'block', marginTop: 1, fontSize: phone ? 13 : 12.5, color: 'var(--ov-mute)' }}>{sub}</span>
            </span>
            {phone && <ChevronRight size={18} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--ov-faint)' }} />}
          </button>
        )
      })}
    </nav>
  )
}

// A status chip: tone 'on' (green), 'off' (neutral) or 'warn'.
export function SettingsChip({ tone = 'off', children }) {
  return <span className={`ov-set-chip is-${tone}`}><i />{children}</span>
}

// One Settings card: a 40px icon tile, title, one-line description and an
// optional right-hand chip or button, then the body.
export function SettingsCard({ icon: Icon, title, sub, right, children, gap = 18, label }) {
  return (
    <section className="ov-card ov-set-card" aria-label={label || title} style={{ gap }}>
      <div className="ov-set-head">
        <span className="ov-set-tile"><Icon size={19} strokeWidth={2} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ ...OV_TITLE, fontSize: 18 }}>{title}</h2>
          {sub && <p style={{ margin: '3px 0 0', fontSize: 13.5, lineHeight: 1.45, color: 'var(--ov-mute)' }}>{sub}</p>}
        </div>
        {right && <div className="ov-set-right">{right}</div>}
      </div>
      {children}
    </section>
  )
}

// Six one-digit boxes. Typing advances, Backspace steps back, a paste (or an
// authenticator's autofill into any box) fills all six. `value` is a string
// of up to 6 digits.
export function CodeBoxes({ value, onChange, onComplete, autoFocus, disabled, invalid, height = 56, label = '6-digit code' }) {
  const refs = useRef([])
  const digitsOf = s => (s || '').replace(/\D/g, '').slice(0, 6)
  const cur = digitsOf(value)
  useEffect(() => { if (autoFocus) refs.current[Math.min(cur.length, 5)]?.focus() }, [autoFocus]) // eslint-disable-line react-hooks/exhaustive-deps

  function set(next) {
    const d = digitsOf(next)
    onChange(d)
    refs.current[Math.min(d.length, 5)]?.focus()
    if (d.length === 6) onComplete?.(d)
  }
  function onInput(i, e) {
    let typed = e.target.value.replace(/\D/g, '')
    if (!typed) return
    // Typed next to a digit already in the box: keep only the new one.
    if (cur[i] && typed.length === 2) typed = typed[0] === cur[i] ? typed[1] : typed[0]
    // Several digits at once = a paste or autofill: take them from this box on.
    if (typed.length > 1) return set(cur.slice(0, i) + typed)
    set(cur.slice(0, i) + typed + cur.slice(i + 1))
  }
  function onKey(i, e) {
    if (e.key === 'Backspace') {
      e.preventDefault()
      const at = i < cur.length ? i : cur.length - 1
      if (at < 0) return
      onChange(cur.slice(0, at) + cur.slice(at + 1))
      refs.current[Math.max(at, 0)]?.focus()
    } else if (e.key === 'ArrowLeft') refs.current[Math.max(i - 1, 0)]?.focus()
    else if (e.key === 'ArrowRight') refs.current[Math.min(i + 1, 5)]?.focus()
  }
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', gap: 8 }}>
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el }}
          className={`ov-code${invalid ? ' is-error' : ''}`}
          style={{ height }}
          value={cur[i] || ''}
          onChange={e => onInput(i, e)}
          onKeyDown={e => onKey(i, e)}
          onPaste={e => { e.preventDefault(); set(cur.slice(0, i) + e.clipboardData.getData('text')) }}
          onFocus={e => e.target.select()}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={6}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
        />
      ))}
    </div>
  )
}

// 0-4: one point each for 8+ characters, 12+, mixed case, a digit or symbol.
function passwordScore(pw = '') {
  if (!pw) return 0
  return [pw.length >= 8, pw.length >= 12, /[a-z]/.test(pw) && /[A-Z]/.test(pw), /[\d\W_]/.test(pw)].filter(Boolean).length
}
const STRENGTH = [null, ['Weak', 'var(--danger)'], ['Okay', 'var(--ov-st-needs)'], ['Good', 'var(--ov-st-booked)'], ['Strong', 'var(--ov-st-cancelled)']]

export function StrengthBar({ password }) {
  const score = passwordScore(password)
  const [label, color] = STRENGTH[Math.max(score, 1)]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }} aria-live="polite">
      <div style={{ flex: 1, display: 'flex', gap: 4 }} aria-hidden="true">
        {[1, 2, 3, 4].map(n => (
          <span key={n} style={{ flex: 1, height: 6, borderRadius: 3, background: score >= n ? color : 'var(--ov-stub)', transition: 'background 160ms ease' }} />
        ))}
      </div>
      <span style={{ width: 52, textAlign: 'right', fontSize: 13, fontWeight: 600, color: password ? color : 'var(--ov-faint)' }}>
        {password ? label : ''}
      </span>
    </div>
  )
}

// ── Prompt 721 — Messages ──────────────────────────────────────────
// Pieces for /messages (team lines only). A `line` is
// { kind: 'admin' | 'fulfillment' | 'agent', name, avatarUrl, avatarColor }.
// .ov-msg-* / .ov-bubble / .ov-composer in index.css.

const ROLE_BADGE = {
  admin: { icon: ShieldCheck, bg: '#1D4ED8', label: 'Admin' },
  fulfillment: { icon: Headset, bg: '#0F766E', label: 'Fulfillment' },
}
const ELLIPSIS = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

// The role mark at an avatar's bottom right: Admin = shield, Fulfillment =
// headset, agents none. The 2px ring matches the surface behind it.
export function RoleBadge({ kind, size = 17 }) {
  const b = ROLE_BADGE[kind]
  if (!b) return null
  const Icon = b.icon
  return (
    <span title={b.label} style={{
      position: 'absolute', right: -5, bottom: -3, width: size, height: size, boxSizing: 'content-box',
      borderRadius: '50%', background: b.bg, color: '#fff', border: '2px solid var(--ov-badge-ring)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon size={Math.round(size * 0.58)} strokeWidth={2.4} />
    </span>
  )
}

// A line's avatar: the person's photo or colour, or a blue "A" for Admin
// (Admin has no profile row), with its role badge.
export function LineAvatar({ line, size = 42, badge = true, style }) {
  return (
    <span style={{ position: 'relative', display: 'block', flexShrink: 0, width: size, height: size, ...style }}>
      {line.kind === 'admin' ? (
        <span style={{
          width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
          color: '#fff', fontSize: Math.round(size / 3), fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>A</span>
      ) : (
        <Avatar name={line.name} avatarUrl={line.avatarUrl} avatarColor={line.avatarColor} size={size} />
      )}
      {badge && <RoleBadge kind={line.kind} size={Math.round(size * 0.4)} />}
    </span>
  )
}

// The coloured card at the top of the inbox: unread count (or "All caught
// up"), up to three of the user's lines, then one status line. The avatars
// share the "Inbox" row and hang 14px into the big line, as in the mockup;
// with three or more beside "All caught up" there's no room, so they don't.
export function InboxHero({ unread, lines, note, loading }) {
  const shown = lines.slice(0, 3)
  const more = lines.length - shown.length
  const ring = { borderRadius: '50%', boxShadow: '0 0 0 2px rgba(255,255,255,0.85)' }
  const overlap = loading || unread > 0 || lines.length <= 2
  return (
    <section className="ov-hero ov-msg-hero" aria-label="Inbox">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--ov-hero-soft)' }}>Inbox</div>
        {shown.length > 0 && (
          <div style={{ display: 'flex', flexShrink: 0, marginBottom: overlap ? -14 : 0 }} aria-hidden="true">
            {shown.map((l, i) => (
              <LineAvatar key={l.key} line={l} size={36} badge={false} style={{ ...ring, marginLeft: i ? -10 : 0 }} />
            ))}
            {more > 0 && (
              <span style={{
                ...ring, width: 36, height: 36, marginLeft: -10, background: 'rgba(255,255,255,0.18)', color: '#fff',
                fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>+{more}</span>
            )}
          </div>
        )}
      </div>
      {loading ? (
        <div className="ov-skel" style={{ marginTop: 10, width: 150, height: 28, background: 'rgba(255,255,255,0.14)' }} />
      ) : unread > 0 ? (
        <div style={{ marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 40, fontWeight: 600, lineHeight: 1.05, letterSpacing: '-0.03em' }}>{unread}</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>unread</span>
        </div>
      ) : (
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
          <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: '50%', background: 'rgba(255,255,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Check size={16} strokeWidth={3} />
          </span>
          <span style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>All caught up</span>
        </div>
      )}
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ov-hero-soft)' }}>
        <span style={{ width: 7, height: 7, flexShrink: 0, borderRadius: '50%', background: 'var(--ov-hero-dot)' }} />
        <span style={{ minWidth: 0, ...ELLIPSIS }}>{loading ? 'Loading…' : note}</span>
      </div>
    </section>
  )
}

// One line in the inbox list.
export function InboxRow({ line, title, roleLine, time, preview, unread, active, onClick }) {
  const isUnread = unread > 0
  return (
    <button type="button" onClick={onClick} className={`ov-msg-row${active ? ' is-active' : ''}`} aria-current={active ? 'true' : undefined}>
      <LineAvatar line={line} size={42} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: isUnread ? 700 : 600, color: 'var(--ov-hi)', ...ELLIPSIS }}>{title}</span>
          {time && (
            <span style={{ flexShrink: 0, fontSize: 12, fontWeight: isUnread ? 700 : 500, color: isUnread ? 'var(--ov-st-booked)' : 'var(--ov-faint)' }}>{time}</span>
          )}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--ov-mute)' }}>{roleLine}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: isUnread ? 600 : 400, color: isUnread ? 'var(--ov-hi)' : 'var(--ov-soft)', ...ELLIPSIS }}>{preview}</span>
          {isUnread && <span className="ov-msg-pill" aria-label={`${unread} unread`}>{unread}</span>}
        </span>
      </span>
    </button>
  )
}

export function InboxRowSkeleton() {
  return (
    <div aria-hidden="true" style={{ display: 'flex', gap: 12, padding: '12px 14px' }}>
      <span className="ov-skel" style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0 }} />
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7, paddingTop: 3 }}>
        <span className="ov-skel" style={{ width: '55%', height: 12 }} />
        <span className="ov-skel" style={{ width: '30%', height: 10 }} />
        <span className="ov-skel" style={{ width: '80%', height: 10 }} />
      </span>
    </div>
  )
}

// "Today" / "Yesterday" / "Mon, Oct 5" between hairlines.
export function DayDivider({ label }) {
  return (
    <div role="separator" aria-label={label} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, fontWeight: 700, color: 'var(--ov-faint)' }}>
      <span style={{ flex: 1, height: 1, background: 'var(--ov-line)' }} />
      {label}
      <span style={{ flex: 1, height: 1, background: 'var(--ov-line)' }} />
    </div>
  )
}

// Inside a group the corners facing the sender's side drop to 6px between
// bubbles, so the run reads as one block.
function bubbleRadius(mine, i, n) {
  if (n === 1) return 18
  const top = i === 0 ? 18 : 6
  const bottom = i === n - 1 ? 18 : 6
  return mine ? `18px ${top}px ${bottom}px 18px` : `${top}px 18px 18px ${bottom}px`
}

// One run of messages from one sender. Theirs: caption above, avatar beside
// the last bubble. Mine: the time under the last bubble.
export function ChatBubbleGroup({ mine, caption, avatar, messages, time }) {
  const bubbles = messages.map((m, i) => (
    <div key={m.id} className={`ov-bubble ${mine ? 'is-mine' : 'is-theirs'}`} style={{ borderRadius: bubbleRadius(mine, i, messages.length) }}>
      {m.body}
    </div>
  ))
  if (mine) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end', paddingLeft: 42 }}>
        {bubbles}
        {time && <div style={{ fontSize: 12, color: 'var(--ov-faint)', padding: '2px 4px 0' }}>{time}</div>}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
      {avatar}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start', minWidth: 0, paddingRight: 42 }}>
        {caption && <div style={{ fontSize: 12.5, color: 'var(--ov-mute)', padding: '0 4px 2px' }}>{caption}</div>}
        {bubbles}
      </div>
    </div>
  )
}

const COMPOSER_MAX_H = 6 * 22 + 18 // six lines + padding, then it scrolls

// The message box: auto-grows 1 → 6 lines, Enter sends, Shift+Enter breaks a
// line. The `n/max` counter shows from max - 200 characters.
export function Composer({ value, onChange, onSubmit, placeholder, busy, error, max, inputRef }) {
  const own = useRef(null)
  const ref = inputRef || own
  const trimmed = value.trim()
  const counter = value.length >= max - 200

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_H)}px`
    el.style.overflowY = el.scrollHeight > COMPOSER_MAX_H ? 'auto' : 'hidden'
  }, [value, ref])

  return (
    <div>
      {error && <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--danger)' }}>{error}</p>}
      <div className="ov-composer">
        <textarea
          ref={ref} rows={1} value={value} placeholder={placeholder} aria-label={placeholder}
          className="scrollbar-thin"
          onChange={e => onChange(e.target.value.slice(0, max))}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit() } }}
        />
        <button type="button" className="ov-send" onClick={onSubmit} disabled={!trimmed || busy} aria-label={busy ? 'Sending…' : 'Send'} title="Send">
          <Send size={17} strokeWidth={2.2} />
        </button>
      </div>
      <div className={counter ? 'flex' : 'hidden md:flex'} style={{ gap: 12, padding: '8px 8px 0', fontSize: 12, color: 'var(--ov-faint)' }}>
        <span className="hidden md:inline">Enter to send · Shift + Enter for a new line</span>
        {counter && <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{value.length}/{max}</span>}
      </div>
    </div>
  )
}

// ── Prompt 723 — Overview final touches ───────────────────────────────────
// The attention box has two states (AttentionCard = someone needs the agent,
// ComingUpCard = nobody does), and the chart becomes last Monday to Sunday.
// AttentionPanel and ActivityChart above are left in place, unused.

const startOfDay = d => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
// Whole calendar days from `now` to `iso`, in the agent's own zone, or in
// `tz` (the client's, Prompt 724) when given.
const dayGap = (iso, now, tz) => {
  if (!tz) return Math.round((startOfDay(iso) - startOfDay(now)) / 864e5)
  const ms = s => Date.UTC(...s.split('-').map((n, i) => (i === 1 ? n - 1 : +n)))
  return Math.round((ms(dayIn(new Date(iso).getTime(), tz)) - ms(dayIn(now, tz))) / 864e5)
}

// "in 25 min" / "in 4 h 39 min" / "in 2 h" / "Tomorrow" / "In 3 days".
function untilLabel(iso, now) {
  const mins = Math.max(1, Math.round((new Date(iso).getTime() - now) / 6e4))
  const gap = dayGap(iso, now)
  if (mins < 60) return `in ${mins} min`
  if (gap <= 0) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m ? `in ${h} h ${m} min` : `in ${h} h`
  }
  if (gap === 1) return 'Tomorrow'
  return `In ${gap} days`
}

// "Today, 2:30 PM" / "Tomorrow, 2:30 PM" / "Mon, 10:00 AM" / "Oct 19, 10:00 AM".
function comingWhen(iso, now, tz) {
  const gap = dayGap(iso, now, tz)
  const d = new Date(iso)
  const z = tz ? { timeZone: tz } : null
  const day = gap <= 0 ? 'Today' : gap === 1 ? 'Tomorrow'
    : gap < 7 ? d.toLocaleDateString('en-US', { weekday: 'short', ...z })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...z })
  return `${day}, ${fmtSlotTime(iso, tz)}`
}

function CallDateTile({ iso, booked, tz }) {
  const d = new Date(iso)
  const z = tz ? { timeZone: tz } : null
  return (
    <span style={{
      width: 46, height: 46, flexShrink: 0, boxSizing: 'border-box', borderRadius: 13,
      background: booked ? 'var(--ov-st-booked-tint)' : 'var(--ov-stub)',
      color: booked ? 'var(--ov-st-booked)' : 'var(--ov-mid)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
    }}>
      {/* A calendar tile: the one place an all-caps label is allowed. */}
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.02em', opacity: 0.9, textTransform: 'uppercase' }}>
        {d.toLocaleDateString('en-US', { weekday: 'short', ...z })}
      </span>
      <span style={{ marginTop: 3, fontFamily: DISPLAY, fontSize: 18, fontWeight: 700 }}>{z ? d.toLocaleDateString('en-US', { day: 'numeric', ...z }) : d.getDate()}</span>
    </span>
  )
}

// The amber state (Prompt 732): the Needs attention tab and nothing else.
// Each row (and its Open button) goes to My Pipeline's Needs attention tab with
// that client's drawer open; no confirm or re-book starts from here.
export function AttentionCard({ items, loading, onGo }) {
  const pad = 'p-[18px] sm:px-6 sm:pt-6 sm:pb-5'
  const area = { gridArea: 'attn', minWidth: 0 }
  const title = <h2 style={{ ...OV_TITLE, flex: 1, minWidth: 0 }} className="text-[18px] sm:text-[19px]">Needs your attention</h2>

  if (loading) {
    return (
      <div className={`ov-card flex flex-col ${pad}`} style={area}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {title}
          <span style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 600, color: 'var(--ov-mute)' }}>—</span>
        </div>
      </div>
    )
  }

  const count = items.length
  const shown = items.slice(0, ATTN_ROWS)
  const more = n => (count > n ? `See all ${count} in My Pipeline` : 'Open in My Pipeline')
  const toConfirm = items.filter(p => agentStageOf(p) === 'confirmNumber').length
  const toCall = count - toConfirm
  const intro = [toConfirm && `${toConfirm} to confirm`, toCall && `${toCall} to call`].filter(Boolean).join(' · ')
  const go = p => onGo(`/agent/clients?open=${p.id}&stage=needs`)

  return (
    <div className={`ov-attn flex flex-col ${pad}`} style={area}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <IconChip icon={TriangleAlert} color="var(--ov-warn)" tint="var(--ov-warn-tint)" />
        {title}
        <span style={{
          minWidth: 30, height: 30, boxSizing: 'border-box', padding: '0 10px', borderRadius: 999,
          background: 'var(--ov-badge-bg)', color: 'var(--ov-badge-fg)', fontFamily: DISPLAY, fontSize: 15, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontVariantNumeric: 'tabular-nums',
        }}>
          {count}
        </span>
      </div>
      <p style={{ margin: '14px 0 6px', fontSize: 14, lineHeight: 1.5, color: 'var(--ov-soft)' }}>
        {intro}. Open one to see what to do.
      </p>

      {shown.map((p, i) => {
        const name = fullName(p)
        const meta = [p.current_carrier || 'Carrier not noted', NEEDS_WHY[agentStageOf(p)]].filter(Boolean).join(' · ')
        return (
          <div key={p.id} role="button" tabIndex={0} aria-label={`Open ${name}`}
            onClick={() => go(p)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(p) } }}
            className={`ov-attn-row ${i >= 3 ? 'hidden sm:flex' : 'flex'}`} style={{ alignItems: 'center', gap: 12, padding: '14px 0', cursor: 'pointer' }}>
            <span style={{
              width: 38, height: 38, flexShrink: 0, borderRadius: '50%', background: 'var(--ov-warn-tint)', color: 'var(--ov-warn)',
              fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {initialsOf(name)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
              <div style={{ marginTop: 2, fontSize: 12.5, color: 'var(--ov-mute)', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }}>{meta}</div>
            </div>
            <button type="button" className="ov-ghost h-10 sm:h-[34px]" tabIndex={-1} aria-hidden="true"
              style={{ padding: '0 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Open <ArrowRight size={14} strokeWidth={2.2} />
            </button>
          </div>
        )
      })}

      <div style={{ marginTop: 'auto', paddingTop: 14 }}>
        <button type="button" className="ov-primary" onClick={() => onGo('/agent/clients?stage=needs')}>
          <span className="sm:hidden">{more(3)}</span>
          <span className="hidden sm:inline">{more(ATTN_ROWS)}</span>
          <ArrowRight size={15} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
}

// The calm state: nobody needs the agent, so show what is coming up.
// `upcoming`: booked rows with a future call, soonest first.
export function ComingUpCard({ upcoming, now, onGo }) {
  const pad = 'p-[18px] sm:px-6 sm:pt-6 sm:pb-5'
  const area = { gridArea: 'attn', minWidth: 0 }
  const title = <h2 style={{ ...OV_TITLE, flex: 1, minWidth: 0 }} className="text-[18px] sm:text-[19px]">You&rsquo;re all caught up</h2>
  const n = upcoming.length
  const [next, ...rest] = upcoming
  const list = rest.slice(0, 3)

  return (
    <div className={`ov-card flex flex-col ${pad}`} style={area}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <IconChip icon={Check} color="var(--ov-up)" tint="var(--ov-up-tint)" iconSize={18} />
        {title}
      </div>
      <p style={{ margin: '12px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--ov-soft)' }}>
        {n ? 'Nobody is waiting on you. Here’s what’s coming up.' : 'Nobody is waiting on you.'}
      </p>

      {n === 0 ? (
        <>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '28px 10px' }}>
            <span style={{
              width: 68, height: 68, borderRadius: 22, background: 'var(--ov-st-booked-tint)', color: 'var(--ov-st-booked)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CalendarDays size={30} strokeWidth={1.8} />
            </span>
            <div style={{ marginTop: 18, fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ov-hi)' }}>
              Nothing on the books yet
            </div>
            <div style={{ marginTop: 6, maxWidth: 250, fontSize: 14, lineHeight: 1.5, color: 'var(--ov-mute)' }}>
              Book a call when your next client says yes.
            </div>
          </div>
          <button type="button" className="ov-primary" onClick={() => onGo('/agent/book')}>
            <CalendarPlus size={17} strokeWidth={2.1} /> Book a call
          </button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '22px 0 10px' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }}>Up next</span>
            <span style={{ fontSize: 12.5, color: 'var(--ov-faint)' }}>{n} {n === 1 ? 'call' : 'calls'} booked</span>
          </div>

          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 16,
              background: 'var(--ov-st-booked-tint)', border: '1px solid var(--ov-st-booked-edge)',
            }}>
            <CallDateTile iso={next.scheduled_call_at} tz={next.client_timezone} booked />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--ov-hi)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName(next)}</span>
              <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--ov-mid)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {next.current_carrier || 'Carrier not noted'}
              </span>
            </span>
            <span style={{ textAlign: 'right', lineHeight: 1.25, flexShrink: 0 }}>
              <span style={{ display: 'block', fontFamily: DISPLAY, fontSize: 17, fontWeight: 700, color: 'var(--ov-st-booked)', whiteSpace: 'nowrap' }}>
                {fmtSlotTime(next.scheduled_call_at, next.client_timezone)}
              </span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--ov-mute)', whiteSpace: 'nowrap' }}>{untilLabel(next.scheduled_call_at, now)}</span>
            </span>
          </div>

          {list.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {list.map((p, i) => (
                <div key={p.id}
                  className={`ov-up-row ${i >= 2 ? 'hidden sm:flex' : 'flex'}`}
                  style={{ alignItems: 'center', gap: 14, padding: '11px 4px' }}>
                  <CallDateTile iso={p.scheduled_call_at} tz={p.client_timezone} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName(p)}</span>
                    <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--ov-mute)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {comingWhen(p.scheduled_call_at, now, p.client_timezone)} · {p.current_carrier || 'Carrier not noted'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ height: 14 }} />
          <button type="button" className="ov-primary" style={{ marginTop: 'auto' }} onClick={() => onGo('/agent/clients?stage=booked')}>
            Open My Pipeline <ArrowRight size={15} strokeWidth={2.2} />
          </button>
        </>
      )}
    </div>
  )
}

// Last Monday to Sunday: `days` is 7 entries [{ date, booked, cancelled }].
// One responsive render (the .ov-lw* rules in index.css switch to the phone
// layout under 640px). Rows with numbers on the left, no numbers on the bars.
export function LastWeekChart({ days, loading, className = '' }) {
  const booked = days.reduce((s, d) => s + d.booked, 0)
  const cancelled = days.reduce((s, d) => s + d.cancelled, 0)
  const m = Math.max(0, ...days.map(d => Math.max(d.booked, d.cancelled)))
  const step = m <= 4 ? 1 : Math.ceil(m / 4)
  const top = step * 4
  const rows = [0, 1, 2, 3, 4]
  const empty = !loading && booked === 0 && cancelled === 0
  const range = days.length ? `${shortDate(days[0].date)} to ${shortDate(days[days.length - 1].date)}` : ''
  const barH = v => (v ? `${(v / top) * 100}%` : 3)
  const dayName = d => d.toLocaleDateString('en-US', { weekday: 'short' })

  const total = (v, word) => (
    <div>
      <div className="ov-lw-num" style={OV_NUM}>{loading ? '—' : v}</div>
      <div style={{ marginTop: 6, fontSize: 13, color: 'var(--ov-mute)' }}>{word}</div>
    </div>
  )

  return (
    <div className={`ov-card ov-lw ${className}`}>
      <div className="ov-lw-head">
        <div className="ov-lw-titles">
          <h2 style={OV_TITLE} className="text-[18px] sm:text-[19px]">Last week</h2>
          <p className="ov-lw-sub-wide" style={{ margin: '3px 0 0', fontSize: 13.5, color: 'var(--ov-mute)' }}>{range} · calls you booked and old policies confirmed cancelled</p>
          <p className="ov-lw-sub-narrow" style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--ov-mute)' }}>{range}</p>
        </div>
        <Legend />
      </div>

      <div className="ov-lw-body">
        <div className="ov-lw-totals">{total(booked, 'booked')}{total(cancelled, 'cancelled')}</div>

        {empty ? (
          <div style={{ flex: 1, minWidth: 0, minHeight: 176, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 14, color: 'var(--ov-mute)' }}>
            No calls last week. Book one when your next client says yes.
          </div>
        ) : (
          <div className="ov-lw-chart">
            <div className="ov-lw-axis" aria-hidden="true">
              {rows.map(i => (
                <span key={i} className="ov-lw-tick" style={{ bottom: `calc(${i * 25}% - 7px)` }}>{i * step}</span>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                className="ov-lw-plot" role="img"
                aria-label={`Last week: ${booked} booked, ${cancelled} cancelled`}
              >
                {rows.map(i => (
                  <div key={i} className="ov-lw-line" style={{ bottom: `${i * 25}%`, background: i === 0 ? 'var(--ov-line)' : 'var(--ov-grid)' }} />
                ))}
                <div className="ov-lw-cols">
                  {days.map((d, i) => (
                    <div key={i} className="ov-lw-col" title={`${dayName(d.date)}, ${shortDate(d.date)}: ${d.booked} booked, ${d.cancelled} cancelled`}>
                      <span className="ov-lw-bar" style={{ height: barH(d.booked), background: 'var(--ov-data-a-bar)' }} />
                      <span className="ov-lw-bar" style={{ height: barH(d.cancelled), background: 'var(--ov-data-b-bar)' }} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="ov-lw-xs">
                {days.map((d, i) => (
                  <div key={i} style={{ flex: 1, minWidth: 0, textAlign: 'center', lineHeight: 1.25 }}>
                    <div style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: 'var(--ov-mid)' }}>{dayName(d.date)}</div>
                    <div className="ov-lw-date" style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ov-faint)' }}>{shortDate(d.date)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
