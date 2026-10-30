import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PhoneIncoming } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAgentDuty } from '../../hooks/useAgentDuty'
import { transferWatch, myIncomingTransfer, playRing, audioContext } from '../../lib/transferAlert'

// Live-transfer alert, mounted once in PortalV2Layout. While the agent is Active and the tab
// is visible it asks my_incoming_transfer() every 4s; a row rings the portal and shows this
// over the page while help-transfer calls their phone. Portaled to <body> because .page-enter
// keeps a transform that would trap position: fixed (Gotchas). Inactive: no polls, no ring.
export function TransferAlert() {
  const { on } = useAgentDuty()
  const [row, setRow] = useState(null)
  const watch = useRef(null)
  const btn = useRef(null)

  useEffect(() => {
    const w = transferWatch({ fetchRow: () => myIncomingTransfer(supabase), ring: playRing, onChange: setRow, doc: document })
    watch.current = w
    return () => w.stop()
  }, [])

  useEffect(() => {
    watch.current?.setActive(on)
    if (!on) return
    // Browsers only let audio start after a tap; any tap while Active unlocks the ring.
    const unlock = () => audioContext()
    document.addEventListener('pointerdown', unlock, { once: true })
    return () => document.removeEventListener('pointerdown', unlock)
  }, [on])

  useEffect(() => { if (row) btn.current?.focus() }, [row])

  if (!on || !row) return null
  return createPortal(
    <>
      <div className="ov-scrim pv-ta-scrim" aria-hidden="true" />
      <section className="ov-hero pv-ta" role="alertdialog" aria-modal="true" aria-labelledby="pv-ta-title" aria-describedby="pv-ta-text">
        <div className="pv-ta-top">
          <span className="pv-ta-ring" aria-hidden="true"><PhoneIncoming size={22} strokeWidth={2} /></span>
          <span className="pv-hero-label"><i className="pv-dot" />Live transfer</span>
        </div>
        <h2 id="pv-ta-title">Live call for you: {row.caller_label || 'New caller'}.</h2>
        <p id="pv-ta-text">We&rsquo;re calling your phone now. Pick up.</p>
        <button ref={btn} type="button" className="ov-hero-btn pv-ta-btn" onClick={() => watch.current?.dismiss()}>Dismiss</button>
      </section>
    </>,
    document.body,
  )
}
