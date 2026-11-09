import { useNavigate } from 'react-router-dom'
import { paths } from './paths'

// P873 → P910 — what each to-do's action button does (NeedsNow.jsx draws them).
const toOf = item => (item.kind === 'billing' ? paths.billing() : item.kind === 'check' ? paths.clients('needs_attention') : item.kind === 'client' ? paths.client(item.ref) : item.kind === 'submit' ? paths.submit(item.ref) : paths.lead(item.ref))

// What each action button does. Calls connect once the phone side is live; until then it says so and opens the lead.
export function useNeedAction(onDone) {
  const navigate = useNavigate()
  return item => {
    const to = toOf(item)
    onDone?.()
    // A call to mark (booked or live) opens the lead with the result sheet; the check opens Clients' check list.
    if (item.trigger === 'outcome' || item.trigger === 'live') { navigate(`${to}?outcome=1`); return }
    navigate(to)
  }
}

