import { useMemo } from 'react'
import { useSampleLeads, useSampleClients } from '../data'
import { paths } from '../paths'
import { useApp } from './AppKit'
import { minutesOf } from './appModel'

// P972 — what Activity reads: who a row is about, where a tap goes, newest first. P1023: the bell is hooks/useBell.
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

export const byTime = (a, b) => minutesOf(b.time) - minutesOf(a.time)
