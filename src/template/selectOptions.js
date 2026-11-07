import { US_STATES } from '../lib/usStates.js'

// P847 — option lists for the DayTimeSelect (Select.jsx): the next days and the half hours in the team's day.
const pad = x => String(x).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export function dayOptions(n = 14, from = new Date()) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)
    const name = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long' })
    return { value: ymd(d), label: name, sub: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  })
}
export function timeOptions(startH = 8, endH = 18, step = 30) {
  const out = []
  for (let m = startH * 60; m <= endH * 60; m += step) {
    const h = Math.floor(m / 60)
    out.push({ value: `${pad(h)}:${pad(m % 60)}`, label: `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? 'AM' : 'PM'}` })
  }
  return out
}

// P868 — type-to-jump for a list with no search box (Select.jsx). `text` is what was typed in the last half second.
// The same letter again (or held) steps to the next option starting with it ("t" Tennessee, "tt" Texas, "ttt" back to
// Tennessee); otherwise the first option starting with the text. -1 when nothing starts with it.
export function typeAheadIndex(rows, text, from = -1) {
  const t = String(text || '').toLowerCase()
  if (!t) return -1
  const starts = p => rows.reduce((out, o, i) => (!o.disabled && String(o.label).toLowerCase().startsWith(p) ? [...out, i] : out), [])
  const k = t[0]
  if ([...t].every(c => c === k)) {
    const all = starts(k)
    if (!all.length) return -1
    if (t.length === 1) return rows[from] && String(rows[from].label).toLowerCase().startsWith(k) ? (all.find(i => i > from) ?? all[0]) : all[0]
    return all[(t.length - 1) % all.length]
  }
  return starts(t)[0] ?? -1
}

// P868 — StateSelect's options: the 50 states plus DC, A–Z by name, the code underneath.
export const STATE_OPTIONS = US_STATES.map(s => ({ value: s.code, label: s.name, sub: s.code })).sort((a, b) => a.label.localeCompare(b.label))
