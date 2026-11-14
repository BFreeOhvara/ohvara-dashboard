import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFulClients } from '../../ful/data'
import { fp } from '../../ful/paths'
import { useApp } from '../AppKit'
import { threadIdFor } from '../threadStore'
import { useVaThreads } from './vaStore'

// P1002 — "Message {agent}" about a client, from anywhere in the VA app (Today's next call, a client, a call's brief):
// opens the chat about that client, or starts one on the spot when there isn't one yet (the desktop's client Message
// button, Clients.jsx). The call brief sits outside the app's frame (no AppCtx), so it falls back to the address.
export function useVaChat() {
  const app = useApp()
  const navigate = useNavigate()
  const { data: clients } = useFulClients()
  const threads = useVaThreads()
  const go = useCallback((sub, params) => {
    if (app) { app.openSub(sub, params); return }
    const q = new URLSearchParams({ s: sub, ...params })
    navigate(`${sub === 'thread' ? fp('messages') : fp('more')}?${q}`, { state: { tab: sub === 'thread' ? 'messages' : 'me' } })
  }, [app, navigate])
  const message = useCallback(clientId => {
    const t = threads.find(x => !x.va && clientId && x.client_id === clientId)
    if (t) { go('thread', { t: t.id }); return true }
    const c = clients.find(x => x.id === clientId)
    if (!c) { if (app) app.goTab('messages'); else navigate(fp('messages')); return false }
    go('thread', { t: threadIdFor(threads, c) })
    return true
  }, [threads, clients, go, app, navigate])
  const client = useCallback(clientId => {
    if (!clientId) return
    if (app) app.openSub('client', { c: clientId })
    else navigate(fp('clients', clientId))
  }, [app, navigate])
  return { message, client }
}
