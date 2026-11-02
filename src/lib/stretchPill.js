// The stretchy pill's maths, no DOM: the edge in the direction of travel gets there first and the other catches
// up. Edges are { top, right, bottom, left } in px from the row's top-left corner. useStretchPill draws them.

export const FLIGHT_MS = 550
export const LEAD_MS = 360
export const CROSSFADE_MS = 80
export const REMEMBER_MS = 300
const SAMPLES = 24

// cubic-bezier(0.165, 0.84, 0.44, 1): find the curve's s for this time, then return its progress.
const curve = (a, b, s) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3
export function ease(t) {
  if (t <= 0) return 0
  if (t >= 1) return 1
  let lo = 0, hi = 1
  for (let i = 0; i < 30; i++) {
    const s = (lo + hi) / 2
    if (curve(0.165, 0.44, s) < t) lo = s
    else hi = s
  }
  return curve(0.84, 1, (lo + hi) / 2)
}

const lerp = (a, b, p) => a + (b - a) * p
const centre = e => (e.left + e.right) / 2
const round = n => Math.round(n * 1000) / 1000

// Where the four edges are, this many ms into a flight. Moving right the right edge leads, moving left the left edge.
export function edgesAt(from, to, ms) {
  const lead = ease(ms / LEAD_MS)
  const trail = ease(ms / FLIGHT_MS)
  const right = centre(to) >= centre(from)
  return {
    top: lerp(from.top, to.top, trail),
    right: lerp(from.right, to.right, right ? lead : trail),
    bottom: lerp(from.bottom, to.bottom, trail),
    left: lerp(from.left, to.left, right ? trail : lead),
  }
}

// One clip-path value. calc(100% - x) measures from the overlay's far sides, so edges stay in row coordinates.
export function clipOf(e, radius) {
  return `inset(${round(e.top)}px calc(100% - ${round(e.right)}px) calc(100% - ${round(e.bottom)}px) ${round(e.left)}px round ${round(radius)}px)`
}

// Sample times as offsets, with one exactly where the leading edge lands.
export function flightOffsets() {
  const list = Array.from({ length: SAMPLES + 1 }, (_, i) => i / SAMPLES)
  const landing = LEAD_MS / FLIGHT_MS
  return [...list, landing].sort((a, b) => a - b)
}

// WAAPI keyframes for one flight; run them linear over FLIGHT_MS.
export function stretchKeyframes(from, to, radius) {
  return flightOffsets().map(offset => ({ offset, clipPath: clipOf(edgesAt(from, to, offset * FLIGHT_MS), radius) }))
}

// The same edges pulled in on every side, for the inner fill of a bordered pill.
export const shrinkEdges = (e, by) => ({ top: e.top + by, right: e.right - by, bottom: e.bottom - by, left: e.left + by })

// Two rects are on one line when their vertical ranges overlap by more than half the smaller height.
export function sameLine(a, b) {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return overlap > Math.min(a.bottom - a.top, b.bottom - b.top) / 2
}

// Whether a switch flies, given where the pill is now (at rest or mid-flight) and where it is going.
export function planMove(current, target) {
  if (!current || !target) return { fly: false, from: null }
  const empty = e => e.right - e.left <= 0 || e.bottom - e.top <= 0
  const still = ['top', 'right', 'bottom', 'left'].every(k => Math.abs(current[k] - target[k]) < 0.5)
  if (empty(current) || empty(target) || still || !sameLine(current, target)) return { fly: false, from: null }
  return { fly: true, from: current }
}

// How much of a label (0 to 1) sits under the pill.
export function coverOf(e, label) {
  const width = label.right - label.left
  if (width <= 0) return 0
  return Math.max(0, Math.min(1, (Math.min(e.right, label.right) - Math.max(e.left, label.left)) / width))
}

// A label's cover at every sample, so its colour turns as the pill crosses it.
export function coverTrack(from, to, label) {
  return flightOffsets().map(offset => ({ offset, cover: coverOf(edgesAt(from, to, offset * FLIGHT_MS), label) }))
}

// A label's colour for a given cover: the on-pill colour blended into its off-pill colour. A label under a moving
// edge sits on both at once, so the blend reaches the middle tone, which reads on both, soon after the edge touches.
const turn = c => (c < 0.5 ? 0.5 - 0.5 * (1 - 2 * c) ** 3 : 0.5 + 0.5 * (2 * c - 1) ** 3)
export const inkAt = (on, off, cover) => `color-mix(in srgb, ${on} ${round(turn(cover) * 100)}%, ${off})`

// Read a computed colour: rgb(), rgba() or color(srgb ...). Null for anything else.
export function parseColor(text) {
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(text)
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: rgb[4] === undefined ? 1 : +rgb[4] }
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(text)
  if (srgb) return { r: srgb[1] * 255, g: srgb[2] * 255, b: srgb[3] * 255, a: srgb[4] === undefined ? 1 : +srgb[4] }
  return null
}

// The two layers of a bordered pill. A see-through inner layer shows the outer one through it, which would tint
// the whole pill and jump on landing, so when the fill is see-through the outer layer gets fainter (never more
// than half the fill) and the inner colour is worked out so the middle looks exactly like the fill alone. The real
// border fades in with the landing. Colours that cannot be read stay as they are.
export function stackedFills(fill, border) {
  const f = parseColor(fill)
  const b = parseColor(border)
  if (!f || !b || f.a >= 1 || f.a <= 0) return { outer: border, inner: fill }
  const outerA = Math.min(b.a, f.a / 2)
  const innerA = 1 - (1 - f.a) / (1 - outerA)
  const channel = k => Math.max(0, Math.min(255, Math.round((f.a * f[k] - (1 - innerA) * outerA * b[k]) / innerA)))
  return {
    outer: `rgba(${Math.round(b.r)}, ${Math.round(b.g)}, ${Math.round(b.b)}, ${round(outerA)})`,
    inner: `rgba(${channel('r')}, ${channel('g')}, ${channel('b')}, ${round(innerA)})`,
  }
}

// A remounted row's stored edges, if the old row just left with a different selection.
export function rememberedEdges(entry, activeKey, now) {
  if (!entry || entry.key === activeKey || now - entry.at > REMEMBER_MS) return null
  return entry.edges
}
