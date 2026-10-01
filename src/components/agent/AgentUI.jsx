import { Clock, AlertTriangle, User } from 'lucide-react'
import { card, fieldLabel, control, MONO } from '../../lib/exportStyles'
import { SLOTS, slotToISO, localDateISO } from '../../lib/scheduling'
import { STAGE, SUBSTATUS_LABEL, TONE, stageOf, isMissed } from '../../lib/agentBookings'
import { fullName } from '../../lib/policyFormat'

// Shared pieces for the agent portal pages (Prompt 665). Visual language
// matches the Fulfillment desk (Prompt 663) on purpose — same tiles, pills and
// rows — so the two halves of the hand-off read as one app.

export function Pill({ tone = 'neutral', icon: Icon, children }) {
  const t = TONE[tone]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 4,
      fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
      background: t.dim, color: t.color, border: `1px solid ${t.bd}`,
    }}>
      {Icon && <Icon size={10} />}{children}
    </span>
  )
}

export function StagePill({ p, now }) {
  const stage = stageOf(p)
  if (isMissed(p, now)) return <Pill tone="warning" icon={AlertTriangle}>Not picked up yet</Pill>
  const label = stage === 'inProgress'
    ? (SUBSTATUS_LABEL[p.cancellation_substatus] || STAGE.inProgress.label)
    : STAGE[stage].label
  return <Pill tone={STAGE[stage].tone}>{label}</Pill>
}

export function StatTile({ icon: Icon, label, value, sub, tone = 'neutral' }) {
  const t = TONE[tone]
  return (
    <div style={{ ...card, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <span style={{
        width: 30, height: 30, borderRadius: 7, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: t.dim, border: `1px solid ${t.bd}`, color: t.color,
      }}>
        <Icon size={14} />
      </span>
      <div style={{ minWidth: 0 }}>
        <p style={{ ...fieldLabel, margin: 0 }}>{label}</p>
        <p style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', fontFamily: MONO, lineHeight: 1.1 }}>
          {value}
        </p>
        {sub && <p style={{ margin: '2px 0 0', fontSize: 10.5, color: 'var(--text-muted)' }}>{sub}</p>}
      </div>
    </div>
  )
}

export function StatGrid({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))', gap: 10 }}>
      {children}
    </div>
  )
}

export function EmptyNote({ children }) {
  return (
    <div style={{
      padding: '22px 16px', borderRadius: 7, textAlign: 'center',
      border: 'var(--border-w) dashed var(--border)', color: 'var(--text-muted)', fontSize: 12.5,
    }}>
      {children}
    </div>
  )
}

// One booked client, compact. Used on Overview and My Clients.
export function ClientRow({ p, now, onClick, showAgent, timeOnly, right }) {
  const when = p.scheduled_call_at
    ? new Date(p.scheduled_call_at).toLocaleString('en-US', timeOnly
      ? { hour: 'numeric', minute: '2-digit' }
      : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'No time'
  return (
    <div
      onClick={onClick}
      style={{
        padding: '11px 14px', borderRadius: 7, cursor: onClick ? 'pointer' : 'default',
        background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}
    >
      <span style={{
        minWidth: timeOnly ? 64 : 0, fontSize: 12, fontWeight: 700, fontFamily: MONO,
        color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
      }}>
        {!timeOnly && <Clock size={11} style={{ color: 'var(--text-muted)' }} />}{when}
      </span>
      <div style={{ flex: '1 1 160px', minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{fullName(p)}</p>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
          {p.current_carrier ? `Leaving ${p.current_carrier}` : 'Carrier not noted'}
          {showAgent && <> · <User size={10} style={{ verticalAlign: '-1px' }} /> {p.agent?.full_name || '—'}</>}
        </p>
      </div>
      <StagePill p={p} now={now} />
      {right}
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
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {quick.map(q => {
          const on = date === q.value
          return (
            <button
              key={q.value} type="button" onClick={() => onDate(q.value)}
              style={{
                height: 34, padding: '0 16px', borderRadius: 6, fontSize: 12.5, fontWeight: 700,
                border: `1px solid ${on ? 'var(--accent-border)' : 'var(--border)'}`,
                background: on ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                color: on ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {q.label}
            </button>
          )
        })}
        <input
          type="date" value={date} min={today}
          onChange={e => e.target.value && onDate(e.target.value)}
          aria-label="Pick another day"
          style={{
            ...control, width: 'auto', fontFamily: MONO,
            ...(isOther ? { border: '1px solid var(--accent-border)', color: 'var(--accent)' } : null),
          }}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 8 }}>
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
              style={{
                height: 40, borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: MONO,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
                border: `1px solid ${on ? 'var(--accent-border)' : (error ? 'var(--danger)' : 'var(--border)')}`,
                background: on ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                color: on ? 'var(--accent)' : 'var(--text-secondary)',
                opacity: past ? 0.35 : 1, cursor: past ? 'not-allowed' : 'pointer',
                textDecoration: past ? 'line-through' : 'none',
              }}
            >
              {s}
              {taken > 0 && !past && (
                <span style={{ fontSize: 9, fontWeight: 700, fontFamily: 'inherit', color: 'var(--warning)', letterSpacing: '0.02em' }}>
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
