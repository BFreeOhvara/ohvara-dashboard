import { LogIn, LogOut, Loader2 } from 'lucide-react'
import { card, eyebrow, primaryBtn, ghostBtn, MONO } from '../../lib/exportStyles'
import { useClockIn, useClockOut } from '../../hooks/useFulfillmentPay'
import { fmtShift, sinceLabel } from '../../lib/payPeriod'

// Clock in / clock out (Prompt 681). Shown on the Fulfillment Overview and in
// Settings → Getting Paid. The server stamps both times; this just says which.
export function ClockCard({ entries = [], pay, now, loading, style }) {
  const open = entries.find(e => !e.clock_out)
  const clockIn = useClockIn()
  const clockOut = useClockOut()
  const busy = clockIn.isPending || clockOut.isPending
  const err = clockIn.error || clockOut.error
  const shift = fmtShift(pay)

  return (
    <div style={{
      ...card, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      ...(open ? { background: 'var(--success-dim)', borderColor: 'var(--success-bd)' } : null),
      ...style,
    }}>
      <span style={{
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: open ? 'var(--success)' : 'var(--border-strong)',
        boxShadow: open ? '0 0 0 4px var(--success-bd)' : 'none',
      }} />
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <p style={{ ...eyebrow, ...(open ? { color: 'var(--success)' } : null) }}>
          {open ? 'On the clock' : 'Off the clock'}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-primary)' }}>
          {loading ? 'Loading…'
            : open ? <>Since <span style={{ fontFamily: MONO }}>{new Date(open.clock_in).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span> · <span style={{ fontFamily: MONO }}>{sinceLabel(open.clock_in, now)}</span></>
              : shift ? <>Your shift: <span style={{ fontFamily: MONO }}>{shift}</span></>
                : 'No shift scheduled yet. Brayden sets it.'}
        </p>
        {err && <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--danger)' }}>{err.message}</p>}
      </div>
      {open ? (
        <button onClick={() => clockOut.mutate(open.id)} disabled={busy || loading} style={{ ...ghostBtn, height: 40, opacity: busy ? 0.6 : 1 }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />} Clock out
        </button>
      ) : (
        <button onClick={() => clockIn.mutate()} disabled={busy || loading} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />} Clock in
        </button>
      )}
    </div>
  )
}
