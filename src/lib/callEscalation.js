// P945 — a booked call nobody started is handled automatically, so it never sits on an admin's To-dos (Brayden,
// Nov 10). At the booked time + 5 minutes with no call started, the VA who has it gets a ping. At + 10 minutes it is
// offered to the next free VA (the agent's Deedstone number pod first, then anyone free) and the first VA is told. If
// nobody can take it, the AI front desk (P932) texts or calls the client to rebook. Pure, so the admin sample, the
// VA side and node --test share one rule; migration 265 (booked_call_escalation_sweep) runs the same steps on the
// server every minute.

export const NUDGE_AFTER = 5 // minutes past the booked time: ping the VA
export const HANDOFF_AFTER = 10 // minutes past the booked time: offer it to the next free VA
export const CLASH_MIN = 30 // a VA with another open call this close to it isn't free for it

// Where a booked call is: 'ahead' (not its time yet), 'wait' (its time, under 5 min), 'nudge', 'handoff', or
// 'started' once the call is live or done.
export function missedStage({ bookedMin, nowMin, started = false }) {
  if (started) return 'started'
  const late = nowMin - bookedMin
  if (late < 0) return 'ahead'
  if (late < NUDGE_AFTER) return 'wait'
  if (late < HANDOFF_AFTER) return 'nudge'
  return 'handoff'
}

// The next VA who can take this call at `atMin`: on shift, not on a call, allowed to take calls (P936 training), not
// the VA who has it, and no other open call within CLASH_MIN. Pod first (in pod order), then everyone else (in list
// order). vas: [{ id, onShift, onCall, canTake }]; calls: [{ id, va_id, min, open }].
export function nextVa({ call, vas = [], calls = [], pod = [], atMin }) {
  const busy = id => calls.some(c => c.id !== call.id && c.va_id === id && c.open && Math.abs(c.min - atMin) < CLASH_MIN)
  const ok = v => v && v.id !== call.va_id && v.onShift && !v.onCall && v.canTake !== false && !busy(v.id)
  const byId = new Map(vas.map(v => [v.id, v]))
  const order = [...pod.map(id => byId.get(id)), ...vas.filter(v => !pod.includes(v.id))]
  return order.find(ok)?.id || null
}

// What happens to one booked call by `nowMin`. Returns { stage, to, rebook, steps } where steps are the things that
// were done, in order, each { at: minutes, kind: 'nudge' | 'handoff' | 'rebook', to? }.
export function escalateCall({ call, nowMin, vas = [], calls = [], pod = [] }) {
  const stage = missedStage({ bookedMin: call.min, nowMin, started: !!call.started })
  const steps = []
  if (stage === 'nudge' || stage === 'handoff') steps.push({ at: call.min + NUDGE_AFTER, kind: 'nudge', to: call.va_id })
  if (stage !== 'handoff') return { stage, to: null, rebook: false, steps }
  const at = call.min + HANDOFF_AFTER
  const to = nextVa({ call, vas, calls, pod, atMin: at })
  steps.push(to ? { at, kind: 'handoff', to, from: call.va_id } : { at, kind: 'rebook' })
  return { stage, to, rebook: !to, steps }
}

// The words for each step, for the admin feed and the VA's notifications.
export function stepText(s, { client = 'The client', time = '', nameOf = id => id } = {}) {
  if (s.kind === 'nudge') return `${nameOf(s.to)} pinged: the ${time} call with ${client} hasn't started`
  if (s.kind === 'handoff') return `${client}'s ${time} call moved to ${nameOf(s.to)} after ${HANDOFF_AFTER} minutes (${nameOf(s.from)} told)`
  return `Nobody free for ${client}'s ${time} call: the AI front desk is texting them to rebook`
}
