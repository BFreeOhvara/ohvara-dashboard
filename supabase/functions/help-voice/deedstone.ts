// help-voice, P916 — Deedstone's TwiML. Two jobs, both on Twilio webhooks this function already signs-checks:
//
// 1. An agent's Call (fulfillment-call agent_call rang the agent's phone from their Deedstone number):
//    ds_bridge      the agent answered: "Deedstone call to {name}. Press 1 to connect." (a voicemail can't press 1,
//                   so the client is never dialed into an agent's voicemail)
//    ds_bridge_go   pressed 1: the pre-dial check once more (deedstone_call_connect), then <Dial> the client with
//                   callerId = the agent's Deedstone number. No recording (Q51).
//    ds_client_leg  the client's leg status (answered → live)
//    ds_bridge_done the <Dial> ended: the call row closes with why
//    ds_agent_leg   the agent's leg status (no answer, busy, failed, hung up → the row closes)
//
// 2. Calls in: someone rang any Deedstone number. deedstone_inbound_start looks them up by their phone number (a
//    client's policy, else a lead). Their agent, inside the agent's working hours with a connected phone → the
//    agent's phone rings ~20 s with a whisper ("press 1 to take it"). Not taken, unknown caller, or the agent can't
//    → the VA desk (P882: the next free VA, after hours the greeting and a booked callback, nobody in 2 minutes →
//    a callback).
//    ds_screen      the whisper on the agent's phone
//    ds_take        the agent pressed (or didn't press) 1
//    ds_after_agent the <Dial> to the agent ended: taken → done; else → the VA desk

import { xmlEsc } from '../_shared/twilio.ts'

export type BridgeRow = { id: string; status: string; client_name: string | null; ended_at?: string | null }
export interface BridgeStore {
  bridgeCall(id: string): Promise<BridgeRow | null>
  bridgeConnect(id: string): Promise<{ ok: boolean; reason?: string | null; from?: string; client_phone?: string; name?: string | null }>
  bridgeSave(id: string, patch: Record<string, unknown>, whenOpen?: boolean): Promise<void>
}
export interface DeedstoneInbound {
  inboundStart(callSid: string, caller: string, to: string): Promise<{ agent: boolean; phone: string | null; name: string | null }>
  inboundName(callSid: string): Promise<string | null>
  inboundTook(callSid: string): Promise<void>
  inboundDone(callSid: string): Promise<boolean>
}

export const AGENT_RING_SECS = 20
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FINAL = ['completed', 'busy', 'no-answer', 'failed', 'canceled']

export const twiml = (inner = '') =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, { headers: { 'Content-Type': 'text/xml' } })

const url = (base: string, q: Record<string, string>) => `${base}?${new URLSearchParams(q)}`
const nowIso = () => new Date().toISOString()
const first = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || 'your client'

// Why the agent hears the call didn't go, said on their phone.
const SAY_WHY: Record<string, string> = {
  outside_hours: 'It is outside legal calling hours where they are.',
  attempt_cap: 'They have been called the most times allowed today.',
  opted_out: 'They opted out of calls.',
  dnc: 'They asked not to be called.',
}

// ── 1. The agent's Call ──────────────────────────────────────────────────────────────────────────────────────────
export async function bridgeEvent(event: string, q: URLSearchParams, form: Record<string, string>, store: BridgeStore, publicUrl: string) {
  const id = q.get('dc') || ''
  if (!UUID.test(id)) return twiml('<Hangup/>')

  if (event === 'ds_bridge') {
    const c = await store.bridgeCall(id)
    if (!c || c.status === 'ended') return twiml('<Hangup/>')
    await store.bridgeSave(id, { status: 'agent_on', agent_on_at: nowIso() }, true)
    return twiml(`<Gather numDigits="1" timeout="8" action="${xmlEsc(url(publicUrl, { event: 'ds_bridge_go', dc: id }))}" method="POST">` +
      `<Say>Deedstone call to ${xmlEsc(first(c.client_name))}. Press 1 to connect.</Say></Gather>` +
      `<Say>No key pressed. The call is cancelled.</Say><Hangup/>`)
  }

  if (event === 'ds_bridge_go') {
    if (form.Digits !== '1') {
      await store.bridgeSave(id, { status: 'ended', end_reason: 'agent_cancelled', ended_at: nowIso() }, true)
      return twiml('<Say>Cancelled.</Say><Hangup/>')
    }
    const r = await store.bridgeConnect(id)
    if (!r.ok) {
      return twiml(`<Say>${xmlEsc(SAY_WHY[r.reason || ''] || 'This call can not go right now.')} Goodbye.</Say><Hangup/>`)
    }
    return twiml(`<Say>Calling ${xmlEsc(first(r.name))}.</Say>` +
      `<Dial callerId="${xmlEsc(r.from!)}" timeout="30" answerOnBridge="true" action="${xmlEsc(url(publicUrl, { event: 'ds_bridge_done', dc: id }))}" method="POST">` +
      `<Number statusCallback="${xmlEsc(url(publicUrl, { event: 'ds_client_leg', dc: id }))}" statusCallbackMethod="POST" statusCallbackEvent="answered completed">` +
      `${xmlEsc(r.client_phone!)}</Number></Dial>`)
  }

  if (event === 'ds_client_leg') {
    const s = form.CallStatus || ''
    if (s === 'in-progress' || s === 'answered') {
      await store.bridgeSave(id, { status: 'live', connected_at: nowIso(), client_call_sid: form.CallSid || null }, true)
    }
    return twiml()
  }

  if (event === 'ds_bridge_done') {
    const s = form.DialCallStatus || ''
    const reason = s === 'completed' ? 'done' : s === 'no-answer' ? 'client_no_answer' : s === 'busy' ? 'client_busy' : s || 'done'
    await store.bridgeSave(id, { status: 'ended', end_reason: reason, ended_at: nowIso() }, true)
    if (s === 'no-answer' || s === 'busy' || s === 'failed') return twiml('<Say>They didn\'t answer. Goodbye.</Say><Hangup/>')
    return twiml('<Hangup/>')
  }

  if (event === 'ds_agent_leg') {
    const s = form.CallStatus || ''
    if (FINAL.includes(s)) {
      await store.bridgeSave(id, { status: 'ended', end_reason: s === 'completed' ? 'done' : `agent_${s.replace('-', '_')}`, ended_at: nowIso() }, true)
    }
    return twiml()
  }
  return twiml()
}

// ── 2. Calls in ──────────────────────────────────────────────────────────────────────────────────────────────────
// The agent first. null = go to the VA desk now.
export async function inboundToAgent(ds: DeedstoneInbound, publicUrl: string, form: Record<string, string>, caller: string) {
  const callSid = form.CallSid || ''
  const r = await ds.inboundStart(callSid, caller, form.To || '')
  if (!r.agent || !r.phone) return null
  return twiml(`<Dial timeout="${AGENT_RING_SECS}" callerId="${xmlEsc(form.To || '')}" action="${xmlEsc(url(publicUrl, { event: 'ds_after_agent', call: callSid }))}" method="POST">` +
    `<Number url="${xmlEsc(url(publicUrl, { event: 'ds_screen', call: callSid }))}" method="POST">${xmlEsc(r.phone)}</Number></Dial>`)
}

export async function screen(ds: DeedstoneInbound, publicUrl: string, callSid: string) {
  const raw = await ds.inboundName(callSid).catch(() => null)
  const name = raw ? first(raw) : ''
  return twiml(`<Gather numDigits="1" timeout="6" action="${xmlEsc(url(publicUrl, { event: 'ds_take', call: callSid }))}" method="POST">` +
    `<Say>Deedstone call from ${xmlEsc(name || 'a client')}. Press 1 to take it.</Say></Gather><Hangup/>`)
}

export async function take(ds: DeedstoneInbound, callSid: string, form: Record<string, string>) {
  if (form.Digits !== '1') return twiml('<Hangup/>')
  await ds.inboundTook(callSid)
  return twiml()   // the whisper ends: the agent and the caller are connected
}
