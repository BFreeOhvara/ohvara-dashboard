import { useState } from 'react'
import { useUpdatePolicy, useStartCall, useEndCall, useSetRescheduleReason, usePassOnCancellation } from './usePolicies'
import { invokeCallerId, FALLBACK_CODES } from '../lib/callerId'
import { isLive, useNow } from '../lib/agentBookings'
import { canStartCall, timeText, tooEarlyText, unlockAt } from '../lib/fulfillmentDay'
import { usePortalPhone } from '../contexts/portalPhone'

// Prompt 756 — Call client is locked until 5 minutes before the call. Ticks
// every 15 s so a button unlocks by itself. `opens` is "3:25 PM" (own zone).
export function useCallLock(p) {
  const now = useNow(15e3)
  const { tz, toast } = usePortalPhone()
  const locked = !!p && !isLive(p) && !canStartCall(p, now, tz)
  const at = locked ? unlockAt(p) : null
  return { locked, opens: at ? timeText(at, tz) : null, tell: () => toast(tooEarlyText(at, tz)) }
}

// ── calling the client (Prompt 666) ─────────────────────────────────────────
// "Call client" rings the rep's own phone first (Twilio), then connects them to
// the client showing the agent's number. If Twilio can't place it, it says why
// and offers the direct dial instead. Without the agent's caller ID it's a
// plain tel: link. `onCall` fires once the call is under way (either path),
// which is what puts the item on a live call.
// Prompt 751: once calling in the portal is on (recovery_config.voice_live),
// the button opens the pop-up phone instead (`portal`), for the rep who can
// work the call.
export function useClientCall(p, { canBridge, onCall }) {
  const [state, setState] = useState({ phase: 'idle' })
  const phone = usePortalPhone()
  const portal = phone.voiceLive && !!onCall
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
  return { state, canBridge, bridge, onCall, portal, openPhone: () => phone.open(p) }
}

// The three ways out of a call, shared by the drawer and the page's focus card.
export function useCallActions(p) {
  const update = useUpdatePolicy()
  const startCall = useStartCall()
  const endCall = useEndCall()
  const setReason = useSetRescheduleReason()
  const passOn = usePassOnCancellation()
  const { tz, toast } = usePortalPhone()
  return {
    start: () => {
      if (isLive(p) || p.fulfillment_stage === 'Complete') return
      if (!canStartCall(p, Date.now(), tz)) { toast(tooEarlyText(unlockAt(p), tz)); return }
      startCall.mutate(p.id, { onError: e => { if (e.tooEarly) toast(tooEarlyText(e.opensAt, tz)) } })
    },
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
    error: update.error || (startCall.error?.tooEarly ? null : startCall.error) || endCall.error || setReason.error || passOn.error,
  }
}
