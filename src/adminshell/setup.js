// P906 — Setup = one ticket per agent who has PAID (the $299 setup fee plus their first days of lead spend). Agents
// sign up and pay themselves, so there are no invites and nobody is added by hand here. Each ticket is a short
// checklist: states and spend checked → Meta campaign created from the template with their agent ID (a request sent
// through the GoHighLevel engine slot; its status comes back to the ticket) → every launch check passes (P913, the
// "seatbelt": launchChecks below) → Turn campaign on (locked until then) → done.
// No React, so tests read it under node --test. Sample until the backend wires agent_setup_ticks.

// Who does a step. Ohvara = an admin on the ticket; Engine = GoHighLevel (carries the Engine-slot pill).
export const OWNERS = {
  ohvara: { label: 'Admin', tone: 'blue', where: 'On this ticket' },
  engine: { label: 'GoHighLevel', tone: 'teal', where: 'Through the engine' },
}

// The checklist, in order. `wait` is how a ticket says it is the blocker. P913: the first test lead moved into the
// launch checks (it must come through the exact ad link and match this agent), and "Campaign on" is no longer a tick:
// it's the Turn campaign on button, locked until every launch check passes ("like a car that won't start unless you
// put the seatbelt on", Brayden Nov 8).
export const SETUP_STEPS = [
  { key: 'states', who: 'ohvara', label: 'States and spend checked', wait: 'Check their states and daily spend' },
  { key: 'campaign', who: 'engine', label: 'Meta campaign created from the template', wait: 'Create their campaign', ghl: true },
  { key: 'checks', who: 'ohvara', label: 'Every launch check passes', wait: 'Clear the launch checks' },
  { key: 'on', who: 'ohvara', label: 'Campaign on', wait: 'Turn their campaign on' },
  { key: 'live', who: 'ohvara', label: 'Done', wait: 'Mark the ticket done' },
]

// The ticket board's columns, left to right.
export const SETUP_STAGES = [
  { key: 'new', label: 'New ticket', tone: 'mute', empty: 'No new paid agents.' },
  { key: 'campaign', label: 'Campaign', tone: 'blue', empty: 'No campaign being made.' },
  { key: 'checks', label: 'Launch checks', tone: 'teal', empty: 'Nobody waiting on launch checks.' },
  { key: 'live', label: 'Done this week', tone: 'green', empty: 'No tickets done this week.' },
]

// The "Create campaign" request: none → sent (waiting on GoHighLevel) → created, or failed (with why).
export const CAMPAIGN_REQ = {
  none: ['mute', 'Not sent'], sent: ['blue', 'Sent · waiting on GoHighLevel'], created: ['green', 'Created'], failed: ['warn', 'Failed'],
}

const has = (c, key) => (c.done || []).includes(key)

// A ticket exists only once the agent has paid the setup fee and their first days of spend.
export const isPaid = c => has(c, 'paid')

// Every step counts for every ticket.
export const stepsFor = () => SETUP_STEPS

// P913 — the launch checks. Each is a tick with what's wrong when it fails. Admin can't skip one. If one breaks later
// (the link changes, the card fails), the campaign pauses and the ticket reopens on the failed tick.
// c.launch (sample; the backend fills the same shape): { linkRef, campaignId, campaignRef, testLead: { at, matchedRef,
// by }, licence, hours, tz, card, cardFailed, app: { installed, pushAnswered }, testCall: { at, by } }.
export const LAUNCH_CHECKS = [
  { key: 'link', label: 'Agent ID and Meta campaign ID saved, both pointing at this agent' },
  { key: 'testLead', label: "A test lead through that exact link arrived and matched them (Meta's lead testing tool)" },
  { key: 'profile', label: 'States (3 to 10), licence tick, calendar hours and time zone set' },
  { key: 'paid', label: 'Card on file and the first 2 days paid' },
  { key: 'app', label: 'Phone app installed and the test push answered (live transfers)' },
  { key: 'testCall', label: 'One AI or VA test call placed to their own number from that test lead' },
]
export const MIN_STATES = 3
export const MAX_STATES = 10

function checkOne(key, c) {
  const L = c.launch || {}
  const me = c.agentRef
  switch (key) {
    case 'link':
      if (!L.linkRef) return 'No agent ID in their ad link yet.'
      if (L.linkRef !== me) return `The ad link carries ${L.linkRef}, not ${me}.`
      if (!L.campaignId) return 'No Meta campaign ID saved yet. GoHighLevel sends it back when it creates the campaign.'
      if (L.campaignRef !== me) return `Campaign ${L.campaignId} points at ${L.campaignRef || 'no agent'}, not ${me}.`
      return null
    case 'testLead':
      if (!L.testLead) return "No test lead yet. Send one through their ad link with Meta's lead testing tool."
      if (!L.testLead.matchedRef) return 'The test lead arrived but matched no agent.'
      if (L.testLead.matchedRef !== me) return `The test lead went to ${L.testLead.matchedRef}, not ${me}.`
      return null
    case 'profile': {
      const miss = []
      const n = (c.states || []).length
      if (n < MIN_STATES || n > MAX_STATES) miss.push(`${n} ${n === 1 ? 'state' : 'states'} picked (needs ${MIN_STATES} to ${MAX_STATES})`)
      if (!L.licence) miss.push('licence not ticked')
      if (!L.hours) miss.push('no calendar hours')
      if (!L.tz) miss.push('no time zone')
      return miss.length ? `${miss.join(', ').replace(/^./, x => x.toUpperCase())}.` : null
    }
    case 'paid':
      if (L.cardFailed) return `The card failed: ${L.cardFailed}.`
      if (!L.card) return 'No card on file.'
      if ((c.paid?.days || 0) < 2) return `Only ${c.paid?.days || 0} of the first 2 days paid.`
      return null
    case 'app':
      if (c.lead !== 'live') return null
      if (!L.app?.installed) return 'The phone app isn’t installed yet.'
      if (!L.app?.pushAnswered) return 'The test push hasn’t been answered yet.'
      return null
    case 'testCall':
      if (!L.testLead) return 'Waits for the test lead.'
      if (!L.testCall) return 'No test call yet: place one from the test lead to their own number.'
      return null
    default: return null
  }
}
// What each tick says when it passes.
const okText = (key, c) => {
  const L = c.launch || {}
  return {
    link: `${c.agentRef} in the link · campaign ${L.campaignId}`,
    testLead: `Arrived ${L.testLead?.at || ''}, matched by ${L.testLead?.by === 'campaign' ? 'the campaign ID' : 'the agent ID'}`,
    profile: `${(c.states || []).join(', ')} · licence ticked · ${L.hours} · ${L.tz}`,
    paid: `${L.card} · first 2 days paid`,
    app: c.lead === 'live' ? 'App installed · test push answered' : 'Not needed: appointments only',
    testCall: `${L.testCall?.by || 'AI'} call placed ${L.testCall?.at || ''}`.trim(),
  }[key]
}
export function launchChecks(c) {
  const list = LAUNCH_CHECKS.map(x => {
    const why = checkOne(x.key, c)
    return { ...x, ok: !why, why, text: why || okText(x.key, c) }
  })
  return { list, ok: list.every(x => x.ok), passed: list.filter(x => x.ok).length, failed: list.filter(x => !x.ok) }
}

// Where a ticket stands: each step ticked or open, the % done, the column, the blocker and who owns the next step.
// P913: 'checks' is worked out from the launch checks, never ticked; 'on' and 'live' only count while every check still
// passes, so a check that breaks after launch pauses the campaign and reopens the ticket on the failed tick.
export function setupOf(c) {
  const checks = launchChecks(c)
  const broke = (has(c, 'on') || has(c, 'live')) && !checks.ok
  const isDone = key => (key === 'checks' ? checks.ok : ['on', 'live'].includes(key) ? has(c, key) && checks.ok : has(c, key))
  const steps = stepsFor(c).map(s => ({ ...s, done: isDone(s.key) }))
  const count = steps.filter(s => s.done).length
  const pct = Math.round((count / steps.length) * 100)
  const open = steps.filter(s => !s.done)
  let stage
  if (!has(c, 'states')) stage = 'new'
  else if (!has(c, 'campaign')) stage = 'campaign'
  else if (!isDone('live')) stage = 'checks'
  else stage = 'live'
  const next = open[0] || null
  const req = c.campaignReq?.status || (has(c, 'campaign') ? 'created' : 'none')
  let blocker = next ? next.wait : null
  if (next?.key === 'campaign' && req === 'sent') blocker = 'Campaign requested · waiting on GoHighLevel'
  if (next?.key === 'campaign' && req === 'failed') blocker = `Campaign request failed${c.campaignReq?.why ? `: ${c.campaignReq.why}` : ''}`
  if (next?.key === 'checks') blocker = `${checks.passed} of ${checks.list.length} launch checks pass · ${checks.failed[0].why}`
  if (broke) blocker = `Campaign paused: ${checks.failed[0].why}`
  return {
    steps, count, total: steps.length, pct, stage, next, req, checks,
    paused: broke,
    owner: next ? next.who : null,
    blocker,
    warn: req === 'failed' || broke,
    canLaunch: has(c, 'states') && has(c, 'campaign') && checks.ok && !has(c, 'on'),
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
