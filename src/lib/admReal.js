// P858 — the Admin portal on real data: pure mappers from the tables and RPCs that already exist to the record shapes
// the admin screens read (src/adminshell/data.js, the sample door). No React, no Supabase: hooks/admRealData.js runs
// the queries and hands the rows here. Anything with no backend yet comes back empty (a designed empty state), never
// sample: GoHighLevel-fed pieces read as "not connected" (engine slots).
import { PRICES } from './priceBook.js'
import { tierOf } from '../template/spendPlan.js'
import { isTestProfile } from './testAccounts.js'
import { dailyCounts } from '../template/leadTrend.js'

export const TZ = 'America/Chicago'
const DAY = 864e5
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The parts of an instant in Central time.
export function partsOf(ms, tz = TZ) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return { y: +p.year, m: +p.month, d: +p.day, wd: SHORT.indexOf(p.weekday), time: `${p.hour}:${p.minute} ${p.dayPeriod}` }
}
const ymd = p => `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`

// The real week (Monday to Sunday, Central) as day-of-month numbers, like the sample's WEEK, plus the dates.
export function realClock(now = Date.now(), tz = TZ) {
  const t = partsOf(now, tz)
  const back = (t.wd + 6) % 7 // days since Monday
  const noon = Date.parse(`${ymd(t)}T12:00:00Z`)
  const days = Array.from({ length: 7 }, (_, i) => { const ms = noon + (i - back) * DAY; const d = new Date(ms); return { ms, d: d.getUTCDate(), iso: d.toISOString().slice(0, 10), name: SHORT[d.getUTCDay()], mon: MON[d.getUTCMonth()] } })
  return {
    real: true, today: t.d, todayIso: ymd(t), week: days.map(x => x.d), weekDays: days, weekStartIso: days[0].iso, weekEndIso: days[6].iso,
    monthStartIso: `${t.y}-${String(t.m).padStart(2, '0')}-01`, monthName: MON[t.m - 1],
    dayName: d => days.find(x => x.d === d)?.name || '', dateText: d => { const x = days.find(k => k.d === d); return x ? `${x.name}, ${x.mon} ${x.d}` : '' },
  }
}

// "Today, 9:12 AM" / "Wed, 9:12 AM" / "Oct 30" — the sample's when-words for a real instant.
export function whenText(iso, now = Date.now(), tz = TZ) {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const a = partsOf(ms, tz)
  const n = partsOf(now, tz)
  if (ymd(a) === ymd(n)) return `Today, ${a.time}`
  if (now - ms < 6 * DAY && ms <= now) return `${SHORT[a.wd]}, ${a.time}`
  return `${MON[a.m - 1]} ${a.d}`
}
export const shortDate = iso => { const ms = Date.parse(iso || ''); if (!Number.isFinite(ms)) return ''; const p = partsOf(ms); return `${MON[p.m - 1]} ${p.d}` }
export const dayText = (iso, now = Date.now()) => { const w = whenText(iso, now); return w.startsWith('Today') ? 'Today' : w.split(',')[0] }

export function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || '')
}
const nameOf = p => p?.full_name || p?.username || p?.email || 'No name'

// ── people ───────────────────────────────────────────────────────────────────
const PLAN_KEYS = new Set([...PRICES.tiers.map(t => t.key), 'servicing'])
export function planKey(tier, weeklyDollars) {
  if (PLAN_KEYS.has(tier)) return tier
  return tierOf((weeklyDollars || 0) / 7).key
}
// profiles.billing_status (Stripe, via agent-billing) → the three billing words admin shows.
export function billingOf(p, plan) {
  if (p.billing_exempt) return { status: 'comped', next: 'Comped', method: 'None needed', failed: null }
  const due = ['past_due', 'unpaid', 'incomplete', 'canceled'].includes(p.billing_status)
  const end = p.billing_current_period_end ? whenText(p.billing_current_period_end) : null
  return {
    status: due ? 'past_due' : 'current',
    next: due ? (p.billing_grace_until ? `Locks ${whenText(p.billing_grace_until)}` : 'Past due') : end ? `Renews ${end}` : (p.stripe_subscription_id ? 'Active' : 'Not set up'),
    method: p.stripe_customer_id ? 'Card on file (Stripe)' : 'None yet',
    failed: due ? { what: 'Plan', when: p.billing_updated_at ? whenText(p.billing_updated_at) : '', why: 'Payment failed', amount: plan?.price || 0 } : null,
  }
}

export function toAgent(p, { settings = [], onDuty = [], plans = {} } = {}) {
  const s = settings.find(x => x.agent_id === p.id)
  const states = s?.states || []
  // P906: spend is the daily lead spend on the admin side (the weekly column / 7 until a daily one is read).
  const weekly = Math.round((p.leads_weekly_cents || 0) / 100)
  const spend = Math.round(weekly / 7)
  const plan = planKey(p.billing_tier, weekly)
  return {
    id: p.id, name: nameOf(p), role: 'agent', city: '', state: states[0] || '', email: p.email || '', phone: fmtPhone(p.phone),
    spend, active: !!s?.active, onDuty: onDuty.includes(p.id), servicing: !!p.has_servicing, access: p.is_active !== false,
    comped: !!p.billing_exempt, joined: shortDate(p.created_at), joinedIso: isoDay(p.created_at), lastOn: p.last_login_at ? dayText(p.last_login_at) : 'Never',
    billing: billingOf(p, plans[plan]), states, plan, paused: p.leads_status === 'paused' ? { since: '', until: '' } : null, real: true,
  }
}
export function toVa(p, { accounts = [] } = {}) {
  const acct = accounts.find(a => a.rep_id === p.id || a.profile_id === p.id)
  return {
    id: p.id, name: nameOf(p), role: 'fulfillment', email: p.email || '', phone: fmtPhone(p.phone), hours: '8:00 AM to 6:00 PM',
    access: p.is_active !== false, bank: acct?.payouts_enabled ? 'ready' : 'none', joined: shortDate(p.created_at),
    lastOn: p.last_login_at ? dayText(p.last_login_at) : 'Never', missed: 0, real: true,
  }
}
export function toInvite(r, now = Date.now()) {
  const to = r.invited_email || r.invited_phone || ''
  return { id: r.id, name: to || 'Invite link', role: r.role === 'fulfillment' ? 'fulfillment' : 'agent', via: r.channel || (r.invited_phone ? 'text' : r.invited_email ? 'email' : 'link'), to, sent: whenText(r.created_at, now) }
}

// ── leads ────────────────────────────────────────────────────────────────────
// leads (typed inbound rows) → a Leads-board card. kind from inbound_product; stage from outcome / stage / reach.
// P913: the admin statuses Booked · No show · Follow up · Sold · Not interested. Never reached = a Follow up our team
// owns (owner 'team', teamOwned). No agent = 'unassigned' (the admin alert, not a status). A live call (or a dropped transfer, which bounces back and is booked) is Booked
// until the agent marks the result.
export function leadStage(l) {
  if (!l.assigned_rep_id) return 'unassigned'
  if (l.outcome === 'sold' || l.inbound_stage === 'sold') return 'sold'
  if (l.outcome === 'not_interested' || l.inbound_stage === 'lost') return 'not_interested'
  if (l.outcome === 'no_show' || l.inbound_stage === 'no_show') return 'no_show'
  if (l.outcome === 'follow_up' || l.inbound_stage === 'follow_up') return 'follow_up'
  if (teamOwned(l)) return 'follow_up'
  return 'booked'
}
// Never reached: the AI or the no-answer cadence is still trying, so the Follow up is our team's, not the agent's.
export const teamOwned = l => l.va_outcome === 'not_reached' || l.outcome === 'unreachable' || l.inbound_stage === 'unreachable'
export const ROUTE_WHY = {
  missing: 'No agent ID in the ad link and no Meta campaign ID.', unknown: 'The agent ID and the campaign ID match no agent.', inactive: 'The agent in the ad link is switched off.',
  unlicensed: 'The agent in the ad link is not licensed for this state.',
}
export function toLead(l, { clock, now = Date.now(), intake = {} } = {}) {
  const stage = leadStage(l)
  const team = stage === 'follow_up' && teamOwned(l) && l.outcome !== 'follow_up' && l.inbound_stage !== 'follow_up'
  const kind = team ? 'none' : l.inbound_product === 'live_call' ? 'live' : 'appointment'
  const ms = Date.parse(l.created_at)
  const inWeek = clock && Number.isFinite(ms) && l.created_at.slice(0, 10) >= clock.weekStartIso
  const p = Number.isFinite(ms) ? partsOf(ms) : null
  const i = intake[l.id]
  return {
    id: l.id, name: l.contact_name || l.business_name || 'No name', phone: fmtPhone(l.phone), state: l.state || '', city: l.city || '',
    kind, product: l.lead_type === 'policy_help' ? 'Policy help call' : 'Mortgage protection', day: inWeek && p ? p.d : null, time: p?.time || '',
    came: whenText(l.created_at, now), source: l.lead_source === 'google' ? 'Google · live calls' : i?.meta_option === 'page_only' ? 'Meta · landing page' : 'Meta · form',
    agent_id: l.assigned_rep_id || null, stage, owner: stage === 'follow_up' ? (team ? 'team' : 'agent') : null, premium: 0,
    matchedBy: !l.assigned_rep_id ? null : i?.routing === 'campaign' ? 'campaign' : i?.routing === 'assigned' ? 'admin' : i ? 'link' : null,
    appt: kind === 'appointment' ? (l.appointment_at ? whenText(l.appointment_at, now) : 'not booked yet') : null,
    note: team ? 'Never reached. Our team keeps trying.' : '', why: !l.assigned_rep_id && i?.routing ? ROUTE_WHY[i.routing] || '' : '', campaign: i?.campaign_id || '', agentRef: i?.agent_ref || '',
    log: [], real: true,
  }
}

// ── clients, servicing, desk ─────────────────────────────────────────────────
// P906: the P899 client statuses. Closed = gone for good; Working = the team is on it (new policy, a lapse, a missed
// payment, a save); Needs attention = only the monthly "Still on the books?" check that's due; else Protected.
// An open request is a tag (openSteps), not a status.
export function clientStage(p, now = Date.now()) {
  if (p.closed_at || p.status === 'closed' || p.status === 'cancelled') return 'closed'
  if (p.cancellation_status === 'at_risk' || p.status === 'lapsed' || p.status === 'lapse_pending' || p.fixing_since) return 'working'
  if (p.pending_underwriting || p.status === 'pending' || p.status === 'submitted') return 'working'
  if (p.next_lapse_check_at && Date.parse(p.next_lapse_check_at) <= now) return 'needs_attention'
  return 'protected'
}
export function toClient(p, openSteps = 0) {
  const stage = clientStage(p)
  return {
    id: p.id, name: `${p.client_first_name || ''} ${p.client_last_name || ''}`.trim() || 'No name', agent_id: p.agent_id, va_id: p.assigned_fulfillment_id || null,
    phone: fmtPhone(p.client_phone), state: p.state || '', carrier: p.carrier_name || '', product: p.product_name || p.product_type || '', policy: p.policy_number || '',
    premium: Number(p.monthly_premium) || 0, stage, sold: shortDate(p.policy_sold_date || p.created_at), real: true,
    city: p.city || '', draft: Number(p.draft_day) || null,
    attention: stage === 'needs_attention' ? 'Still on the books?' : stage === 'working' ? (p.status === 'lapsed' ? 'Lapsed: the team is on it' : 'Our team is on it') : null,
    tag: openSteps > 0 ? `${openSteps} request${openSteps === 1 ? '' : 's'} in progress` : null,
  }
}
const KIND_LABEL = { packet_check: 'Packet check', review_call: 'Review call', chargeback_watch: 'Chargeback watch', beneficiary: 'Beneficiary change', address: 'Address change', payment: 'Payment change' }
export function toStep(t, now = Date.now()) {
  const due = t.due_at ? Date.parse(t.due_at) : null
  return {
    id: t.id, kind: KIND_LABEL[t.kind] || String(t.kind || 'Request').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()),
    client_id: t.policy_id, va_id: t.assigned_to || null, due: due ? (due < now ? `Was due ${dayText(t.due_at, now)}` : whenText(t.due_at, now)) : 'No date',
    late: !!due && due < now, status: t.status === 'scheduled' ? 'scheduled' : 'requested', real: true,
  }
}
// A policy on the cancellation desk → today's call row.
export function toCall(p, now = Date.now()) {
  const at = p.scheduled_call_at ? Date.parse(p.scheduled_call_at) : null
  let status = 'booked'
  if (p.call_live_since) status = 'live'
  else if (p.cancellation_status === 'cancelled' || p.fulfillment_stage === 'Complete') status = 'cancelled'
  else if (p.cancellation_substatus === 'no_answer') status = 'no_answer'
  else if (at && at < now - 15 * 60e3) status = 'late'
  return {
    id: p.id, va_id: p.assigned_fulfillment_id || null, time: at ? partsOf(at).time : '', client: `${p.client_first_name || ''} ${p.client_last_name || ''}`.trim(),
    status, old_carrier: p.carrier_name || '', agent_id: p.agent_id, real: true,
  }
}
export const isToday = (iso, now = Date.now()) => !!iso && whenText(iso, now).startsWith('Today')

// ── messages, bugs, audit ────────────────────────────────────────────────────
export function toThreads(threads = [], messages = [], me = null, now = Date.now()) {
  return threads.filter(t => t.peer_key === 'admin').map(t => ({
    id: `${t.agent_id}.admin`, who: t.agent_id, unread: t.unread_count || 0, agentName: t.agent_name,
    messages: messages.filter(m => m.agent_id === t.agent_id).map(m => ({ id: m.id, from: m.sender_id === me || m.sender_role === 'admin' ? 'me' : 'them', text: m.body, at: whenText(m.created_at, now) })),
  }))
}
export function toBug(b, now = Date.now()) {
  return {
    id: b.id, who: b.reporter?.full_name || 'Someone', role: '', text: b.description || '', at: whenText(b.created_at, now), shot: !!b.screenshot_url,
    file: null, status: b.status === 'resolved' ? 'fixed' : 'new', page: b.page_url || '', browser: '', screen: '', real: true,
  }
}
const ACTION_WORD = { route_lead: 'Routed a lead', move_lead: 'Moved a lead', INSERT: 'Added', UPDATE: 'Changed', DELETE: 'Removed' }
export function toAudit(r, now = Date.now()) {
  const what = ACTION_WORD[r.action] || String(r.action || '').replace(/_/g, ' ')
  return { id: `au-${r.id}`, at: whenText(r.at, now), who: r.actor_name || (r.actor ? 'Someone' : 'System'), what, target: `${String(r.target_table || '').replace(/_/g, ' ')}${r.target_id ? ` ${String(r.target_id).slice(0, 8)}` : ''}`, real: true }
}

// ── settings and Connect ─────────────────────────────────────────────────────
// The switches admin shows, from app_settings and recovery_config. A switch whose column isn't on the database
// yet reads off (and the action says so) rather than showing a sample value.
export function switchesOf(app = {}, rc = {}) {
  return {
    sms_live: !!rc.sms_live, voice_live: !!rc.voice_live, ai_caller_live: !!app.ai_caller_live, recording_live: !!rc.recording_live,
    invite_sms_live: !!app.invite_sms_live, payouts_live: !!rc.payouts_live, owner_payouts_live: !!rc.owner_payouts_live, billing_enforced: !!app.agent_billing_enforced,
    submit_live: !!app.submit_live, carrier_lookup_live: !!app.carrier_lookup_live, signup_open: !!app.self_signup_open,
  }
}
// Connect on real data: GoHighLevel isn't connected until the bridge is on, so every engine piece reads empty.
export function connectOf(ghl, keySaved, campaigns = []) {
  return {
    ghl: { keySaved: !!keySaved, keyEnd: '', locationId: ghl?.location_id || '', workflows: { newLead: ghl?.workflow_new_inbound || '', reminder: ghl?.workflow_appointment_reminder || '', noShow: ghl?.workflow_no_show || '' }, saved: ghl?.updated_at ? whenText(ghl.updated_at) : '' },
    texting: { number: '', brand: 'not_started', campaign: 'not_started', sender: '' },
    ads: [
      { kind: 'appointment', label: 'Appointments', account: '', budget: 0, spent: 0, status: ghl?.ad_spend_enabled ? 'live' : 'not_set' },
      { kind: 'live', label: 'Live calls', account: '', budget: 0, spent: 0, status: 'not_set' },
    ],
    sources: { domain: '', forms: [] },
    campaigns, engine: { connected: !!ghl?.enabled, lastSync: ghl?.last_sync_at || null, status: ghl?.last_sync_status || null, adSync: ghl?.ad_spend_last_at || null },
    real: true,
  }
}

// Campaign → agent: the suggestion is the agent whose name appears in the campaign's name (one Meta campaign per agent).
export function suggestAgent(campaignName, agents = []) {
  const n = String(campaignName || '').toLowerCase()
  if (!n) return null
  const full = agents.filter(a => n.includes(a.name.toLowerCase()))
  if (full.length === 1) return full[0].id
  const last = agents.filter(a => { const l = a.name.split(' ').slice(-1)[0]?.toLowerCase(); return l && l.length > 2 && new RegExp(`\\b${l}\\b`).test(n) })
  return last.length === 1 ? last[0].id : null
}
export function toCampaign(c, agents = []) {
  return { id: c.campaign_id, name: c.campaign_name || c.campaign_id, agent_id: c.agent_id || null, lead_type: c.lead_type || 'appts', status: c.status || '', suggested: c.agent_id ? null : suggestAgent(c.campaign_name, agents), seen: c.last_seen_at ? whenText(c.last_seen_at) : '' }
}
// admin_ad_costs rows → per-agent cost per lead / booked / sale (dollars, null where there's nothing to divide by).
export function costsOf(rows = []) {
  const per = (c, n) => (n > 0 ? Math.round(c / n) / 100 : null)
  return Object.fromEntries(rows.map(r => [r.agent_id, {
    spend: Number(r.spend_cents) / 100, leads: r.leads, booked: r.booked, sold: r.sold,
    perLead: per(Number(r.spend_cents), r.leads), perBooked: per(Number(r.spend_cents), r.booked), perSale: per(Number(r.spend_cents), r.sold),
  }]))
}

// ── Setup pipeline ───────────────────────────────────────────────────────────
// An agent's setup steps from their real records; Jordan's and Ohvara's steps from agent_setup_ticks (232).
// lead: 'live' when they have a live-transfer phone (a live-calls plan), else 'appointment'.
export function setupDone(p, { settings = [], ticks = [], mapped = new Set(), ghl = null } = {}) {
  const s = settings.find(x => x.agent_id === p.id)
  const done = ['invite']
  if ((s?.states || []).length && p.npn) done.push('profile')
  if ((p.leads_weekly_cents || 0) > 0 || p.has_servicing) done.push('plan')
  if (p.billing_exempt || ['active', 'trialing'].includes(p.billing_status)) done.push('paid')
  if (p.working_hours_start && p.timezone) done.push('calendar')
  if (p.caller_id_verified_at) done.push('callerId')
  if (p.no_answer_sms_opt_in) done.push('alerts')
  if (p.live_transfer_phone) done.push('transfers')
  if (mapped.has(p.id)) done.push('mapped')
  if (ghl?.workflow_new_inbound) done.push('workflows')
  for (const t of ticks) if (t.agent_id === p.id && !done.includes(t.step)) done.push(t.step)
  return done
}
export function toOnboard(p, ctx = {}) {
  const s = (ctx.settings || []).find(x => x.agent_id === p.id)
  const done = setupDone(p, ctx)
  const live = (ctx.ticks || []).find(t => t.agent_id === p.id && t.step === 'live')
  return {
    id: p.id, name: nameOf(p), city: '', state: s?.states?.[0] || '', states: s?.states || [], lead: p.live_transfer_phone ? 'live' : 'appointment',
    spend: Math.round((p.leads_weekly_cents || 0) / 700), done, since: shortDate(p.created_at), liveOn: live ? whenText(live.done_at) : undefined, campaignReq: null,
    plan: done.includes('plan') ? planKey(p.billing_tier, Math.round((p.leads_weekly_cents || 0) / 100)) : null, real: true,
    // P913/P915: the launch checks. With admin_launch_view (migration 253) loaded, every fact comes from the server
    // (agent_launch_facts: the same rules the server enforces); without it, what the profile already holds.
    agentRef: p.agent_code || p.id,
    launch: {
      licence: !!p.npn, hours: p.working_hours_start || '', tz: p.timezone || '',
      card: ['active', 'trialing'].includes(p.billing_status) ? 'Card on file' : '', cardFailed: p.billing_status === 'past_due' ? 'past due' : '',
    },
    paid: done.includes('paid') ? { on: shortDate(p.created_at), days: 2 } : null,
    ...launchOf(ctx.launch?.[p.id], done, ctx.now),
  }
}

// P915: one agent's row of admin_launch_view: { checks: { ok, failed, facts }, push: [control rows] } -> the ticket's
// launch facts, 'on' when the campaign is turned on, and the last send of campaign on/off to GoHighLevel per side.
export function launchOf(row, done = [], now = Date.now()) {
  const f = row?.checks?.facts
  if (!f) return {}
  const L = f.launch || {}
  const when = v => (v ? whenText(v, now) : '')
  const launch = {
    linkRef: L.linkRef || '', campaignId: L.campaignId || '', campaignRef: L.campaignRef || '',
    testLead: L.testLead ? { at: when(L.testLead.at), matchedRef: L.testLead.matchedRef, by: L.testLead.by, leadId: L.testLead.leadId } : null,
    licence: !!L.licence, hours: L.hours || '', tz: L.tz || '', card: L.card || '', cardFailed: L.cardFailed || '',
    app: { installed: !!L.app?.installed, pushAnswered: !!L.app?.pushAnswered },
    testCall: L.testCall ? { at: when(L.testCall.at), by: L.testCall.by || 'VA' } : null,
    testCallAsked: f.testCallAskedAt ? when(f.testCallAskedAt) : '',
  }
  const out = { agentRef: f.agentRef, lead: f.lead === 'live' ? 'live' : 'appointment', states: f.states || [], launch, launchState: f.state || 'off' }
  // P941: the sign-up block (migration 264): plan, daily spend, the sign-up charge and when, hours, time zone, transfers.
  const S = f.signup
  if (S) {
    out.signup = {
      tier: S.tier || null, dailyCents: S.dailyCents ?? null, paidCents: S.paidCents ?? null, setupCents: S.setupCents ?? 0,
      planCents: S.planCents ?? 0, leadCents: S.leadCents ?? 0, paidOn: S.paidAt ? when(S.paidAt) : '', paidShort: S.paidAt ? shortDate(S.paidAt) : '',
      tz: S.tz || '', hours: Array.isArray(S.hours) ? S.hours : [], live: !!S.live,
    }
    if (S.dailyCents != null) out.spend = Math.round(S.dailyCents / 100)
    if (S.paidAt) out.paid = { on: when(S.paidAt), short: shortDate(S.paidAt), days: f.paidDays || 0 }
  }
  if (f.state === 'on') out.done = [...new Set([...done, 'on'])]
  if (f.state === 'paused') out.pausedKey = f.pausedKey || ''
  out.push = (row.push || []).map(c => pushOf(c, now))
  return out
}

// The last send of one campaign on/off row: sent, waiting, or failing (with the error and the next try).
export function pushOf(c, now = Date.now()) {
  const side = c.lead_type === 'live' ? 'Call ads' : 'Form ads'
  const what = c.run ? `on, $${Math.round((c.daily_budget_cents || 0) / 100)}/day` : `off (${c.reason || 'off'})`
  const pending = !c.pushed_at || Date.parse(c.pushed_at) < Date.parse(c.changed_at)
  if (c.error) return { side, what, tone: 'warn', text: `Failed ${c.attempts}x · ${c.error}${c.next_at ? ` · next try ${whenText(c.next_at, now)}` : ''}` }
  if (pending) return { side, what, tone: 'mute', text: 'Waiting to send to GoHighLevel' }
  return { side, what, tone: 'green', text: `Sent ${whenText(c.pushed_at, now)}${c.engine_state ? ` · GoHighLevel: ${c.engine_state}` : ''}` }
}

// ── the whole admin store on real data ───────────────────────────────────────
// raw: what hooks/admRealData.js loaded (each source an array/object, [] / null when missing). base: the sample
// store's settings, for the rules that are company config rather than sample records (notification list, pay rule).
// Returns the same keys as the sample store, so every derived hook (funnel, Money, Setup) reads it unchanged.
export function buildAdmState(raw = {}, { now = Date.now(), clock = realClock(now), me = null, base = {} } = {}) {
  // P929: test accounts (is_test, the demo side, and the known test ids) and everything of theirs stay out of every
  // admin number: revenue, agents, leads, clients, calls, VA pay, to-dos.
  const testIds = new Set((raw.profiles || []).filter(p => p.is_demo || isTestProfile(p)).map(p => p.id))
  const notTest = id => !id || !testIds.has(id) && !isTestProfile({ id })
  const profiles = (raw.profiles || []).filter(p => !p.deleted_at && !p.is_demo && !isTestProfile(p))
  const settings = raw.leadSettings || []
  const plansIdx = base.plans || {}
  const agents = profiles.filter(p => p.role === 'agent').map(p => toAgent(p, { settings, onDuty: raw.onDuty || [], plans: plansIdx }))
  const vas = profiles.filter(p => p.role === 'fulfillment').map(p => toVa(p, { accounts: raw.accounts || [] }))
  const intake = Object.fromEntries((raw.intake || []).map(i => [i.lead_id, i]))
  const seen = new Set()
  const leads = [...(raw.leads || []), ...(raw.unassigned || [])].filter(l => !l.is_sample && notTest(l.assigned_rep_id) && !seen.has(l.id) && seen.add(l.id)).map(l => toLead(l, { clock, now, intake }))
  const openByPolicy = {}
  for (const t of raw.steps || []) openByPolicy[t.policy_id] = (openByPolicy[t.policy_id] || 0) + 1
  const policies = (raw.policies || []).filter(p => !p.is_demo && notTest(p.agent_id) && notTest(p.assigned_fulfillment_id))
  const clients = policies.filter(p => p.agent_id).map(p => toClient(p, openByPolicy[p.id] || 0))
  const ids = new Set(clients.map(c => c.id))
  const steps = (raw.steps || []).filter(t => ids.has(t.policy_id)).map(t => toStep(t, now))
  const calls = policies.filter(p => p.fulfillment_assigned && isToday(p.scheduled_call_at, now)).map(p => toCall(p, now))
    .sort((a, b) => String(a.time).localeCompare(String(b.time)))
  const dayOff = (raw.dayOff || []).filter(r => notTest(r.va_id)).map(r => ({ id: r.id, va_id: r.va_id, date: Number(String(r.off_date || '').slice(8, 10)) || null, reason: r.reason || '', asked: whenText(r.created_at, now), status: r.status || 'pending' }))
  const audit = (raw.audit || []).map(r => toAudit(r, now))
  const mapped = new Set((raw.campaigns || []).filter(c => c.agent_id).map(c => c.agent_id))
  const agentProfiles = profiles.filter(p => p.role === 'agent')
  const ticks = raw.ticks || []
  const onboard = agentProfiles.filter(p => !ticks.some(t => t.agent_id === p.id && t.step === 'live'))
    .map(p => toOnboard(p, { settings, ticks, mapped, ghl: raw.ghl, launch: Object.fromEntries((raw.launch || []).map(r => [r.agent_id, r])), now }))
  const app = raw.app || {}
  const rc = raw.rc || {}
  const meP = profiles.find(p => p.id === me?.id) || me || {}
  const runs = (raw.runs || []).map(r => ({ id: r.id, week: r.period_start ? `Week of ${shortDate(r.period_start)}` : '', paid: whenText(r.pay_date, now) || shortDate(r.pay_date), amount: Math.round((r.paid_cents || 0) / 100), people: r.paid_reps || 0, status: r.status || 'paid', payIso: r.pay_date ? String(r.pay_date).slice(0, 10) : null }))
  const campaigns = (raw.campaigns || []).filter(c => notTest(c.agent_id)).map(c => toCampaign(c, agents))
  const costs = costsOf(raw.costsWeek || [])
  const weekSpend = Object.values(costs).reduce((t, c) => t + c.spend, 0)
  const connect = connectOf(raw.ghl, raw.keySaved, campaigns)
  connect.ads[0].spent = Math.round(weekSpend)
  return {
    agents, vas, invites: (raw.invites || []).map(r => toInvite(r, now)), leads, clients, steps, calls,
    rota: {}, dayOff, cancels: [], runs, revenue: [], threads: toThreads(raw.threads || [], raw.messages || [], me?.id, now),
    feed: audit.slice(0, 8).map(a => ({ id: `f-${a.id}`, who: a.who, text: `${a.what}${a.target ? `: ${a.target}` : ''}`, at: a.at, kind: 'team' })),
    settings: {
      ...base.settings,
      profile: { name: meP.full_name || '', email: meP.email || '', phone: fmtPhone(meP.phone) },
      tz: meP.timezone || base.settings?.tz || TZ,
      billing: { ...(base.settings?.billing || {}), maxOverride: {} },
      switches: switchesOf(app, rc), payoutsPaused: !!rc.payouts_paused, liveRoom: app.daily_room_url || '',
      split: base.settings?.split || { brayden: 50, changed: null }, showSample: app.show_sample_data !== false,
      daysOffPerMonth: app.va_days_off_per_month ?? base.settings?.daysOffPerMonth, // P915: the server's allowance
    },
    bugs: (raw.bugs || []).map(b => toBug(b, now)), audit, connect, setupFees: [], draws: [], onboard, setupLog: {},
    clock, costs, costsMonth: costsOf(raw.costsMonth || []), costsLast: costsOf(raw.costsLast || []), periodCosts: { week: { adsExtra: 0, tools: 0 }, month: { adsExtra: 0, tools: 0 }, last: { ads: 0, tools: 0 } },
    stripeBalance: null, real: true, trend: leadTrendOf(raw.history || [], clock, notTest),
    spendTrend: leadSpendTrendOf(raw.history || [], clock, notTest), // P943: the Revenue chart's booking desk history
    // P942: the Leads board's "Showing: All" (the last 91 days; this week's list stays "leads").
    allLeads: (() => { const ids = new Set(leads.map(l => l.id)); return [...leads, ...(raw.history || []).filter(l => !l.is_sample && notTest(l.assigned_rep_id) && !ids.has(l.id)).map(l => toLead(l, { clock, now, intake }))] })(),
  }
}

// P943: the Revenue stock chart's lead history: per day (Central), the leads charged to an agent, by kind (an
// appointment or a live call), counted the day they came in. Test and sample leads stay out. data.js prices them.
export function leadSpendTrendOf(history, clock, notTest = () => true) {
  const rows = (history || []).filter(l => !l.is_sample && l.assigned_rep_id && notTest(l.assigned_rep_id) && Number.isFinite(Date.parse(l.created_at)))
  const day = l => ymd(partsOf(Date.parse(l.created_at)))
  return dailyCounts(clock.todayIso, {
    appointment: rows.filter(l => l.inbound_product !== 'live_call').map(day),
    live: rows.filter(l => l.inbound_product === 'live_call').map(day),
  })
}
const isoDay = iso => { const ms = Date.parse(iso || ''); return Number.isFinite(ms) ? ymd(partsOf(ms)) : null }

// P942: the Overview leads chart, one row per day for the last 91 days (Central): came in, delivered (an appointment or
// a live call that reached an agent) and sold, each counted on the day the lead came in. Test and sample leads stay out.
export function leadTrendOf(history, clock, notTest = () => true) {
  const rows = (history || []).filter(l => !l.is_sample && notTest(l.assigned_rep_id) && Number.isFinite(Date.parse(l.created_at)))
  const day = l => ymd(partsOf(Date.parse(l.created_at)))
  const delivered = l => l.assigned_rep_id && !teamOwned(l)
  return dailyCounts(clock.todayIso, {
    in: rows.map(day),
    delivered: rows.filter(delivered).map(day),
    sold: rows.filter(l => leadStage(l) === 'sold').map(day),
  })
}
