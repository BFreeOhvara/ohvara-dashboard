import { useMemo } from 'react'
import { useAdmDay, useAdmThreads, useAdmSource, OWNERS, ownerOf } from '../data'
import { useAccount } from '../../template/kit'
import { useApp } from '../../template/m/AppKit'
import { useLater, useAdmChats, admChats } from './admStore'

// P986 — what several admin app screens share: the Needs you list (Home's cards and the Home tab's red count), the
// owner signed in (sample: Brayden's side, like the desktop's Billing), and the unread count for Messages.
export function useNeeds() {
  const { data: day } = useAdmDay()
  const later = useLater()
  return useMemo(() => {
    const items = [
      ...day.requests.map(r => ({ key: `off-${r.id}`, kind: 'dayoff', r })),
      ...day.failed.map(a => ({ key: `fail-${a.id}`, kind: 'failed', a })),
      ...(day.unassigned.length ? [{ key: `un-${day.unassigned.map(l => l.id).join('.')}`, kind: 'unassigned', leads: day.unassigned }] : []),
    ].filter(i => !later.includes(i.key))
    return items
  }, [day, later])
}

export function useOwnerMe() {
  const account = useAccount()
  const src = useAdmSource()
  return ownerOf(account?.name) || (src === 'real' ? null : OWNERS[0])
}

// The name the app shows for the signed-in admin: their own name when they are an owner or on real data; on sample
// (the preview account is a stand-in) the owner the sample speaks for, so Home, You and the tab avatar agree.
export function useAdmName() {
  const account = useAccount()
  const src = useAdmSource()
  const me = useOwnerMe()
  if (ownerOf(account?.name) || src === 'real') return account?.name || ''
  return me?.name || account?.name || ''
}

export function useUnread() {
  const { data: threads } = useAdmThreads()
  const local = useAdmChats()
  return threads.reduce((n, t) => n + (t.unread || 0), 0) + local.reduce((n, t) => n + (t.unread || 0), 0)
}

// Open the chat with one person (an agent or a VA): their line with Ohvara Support if they have one, else a new chat.
export function useMessageTo() {
  const app = useApp()
  const { data: threads } = useAdmThreads()
  return (person, about) => {
    const t = threads.find(x => x.who === person.id)
    if (t) { app.openSub('thread', { t: t.id }); return }
    const id = `adm-to-${person.id}`
    admChats.start(id, person.name, about)
    app.openSub('thread', { t: id })
  }
}
