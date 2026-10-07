import { Children } from 'react'
import { ChevronRight, MessageCircleMore, CalendarPlus, ArrowUpRight, ArrowRight, TrendingUp, TrendingDown, TriangleAlert, Check } from 'lucide-react'
import { card, eyebrow, control, MONO, DISPLAY } from '../../lib/exportStyles'
import { SLOTS, slotToISO, localDateISO } from '../../lib/scheduling'
import { STAGE, TONE, stageOf, agentStageOf, isLive, recoveryLabel, canRebook, sameLocalDay } from '../../lib/agentBookings'
import { DayClock } from '../ui/DayClock'
import { LiveDot } from '../ui/LiveDot'
import { fullName } from '../../lib/policyFormat'

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
    ? new Date(p.scheduled_call_at).toLocaleString('en-US', timeOnly
      ? { hour: 'numeric', minute: '2-digit' }
      : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
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
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--ov-mute)' }}>Nothing needs you right now.</p>
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
