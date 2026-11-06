import { Navigate, useParams } from 'react-router-dom'
import { FUL } from './paths'

// P846 — Calls became Schedule. The old Calls address, and a call's drawer under it, land on the Schedule.
export default function OldCall() {
  const { id } = useParams()
  return <Navigate to={id ? `${FUL.schedule}/${id}` : FUL.schedule} replace />
}
