// P986 — the admin phone app's rules, as plain functions (no React), so node --test runs them. The app itself is in
// this folder (AdminApp and its screens); it reads the same admin data hooks as the desktop admin (src/adminshell/data.js)
// and the same addresses (src/adminshell/paths.js), so sample data stays on until launch exactly like the desktop.
import { admPageOf, isAdminPreviewPath, PREVIEW_BASE } from '../paths.js'

export const ADM_TABS = ['home', 'agents', 'team', 'messages', 'you']
export const ADM_LABEL = { home: 'Home', agents: 'Agents', team: 'Team', messages: 'Messages', you: 'You' }
// Sub-screens opened with ?s= over the current tab (the agent and VA apps' way). t = the record's id.
export const ADM_SUBS = ['notif', 'search', 'money', 'agent', 'va', 'thread', 'unassigned', 'ai', 'leads', 'lead', 'clients', 'client', 'reports', 'bugs', 'bug', 'setup', 'payouts', 'plans', 'settings', 'profile']
// Screens with their own bottom (a chat box or Message + Call): the tab bar slides away under them.
export const ADM_OWN_BAR = ['thread', 'search', 'agent', 'va', 'lead', 'client', 'bug']
// Which tab a sub-screen belongs to when it's opened from an address (not from a tab).
const HOME_OF = { money: 'home', agent: 'agents', va: 'team', thread: 'messages' }

const strip = p => { const s = String(p || ''); return isAdminPreviewPath(s) ? s.slice(PREVIEW_BASE.length) : s }
const idOf = (pathname, base) => { const m = new RegExp(`^${base}/([^/]+)/?$`).exec(strip(pathname)); return m ? decodeURIComponent(m[1]) : null }

// Where an address lands in the app: { tab, sub, id }. The desktop admin addresses keep working on the phone:
// /admin/agents/<id> is an agent, /admin/fulfillment/<id> a VA, /admin/inbounds is All leads, /admin/pipeline All clients,
// /admin/billing Reports, /admin/bugs Bug reports, /admin/connect Setup, /admin/settings the You tab.
export function admRouteOf(pathname, search = '') {
  const q = new URLSearchParams(search || '')
  const page = admPageOf(pathname)
  const r = { tab: 'home', sub: null, id: null }
  const rec = base => idOf(pathname, base)
  switch (page) {
    case 'agents': Object.assign(r, { tab: 'agents' }, rec('/admin/agents') ? { sub: 'agent', id: rec('/admin/agents') } : {}); break
    case 'setup': r.tab = 'agents'; break
    case 'team': Object.assign(r, { tab: 'team' }, rec('/admin/fulfillment') ? { sub: 'va', id: rec('/admin/fulfillment') } : {}); break
    case 'leads': Object.assign(r, { tab: 'you', sub: rec('/admin/inbounds') ? 'lead' : 'leads', id: rec('/admin/inbounds') }); break
    case 'clients': Object.assign(r, { tab: 'you', sub: rec('/admin/pipeline') ? 'client' : 'clients', id: rec('/admin/pipeline') }); break
    case 'billing': Object.assign(r, { tab: 'you', sub: 'reports' }); break
    case 'bugs': Object.assign(r, { tab: 'you', sub: 'bugs' }); break
    case 'connect': Object.assign(r, { tab: 'you', sub: 'setup' }); break
    case 'messages': r.tab = 'messages'; break
    case 'settings': case 'numbers': case 'compliance': r.tab = 'you'; break
    default: break
  }
  const s = q.get('s')
  if (ADM_SUBS.includes(s)) { r.sub = s; r.id = q.get('t') || null }
  if (r.sub && HOME_OF[r.sub] && !q.get('s')) r.tab = HOME_OF[r.sub]
  return r
}

// ── Money ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const money = n => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-US')}`
// "+$1,240 vs last month" / "-$80 vs last month" / "Same as last month".
export function changeWords(now, before, what = 'last month') {
  const d = Math.round((Number(now) || 0) - (Number(before) || 0))
  if (!d) return `Same as ${what}`
  return `${d > 0 ? '+' : '-'}${money(Math.abs(d))} vs ${what}`
}
// Bars for a few numbers: each as a % of the largest (at least 6 % so a small one still shows).
export const barsOf = vals => { const max = Math.max(1, ...vals.map(v => Math.max(0, v))); return vals.map(v => Math.max(6, Math.round((Math.max(0, v) / max) * 100))) }
// The two halves: you first (when you're an owner), then the other owner. `me` = the owner signed in, or null.
export function halvesOf(split = [], me = null) {
  const mine = me ? split.find(o => o.id === me.id) : null
  const rest = split.filter(o => o !== mine)
  return [...(mine ? [{ ...mine, label: 'Your half' }] : []), ...rest.map(o => ({ ...o, label: `${o.name}’s half` }))]
}

// ── Agents ───────────────────────────────────────────────────────────────────────────────────────────────────────
const WHAT = { leads: 'Leads', servicing: 'Servicing', reactivation: 'Reactivation' }
export const buysOf = a => {
  const picked = a.picked?.length ? a.picked : a.plan === 'servicing' ? ['servicing'] : ['leads', ...(a.servicing ? ['servicing'] : [])]
  return picked.map(k => WHAT[k]).filter(Boolean)
}
export const buysLeads = a => buysOf(a).includes('Leads')
// What an agent needs from an admin, or null: a failed card first, then past due, access off, lead spend paused.
export function flagOf(a) {
  const f = a.billing?.failed
  if (f) return { kind: 'failed', tone: 'coral', title: `${f.what} declined`, text: `${f.why} · ${f.when}${a.billing?.next ? ` · ${a.billing.next}` : ''}` }
  if (a.billing?.status === 'past_due') return { kind: 'past_due', tone: 'coral', title: 'Past due', text: a.billing.next || 'Card needs updating' }
  if (a.access === false) return { kind: 'access', tone: 'apricot', title: 'Access is off', text: 'They can’t sign in until it’s turned back on' }
  if (a.paused) return { kind: 'paused', tone: 'apricot', title: 'Lead spend paused', text: a.paused.until ? `Until ${a.paused.until}` : 'Until they turn it back on' }
  return null
}
// One status line for a "Doing fine" row.
export function statusLine(a) {
  if (a.comped) return `Comped · ${a.billing?.next || ''}`.replace(/ · $/, '')
  const w = a.week || {}
  const got = (w.booked || 0) + (w.transferred || 0)
  if (!buysLeads(a)) return `${a.clients || 0} ${a.clients === 1 ? 'client' : 'clients'} on the books`
  const on = a.onDuty && a.active ? 'Taking calls now' : `Last on ${a.lastOn || 'not yet'}`
  return `${on} · ${got} booked this week`
}
// Daily lead spend across the agents still buying leads (paused, comped and servicing-only count as none).
// The agents taking leads right now (buying Leads, access on, not paused, comped or past due): who a lead can go to.
export const takingLeads = agents => agents.filter(a => buysLeads(a) && a.access !== false && !a.paused && !a.comped && a.billing?.status !== 'past_due')
export const dailySpend = agents => agents.filter(a => buysLeads(a) && !a.paused && !a.comped).reduce((t, a) => t + (Number(a.spend) || 0), 0)
// Agents joined in the last 7 days. `joined` is "Mon D" in the sample year; todayIso is the clock's today.
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
export function isNew(a, todayIso) {
  const m = /^(\w{3}) (\d{1,2})$/.exec(String(a.joined || ''))
  if (!m || MON[m[1]] == null || !todayIso) return false
  const y = Number(todayIso.slice(0, 4))
  const t = Date.UTC(y, MON[m[1]], Number(m[2]))
  const now = Date.parse(`${todayIso}T00:00:00Z`)
  return now - t >= 0 && now - t < 7 * 86400000
}
export function agentGroups(agents, filter = 'all', todayIso = '') {
  const list = filter === 'need' ? agents.filter(a => flagOf(a)) : filter === 'new' ? agents.filter(a => isNew(a, todayIso)) : agents
  return [
    { key: 'need', label: 'Need you', items: list.filter(a => flagOf(a)) },
    { key: 'fine', label: 'Doing fine', items: list.filter(a => !flagOf(a)) },
  ].filter(g => g.items.length)
}
// Up to three agents to watch on Home: the ones that need you, then active agents with nothing booked this week.
export function toWatch(agents, n = 3) {
  const need = agents.filter(a => flagOf(a))
  const quiet = agents.filter(a => !flagOf(a) && buysLeads(a) && a.active && !((a.week?.booked || 0) + (a.week?.transferred || 0)))
  return [...need, ...quiet].slice(0, n)
}

// ── Team ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// A desk call's result group: done (the job's done), no answer, needs a result (its time passed, not started),
// to call (booked, on a call now, or the AI is rebooking it).
export const CALL_GROUP = { done: 'done', cancelled: 'done', no_answer: 'noanswer', late: 'open', booked: 'todo', live: 'todo', rebook: 'todo' }
export const GROUP_TAG = { done: 'Done', noanswer: 'No answer', open: 'Needs a result', todo: 'To call' }
export const GROUP_TONE = { done: 'sage', noanswer: 'butter', open: 'apricot', todo: 'sky' }
export const GROUP_ORDER = ['done', 'noanswer', 'open', 'todo']
export function callSplit(calls = []) {
  const n = Object.fromEntries(GROUP_ORDER.map(k => [k, 0]))
  for (const c of calls) n[CALL_GROUP[c.status] || 'todo'] += 1
  return { counts: n, total: calls.length, done: n.done }
}
export const callTag = c => (c.status === 'live' ? 'On the call now' : c.status === 'rebook' ? 'AI is rebooking' : GROUP_TAG[CALL_GROUP[c.status] || 'todo'])
// The rota row of one VA for a week of dates: which of the days they're on.
export const rotaOf = (rota, days, vaId) => days.map(d => (rota[d] || []).includes(vaId))

// ── Leads and clients ────────────────────────────────────────────────────────────────────────────────────────────
// P995 — All leads built like the agent Leads page: Delivered (booked appointments and live transfers together),
// Follow up, Not interested and Sold, each in the agent page's colour (template/m/appModel TONE: booked sky, follow
// up butter, sold sage, closed stone). No-shows are the closed ones: they only show with the "Show closed" switch,
// in grey, like the agent side. A lead with no agent yet is in no filter: it leads the full list in apricot.
export const LEAD_FILTERS = [['delivered', 'Delivered'], ['follow', 'Follow up'], ['not_interested', 'Not interested'], ['sold', 'Sold']]
export const LEAD_GROUPS = ['new', 'delivered', 'follow', 'not_interested', 'sold', 'closed']
export function leadStage(l) {
  if (l.stage === 'unassigned' || !l.agent_id) return 'new'
  if (l.stage === 'sold') return 'sold'
  if (l.stage === 'not_interested') return 'not_interested'
  if (l.stage === 'no_show') return 'closed'
  if (l.stage === 'follow_up') return 'follow'
  return 'delivered'
}
export const LEAD_WORD = { new: 'Needs an agent', delivered: 'Delivered', follow: 'Follow up', not_interested: 'Not interested', sold: 'Sold', closed: 'Closed' }
export const LEAD_TONE = { new: 'apricot', delivered: 'sky', follow: 'butter', not_interested: 'stone', sold: 'sage', closed: 'stone' }
export const LEAD_HINT = {
  all: 'Every lead across every agent, newest first.',
  delivered: 'Booked appointments and live transfers handed to an agent.',
  follow: 'To call back: the agent’s, or our team’s while we try to reach them.',
  not_interested: 'The agent marked them not interested. Calls and texts stopped.',
  sold: 'Sold. Each one goes on to servicing.',
}
// The lead type on a row: booked or live (a lead the team never reached has neither yet).
export const leadKind = l => (l.kind === 'live' ? 'Live transfer' : l.kind === 'appointment' ? 'Booked appointment' : 'Not reached yet')
// The bold line on a row, like the agent page's "when": what kind of lead and when it came in, or what happened.
export function leadWhen(l) {
  const st = leadStage(l)
  if (st === 'closed') return `No show${l.appt ? ` · ${l.appt}` : ''} · rebook text sent`
  if (st === 'delivered' && l.kind === 'appointment' && l.appt) return `Booked · ${l.appt}`
  return `${leadKind(l)} · ${l.came || ''}`.replace(/ · $/, '')
}
const digits = s => String(s || '').replace(/\D/g, '')
export function filterLeads(leads, { q = '', stage = null, agent = null, closed = false } = {}) {
  const t = q.trim().toLowerCase()
  const d = digits(t)
  return leads.filter(l => {
    const st = leadStage(l)
    const inView = stage ? st === stage || (closed && st === 'closed') : closed || st !== 'closed'
    return inView && (!agent || l.agent_id === agent)
      && (!t || l.name.toLowerCase().includes(t) || (d.length >= 3 && digits(l.phone).includes(d)) || String(l.agent || '').toLowerCase().includes(t))
  })
}
// The count on each filter tile: the leads that agent and that search would show in it (closed never counts).
export function leadCounts(leads, { q = '', agent = null } = {}) {
  const base = filterLeads(leads, { q, agent })
  return Object.fromEntries(LEAD_FILTERS.map(([k]) => [k, base.filter(l => leadStage(l) === k).length]))
}
// The full list grouped like the agent page (one group per status, in filter order), newest first in each.
export function groupLeads(list) {
  const newest = list.slice().reverse()
  return LEAD_GROUPS.map(k => [k, newest.filter(l => leadStage(l) === k)]).filter(([, items]) => items.length)
}
// A lead's timeline for the admin lead screen, oldest first. The result lines come from the agent and the system.
const MATCH_WORD = { link: 'From the agent ID in the ad link', campaign: 'From the Meta campaign ID', admin: 'Given by an admin' }
export function leadEvents(l) {
  const st = leadStage(l)
  const who = String(l.agent || '').split(' ')[0] || 'The agent'
  const ev = [{ what: 'Came in', sub: [l.source, l.came].filter(Boolean).join(' · ') }]
  if (!l.agent_id) ev.push({ what: 'Waiting for an agent', sub: l.why || 'No agent matched it yet' })
  else {
    ev.push({ what: `Matched to ${l.agent}`, sub: MATCH_WORD[l.matchedBy] || '' })
    if (l.kind === 'live') ev.push({ what: `Live transfer to ${who}`, sub: l.came || '' })
    else if (l.kind === 'appointment') ev.push({ what: 'Appointment booked', sub: l.appt || '' })
    else ev.push({ what: 'Not reached yet', sub: 'Our team keeps trying' })
    if (st === 'sold') ev.push({ what: 'Sold', sub: l.premium ? `${money(l.premium)} a month · goes on to servicing` : 'Goes on to servicing' })
    else if (st === 'not_interested') ev.push({ what: 'Not interested', sub: 'Calls and texts stopped' })
    else if (st === 'closed') ev.push({ what: 'No show', sub: 'Rebook text sent · the AI caller calls to book again' })
    else if (st === 'follow' && l.owner !== 'team') ev.push({ what: 'Follow up', sub: `${who} calls them back` })
  }
  for (const x of l.log || []) ev.push({ what: String(x), sub: '' })
  return ev
}
export const CLIENT_FILTERS = [['needs_attention', 'Needs attention'], ['working', 'Working'], ['protected', 'Protected']]
export function filterClients(clients, { q = '', stage = null } = {}) {
  const t = q.trim().toLowerCase()
  const d = digits(t)
  return clients.filter(c => (!stage || c.stage === stage)
    && (!t || c.name.toLowerCase().includes(t) || (d.length >= 3 && digits(c.phone).includes(d)) || String(c.policy || '').toLowerCase().includes(t) || String(c.agent || '').toLowerCase().includes(t)))
}

// ── Search (Home) ────────────────────────────────────────────────────────────────────────────────────────────────
// Agents, VAs, leads and clients in one list, best first (name starts with the words, then contains them).
export function searchAll({ agents = [], vas = [], leads = [], clients = [] }, q, max = 24) {
  const t = q.trim().toLowerCase()
  if (!t) return []
  const d = digits(t)
  const hit = (name, phone) => {
    const n = String(name || '').toLowerCase()
    if (n.startsWith(t) || n.split(/\s+/).some(w => w.startsWith(t))) return 2
    if (n.includes(t) || (d.length >= 3 && digits(phone).includes(d))) return 1
    return 0
  }
  const rows = [
    ...agents.map(a => ({ kind: 'agent', id: a.id, name: a.name, sub: `Agent · ${a.city || ''}${a.state ? `, ${a.state}` : ''}`, score: hit(a.name, a.phone) })),
    ...vas.map(v => ({ kind: 'va', id: v.id, name: v.name, sub: 'VA', score: hit(v.name, v.phone) })),
    ...leads.map(l => ({ kind: 'lead', id: l.id, name: l.name, sub: `Lead · ${l.agent || 'No agent yet'}`, score: hit(l.name, l.phone) })),
    ...clients.map(c => ({ kind: 'client', id: c.id, name: c.name, sub: `Client · ${c.agent || ''}`, score: hit(c.name, c.phone) })),
  ]
  return rows.filter(r => r.score > 0).sort((x, y) => y.score - x.score || x.name.localeCompare(y.name)).slice(0, max)
}

// ── Bug reports ──────────────────────────────────────────────────────────────────────────────────────────────────
// new → Looking (seen) → Fixed. The store keeps new | seen | fixed.
export const BUG_WORD = { new: 'New', seen: 'Looking', fixed: 'Fixed' }
export const BUG_TONE = { new: 'coral', seen: 'butter', fixed: 'sage' }
export const appOf = b => {
  const p = String(b.page || '')
  if (/^\/(preview\/)?admin/.test(p)) return 'Admin app'
  if (/fulfillment|^\/(template\/)?fulfillment/.test(p) || b.role === 'Fulfillment') return 'VA app'
  return 'Agent app'
}
export const pageOf = b => {
  const p = String(b.page || '').split('?')[0].replace(/^\/(preview|template)/, '').replace(/^\/(admin|agent|fulfillment)/, '')
  const word = p.split('/').filter(Boolean)[0] || 'home'
  return word.charAt(0).toUpperCase() + word.slice(1)
}

// ── Setup (connections, view only) ───────────────────────────────────────────────────────────────────────────────
// Every outside service and whether it's connected, from the same settings and Connect data the desktop reads.
// Changes are made on the desktop; nothing here switches anything.
export function connectionsOf({ connect = {}, settings = {} } = {}) {
  const sw = settings.switches || {}
  const ads = connect.ads || []
  const C = (key, name, what, on, note) => ({ key, name, what, on: !!on, note })
  return [
    C('stripe', 'Stripe', 'Cards, plans and setup fees', true, sw.billing_enforced ? 'Charging live' : 'Connected · charging is off until launch'),
    C('ghl', 'GoHighLevel', 'Lead intake, texts, reminders', !!connect.ghl?.keySaved, connect.ghl?.keySaved ? `Location ${connect.ghl.locationId}` : 'Key not saved yet'),
    C('twilio', 'Phone numbers (Twilio)', 'Calls and texts', connect.texting?.campaign === 'approved' && sw.sms_live, connect.texting?.campaign === 'approved' ? (sw.sms_live ? `Live on ${connect.texting.number}` : 'Approved · texting is off until launch') : 'Texting campaign in review'),
    C('retell', 'Retell AI caller', 'The AI that calls and books', sw.ai_caller_live, sw.ai_caller_live ? 'Calling live' : 'Off until launch'),
    C('elevenlabs', 'ElevenLabs', 'The AI caller’s voice', sw.ai_caller_live, sw.ai_caller_live ? 'Voice live' : 'Off until the AI caller goes live'),
    C('meta', 'Meta ads (Deedstone)', 'One campaign per agent', ads.length > 0 && ads.every(a => a.account), ads.every(a => a.account) ? 'Ad accounts linked' : `${ads.filter(a => !a.account).length} ad account${ads.filter(a => !a.account).length === 1 ? '' : 's'} not linked`),
    C('stores', 'App Store and Google Play', 'The phone app', true, 'Updates go out over the air'),
  ]
}
