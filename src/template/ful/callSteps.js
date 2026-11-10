// P931 — the VA call panel, as plain words and rules (no React, so node --test runs it). Brayden (Nov 9): a VA only
// ever talks to a client whose policy is already sold, to help keep it on the books. Every booked call is just a
// call: one short "why" line (the Calendar box and the panel's top line), at most 3 steps for its type, and the
// texts we sent or got. No identity checks on calls we booked (that's only for an unknown caller ringing in).
import { CALLBACK_WHY } from './bookings.js'
import { WELCOME_TEXT_ASK } from '../../lib/bookImport.js'

export const MAX_STEPS = 3
const firstOf = (x, name) => x?.client_first_name || String(name || '').split(' ')[0] || 'them'
const agentFirst = a => String(a || '').split(' ')[0] || 'the agent'

const CHANGE_WORD = {
  payment_change: 'Payment change', beneficiary_change: 'Beneficiary change', address_change: 'Address change',
  draft_date_change: 'Draft date change', name_change: 'Name change', change_request: 'Change request',
}
const NOTICE_WORD = { missed: 'Missed payment', lapse_notice: 'Lapse notice', chargeback_warning: 'Chargeback warning' }
const CALLBACK_SHORT = { missed_call: 'Missed their call', asked: 'Asked for a call', client_text: 'Texted us', client_call: 'Called in', reply: 'Replied to a text' }

// The kind of call an item is: a Calendar item ({ kind: 'call' | 'task', type, row }), a call row (cancel the old
// policy) or a task row ({ kind: 'lapse_save', ... }).
export function typeOf(x) {
  if (!x) return 'callback'
  if (x.kind === 'call' || x.old_carrier) return 'cancel_old'
  if (x.type) return x.type
  const k = x.kind
  if (k === 'handoff_call') return 'handoff'
  if (k === 'lapse_save') return 'save'
  if (k === 'cancel_request') return 'cancel_request'
  if (k === 'callback') return 'callback'
  if (k === 'welcome_call') return 'welcome'
  if (k === 'annual_review' || k === 'review_call') return 'review'
  if (CHANGE_WORD[k]) return 'change'
  return 'callback'
}

// The one short line: what the call is about. Fits a Calendar box ("Cancel old policy", "Missed payment").
export function whyShort(x) {
  const t = x?.row || x || {}
  const type = typeOf(x?.kind === 'call' || x?.kind === 'task' ? x : t)
  if (type === 'cancel_old') return 'Cancel old policy'
  if (type === 'handoff') return 'After the sale'
  if (type === 'save') return t.missed?.check ? 'Check it cleared' : NOTICE_WORD[t.missed?.notice] || 'Missed payment'
  if (type === 'change') return CHANGE_WORD[t.kind] || 'Change request'
  if (type === 'cancel_request') return 'Wants to cancel'
  if (type === 'welcome') return 'Welcome call'
  if (type === 'review') return 'Yearly review'
  return CALLBACK_SHORT[t.why] || CALLBACK_WHY[t.why] || 'Call back'
}

// The panel's top line: why we're calling, in one sentence.
export function whyLine(x) {
  const t = x || {}
  const type = typeOf(t)
  const first = firstOf(t.client, t.name)
  if (type === 'cancel_old') return `Cancel ${first}’s old ${t.old_carrier} policy, so they never pay for both.`
  if (type === 'handoff') return `${agentFirst(t.agent)} sold ${first} a ${t.carrier || 'new'} policy. Welcome them and check the details.`.replace('a A', 'an A')
  if (type === 'save') return t.missed?.check ? `Check ${first}’s ${t.carrier} payment went through.` : `${first}’s ${t.carrier || ''} payment didn’t go through. Fix it together.`.replace('  ', ' ')
  if (type === 'change') return `${first} wants a ${(CHANGE_WORD[t.kind] || 'change').toLowerCase()}.`
  if (type === 'cancel_request') return `${first} asked to cancel. Find out why and try to keep it.`
  if (type === 'welcome') return `${agentFirst(t.agent)} added ${first}. Introduce the team and check the details.`
  if (type === 'review') return `${first}’s yearly review: check the policy still fits.`
  if (t.why === 'client_text') return `${first} texted us. Call back and help.`
  if (t.why === 'missed_call') return `${first} called and we missed it. Call back.`
  return `${first} asked us to call back.`
}

// The short script for the first step.
function scriptOf(t, type) {
  const first = firstOf(t.client, t.name)
  const ag = agentFirst(t.agent)
  if (type === 'handoff') return `Hi ${first}, this is (your name) with Deedstone, part of ${ag}’s client care team. Congratulations on your new ${t.carrier ? `${t.carrier} ` : ''}policy. I’m calling to check your details and tell you who to call for anything you need.`
  if (type === 'save') return `Hi ${first}, this is (your name) with Deedstone, calling for ${ag}. A payment on your ${t.carrier ? `${t.carrier} ` : ''}policy didn’t go through${t.missed?.due ? ` on ${t.missed.due}` : ''}. Let’s fix it together now so your coverage stays in place.`
  if (type === 'change') return `Hi ${first}, this is (your name) with Deedstone. ${ag} let us know you’d like a ${(CHANGE_WORD[t.kind] || 'change').toLowerCase()}. I can help with that now.`
  if (type === 'cancel_request') return `Hi ${first}, this is (your name) with Deedstone. You asked about cancelling your ${t.carrier ? `${t.carrier} ` : ''}policy. Before anything changes, can I ask what’s going on? There may be a way to keep your coverage.`
  if (type === 'welcome') return `Hi ${first}, this is (your name) with ${ag}’s client care team at Deedstone. ${ag} asked us to look after your ${t.carrier ? `${t.carrier} ` : ''}policy: payments, changes, your yearly review. Do you have two minutes so I can check we have your details right?`
  if (type === 'review') return `Hi ${first}, this is (your name) with Deedstone, calling for your yearly review for ${ag}. It takes five minutes: I’ll check your policy still fits and your details are right.`
  if (t.why === 'missed_call') return `Hi ${first}, this is (your name) with Deedstone, returning your call. How can I help?`
  if (t.why === 'client_text') return `Hi ${first}, this is (your name) with Deedstone. You texted us${t.text ? ` about “${t.text}”` : ''}. I’m calling to sort it out.`
  return `Hi ${first}, this is (your name) with Deedstone, calling you back as promised. How can I help?`
}

// At most 3 steps for this call: [{ key, title, say?, sub?, part? }]. part names a piece the panel adds under the step
// ('facts' = the details to read back, 'texts' = the text-updates question, 'papers' = the carrier form).
export function stepsOf(x) {
  const t = x || {}
  const type = typeOf(t)
  const first = firstOf(t.client, t.name)
  const ag = agentFirst(t.agent)
  const toAgent = `Check agent to hand ${first} to ${ag} live, or book ${ag}’s calendar.`
  let steps
  if (type === 'cancel_old') {
    const old = t.old_carrier || 'the old carrier'
    steps = [
      { key: 'client', title: `Call ${first}`, say: `We’re cancelling your old ${old} policy today. Stay near your phone. You can hold, or hang up and I’ll ring you back when I reach ${old}.` },
      { key: 'carrier', title: `Call ${old}, then merge ${first} in`, sub: 'Hold as long as it takes. When they answer, say:', say: 'I’m helping my friend, who’s on the other line, cancel their policy.' },
      { key: 'done', title: `${first} does the talking`, sub: 'Stay on to help. When it’s cancelled, press Cancelled. No confirmation number needed.', part: 'papers' },
    ]
  } else if (type === 'handoff') {
    steps = [
      { key: 'say', title: 'Say who you are', say: scriptOf(t, type) },
      { key: 'check', title: 'Read the details back', sub: 'Carrier, draft date and policy number. Anything wrong: pick Details fixed and say what.' },
      { key: 'who', title: 'Tell them who to call', sub: `Payments and changes: us. Questions about coverage: ${ag}.` },
    ]
  } else if (type === 'save' && t.missed?.check) {
    steps = [
      { key: 'carrier', title: `Check with ${t.carrier || 'the carrier'} it cleared`, sub: 'If it did, pick Saved. Nothing else to do.' },
      { key: 'say', title: `If not, call ${first}`, say: scriptOf(t, type) },
      { key: 'fix', title: 'Fix it together', sub: `A new draft date, a new card or bank, or call ${t.carrier || 'the carrier'} together. ${toAgent}` },
    ]
  } else if (type === 'save') {
    steps = [
      { key: 'say', title: 'Say why you’re calling', say: scriptOf(t, type) },
      { key: 'fix', title: 'Fix the payment together', sub: `A new draft date, a new card or bank, or call ${t.carrier || 'the carrier'} together.` },
      { key: 'agent', title: 'Can’t fix it?', sub: toAgent },
    ]
  } else if (type === 'change') {
    steps = [
      { key: 'say', title: 'Say why you’re calling', say: scriptOf(t, type) },
      { key: 'carrier', title: `Make the change with ${t.carrier || 'the carrier'}`, sub: 'Call them together, or send their form if they need one signed.', part: 'papers' },
      { key: 'log', title: 'Log it', sub: 'Done, or Couldn’t finish with a short note.' },
    ]
  } else if (type === 'cancel_request') {
    steps = [
      { key: 'say', title: 'Ask what’s going on', say: scriptOf(t, type) },
      { key: 'keep', title: 'Try to keep it', sub: 'A lower amount, or a later draft date.' },
      { key: 'agent', title: 'Still wants to cancel?', sub: toAgent },
    ]
  } else if (type === 'welcome') {
    steps = [
      { key: 'say', title: 'Say who you are', say: scriptOf(t, type) },
      { key: 'check', title: 'Read the details back', sub: 'Anything wrong: pick Details fixed and say what.', part: 'facts' },
      { key: 'texts', title: 'Ask about text updates', say: WELCOME_TEXT_ASK, part: 'texts' },
    ]
  } else if (type === 'review') {
    steps = [
      { key: 'say', title: 'Say why you’re calling', say: scriptOf(t, type) },
      { key: 'fit', title: 'Check it still fits', sub: 'Same people to protect, same budget, details still right.' },
      { key: 'next', title: 'Anything to change?', sub: `A change we book for them. Questions about coverage: ${ag}.` },
    ]
  } else {
    steps = [
      { key: 'say', title: 'Say why you’re calling', say: scriptOf(t, type) },
      { key: 'help', title: 'Help with what they need', sub: t.note || 'Payments and changes we do on the call.' },
      { key: 'agent', title: 'A question about coverage?', sub: toAgent },
    ]
  }
  return steps.slice(0, MAX_STEPS)
}

// The client facts at the top of the panel: name, phone, carrier, draft date, agent.
const ord = n => { const v = Number(n); if (!v) return null; const s = ['th', 'st', 'nd', 'rd'][(v % 100 > 10 && v % 100 < 14) ? 0 : v % 10] || 'th'; return `The ${v}${s}` }
export function factsOf(x) {
  const t = x || {}
  const c = t.client || {}
  return [
    ['Name', t.name || [c.client_first_name, c.client_last_name].filter(Boolean).join(' ')],
    ['Phone', c.client_phone || 'Not given'],
    ['Carrier', t.carrier || c.carrier_name || 'Not given'],
    ['Draft date', ord(c.draft_day) || 'Not given'],
    ['Agent', t.agent || 'Not given'],
  ]
}

// The texts with this client we know of, newest last: what they sent us and our automatic answer, and the text that
// told them about this call. [{ id, from: 'them' | 'us', text }]
export function textsOf(x, bookedWhen = '') {
  const t = x || {}
  const out = []
  if (t.text) out.push({ id: 'in', from: 'them', text: t.text })
  if (t.reply) out.push({ id: 'auto', from: 'us', text: t.reply })
  if (bookedWhen) out.push({ id: 'booked', from: 'us', text: `Your call with Deedstone is booked for ${bookedWhen}. Reply C to change it.` })
  return out
}
