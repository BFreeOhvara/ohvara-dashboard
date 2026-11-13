// P991 — "Delivered this week" judged by pace, not against the full-week range (Brayden, Nov 13). While the week is
// running, this week so far is compared with the range scaled to how much of the week (Mon 12:00 AM to Sun midnight, on
// the agent's clock) has passed: Friday noon of a 9 to 17 week expects about 6 to 11 so far. After the week closes it
// is judged against the full range, as before. Pure: the hooks pass the agent's wall clock ('YYYY-MM-DDTHH:MM').

const WEEK_MIN = 7 * 1440
// The projection ("on pace for ~9") shows once two full days are in; before that one busy morning would read as 40.
export const PROJECT_FROM = 2 / 7

// Share of the Mon to Sun week that has passed at this wall-clock time, 0..1.
export function weekShare(wall) {
  const day = new Date(`${wall.slice(0, 10)}T12:00:00Z`).getUTCDay()
  const min = ((day + 6) % 7) * 1440 + Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16))
  return Math.min(1, Math.max(0, min / WEEK_MIN))
}

// The wall-clock time one week earlier (same weekday, same time), for "N by this time last week".
export function weekAgo(wall) {
  const d = new Date(`${wall.slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 7)
  return `${d.toISOString().slice(0, 10)}${wall.slice(10, 16)}`
}

// The range expected by now: the full range times the share passed, rounded ("about 6 to 11").
export const rangeSoFar = (range, share) => ({ low: Math.round(range.low * share), high: Math.round(range.high * share) })

const PACE = {
  ahead: { word: 'Ahead of pace', tone: 'up' },
  on: { word: 'On pace', tone: 'mute' },
  behind: { word: 'Behind pace', tone: 'warn' },
  above: { word: 'Above range', tone: 'up' },
  in: { word: 'In range', tone: 'up' },
  below: { word: 'Below range', tone: 'mute' },
}

// total: delivered this week so far. range: { low, high } for a full week. share: weekShare(now); closed: the week is over.
// Returns { key, word, tone, closed, soFar, projected } — projected is null until PROJECT_FROM (and once closed).
export function paceOf({ total, range, share, closed = false }) {
  if (closed || share >= 1) {
    const key = total < range.low ? 'below' : total > range.high ? 'above' : 'in'
    return { key, ...PACE[key], closed: true, soFar: { low: range.low, high: range.high }, projected: null }
  }
  const soFar = rangeSoFar(range, share)
  const key = total > soFar.high ? 'ahead' : total < soFar.low ? 'behind' : 'on'
  const projected = share >= PROJECT_FROM ? Math.round(total / share) : null
  return { key, ...PACE[key], closed: false, soFar, projected }
}

// "5 by this time last week · 12 by the end"; just "12 last week" when the earlier count isn't known.
export const lastWeekWords = (prevSoFar, prev, closed = false) =>
  prev == null ? '' : closed || prevSoFar == null ? `${prev} last week` : `${prevSoFar} by this time last week · ${prev} by the end`
