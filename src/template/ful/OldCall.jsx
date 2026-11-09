import { Navigate, useParams } from 'react-router-dom'
import { fp } from './paths'

// P846 — the old Calls address (/fulfillment/desk) and a call's drawer under it. P918: every old address for a booked
// call (Calls, Queue, Servicing, and /fulfillment/schedule/<id> from before the Calendar) lands on the Calendar, with
// the call's drawer open when the address named one.
export default function OldCall() {
  const { id } = useParams()
  return <Navigate to={fp('calendar', id)} replace />
}
