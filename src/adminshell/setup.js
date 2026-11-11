// P906 — Setup = one ticket per agent who has PAID (the $299 setup fee plus their first days of lead spend). Agents
// sign up and pay themselves, so there are no invites and nobody is added by hand here.
// P941: a ticket IS the agent's finished sign-up: plan, daily spend, paid on, licensed states, hours and time zone,
// live transfers yes/no (signupOf below, read-only at the top of the ticket). Nobody "checks states and spend" any
// more: the sign-up can't be paid without them. The checklist: Signed up and paid -> Meta campaign created from the
// template with their agent ID (a request sent through the GoHighLevel engine slot) -> every launch check passes (P913,
// the "seatbelt", in plain words: launchChecks below) -> Turn campaign on (locked until then) -> done.
// No React, so tests read it under node --test. The agent's own setup progress uses the same launchChecks words.
import { hoursText, zoneWord } from '../lib/signupDetails.js'
import { needsTicket, productChips } from './products955.js'

// Who does a step. Ohvara = an admin on the ticket; Engine = GoHighLevel (carries the Engine-slot pill).
export const OWNERS = {
  agent: { label: 'Agent', tone: 'mute', where: 'At sign-up' },
  ohvara: { label: 'Admin', tone: 'blue', where: 'On this ticket' },
  engine: { label: 'GoHighLevel', tone: 'teal', where: 'Through the engine' },
}

// The checklist, in order. `wait` is how a ticket says it is the blocker. P913: the first test lead moved into the
// launch checks (it must come through the exact ad link and match this agent), and "Campaign on" is no longer a tick:
// it's the Turn campaign on button, locked until every launch check passes ("like a car that won't start unless you
// put the seatbelt on", Brayden Nov 8).
export const SETUP_STEPS = [
  { key: 'signup', who: 'agent', label: 'Signed up and paid', wait: 'Waiting on their sign-up' },
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
// P955: and only with Leads. Servicing-only and Reactivation-only agents never get a ticket; an agent who adds Leads
// later in Billing gets one once that charge (product_add) is paid.
export const hasTicket = c => needsTicket(c, isPaid)

// Every step counts for every ticket.
export const stepsFor = () => SETUP_STEPS

// P913 — the launch checks. P941: plain words, in this order, the same on the agent's setup progress. Each is a tick
// or what's missing. Admin can't skip one. If one breaks later (the link changes, the card fails), the campaign pauses
// and the ticket reopens on the failed tick. Keys match the server (agent_launch_checks, migration 264).
// c.launch (sample; the backend fills the same shape): { linkRef, campaignId, campaignRef, testLead: { at, matchedRef,
// by }, licence, hours, tz, card, cardFailed, app: { installed, pushAnswered }, testCall: { at, by } }.
export const LAUNCH_CHECKS = [
  { key: 'paid', label: 'Paid: setup + first 2 days' },
  { key: 'states', label: 'States picked' },
  { key: 'hours', label: 'Hours set' },
  { key: 'link', label: 'Ad link + campaign saved' },
  { key: 'testLead', label: 'Test lead arrived for this agent' },
  { key: 'testCall', label: 'Test call reached the agent' },
  { key: 'app', label: 'App installed + test push answered', liveOnly: true },
]
// The agent sees the same steps, about themselves (and never the words ad or Meta: "Your lead link").
export const AGENT_WORDS = {
  paid: 'Paid: setup + first 2 days', states: 'States picked', hours: 'Hours set', link: 'Your lead link saved',
  testLead: 'Test lead arrived for you', testCall: 'Test call reached you', app: 'App installed + test push answered',
}
export const MIN_STATES = 3
export const MAX_STATES = 10
// Which checks a ticket has: the app check only with live transfers.
export const checksFor = c => LAUNCH_CHECKS.filter(x => !x.liveOnly || c.lead === 'live')

const usd0 = n => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`

function checkOne(key, c) {
  const L = c.launch || {}
  const me = c.agentRef
  switch (key) {
    case 'paid':
      if (L.cardFailed) return `The card failed: ${L.cardFailed}.`
      if (!L.card) return 'Not paid yet: no card on file.'
      if ((c.paid?.days || 0) < 2) return `Only ${c.paid?.days || 0} of the first 2 days paid.`
      return null
    case 'states': {
      const n = (c.states || []).length
      if (n < MIN_STATES) return `Only ${n} ${n === 1 ? 'state' : 'states'} picked (needs ${MIN_STATES} to ${MAX_STATES}).`
      if (n > MAX_STATES) return `${n} states picked (at most ${MAX_STATES}).`
      if (!L.licence) return 'The licence box isn’t ticked.'
      return null
    }
    case 'hours':
      if (!L.hours) return 'No hours set.'
      if (!L.tz) return 'No time zone set.'
      return null
    case 'link':
      if (!L.linkRef) return 'No agent ID in the ad link yet.'
      if (L.linkRef !== me) return `The ad link carries ${L.linkRef}, not ${me}.`
      if (!L.campaignId) return 'No campaign saved yet. GoHighLevel sends it back when it creates the campaign.'
      if (L.campaignRef !== me) return `Campaign ${L.campaignId} points at ${L.campaignRef || 'no agent'}, not ${me}.`
      return null
    case 'testLead':
      if (!L.testLead) return "No test lead yet. Send one through the ad link with Meta's lead testing tool."
      if (!L.testLead.matchedRef) return 'A test lead arrived but matched no agent.'
      if (L.testLead.matchedRef !== me) return `The test lead went to ${L.testLead.matchedRef}, not ${me}.`
      return null
    case 'testCall':
      if (!L.testLead) return 'Waits for the test lead.'
      if (!L.testCall) return 'No test call yet: place one from the test lead to their own number.'
      return null
    case 'app':
      if (c.lead !== 'live') return null
      if (!L.app?.installed) return 'The phone app isn’t installed yet.'
      if (!L.app?.pushAnswered) return 'The test push hasn’t been answered yet.'
      return null
    default: return null
  }
}
// What each tick says under its title when it passes.
const okText = (key, c) => {
  const L = c.launch || {}
  const p = paidLine(c)
  return {
    paid: p ? `Setup ${usd0(p.setup)} · first month ${usd0(p.plan)} · 2 days of leads ${usd0(p.leads)}${L.card && L.card !== 'Card on file' ? ` · ${L.card}` : ''}` : 'Setup and the first 2 days paid',
    states: 'Licence box ticked',
    hours: [c.signup?.hours?.length ? hoursText(c.signup.hours) : L.hours, zoneWord(c.signup?.tz) || L.tz].filter(Boolean).join(' · '),
    link: `${c.agentRef} in the link · campaign ${L.campaignId}`,
    testLead: `Arrived ${L.testLead?.at || ''}, matched by ${L.testLead?.by === 'campaign' ? 'the campaign' : 'the agent ID'}`,
    testCall: `${L.testCall?.by || 'AI'} call ${L.testCall?.at || ''}`.trim(),
    app: 'App installed · test push answered',
  }[key]
}
// A passing check's title carries its facts: "Paid: setup + first 2 days ($2,022, Nov 10)", "States picked: TX, OK, LA".
function titleOf(x, c, ok, words) {
  const base = words[x.key] || x.label
  if (!ok) return base
  if (x.key === 'paid') { const p = paidLine(c); return p ? `${base} (${usd0(p.total)}, ${p.short})` : base }
  if (x.key === 'states') return `${base}: ${(c.states || []).join(', ')}`
  return base
}
// The agent's detail lines for the steps our team does (never GoHighLevel, Meta or ads on an agent screen).
const agentText = (key, c, ok) => {
  const L = c.launch || {}
  if (key === 'link') return ok ? 'Ready: leads that come in are matched to you' : 'Our team is setting up your lead link.'
  if (key === 'testLead') return ok ? `Arrived ${L.testLead?.at || ''}`.trim() : 'Next, our team sends a test lead through your link.'
  if (key === 'testCall') return ok ? `Rang your phone ${L.testCall?.at || ''}`.trim() : 'Then we call you from the test lead to check it rings.'
  return null
}
export function launchChecks(c, { who = 'admin' } = {}) {
  const agent = who === 'agent'
  const words = agent ? AGENT_WORDS : Object.fromEntries(LAUNCH_CHECKS.map(x => [x.key, x.label]))
  const list = checksFor(c).map(x => {
    const why = checkOne(x.key, c)
    const text = (agent && agentText(x.key, c, !why)) || why || okText(x.key, c)
    return { ...x, label: titleOf(x, c, !why, words), ok: !why, why: agent ? (why && text) : why, text }
  })
  return { list, ok: list.every(x => x.ok), passed: list.filter(x => x.ok).length, failed: list.filter(x => !x.ok) }
}

// ── The sign-up, read-only at the top of the ticket ─────────────────────────
// c.signup (real: agent_launch_facts' signup block via admReal; sample: data.js): { tier, dailyCents, paidCents,
// setupCents, planCents, leadCents, paidOn, paidShort, tz, hours: [{ weekday, start, end }], live }.
// paidLine: the sign-up charge in dollars, with its date.
export function paidLine(c) {
  const s = c.signup || {}
  if (s.paidCents == null) return null
  return { total: s.paidCents / 100, setup: (s.setupCents || 0) / 100, plan: (s.planCents || 0) / 100, leads: (s.leadCents || 0) / 100, on: s.paidOn || c.paid?.on || '', short: s.paidShort || s.paidOn || c.paid?.on || '' }
}
export function signupOf(c, { plans = {} } = {}) {
  const s = c.signup || {}
  const rows = s.hours || []
  const tier = s.tier || c.plan
  return {
    plan: plans[tier]?.label || (tier ? tier[0].toUpperCase() + tier.slice(1) : 'No plan'),
    daily: s.dailyCents != null ? s.dailyCents / 100 : c.spend || 0,
    paid: paidLine(c),
    paidOn: s.paidOn || c.paid?.on || '',
    states: c.states || [],
    hours: rows.length ? hoursText(rows) : (c.launch?.hours || ''),
    tz: zoneWord(s.tz) || c.launch?.tz || '',
    live: s.live != null ? !!s.live : c.lead === 'live',
    // P955: what they picked, and how Leads was paid (at sign-up, or added later in Billing).
    products: productChips(c),
    via: c.leadsAdded ? `Added Leads in Billing${c.leadsAdded.on ? ` on ${c.leadsAdded.on}` : ''}` : 'At sign-up',
  }
}

// Where a ticket stands: each step ticked or open, the % done, the column, the blocker and who owns the next step.
// P913: 'checks' is worked out from the launch checks, never ticked; 'on' and 'live' only count while every check still
// passes, so a check that breaks after launch pauses the campaign and reopens the ticket on the failed tick.
export function setupOf(c) {
  const checks = launchChecks(c)
  const broke = (has(c, 'on') || has(c, 'live')) && !checks.ok
  const isDone = key => (key === 'signup' ? isPaid(c) : key === 'checks' ? checks.ok : ['on', 'live'].includes(key) ? has(c, key) && checks.ok : has(c, key))
  const steps = stepsFor(c).map(s => ({ ...s, done: isDone(s.key) }))
  const count = steps.filter(s => s.done).length
  const pct = Math.round((count / steps.length) * 100)
  const open = steps.filter(s => !s.done)
  const req = c.campaignReq?.status || (has(c, 'campaign') ? 'created' : 'none')
  // P941: New ticket = paid, campaign not asked for yet; Campaign = asked, waiting on GoHighLevel.
  let stage
  if (!has(c, 'campaign')) stage = req === 'none' ? 'new' : 'campaign'
  else if (!isDone('live')) stage = 'checks'
  else stage = 'live'
  const next = open[0] || null
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
    canLaunch: has(c, 'campaign') && checks.ok && !has(c, 'on'),
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
