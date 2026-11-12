import { useMemo, useSyncExternalStore } from 'react'
import { useSampleNeeds, useSampleActivity, useSampleLeads, useSampleClients } from '../data'
import { paths } from '../paths'
import { useApp } from './AppKit'
import { useThreadList } from './AMessages'
import { shortAt } from './threadStore'
import { kindOfActivity, dayOf, minutesOf } from './appModel'

// P972 — what Notifications and Activity read: the rows (with their kind, day group, time and where a tap goes), the
// bell's count, and the device's seen (badge) and read (dots) lists.
// Who an activity row is about: a lead or a client by name (the log keeps names only).
export function useWho() {
  const { data: leads } = useSampleLeads()
  const { data: clients } = useSampleClients()
  return useMemo(() => {
    const m = new Map()
    leads.forEach(l => m.set(`${l.first_name} ${l.last_name}`.toLowerCase(), { lead: l.id }))
    clients.forEach(c => m.set(`${c.client_first_name} ${c.client_last_name}`.toLowerCase(), { client: c.id }))
    return name => m.get(String(name || '').toLowerCase()) || null
  }, [leads, clients])
}

// Where a row goes when tapped.
export function useGo() {
  const app = useApp()
  return to => {
    if (!to) return
    if (to.lead) app.open(paths.lead(to.lead))
    else if (to.client) app.open(paths.client(to.client))
    else if (to.thread) app.openSub('thread', { t: to.thread })
    else if (to.billing) app.open(paths.billing())
    else if (to.clients) app.open(paths.clients(), { cf: to.clients })
  }
}

// A tiny device store (seen = the badge, read = the dots), so the bell updates the moment the panel opens.
function deviceSet(key) {
  const read = () => { try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] } }
  let cache = read()
  const subs = new Set()
  return {
    sub: f => { subs.add(f); return () => { subs.delete(f) } },
    get: () => cache,
    add: ids => {
      const next = [...new Set([...cache, ...ids])].slice(-300)
      if (next.length === cache.length) return
      cache = next
      try { localStorage.setItem(key, JSON.stringify(cache)) } catch { /* private window: fine */ }
      subs.forEach(f => f())
    },
  }
}
export const SEEN = deviceSet('ohv-ma-seen')
export const READ = deviceSet('ohv-ma-read')

const FYI_KIND = { 'New booking': 'booking', 'Missed transfer': 'live', 'No show': 'moved', Rebooking: 'booking' }
export const byTime = (a, b) => minutesOf(b.time) - minutesOf(a.time)
export function useNotifItems() {
  const { data: needs } = useSampleNeeds()
  const { data: act } = useSampleActivity()
  const { threads } = useThreadList()
  const who = useWho()
  return useMemo(() => {
    const top = [
      ...(needs.notices || []).map(n => ({ id: `bill-${n.key}`, kind: 'payment', title: n.title || n.name, what: n.what, time: 'Now', group: 'today', to: { billing: true } })),
      ...needs.now.map(n => ({
        id: n.id, kind: n.trigger === 'live' ? 'live' : n.kind === 'check' ? 'risk' : n.kind === 'submit' ? 'sold' : 'todo',
        title: n.kind === 'check' ? n.title : n.name, what: n.kind === 'check' ? `${n.name}. ${n.what}` : n.what,
        time: n.when && n.when !== 'Today' ? n.when : '', group: 'today',
        to: n.kind === 'check' ? { clients: 'need' } : n.ref ? { lead: n.ref } : null,
      })),
      ...(needs.fyi || []).map(n => ({ id: n.id, kind: FYI_KIND[n.title] || 'booking', title: n.name, what: `${n.title}. ${n.what}`, time: '', group: 'today', to: n.ref ? { lead: n.ref } : null })),
      ...threads.filter(t => t.unread > 0).map(t => {
        const last = t.messages?.[t.messages.length - 1]
        const d = dayOf(last?.at)
        return { id: `msg-${t.id}-${t.messages?.length || 0}`, kind: 'message', title: t.name, what: last ? last.text : 'New message', time: d.group === 'earlier' ? shortAt(last?.at) : d.time, group: 'today', to: { thread: t.id } }
      }),
    ]
    const log = act.map(a => {
      const d = dayOf(a.at)
      return { id: `act-${a.id}`, kind: kindOfActivity(a), title: a.who, what: a.text, time: d.group === 'earlier' ? d.day : d.time, group: d.group, to: who(a.who), old: d.group !== 'today' }
    })
    const today = log.filter(x => x.group === 'today').sort(byTime)
    return [...top, ...today, ...log.filter(x => x.group === 'yesterday').sort(byTime), ...log.filter(x => x.group === 'earlier')]
  }, [needs, act, threads, who])
}

// The bell's count: today's notifications not seen yet.
export function useUnseen() {
  const items = useNotifItems()
  const seen = useSyncExternalStore(SEEN.sub, SEEN.get)
  return items.filter(i => i.group === 'today' && !seen.includes(i.id)).length
}

