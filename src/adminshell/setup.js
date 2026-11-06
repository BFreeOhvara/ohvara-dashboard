// P866 — Setup: everything it takes to get a new client (an agent who signed with us) from "invited" to "their leads
// are flowing". No React, so tests read it under node --test. Sample until P858 wires the real reads.

// Who does a step. Agent = in their portal; Jordan = in GoHighLevel; Ohvara = us.
export const OWNERS = {
  agent: { label: 'Agent', tone: 'blue', where: 'In the portal' },
  jordan: { label: 'Jordan', tone: 'teal', where: 'In GoHighLevel' },
  ohvara: { label: 'Ohvara', tone: 'mute', where: 'Us' },
}

// Every step, in order. `wait` is how a card says it is the blocker. `liveOnly` steps count only on a live-calls plan.
// `ghl` steps are done in GoHighLevel (they carry the Engine-slot pill).
export const SETUP_STEPS = [
  { key: 'invite', who: 'agent', label: 'Invite accepted', wait: "Hasn't accepted the invite" },
  { key: 'profile', who: 'agent', label: 'Profile: states, carriers and NPN', wait: 'Profile not finished' },
  { key: 'plan', who: 'agent', label: 'Plan built', wait: 'Plan not built yet' },
  { key: 'paid', who: 'agent', label: 'Setup fee and first week paid', wait: 'Setup fee and first week not paid' },
  { key: 'calendar', who: 'agent', label: 'Calendar hours and time zone', wait: 'Calendar hours not set' },
  { key: 'callerId', who: 'agent', label: 'Caller ID confirmed', wait: 'Caller ID not confirmed' },
  { key: 'alerts', who: 'agent', label: 'Text alerts opted in', wait: 'Text alerts not opted in' },
  { key: 'transfers', who: 'agent', label: 'Live transfers set', wait: 'Live transfers not set', liveOnly: true },
  { key: 'campaign', who: 'jordan', label: 'Meta campaign created', wait: 'Meta campaign not created', ghl: true },
  { key: 'budget', who: 'jordan', label: 'Campaign budget = the weekly ad amount', wait: 'Campaign budget not set', ghl: true },
  { key: 'mapped', who: 'jordan', label: 'Campaign mapped to the agent', wait: 'Campaign not mapped to the agent', ghl: true },
  { key: 'link', who: 'jordan', label: 'Landing link carries the agent ID', wait: 'Landing link has no agent ID', ghl: true },
  { key: 'tracking', who: 'jordan', label: 'Tracking number forwards to the VA desk', wait: 'No tracking number yet', ghl: true, liveOnly: true },
  { key: 'workflows', who: 'jordan', label: 'Workflows on for this agent', wait: 'Workflows not on yet', ghl: true },
  { key: 'briefed', who: 'ohvara', label: 'VA desk briefed', wait: 'VA desk not briefed' },
  { key: 'test', who: 'ohvara', label: 'First test lead run and passed', wait: 'Test lead not run yet' },
  { key: 'live', who: 'ohvara', label: 'Marked Live', wait: 'Not marked live yet' },
]

// The pipeline's columns, left to right.
export const SETUP_STAGES = [
  { key: 'invited', label: 'Invited', tone: 'mute', empty: 'No invites out.' },
  { key: 'profile', label: 'Profile', tone: 'blue', empty: 'Nobody on their profile.' },
  { key: 'plan', label: 'Plan & paid', tone: 'blue', empty: 'Nobody building a plan.' },
  { key: 'calendar', label: 'Calendar & caller ID', tone: 'blue', empty: 'Nobody on this step.' },
  { key: 'ready', label: 'Ready to launch', tone: 'teal', empty: 'Nobody waiting on launch.' },
  { key: 'launching', label: 'Launching (Jordan)', tone: 'teal', empty: 'Nothing launching.' },
  { key: 'live', label: 'Live this week', tone: 'green', empty: 'Nobody went live this week.' },
]

const has = (c, key) => (c.done || []).includes(key)

// The steps that count for this client: the live-calls steps only when their plan takes live calls.
export const stepsFor = c => SETUP_STEPS.filter(s => !s.liveOnly || c.lead === 'live')

// Where a client stands: each step ticked or open, the % done, the column, the blocker and who owns the next step.
export function setupOf(c) {
  const steps = stepsFor(c).map(s => ({ ...s, done: has(c, s.key) }))
  const count = steps.filter(s => s.done).length
  const pct = Math.round((count / steps.length) * 100)
  const open = steps.filter(s => !s.done)
  const agentOpen = open.filter(s => s.who === 'agent')
  const jordanDone = steps.some(s => s.who === 'jordan' && s.done)
  let stage
  if (!has(c, 'invite')) stage = 'invited'
  else if (!has(c, 'profile')) stage = 'profile'
  else if (!has(c, 'plan') || !has(c, 'paid')) stage = 'plan'
  else if (agentOpen.length) stage = 'calendar'
  else if (!jordanDone) stage = 'ready'
  else if (!has(c, 'live')) stage = 'launching'
  else stage = 'live'
  const next = open[0] || null
  return {
    steps, count, total: steps.length, pct, stage, next,
    owner: next ? next.who : null,
    blocker: next ? (c.note && c.noteOn === next.key ? c.note : next.wait) : null,
    canLive: open.length === 1 && open[0].key === 'live',
  }
}

// The system readiness strip: one line per piece GoHighLevel runs. `on` = GoHighLevel connected (engineState).
// `sync` is the last-sync words. Nothing is green until GoHighLevel is connected.
export function readiness(c, { on, sync, workflows, tracking }) {
  const off = ['mute', 'Not connected']
  const pick = (ready, partial, words) => (!on ? off : ready ? ['green', words[0]] : partial ? ['blue', words[1]] : ['mute', words[2]])
  const wfOn = workflows.filter(w => w.on).length
  const ads = c.ads.filter(a => a.account).length
  const formsOn = c.sources.forms.filter(f => f.on).length
  const a2p = c.texting.brand === 'approved' && c.texting.campaign === 'approved'
  const line = text => (on ? `${text} · last sync ${sync}` : text)
  return [
    { key: 'ghl', label: 'GoHighLevel connected', sub: on ? `Last sync ${sync}` : 'Jordan connects it on Connect', tone: on ? 'green' : 'mute', word: on ? 'Connected' : 'Not connected' },
    { key: 'a2p', label: 'A2P sender', sub: line(c.texting.number), ...pair(pick(a2p, c.texting.brand === 'approved', ['Approved', 'In review', 'Not started'])) },
    { key: 'workflows', label: 'Workflows A1–E3', sub: line(`${wfOn} of ${workflows.length} on`), ...pair(pick(wfOn === workflows.length, wfOn > 0, ['All on', `${wfOn} of ${workflows.length} on`, 'None on'])) },
    { key: 'account', label: 'Ad account', sub: line(`${ads} of ${c.ads.length} set`), ...pair(pick(ads === c.ads.length, ads > 0, ['Set', `${ads} of ${c.ads.length} set`, 'Not set'])) },
    { key: 'tracking', label: 'Tracking numbers', sub: line(`${tracking.length} to the VA desk`), ...pair(pick(tracking.length > 0, false, ['Forwarding', '', 'None yet'])) },
    { key: 'form', label: 'Lead form / landing page', sub: line(c.sources.domain || 'No domain yet'), ...pair(pick(!!c.sources.domain && formsOn > 0, !!c.sources.domain, ['Live', 'No form on', 'Not set'])) },
  ]
}
const pair = ([tone, word]) => ({ tone, word })
