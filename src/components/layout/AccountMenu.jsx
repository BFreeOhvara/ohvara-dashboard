import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Moon, Sun, Smartphone, Bug, LogOut } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { useUnresolvedBugReportCount } from '../../hooks/useBugReports'

// Account menu (Prompt 722) — replaces the sidebar's round bug / phone buttons
// and the card's slide-up Sign out panel. Opens upward out of the account card
// (same width, 4px above it) or, on the collapsed rail, to the right of the
// avatar. Portaled to <body> so the rail's overflow can't clip it and the
// sidebar's re-pointed colour tokens don't reach it. Exact motion in the P722
// mockup (media/p722-sidebar-header/mockup-account-menu-dark.html): in 280ms,
// rows fade up 35ms apart, out 160ms; opacity only under reduced motion. Stays
// mounted until its exit animation ends.
//
// `anchor` is the trigger's DOMRect, read by the caller when it opened the
// menu (the sidebar doesn't move while it's open; a resize closes it).

const STAGGER = 35

export function AccountMenu({ open, anchor, placement = 'above', onClose, triggerRef, isAdmin, onPhoneApp, onReport, onSignOut }) {
  const [theme, setTheme] = useTheme()
  const panel = useRef(null)
  const [shown, setShown] = useState(open)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setShown(true)
  }
  const closing = shown && !open

  // Exit fallback: a hidden tab can pause the animation and never fire animationend.
  useEffect(() => {
    if (!closing) return undefined
    const t = setTimeout(() => setShown(false), 260)
    return () => clearTimeout(t)
  }, [closing])

  useEffect(() => {
    if (!open) return undefined
    panel.current?.querySelector('[role^="menuitem"]')?.focus({ preventScroll: true })
    const onDown = e => {
      if (panel.current?.contains(e.target) || triggerRef?.current?.contains(e.target)) return
      onClose()
    }
    const onKey = e => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
      triggerRef?.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [open, onClose, triggerRef])

  if (!shown || !anchor) return null

  const pos = placement === 'right'
    ? { left: anchor.right + 12, bottom: window.innerHeight - anchor.bottom, width: 248, transformOrigin: '0% 100%' }
    : { left: anchor.left, bottom: window.innerHeight - anchor.top + 4, width: anchor.width, transformOrigin: '50% 100%' }

  // Arrow keys move between rows (the two theme buttons count as rows).
  const onKeyDown = e => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = [...panel.current.querySelectorAll('[role^="menuitem"]')]
    const i = items.indexOf(document.activeElement)
    e.preventDefault()
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
    items[next]?.focus()
  }

  const pick = fn => () => { onClose(); fn() }
  let n = 0
  const delay = () => ({ animationDelay: `${40 + STAGGER * n++}ms` })

  return createPortal(
    <div
      ref={panel} role="menu" aria-label="Account" onKeyDown={onKeyDown}
      className={`ov-card ov-menu${closing ? ' is-closing' : ''}`}
      style={{ position: 'fixed', zIndex: 130, ...pos }}
      onAnimationEnd={e => { if (closing && e.target === e.currentTarget) setShown(false) }}
    >
      <div className="ov-mi ov-mi-theme" style={delay()}>
        <Moon size={16} strokeWidth={1.9} className="ov-mi-icon" aria-hidden="true" />
        <span id="ov-theme-label" style={{ flex: 1 }}>Theme</span>
        <span className="ov-theme-switch" role="group" aria-labelledby="ov-theme-label">
          <span className="ov-thumb" style={{ left: theme === 'light' ? 32 : 2 }} aria-hidden="true" />
          <button type="button" role="menuitemradio" aria-checked={theme !== 'light'} aria-label="Dark theme"
            className={theme !== 'light' ? 'is-on' : ''} onClick={() => setTheme('dark')}>
            <Moon size={14} strokeWidth={2.2} />
          </button>
          <button type="button" role="menuitemradio" aria-checked={theme === 'light'} aria-label="Light theme"
            className={theme === 'light' ? 'is-on' : ''} onClick={() => setTheme('light')}>
            <Sun size={14} strokeWidth={2.2} />
          </button>
        </span>
      </div>
      <button type="button" role="menuitem" className="ov-mi ov-mi-row" style={delay()} onClick={pick(onPhoneApp)}>
        <Smartphone size={16} strokeWidth={1.9} className="ov-mi-icon" />Get the phone app
      </button>
      <button type="button" role="menuitem" className="ov-mi ov-mi-row" style={delay()} onClick={pick(onReport)}>
        <Bug size={16} strokeWidth={1.9} className="ov-mi-icon" />
        <span style={{ flex: 1 }}>{isAdmin ? 'Bug reports' : 'Report a problem'}</span>
        {isAdmin && <BugCount />}
      </button>
      <div className="ov-mi ov-mi-sep" style={delay()} role="separator" />
      <button type="button" role="menuitem" className="ov-mi ov-mi-row is-danger" style={delay()} onClick={pick(onSignOut)}>
        <LogOut size={16} strokeWidth={1.9} className="ov-mi-icon" />Sign out
      </button>
    </div>,
    document.body
  )
}

// Admins only: unresolved reports, as a pill on the Bug reports row.
function BugCount() {
  const { data: n = 0 } = useUnresolvedBugReportCount()
  if (!n) return null
  return <span className="ov-count" aria-label={`${n} unresolved`}>{n > 99 ? '99+' : n}</span>
}
