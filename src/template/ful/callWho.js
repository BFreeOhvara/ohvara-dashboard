// The person a VA call is with, built from what the system gave the VA (a cancellation call row or a booked
// servicing call). Moved out of Phone.jsx (P975) so the VA phone app starts its calls with the same "who".
import { KIND } from './words.js'
import { fp } from './paths.js'

const OPEN = ['booked', 'no_answer']

// Every call starts from one of these: what the system gave the VA. `rec` = the record, one tap away.
export const fromCall = k => ({
  key: `k-${k.id}`, kind: 'call', id: k.id, role: 'client', name: k.name, number: k.client.client_phone, state: k.client.state, city: k.client.city,
  tz: k.tz || null, agentId: k.client.agent_id, agent: k.agent, reason: `Cancel ${k.old_carrier}, keeping ${k.carrier}`, carrier: k.old_carrier,
  callId: OPEN.includes(k.status) ? k.id : null, notes: k.notes || '', rec: fp('calendar', k.id), when: k.time, iso: k.iso || null, done: !OPEN.includes(k.status),
  bc: { client: k.client, oldCarrier: k.old_carrier }, // P923: the "Before you call" box
})
// P907: a booked servicing call (a hand-off, save, change, callback...) opens on the Calendar when it's yours (P918).
export const fromTask = t => ({
  key: `t-${t.id}`, kind: 'task', id: t.id, role: t.client.lead ? 'lead' : 'client', name: t.name, number: t.client.client_phone, state: t.client.state, city: t.client.city,
  tz: t.tz || null, agentId: t.client.agent_id || t.agent_id, agent: t.agent, reason: [KIND[t.kind] || 'Servicing', t.carrier].filter(Boolean).join(' · '), carrier: t.carrier, notes: t.note || '',
  rec: t.iso && t.mine !== false ? fp('calendar', t.id) : t.client_id ? fp('clients', t.client_id) : fp('calendar', t.id), when: t.when || t.due_text, iso: t.iso || null, done: t.status === 'done',
  bc: t.kind === 'handoff_call' ? { client: t.client } : null, // P923: the "Before you call" box
})
// A Schedule item (P907's one row shape) or, on real data, a call row.
export const fromItem = i => (i.row ? (i.kind === 'task' ? fromTask(i.row) : fromCall(i.row)) : fromCall(i))
