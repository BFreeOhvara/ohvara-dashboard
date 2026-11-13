// P983 — one day box of the phone Calendar's month, shared by the agent app (ACalendar) and the VA app
// (VCalendar) so the two stay identical: the day number, then a thin coloured bar per call (max 3, no "+N"),
// today ringed, past faded, a blocked / day-off day hatched with its own mark in place of the bars.
export default function MonthDay({ cell, tones = [], today = false, past = false, picked = false, off = false, offMark = null, label, onPick, className = '' }) {
  const cls = [cell.inMonth ? '' : 'is-out', today ? 'is-today' : '', past ? 'is-past' : '', tones.length ? 'has-calls' : '', off ? 'is-blocked' : '', picked ? 'is-picked' : '', className].filter(Boolean).join(' ')
  return (
    <button type="button" className={`ma-day ma-press ${cls}`} disabled={!cell.inMonth} aria-pressed={picked} aria-label={label} onClick={() => onPick(cell.iso)}>
      <b>{cell.n}</b>
      <span className="ma-bars">{off ? offMark : tones.slice(0, 3).map((t, i) => <i key={i} className={`is-${t}`} />)}</span>
    </button>
  )
}
