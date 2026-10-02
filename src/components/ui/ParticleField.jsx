import { useEffect, useRef } from 'react'
import { useTheme } from '../../hooks/useTheme'

// Prompt 669 — the slow dot-network background from Restorix Portal
// (restorix-portal components/ui/ParticleField.jsx, itself ported from
// restorix-marketing), mounted once in DashboardLayout behind every page.
//
// Two differences from the Restorix copy:
// - Colours come from the --particle-line / --particle-dot tokens in
//   index.css, read with getComputedStyle when the theme changes, instead of
//   hardcoded rgba — canvas can't resolve CSS variables directly, but this
//   keeps every colour defined in one place.
// - Pointer tracking listens on window. The canvas layer is
//   pointer-events:none so it never blocks clicks, which meant Restorix's
//   parent-element listener never fired and the cursor repel never ran.
//
// Like Restorix's, it pauses when the tab is hidden or the canvas scrolls out
// of view, and stays still under prefers-reduced-motion.
const DOT_COUNT = 42
const LINK_DISTANCE = 250
const LINK_OPACITY = 0.28
const LINE_WIDTH = 1.25
const SPEED = 0.12
const REPEL_RADIUS = 90
const REPEL_STRENGTH = 42
const EASE = 0.12

function readColors() {
  const cs = getComputedStyle(document.documentElement)
  return {
    line: cs.getPropertyValue('--particle-line').trim() || '75,121,206',
    dot: cs.getPropertyValue('--particle-dot').trim() || 'rgba(107,147,217,0.55)',
  }
}

export default function ParticleField({ className = '' }) {
  const canvasRef = useRef(null)
  const mouseRef = useRef({ x: -9999, y: -9999 })
  const [theme] = useTheme()

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return
    const colors = readColors()

    const ctx = canvas.getContext('2d')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    let width = 0
    let height = 0
    let dots = []
    let rafId = null

    function resize() {
      const rect = parent.getBoundingClientRect()
      width = rect.width
      height = rect.height
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function seed() {
      dots = Array.from({ length: DOT_COUNT }, () => {
        const x = Math.random() * width
        const y = Math.random() * height
        return {
          x, y,
          rx: x, ry: y,
          vx: (Math.random() - 0.5) * SPEED,
          vy: (Math.random() - 0.5) * SPEED,
          r: Math.random() * 2.6 + 1.1,
        }
      })
    }

    function draw(animate) {
      ctx.clearRect(0, 0, width, height)
      const mouse = mouseRef.current
      for (const d of dots) {
        if (animate) {
          d.x += d.vx
          d.y += d.vy
          if (d.x < 0 || d.x > width) d.vx *= -1
          if (d.y < 0 || d.y > height) d.vy *= -1
        }

        let targetX = d.x
        let targetY = d.y
        const distX = d.x - mouse.x
        const distY = d.y - mouse.y
        const dist = Math.hypot(distX, distY)
        if (dist < REPEL_RADIUS && dist > 0.01) {
          const force = (1 - dist / REPEL_RADIUS) * REPEL_STRENGTH
          targetX += (distX / dist) * force
          targetY += (distY / dist) * force
        }

        if (animate) {
          d.rx += (targetX - d.rx) * EASE
          d.ry += (targetY - d.ry) * EASE
        } else {
          d.rx = targetX
          d.ry = targetY
        }
      }

      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const a = dots[i]
          const b = dots[j]
          const dist = Math.hypot(a.rx - b.rx, a.ry - b.ry)
          if (dist < LINK_DISTANCE) {
            ctx.strokeStyle = `rgba(${colors.line}, ${LINK_OPACITY * (1 - dist / LINK_DISTANCE)})`
            ctx.lineWidth = LINE_WIDTH
            ctx.beginPath()
            ctx.moveTo(a.rx, a.ry)
            ctx.lineTo(b.rx, b.ry)
            ctx.stroke()
          }
        }
      }
      ctx.fillStyle = colors.dot
      for (const d of dots) {
        ctx.beginPath()
        ctx.arc(d.rx, d.ry, d.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    function loop() {
      draw(true)
      rafId = requestAnimationFrame(loop)
    }

    function stopLoop() {
      if (rafId != null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    }

    function startLoop() {
      if (rafId == null && !document.hidden) rafId = requestAnimationFrame(loop)
    }

    let seeded = false

    const sizeObserver = new ResizeObserver(() => {
      resize()
      if (!seeded && width > 0 && height > 0) {
        seed()
        seeded = true
      }
      draw(false)
    })
    sizeObserver.observe(parent)

    function onPointerMove(e) {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    function onPointerLeave() {
      mouseRef.current = { x: -9999, y: -9999 }
    }
    if (!reduceMotion) {
      window.addEventListener('pointermove', onPointerMove)
      document.documentElement.addEventListener('pointerleave', onPointerLeave)
    }

    let intersectionObserver = null
    function onVisibilityChange() {
      if (document.hidden) stopLoop()
      else startLoop()
    }
    if (!reduceMotion) {
      intersectionObserver = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) startLoop()
        else stopLoop()
      })
      intersectionObserver.observe(canvas)
      document.addEventListener('visibilitychange', onVisibilityChange)
    }

    return () => {
      sizeObserver.disconnect()
      stopLoop()
      if (intersectionObserver) intersectionObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pointermove', onPointerMove)
      document.documentElement.removeEventListener('pointerleave', onPointerLeave)
    }
    // Re-init on theme switch so the loop picks up that theme's colours.
  }, [theme])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
