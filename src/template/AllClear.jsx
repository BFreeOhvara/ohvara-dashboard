import { useEffect, useState } from 'react'
import { CheckCheck } from 'lucide-react'
import './allclear1004.css'

// P1004 — the empty "Needs you" panel, the same for admin, agent and Fulfillment, desktop and phone. When nothing
// waits on you the panel is a finished card, not a flat grey box: a soft check, "All caught up", one line saying what
// will show up here, and when it was last checked. `phone` = the app's glass card look.
const clock = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

// The time the list was last looked at: now, moving on each minute while the page is open.
function useCheckedAt(at) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t) }, [])
  return at ? new Date(at) : now
}

export function AllClear({ line, at, phone = false, title = 'All caught up' }) {
  const checked = useCheckedAt(at)
  return (
    <div className={`fx-allclear${phone ? ' is-phone' : ''}`} role="status" data-empty="needs">
      <span className="fx-allclear-ic" aria-hidden="true"><CheckCheck size={phone ? 20 : 24} strokeWidth={2.2} /></span>
      <b className="fx-allclear-t">{title}</b>
      {line && <p className="fx-allclear-s">{line}</p>}
      <small className="fx-allclear-at">Checked <span className="tp-num">{clock(checked)}</span></small>
    </div>
  )
}
