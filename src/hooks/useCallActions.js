import { useState } from 'react'
import { useUpdatePolicy, useStartCall, useEndCall, useSetRescheduleReason, usePassOnCancellation } from './usePolicies'
import { invokeCallerId, FALLBACK_CODES } from '../lib/callerId'
import { isLive } from '../lib/agentBookings'

// ── calling the client (Prompt 666) ─────────────────────────────────────────
// "Call client" rings the rep's own phone first (Twilio), then connects them to
// the client showing the agent's number. If Twilio can't place it, it says why
// and offers the direct dial instead. Without the agent's caller ID it's a
// plain tel: link. `onCall` fires once the call is under way (either path),
// which is what puts the item on a live call.
export function useClientCall(p, { canBridge, onCall }) {
  const [state, setState] = useState({ phase: 'idle' })
  async function bridge() {
    setState({ phase: 'calling' })
    try {
      await invokeCallerId('start-agent-caller-id-call', { policy_id: p.id })
      setState({ phase: 'ringing' })
      onCall?.()
    } catch (e) {
      setState({ phase: FALLBACK_CODES.has(e.code) ? 'fallback' : 'error', message: e.message })
    }
  }
  return { state, canBridge, bridge, onCall }
}

// The three ways out of a call, shared by the drawer and the page's focus card.
export function useCallActions(p) {
  const update = useUpdatePolicy()
  const startCall = useStartCall()
  const endCall = useEndCall()
  const setReason = useSetRescheduleReason()
  const passOn = usePassOnCancellation()
  return {
    start: () => { if (!isLive(p) && p.fulfillment_stage !== 'Complete') startCall.mutate(p.id) },
    noAnswer: opts => endCall.mutate({ id: p.id, outcome: 'no_answer' }, opts),
    // `notes` undefined leaves the saved notes as they are.
    cancelled: (notes, opts) => update.mutate({
      id: p.id, fulfillment_stage: 'Complete', status: 'In Effect',
      ...(notes === undefined ? null : { cancellation_notes: notes.trim() || null }),
    }, opts),
    reason: value => setReason.mutate({ id: p.id, reason: p.cancellation_substatus === value ? null : value }),
    saveNotes: (notes, opts) => update.mutate({ id: p.id, cancellation_notes: notes.trim() || null }, opts),
    passOn: opts => passOn.mutate(p.id, opts),
    busy: update.isPending || endCall.isPending,
    passing: passOn.isPending,
    saving: update.isPending,
    error: update.error || startCall.error || endCall.error || setReason.error || passOn.error,
  }
}
