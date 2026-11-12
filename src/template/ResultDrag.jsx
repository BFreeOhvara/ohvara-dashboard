import { useCallback, useEffect, useRef, useState } from 'react'
import { still } from './motion'
import { laneResults } from './leadDrag'
import './drag978.css'

// P978 — the drag itself (rules in leadDrag.js). Pointer events, no library: a card is picked up after a few pixels of
// movement, a clone of it follows the pointer (the board's lanes scroll and clip, so the real card stays in its slot,
// dimmed), the columns that take it light up in their stage colour and every other column dims. A drop on a valid column
// hands over to onDrop(lead, result) (the same result prompt the Mark result button opens); anywhere else the card
// springs back and onRefuse(lead) says why. Escape cancels. Reduced motion: no tilt, no spring, no glow transition.
const START = 6
const SPRING = 'cubic-bezier(.34, 1.56, .64, 1)'
const laneAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('[data-lane]')?.getAttribute('data-lane') || null

export function useResultDrag({ onDrop, onRefuse }) {
  const [ui, setUi] = useState(null) // { id, lanes: [keys that take the drop], over: key | null }
  const cb = useRef({ onDrop, onRefuse })
  const live = useRef(null)
  useEffect(() => { cb.current = { onDrop, onRefuse } })
  useEffect(() => () => live.current?.abort?.(), [])

  const grab = useCallback((e, lead) => {
    if (e.button !== 0 || (e.pointerType !== 'mouse' && e.pointerType !== 'pen') || e.target.closest('button, input, textarea, select')) return
    const card = e.currentTarget
    const lanes = laneResults(lead)
    const keys = Object.keys(lanes)
    if (!keys.length) return
    const calm = still()
    const from = { x: e.clientX, y: e.clientY }
    const rect = card.getBoundingClientRect()
    const off = { x: from.x - rect.left, y: from.y - rect.top }
    let ghost = null
    let over = null
    let pos = { x: from.x, y: from.y }
    const at = (tilt, lift) => `translate(${pos.x - off.x}px, ${pos.y - off.y}px) rotate(${calm ? 0 : tilt}deg) scale(${calm ? 1 : lift})`
    const draw = () => { if (ghost) ghost.style.transform = at(2.4, 1.035) }
    const begin = () => {
      ghost = document.createElement('div')
      ghost.className = 'tp fx lc-board ldg-ghost'
      ghost.setAttribute('aria-hidden', 'true')
      ghost.inert = true
      ghost.style.width = `${rect.width}px`
      ghost.style.height = `${rect.height}px`
      ghost.appendChild(card.cloneNode(true))
      document.body.appendChild(ghost)
      document.documentElement.classList.add('ldg-grabbing')
      card.setAttribute('data-lifted', '')
      setUi({ id: lead.id, lanes: keys, over: null })
      draw()
    }
    const end = () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('keydown', key, true)
      document.documentElement.classList.remove('ldg-grabbing')
      card.removeAttribute('data-lifted')
      setUi(null)
      live.current = null
    }
    const settle = (frames, ms) => {
      const g = ghost
      ghost = null
      if (!g) return
      if (calm) { g.remove(); return }
      g.animate(frames, { duration: ms, easing: SPRING, fill: 'forwards' }).finished.catch(() => {}).then(() => g.remove())
      setTimeout(() => g.remove(), ms + 250) // never leave a clone behind (a hidden tab doesn't tick animations)
    }
    const move = ev => {
      pos = { x: ev.clientX, y: ev.clientY }
      if (!ghost) {
        if (Math.hypot(pos.x - from.x, pos.y - from.y) < START) return
        begin()
      }
      draw()
      const k = laneAt(pos.x, pos.y)
      const next = k && lanes[k] ? k : null
      if (next !== over) { over = next; setUi(u => (u ? { ...u, over } : u)) }
    }
    const up = ev => {
      pos = { x: ev.clientX, y: ev.clientY }
      const dragged = !!ghost
      if (dragged) {
        const result = lanes[laneAt(pos.x, pos.y)]
        // The click that follows a real drag would open the lead; swallow it.
        const eat = c => { c.preventDefault(); c.stopPropagation() }
        window.addEventListener('click', eat, { capture: true, once: true })
        setTimeout(() => window.removeEventListener('click', eat, true), 0)
        if (result) {
          settle([{ transform: at(2.4, 1.035), opacity: 1 }, { transform: at(0, 1), opacity: 1, offset: 0.55 }, { transform: at(0, 1), opacity: 0 }], 340)
          end()
          cb.current.onDrop(lead, result)
        } else {
          settle([{ transform: at(2.4, 1.035) }, { transform: `translate(${rect.left}px, ${rect.top}px) rotate(0deg) scale(1)` }], 420)
          end()
          cb.current.onRefuse(lead)
        }
        return
      }
      end()
    }
    const cancel = () => { settle([{ transform: at(2.4, 1.035) }, { transform: `translate(${rect.left}px, ${rect.top}px) rotate(0deg) scale(1)` }], 320); end() }
    const key = ev => { if (ev.key === 'Escape') { ev.preventDefault(); cancel() } }
    live.current = { abort: () => { ghost?.remove(); ghost = null; end() } }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('keydown', key, true)
  }, [])

  return { ui, grab }
}
