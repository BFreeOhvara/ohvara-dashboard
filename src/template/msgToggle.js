import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { still } from './motion'

// P911 — the header Messages icon. P914: every shell (agent, VA, admin). While Messages is open it shows selected
// (NavLink .active, shell914.css), and clicking it again closes Messages and goes back to Overview with the same page
// swap as a nav tab; the icon just presses (.is-closing). Reduced motion: it just goes.
export function useMessagesToggle(on, home) {
  const navigate = useNavigate()
  const [closing, setClosing] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const onClick = e => {
    if (!on) return
    e.preventDefault()
    if (still()) { navigate(home); return }
    setClosing(true)
    navigate(home)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setClosing(false), 260)
  }
  return { closing, onClick }
}
