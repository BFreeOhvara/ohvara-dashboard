import { useLayoutEffect, useRef } from 'react'
import {
  FLIGHT_MS, CROSSFADE_MS, clipOf, edgesAt, stretchKeyframes, shrinkEdges, planMove, coverTrack, inkAt, stackedFills, rememberedEdges,
} from '../lib/stretchPill'
import '../components/ui/stretchPill.css'

// The stretchy pill: when the selection in a row changes, a pill flies from the old button to the new one, its
// leading edge first. It exists only in flight. At rest the selected button draws its own look from its own CSS
// and the row carries nothing from here, so a failed hook, a resize or a font load cannot leave a wrong look.
//   const ref = useRef(null)
//   useStretchPill(ref, { activeKey: view, selector: 'button.on' })
//   <div ref={ref}>…</div>
// A row that remounts when selected passes persistKey, and the new row flies from where the old one left off.
// A per-colour or gradient row sets --sp-fill on its selected rule for the in-flight fill. Without it a gradient
// target flies a flat mix of its --c. Maths in src/lib/stretchPill.js.

const lastEdges = new Map() // persistKey -> { key, edges, at }
const CLEAR = 'rgba(0, 0, 0, 0)'
const FILL_MIX = 18
const COPY_LOOK = [
  'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat', 'backgroundClip', 'backgroundOrigin',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius', 'boxShadow',
]

// Row coordinates: from the row's padding box, plus its scroll, so the numbers hold in a scrolling row.
function edgesOf(el, row) {
  const r = el.getBoundingClientRect()
  const o = row.getBoundingClientRect()
  const x = row.scrollLeft - o.left - row.clientLeft
  const y = row.scrollTop - o.top - row.clientTop
  return { top: r.top + y, right: r.right + x, bottom: r.bottom + y, left: r.left + x }
}

// A color-mix() fill as the plain colour the browser computes for it, so a bordered pill can lay its layers under it.
function plainColour(target, css) {
  const probe = document.createElement('span')
  probe.style.color = css
  target.append(probe)
  const colour = getComputedStyle(probe).color
  probe.remove()
  return colour
}

// The selected button's look, read from its own computed style.
function lookOf(target) {
  const cs = getComputedStyle(target)
  const width = parseFloat(cs.borderTopWidth) || 0
  const bordered = width > 0 && cs.borderTopColor !== CLEAR
  const box = target.getBoundingClientRect()
  const raw = cs.borderTopLeftRadius
  const radius = raw.endsWith('%') ? parseFloat(raw) / 100 * Math.min(box.width, box.height) : parseFloat(raw) || 0
  const custom = cs.getPropertyValue('--sp-fill').trim()
  const gradient = cs.backgroundImage !== 'none'
  const c = cs.getPropertyValue('--c').trim()
  const fill = custom || (!gradient ? cs.backgroundColor : c ? plainColour(target, `color-mix(in srgb, ${c} ${FILL_MIX}%, transparent)`) : 'var(--ov-data-a-tint)')
  return { fill, radius, width, bordered, border: cs.borderTopColor, plain: !bordered && !custom && !gradient && cs.boxShadow === 'none', styles: cs }
}

const itemsOf = target => [...target.parentElement.children].filter(el => !el.classList.contains('sp-pill'))
const partsOf = item => [item, ...item.querySelectorAll('*')]
const paintOf = el => { const cs = getComputedStyle(el); return { color: cs.color, bg: cs.backgroundColor } }

// Where the text sits in a button, kept inside the button so the target always ends fully covered.
function labelOf(item, row) {
  const box = edgesOf(item, row)
  const range = document.createRange()
  range.selectNodeContents(item)
  const text = edgesOf(range, row)
  if (text.right - text.left <= 0) return box
  return { left: Math.max(box.left, text.left), right: Math.min(box.right, text.right) }
}

// Each button's own colours off the pill. A selected button cannot show its own, so they are noted while it is
// not selected. A theme switch makes the notes stale, so it starts them again.
function noteOffColours(s, row, target) {
  const theme = document.documentElement.getAttribute('data-theme')
  if (s.theme !== theme) { s.theme = theme; s.off = new WeakMap() }
  for (const item of target ? itemsOf(target) : row.children) {
    if (item === target || item.classList.contains('sp-pill')) continue
    for (const el of partsOf(item)) s.off.set(el, paintOf(el))
  }
}

// Fade colours so a label turns as the pill covers or leaves it, on every button the flight crosses: the one it
// left, the one it lands on and any it sweeps past. A dot (cal-strip u) is a background, so that fades too.
function fadeLabels(s, row, target, from, to) {
  const onPaint = new Map()
  for (const el of [...target.querySelectorAll('*')].reverse()) onPaint.set(el.tagName, paintOf(el))
  const self = paintOf(target)
  const first = target.firstElementChild ? paintOf(target.firstElementChild).color : self.color
  const others = itemsOf(target).filter(item => item !== target)
  const anims = []
  for (const item of itemsOf(target)) {
    const track = coverTrack(from, to, labelOf(item, row))
    if (item !== target && track.every(f => f.cover === 0)) continue
    for (const el of partsOf(item)) {
      const on = el === item ? self : onPaint.get(el.tagName) || { color: first, bg: first }
      const twin = el === item ? others[0] : others.map(o => o.querySelector(el.tagName)).find(Boolean)
      const off = item !== target ? paintOf(el) : s.off.get(el) || (twin && s.off.get(twin)) || on
      if (off.color !== on.color) anims.push(el.animate(track.map(({ offset, cover }) => ({ offset, color: inkAt(on.color, off.color, cover) })), { duration: FLIGHT_MS }))
      if (el !== item && off.bg !== CLEAR && off.bg !== on.bg) anims.push(el.animate(track.map(({ offset, cover }) => ({ offset, backgroundColor: inkAt(on.bg, off.bg, cover) })), { duration: FLIGHT_MS }))
    }
  }
  return anims
}

function addLayer(overlay, from, to, radius, colour) {
  const layer = document.createElement('div')
  layer.className = 'sp-layer'
  layer.style.background = colour
  // Sits on the landing spot once the animation ends, for the instant before the overlay comes off.
  layer.style.clipPath = clipOf(to, radius)
  overlay.append(layer)
  return { layer, anim: layer.animate(stretchKeyframes(from, to, radius), { duration: FLIGHT_MS }) }
}

function launch(s, row, target, from, to) {
  const look = lookOf(target)
  const overlay = document.createElement('div')
  overlay.className = 'sp-pill'
  overlay.setAttribute('aria-hidden', 'true')
  // In a scrolling row, cover all the content, not only the visible part.
  if (row.scrollWidth > row.clientWidth) overlay.style.width = `${row.scrollWidth}px`
  if (row.scrollHeight > row.clientHeight) overlay.style.height = `${row.scrollHeight}px`

  const layers = []
  if (look.bordered) {
    const { outer, inner } = stackedFills(look.fill, look.border)
    layers.push(addLayer(overlay, from, to, look.radius, outer))
    layers.push(addLayer(overlay, shrinkEdges(from, look.width), shrinkEdges(to, look.width), Math.max(0, look.radius - look.width), inner))
  } else {
    layers.push(addLayer(overlay, from, to, look.radius, look.fill))
  }
  const anims = layers.map(l => l.anim)

  // The pill is an exact match unless the look has a border, gradient or shadow. Then the real look fades in over
  // the last moments, so the swap to the button itself shows no change.
  if (!look.plain) {
    const land = document.createElement('div')
    land.className = 'sp-land'
    for (const prop of COPY_LOOK) land.style[prop] = look.styles[prop]
    Object.assign(land.style, { top: `${to.top}px`, left: `${to.left}px`, width: `${to.right - to.left}px`, height: `${to.bottom - to.top}px` })
    overlay.append(land)
    const start = 1 - CROSSFADE_MS / FLIGHT_MS
    anims.push(land.animate([{ offset: 0, opacity: 0 }, { offset: start, opacity: 0 }, { offset: 1, opacity: 1 }], { duration: FLIGHT_MS }))
    for (const { layer } of layers) anims.push(layer.animate([{ offset: 0, opacity: 1 }, { offset: start, opacity: 1 }, { offset: 1, opacity: 0 }], { duration: FLIGHT_MS }))
  }
  anims.push(...fadeLabels(s, row, target, from, to))

  row.append(overlay)
  target.classList.add('sp-target')

  const flight = { row, target, from, to, overlay, anims, clock: anims[0], watch: null }
  flight.clock.onfinish = () => { if (s.flight === flight) endFlight(s) }
  // A size or font change mid-flight makes the edges wrong, so drop straight to the rest state. The first
  // ResizeObserver call only reports the current size, and fonts.ready resolves at once when nothing is loading.
  const { offsetWidth: w, offsetHeight: h } = row
  flight.watch = new ResizeObserver(() => { if (s.flight === flight && (row.offsetWidth !== w || row.offsetHeight !== h)) endFlight(s) })
  flight.watch.observe(row)
  if (document.fonts?.status === 'loading') document.fonts.ready.then(() => { if (s.flight === flight) endFlight(s) })
  return flight
}

// Everything off the row, in an order that lets no CSS transition run on the look coming back.
function freezeOff(row, target) {
  target?.classList.remove('sp-target')
  void row.offsetHeight
  row.classList.remove('sp-flying', 'sp-row')
}

function endFlight(s) {
  const flight = s.flight
  if (!flight) return
  s.flight = null
  flight.clock.onfinish = null
  flight.watch?.disconnect()
  flight.anims.forEach(a => a.cancel())
  flight.overlay.remove()
  freezeOff(flight.row, flight.target)
}

export function useStretchPill(rowRef, { activeKey, selector, enabled = true, persistKey }) {
  const state = useRef({ seen: false, key: undefined, el: null, row: null, flight: null, off: new WeakMap(), theme: null, mounted: false })

  useLayoutEffect(() => {
    const s = state.current
    const row = rowRef.current
    if (!row) return
    if (s.seen && s.key === activeKey) {
      if (!enabled) endFlight(s)
      return
    }
    const mounting = !s.seen
    const source = s.el
    const target = row.querySelector(selector)
    s.seen = true
    s.key = activeKey
    s.row = row
    s.el = target

    // Where the pill is right now. Read before the running flight comes off.
    const running = s.flight
    const midFlight = running ? edgesAt(running.from, running.to, running.clock.currentTime ?? 0) : null
    endFlight(s)

    // Freezes transitions before any read, or the first read would start the row's own CSS transitions.
    row.classList.add('sp-row', 'sp-flying')
    try {
      const visible = row.clientWidth > 0
      if (visible) noteOffColours(s, row, target)
      if (enabled && visible && target && typeof target.animate === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const to = edgesOf(target, row)
        const from = midFlight
          || (source && source !== target && row.contains(source) ? edgesOf(source, row) : null)
          || (mounting && persistKey ? rememberedEdges(lastEdges.get(persistKey), activeKey, performance.now()) : null)
        const move = planMove(from, to)
        if (move.fly) s.flight = launch(s, row, target, move.from, to)
      }
    } catch {
      // The rest state is complete on its own: drop whatever got started.
      s.flight = null
      row.querySelectorAll(':scope > .sp-pill').forEach(el => el.remove())
    }
    if (!s.flight) freezeOff(row, target)
  }, [rowRef, activeKey, selector, enabled, persistKey])

  // The remount note is written straight away, because the next row mounts in this same commit. Taking the flight
  // down waits a microtask, because React's StrictMode runs this cleanup and the effect back to back on a live row.
  useLayoutEffect(() => {
    const s = state.current
    s.mounted = true
    return () => {
      s.mounted = false
      if (persistKey && s.row && s.row.clientWidth > 0) {
        const f = s.flight
        const edges = f ? edgesAt(f.from, f.to, f.clock.currentTime ?? 0) : s.el && s.row.contains(s.el) ? edgesOf(s.el, s.row) : null
        if (edges) lastEdges.set(persistKey, { key: s.key, edges, at: performance.now() })
      }
      queueMicrotask(() => { if (!s.mounted) endFlight(s) })
    }
  }, [persistKey])
}
