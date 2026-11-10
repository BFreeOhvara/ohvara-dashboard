// P929 — calendar boxes never overlap. Given boxes as { id, start, end } (minutes on the grid, end = where the box's
// drawn bottom lands), returns { [id]: [column, columns] }: boxes that touch each other sit side by side in as many
// columns as the busiest moment needs; a box with nothing beside it keeps the full width. Pure, no imports.
export function calLanes(items) {
  const out = {}
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end)
  let group = []
  let cols = []
  let groupEnd = -Infinity
  const close = () => { for (const g of group) out[g.id] = [g.col, cols.length]; group = []; cols = []; groupEnd = -Infinity }
  for (const it of sorted) {
    if (it.start >= groupEnd) close()
    let col = cols.findIndex(end => end <= it.start)
    if (col === -1) { col = cols.length; cols.push(it.end) } else cols[col] = it.end
    group.push({ id: it.id, col })
    groupEnd = Math.max(groupEnd, it.end)
  }
  close()
  return out
}

// How many grid minutes a box covers: its real length, but never shorter than it needs to stay readable.
export const boxMinutes = (realMins, minPx, pxPerMin) => Math.max(realMins || 30, pxPerMin > 0 ? Math.ceil(minPx / pxPerMin) : 60)
