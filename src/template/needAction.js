import { useNavigate } from 'react-router-dom'
import { useSampleActions } from './data'
import { useNote } from './kit'
import { paths } from './paths'

// P873 — what each Needs-you-now action button does (NeedsNow.jsx draws them).
const toOf = item => (item.kind === 'billing' ? paths.billing() : item.kind === 'client' ? paths.client(item.ref) : paths.lead(item.ref))

// What each action button does. Calls connect once the phone side is live; until then it says so and opens the lead.
export function useNeedAction(onDone) {
  const navigate = useNavigate()
  const { moveLead, callBack } = useSampleActions()
  const note = useNote()
  return item => {
    const to = toOf(item)
    const first = (item.name || '').split(' ')[0]
    onDone?.()
    if (item.trigger === 'live') { moveLead(item.ref, 'showed'); note(`You took the call with ${first}. The team dropped off`); navigate(to); return }
    if (item.trigger === 'starting' || item.trigger === 'follow') { note(`Calling ${first} at ${item.phone}. Calls connect when your leads go live`); navigate(to); return }
    if (item.trigger === 'outcome') { navigate(`${to}?outcome=1`); return }
    if (item.trigger === 'call') { callBack(item.ref); note(`Calling ${first} at ${item.phone}. Calls connect when your leads go live`); navigate(to); return }
    if (item.trigger === 'finish') { navigate(paths.submit(item.ref)); return }
    navigate(to)
  }
}

