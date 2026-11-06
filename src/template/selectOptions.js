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
