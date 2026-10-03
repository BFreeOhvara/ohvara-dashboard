import { ChevronRight, Clock } from 'lucide-react'
import { eyebrow, MONO } from '../../lib/exportStyles'
import { Pill, StagePill } from '../agent/AgentUI'
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
