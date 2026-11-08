// P906 — Setup = one ticket per agent who has PAID (the $299 setup fee plus their first days of lead spend). Agents
// sign up and pay themselves, so there are no invites and nobody is added by hand here. Each ticket is a short
// checklist: states and spend checked → Meta campaign created from the template with their agent ID (a request sent
// through the GoHighLevel engine slot; its status comes back to the ticket) → campaign on → first test lead received
// → done. No React, so tests read it under node --test. Sample until the backend wires agent_setup_ticks.

// Who does a step. Ohvara = an admin on the ticket; Engine = GoHighLevel (carries the Engine-slot pill).
export const OWNERS = {
  ohvara: { label: 'Admin', tone: 'blue', where: 'On this ticket' },
  engine: { label: 'GoHighLevel', tone: 'teal', where: 'Through the engine' },
}

// The checklist, in order. `wait` is how a ticket says it is the blocker.
export const SETUP_STEPS = [
  { key: 'states', who: 'ohvara', label: 'States and spend checked', wait: 'Check their states and daily spend' },
  { key: 'campaign', who: 'engine', label: 'Meta campaign created from the template', wait: 'Create their campaign', ghl: true },
  { key: 'on', who: 'engine', label: 'Campaign on', wait: 'Turn their campaign on', ghl: true },
  { key: 'test', who: 'ohvara', label: 'First test lead received', wait: 'Waiting for the first test lead' },
  { key: 'live', who: 'ohvara', label: 'Done', wait: 'Mark the ticket done' },
]

// The ticket board's columns, left to right.
export const SETUP_STAGES = [
  { key: 'new', label: 'New ticket', tone: 'blue', empty: 'No new paid agents.' },
  { key: 'campaign', label: 'Campaign', tone: 'teal', empty: 'No campaign being made.' },
  { key: 'test', label: 'Test lead', tone: 'violet', empty: 'Nobody waiting on a test lead.' },
  { key: 'live', label: 'Done this week', tone: 'green', empty: 'No tickets done this week.' },
]

// The "Create campaign" request: none → sent (waiting on GoHighLevel) → created, or failed (with why).
export const CAMPAIGN_REQ = {
  none: ['mute', 'Not sent'], sent: ['blue', 'Sent · waiting on GoHighLevel'], created: ['green', 'Created'], failed: ['warn', 'Failed'],
}

const has = (c, key) => (c.done || []).includes(key)

// A ticket exists only once the agent has paid the setup fee and their first days of spend.
export const isPaid = c => has(c, 'paid')

// Every step counts for every ticket (live calls need nothing extra here: the agent sets them in their own portal).
export const stepsFor = () => SETUP_STEPS

// Where a ticket stands: each step ticked or open, the % done, the column, the blocker and who owns the next step.
export function setupOf(c) {
  const steps = stepsFor(c).map(s => ({ ...s, done: has(c, s.key) }))
  const count = steps.filter(s => s.done).length
  const pct = Math.round((count / steps.length) * 100)
  const open = steps.filter(s => !s.done)
  let stage
  if (!has(c, 'states')) stage = 'new'
  else if (!has(c, 'campaign') || !has(c, 'on')) stage = 'campaign'
  else if (!has(c, 'live')) stage = 'test'
  else stage = 'live'
  const next = open[0] || null
  const req = c.campaignReq?.status || (has(c, 'campaign') ? 'created' : 'none')
  let blocker = next ? next.wait : null
  if (next?.key === 'campaign' && req === 'sent') blocker = 'Campaign requested · waiting on GoHighLevel'
  if (next?.key === 'campaign' && req === 'failed') blocker = `Campaign request failed${c.campaignReq?.why ? `: ${c.campaignReq.why}` : ''}`
  return {
    steps, count, total: steps.length, pct, stage, next, req,
    owner: next ? next.who : null,
    blocker,
    warn: req === 'failed',
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
