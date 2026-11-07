// P878 — the agent's week (N-H-13, N-K-04) and what a change of hours or a blocked day hits (N-C-38). Shared by the
// hours editor (Hours.jsx) and the Calendar.
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const minOf = c => { const m = /(\d+):(\d+)\s*(AM|PM)/.exec(c || ''); return m ? ((Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + Number(m[2]) : 0 }

// Appointments outside a new set of hours (or on a blocked day). appts carry day ('Mon') and time ('3:30 PM').
export function clashes(appts, week, blocked = []) {
  return appts.filter(a => {
    if (blocked.includes(a.day)) return true
    const d = week[a.day]
    if (!d) return false
    if (!d.on) return true
    const m = minOf(a.time)
    return m < minOf(d.start) || m + 30 > minOf(d.end)
  })
}
