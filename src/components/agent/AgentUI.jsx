import { Children } from 'react'
import { ChevronRight, MessageCircleMore } from 'lucide-react'
import { card, eyebrow, control, MONO } from '../../lib/exportStyles'
import { SLOTS, slotToISO, localDateISO } from '../../lib/scheduling'
import { STAGE, TONE, stageOf } from '../../lib/agentBookings'
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

export function StagePill({ p }) {
  const stage = stageOf(p)
  return (
    <Pill tone={STAGE[stage].tone} icon={stage === 'inProgress' ? LiveDot : undefined}>
      {STAGE[stage].label}
    </Pill>
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
    <p style={{ margin: 0, padding: '32px 20px', textAlign: 'center', fontSize: 14, color: 'var(--text-secondary)' }}>
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
    <div style={{ ...card, padding: 0, overflow: 'hidden', ...style }}>
      {head && hasRows && (
        <div
          className={`hidden md:grid ${timeOnly ? 'md:grid-cols-[96px_minmax(0,1.4fr)_minmax(0,1fr)_160px_14px]' : 'md:grid-cols-[176px_minmax(0,1.4fr)_minmax(0,1fr)_160px_14px]'} items-center gap-x-4`}
          style={{ ...eyebrow, padding: '11px 20px', background: 'var(--bg-elevated)', position: 'sticky', top: 0, zIndex: 1 }}
        >
          <span>{timeOnly ? 'Time' : 'Call'}</span><span>Client</span><span>Leaving</span><span style={{ justifySelf: 'end' }}>Status</span><span />
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

export function ClientRow({ p, now, onClick, onRebook, showAgent, timeOnly, active, first, compact, tall }) {
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
        {onRebook && (
          <button
            onClick={e => { e.stopPropagation(); onRebook() }}
            style={{
              height: 24, padding: '0 10px', borderRadius: 999, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
              background: 'transparent', color: 'var(--text-secondary)', border: 'var(--border-w) solid var(--border-strong)',
            }}
          >
            Re-book
          </button>
        )}
        <StagePill p={p} now={now} />
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
