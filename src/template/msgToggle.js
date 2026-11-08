import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { still } from './motion'

// P911 — the header Messages icon (agent and VA shells). While Messages is open it shows selected (NavLink .active,
// p911.css), and clicking it again closes Messages and goes back to Overview: the icon presses and the page shrinks
// toward it as it leaves (the frame's 200 ms page swap, restyled by .is-msg-closing), like the avatar menu's close
// (P893). Reduced motion: it just goes.
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
