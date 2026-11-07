// P882 — the VA phone's real line, with no React and nothing imported, so node --test can drive it with stubs.
// The hook (src/hooks/useRealLine.js) hands it supabase.rpc, the fulfillment-call function and the Twilio device.
//
//   rpc(name, args)       → data, throws on error            (va_beat, route_accept, route_pass, va_wrap_*, …)
//   invoke(fn, body)      → data, throws Error with .code    (fulfillment-call: open_line, ring_client, hold, …)
//   connect({ lineId, onEnd, onAccept }) → { hangUp, destroy, mute }   (src/lib/voiceDevice.connectVoice)
//
// Calls start only from what the system gave the VA: an accepted ring (route_accept) or a task's Call button
// (open_line with the lead or policy). Neither ever takes a phone number from the browser.

// A ring the server put on this VA: the kinds that need the lead or client rung once the VA is on the line.
const RING_OUT = ['new_lead', 'callback']

export function realLineApi({ rpc, invoke, connect }) {
  let dev = null
  const join = async (lineId, cb = {}) => {
    dev = await connect({ lineId, onEnd: cb.onEnd, onAccept: cb.onAccept })
    return dev
  }
  const send = (lineId, action, extra = {}) => {
    if (!lineId) return Promise.reject(new Error('This call isn’t connected yet.'))
    return invoke('fulfillment-call', { line_id: lineId, action, ...extra })
  }
  return {
    beat: (status = null, paused = null) => rpc('va_beat', { p_status: status, p_paused: paused }),
    // Answer a ring: claim it (first VA wins), join its line, then ring the lead for a new lead or a callback.
    async accept(offer, cb = {}) {
      const info = await rpc('route_accept', { p_item: offer.id })
      if (!info?.line_id) throw new Error('Someone else took that call.')
      await join(info.line_id, cb)
      if (RING_OUT.includes(info.kind)) await send(info.line_id, 'ring_client')
      return {
        lineId: info.line_id, kind: info.kind, leadId: info.lead_id || null, policyId: info.policy_id || null,
        callSid: info.help_call_sid || null, detail: info.detail || {},
      }
    },
    pass: id => rpc('route_pass', { p_item: id }),
    // A task's Call button: the server opens a line for that lead or policy, the VA joins, then the person is rung.
    async openLine(target, cb = {}) {
      const body = target.leadId ? { lead_id: target.leadId } : { policy_id: target.policyId }
      if (!body.lead_id && !body.policy_id) throw new Error('Calls start from a lead or a client.')
      const r = await invoke('fulfillment-call', { action: 'open_line', ...body })
      await join(r.line_id, cb)
      await send(r.line_id, 'ring_client')
      return r.line_id
    },
    send,
    mute: on => dev?.mute(on),
    hangUp() { dev?.hangUp(); dev?.destroy(); dev = null },
    wrapDone: outcome => rpc('va_wrap_done', { p_outcome: outcome }),
    wrapMore: () => rpc('va_wrap_more', {}),
    doNotCall: ({ phone, leadId = null, policyId = null, reason = null }) =>
      rpc('mark_do_not_call', { p_phone: phone, p_lead: leadId, p_policy: policyId, p_reason: reason }),
    needHelp: lineId => rpc('va_need_help', { p_line: lineId }),
    overtime: (lineId, minutes = 30) => rpc('va_overtime_request', { p_line: lineId, p_minutes: minutes }),
    handoff: (lineId, detail) => send(lineId, 'handoff_hold', { detail }),
    async predial(phone, state, leadId = null) {
      const rows = await rpc('predial_check', { p_phone: phone, p_state: state, p_lead: leadId, p_channel: 'call' })
      const r = Array.isArray(rows) ? rows[0] : rows
      return r ? { ok: !!r.ok, reason: r.reason || null, nextAt: r.next_at ? new Date(r.next_at) : null } : null
    },
  }
}

// The server's clock against this device's, from va_beat's server_now (ms to add to Date.now()).
export const skewOf = serverNow => (serverNow ? Date.parse(serverNow) - Date.now() : 0)

// The ring shown for a server offer: who and what, and when it started on this device's clock.
export function offerRing(offer, skew = 0) {
  if (!offer) return null
  return {
    // The server's 'inbound' (someone called us) is 'call_in' on the VA phone.
    id: offer.id, kind: offer.kind === 'inbound' ? 'call_in' : offer.kind, name: offer.name || 'Unknown caller', state: offer.state || null,
    last4: offer.phone_last4 || null, pullHold: !!offer.pull_hold, detail: offer.detail || {},
    at: offer.offered_at ? Date.parse(offer.offered_at) - skew : Date.now(),
    leadId: offer.lead_id || null, policyId: offer.policy_id || null, callSid: offer.help_call_sid || null,
  }
}
