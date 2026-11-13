// P911 — Ohvara Support: the admin team (Brayden and Jordan) as one contact, pinned at the top of every agent's and
// VA's Messages list. It looks like any thread (avatar, name, last message) but can't be deleted or hidden: it shows
// even when a search matches nothing else. Admins answer it from admin Messages, as Ohvara Support.
export const SUPPORT_THREAD = 'ohvara-support'
export const SUPPORT_NAME = 'Ohvara Support'
export const isSupport = t => !!t && (t.support === true || t.id === SUPPORT_THREAD)

// The list as shown: Ohvara Support first (always), then the threads that match the search.
export function pinSupport(threads = [], matches = () => true) {
  const sup = threads.find(isSupport)
  const rest = threads.filter(t => !isSupport(t) && matches(t))
  return sup ? [sup, ...rest] : rest
}

// An empty Ohvara Support line (a new account, or real data with no messages yet).
export const emptySupport = () => ({ id: SUPPORT_THREAD, support: true, client_id: null, name: SUPPORT_NAME, unread: 0, messages: [] })

// P987 — agents, VAs, leads and clients never see an admin's own name. Anything an admin wrote or did shows as
// Ohvara Support; admins still see each other's names.
export const shownName = (name, role, viewerRole) => (role === 'admin' && viewerRole !== 'admin' ? SUPPORT_NAME : name)
