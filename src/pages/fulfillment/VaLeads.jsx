import { useState } from 'react'
import { Phone } from 'lucide-react'
import { useVaDesk } from '../../hooks/useVaDesk'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import VaQueue from '../../components/fulfillment/VaQueue'
import VaDesk, { LogisticsLine } from '../../components/fulfillment/VaDesk'
import { heldRow, lostRace, notInQueue } from '../../lib/vaQueue'
import '../../components/fulfillment/vaDesk.css'

// VA desk (route /fulfillment/leads): the queue on the left, the lead you
// hold on the right (one column below 1100px; while a lead is held the phone
// shows only that lead). Tapping a lead takes it for 15 minutes (va_claim).
// Logistics only: nothing about cost or coverage, and nothing is sent from
// this page.

export default function VaLeads() {
  const desk = useVaDesk()
  const phone = usePhoneLayout()
  const [held, setHeld] = useState(null) // { row, expiresAt }
  const [claimingId, setClaimingId] = useState(null)
  const [notice, setNotice] = useState('')

  // A reload (or a second tab) comes back to the lead you already hold.
  const restored = heldRow(desk.queue.data)
  const active = held || (restored ? { row: restored, expiresAt: restored.claim_expires_at } : null)

  const take = row => {
    if (claimingId || active) return
    setNotice('')
    setClaimingId(row.lead_id)
    desk.claim.mutate(row.lead_id, {
      onSuccess: expiresAt => setHeld({ row, expiresAt }),
      onError: err => setNotice(
        lostRace(err) ? 'Another VA already has this lead. Pick another one.'
          : notInQueue(err) ? 'That lead is no longer in the queue. Pick another one.'
            : "Couldn't take that lead. Try again.",
      ),
      onSettled: () => setClaimingId(null),
    })
  }

  const back = () => { setHeld(null); setNotice(''); desk.queue.refetch() }

  return (
    <div className={`va${active ? ' va-held' : ''}`}>
      {phone && <p className="sub" style={{ marginBottom: 14 }}>People nobody has reached yet and callers who need policy help. Tap one to take it.</p>}
      <div className="va-grid">
        <div className="va-col va-qcol">
          <VaQueue queue={desk.queue} heldId={active?.row.lead_id} claimingId={claimingId} notice={notice} onTake={take} />
        </div>
        <div className="va-col">
          {active ? (
            <VaDesk key={active.row.lead_id} desk={desk} row={active.row} expiresAt={active.expiresAt} onBack={back} />
          ) : (
            <>
              <LogisticsLine />
              <div className="ov-card va-empty">
                <span className="va-tile"><Phone size={20} strokeWidth={2} aria-hidden="true" /></span>
                <h3>Pick a lead to start</h3>
                <p className="sub">Callback due comes first. Tapping a lead holds it for you so no other VA calls them at the same time.</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
