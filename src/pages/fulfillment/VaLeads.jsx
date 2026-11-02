import { useState } from 'react'
import { Phone } from 'lucide-react'
import { useVaDesk, useVaNextSlot } from '../../hooks/useVaDesk'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import VaQueue from '../../components/fulfillment/VaQueue'
import VaDesk, { LogisticsLine } from '../../components/fulfillment/VaDesk'
import { displayName, heldRow, lostRace, notInQueue } from '../../lib/vaQueue'
import { fmtSlotTime } from '../../lib/scheduling'
import { inferTimezoneFromState } from '../../lib/timezones'
import '../../components/fulfillment/vaDesk.css'

// VA desk (route /fulfillment/leads): the queue on the left, the lead you
// hold on the right (one column below 1100px; while a lead is held the phone
// shows only that lead). Tapping a lead takes it for 15 minutes (va_claim).
// Logistics only: nothing about cost or coverage, and nothing is sent from
// this page.

// A live transfer nobody answered: the next open slot within the hour, one tap to
// book it on the same path as the desk (take the lead, then desk.book). The hold
// goes back if nothing was booked. Take it opens the lead for any other outcome.
function MissedRow({ row, desk, locked, onTake, onBooked }) {
  const slot = useVaNextSlot(row.lead_id)
  const [busy, setBusy] = useState(false)
  const [bookingId, setBookingId] = useState(null)
  const [msg, setMsg] = useState('')

  const book = async () => {
    setBusy(true)
    setMsg('')
    let claimed = false
    try {
      await desk.claim.mutateAsync(row.lead_id)
      claimed = true
      await desk.book.mutateAsync({
        lead: row,
        agentId: row.agent_id,
        scheduledAt: slot.data,
        timezone: inferTimezoneFromState(row.state || row.va_checklist?.state),
        carrier: null,
        checklist: row.va_checklist,
        bookingId,
      })
      onBooked(`Booked ${displayName(row)} with ${row.agent_name} at ${fmtSlotTime(slot.data)}. No text, email or call was sent.`)
    } catch (e) {
      if (e?.bookingId) {
        setBookingId(e.bookingId)
        setMsg("Booked on the calendar, but it didn't save to the lead. Try again.")
        return
      }
      if (claimed) desk.release.mutate(row.lead_id)
      setMsg(lostRace(e) ? 'Another VA already has this lead.'
        : e?.hint === 'working_hours' ? e.message
          : "Couldn't book. Nothing was saved.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="va-missed">
      <p className="nm">{displayName(row)}</p>
      <p className="sub">{row.agent_name ? `Missed by ${row.agent_name}` : 'Missed live transfer'}</p>
      <p className="va-missed-slot" role="status">
        {slot.isLoading ? 'Checking the next hour…'
          : slot.isError ? "Couldn't check open slots."
            : slot.data ? <>Next open slot: <b className="tab">{fmtSlotTime(slot.data)}</b></>
              : 'No open slot in the next hour'}
      </p>
      {msg && <p className="sub" role="alert">{msg}</p>}
      <div className="va-missed-btns">
        {slot.data && row.agent_id && (
          <button type="button" className="ov-primary va-btn" disabled={locked || busy} onClick={book}>{busy ? 'Booking…' : 'Book'}</button>
        )}
        <button type="button" className="ov-ghost va-btn" disabled={locked || busy} onClick={() => onTake(row)}>Take it</button>
      </div>
    </div>
  )
}

function MissedTransfers({ desk, locked, onTake, onBooked }) {
  const rows = desk.missed.data || []
  if (!rows.length) return null
  return (
    <section className="ov-attn va-qsec" aria-label="Missed transfers">
      <div className="va-qsec-h"><h2>Missed transfers</h2><span className="va-qn tab">{rows.length}</span></div>
      {rows.map(r => <MissedRow key={r.lead_id} row={r} desk={desk} locked={locked} onTake={onTake} onBooked={onBooked} />)}
    </section>
  )
}

export default function VaLeads() {
  const desk = useVaDesk()
  const phone = usePhoneLayout()
  const [held, setHeld] = useState(null) // { row, expiresAt }
  const [claimingId, setClaimingId] = useState(null)
  const [notice, setNotice] = useState('')

  // A reload (or a second tab) comes back to the lead you already hold.
  const restored = heldRow([...(desk.queue.data || []), ...(desk.missed.data || [])])
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
          <MissedTransfers desk={desk} locked={!!active || !!claimingId} onTake={take} onBooked={setNotice} />
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
