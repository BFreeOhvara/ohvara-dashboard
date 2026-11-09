// P916 — Deedstone calling for the agent portal, the sample side. The real side (hooks/deedstoneReal.js) has the same
// shape; DataProvider hands screens one or the other (data/index.js SAMPLE.deedstone, hooks/agentRealData.js REAL.deedstone):
//   usePhone()      the agent's connected phone { phone, pending, pendingPhone, loading, refresh }
//   sendCode(phone) a voice call reads a 6-digit code to that phone
//   confirm(code)   { ok, reason, tries_left }
//   disconnect()
//   call(target)    rings the agent's phone, then dials the client from Deedstone → { call_id }
//   hangup(id)
//   useCall(id)     the call's row as it moves { status, end_reason }
// Sample: nothing rings; the steps play out on a timer, and the code is always 123456.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { e164 } from '../lib/deedstoneCall.js'

// ── sample ───────────────────────────────────────────────────────────────────────────────────────────────────
export const SAMPLE_CODE = '123456'
let sample = { phone: '+12145550100', pending: false, pendingPhone: null, calls: {} }
const subs = new Set()
const put = patch => { sample = { ...sample, ...patch }; subs.forEach(f => f()) }
const subscribe = f => { subs.add(f); return () => subs.delete(f) }
const snap = () => sample
const wait = ms => new Promise(r => setTimeout(r, ms))
// The steps a sample call plays (ms from the tap).
export const SAMPLE_STEPS = [['calling_agent', 0], ['agent_on', 2500], ['calling_client', 4000], ['live', 7000]]

export const SAMPLE_DEEDSTONE = {
  source: 'sample',
  usePhone() {
    const s = useSyncExternalStore(subscribe, snap)
    return { phone: s.phone, pending: s.pending, pendingPhone: s.pendingPhone, loading: false, refresh: () => {} }
  },
  async sendCode(phone) {
    const e = e164(phone)
    if (!e) { const err = new Error('Enter a 10-digit US phone number.'); err.code = 'bad_phone'; throw err }
    await wait(400)
    put({ pending: true, pendingPhone: e })
    return { ok: true, calling: e }
  },
  async confirm(code) {
    await wait(300)
    if (!sample.pending) return { ok: false, reason: 'no_code' }
    if (String(code).replace(/\D/g, '') !== SAMPLE_CODE) return { ok: false, reason: 'wrong_code', tries_left: 4 }
    put({ phone: sample.pendingPhone, pending: false, pendingPhone: null })
    return { ok: true, phone: sample.phone }
  },
  async disconnect() { put({ phone: null, pending: false, pendingPhone: null }) },
  async call(target) {
    if (!sample.phone) { const err = new Error('Connect your phone in Settings first.'); err.code = 'no_agent_phone'; throw err }
    const id = `sample-call-${Date.now()}`
    put({ calls: { ...sample.calls, [id]: { at: Date.now(), name: target.name, ended: null } } })
    return { ok: true, call_id: id, name: target.name }
  },
  async hangup(id) {
    if (sample.calls[id]) put({ calls: { ...sample.calls, [id]: { ...sample.calls[id], ended: 'agent_hung_up' } } })
  },
  useCall(id) {
    const s = useSyncExternalStore(subscribe, snap)
    const [, tick] = useState(0)
    const c = id ? s.calls[id] : null
    useEffect(() => {
      if (!c || c.ended) return undefined
      const t = setInterval(() => tick(n => n + 1), 500)
      return () => clearInterval(t)
    }, [c])
    if (!c) return null
    if (c.ended) return { status: 'ended', end_reason: c.ended }
    const gone = Date.now() - c.at
    const step = [...SAMPLE_STEPS].reverse().find(([, ms]) => gone >= ms)
    return { status: step[0], end_reason: null }
  },
}
