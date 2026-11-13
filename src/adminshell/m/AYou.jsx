import { useMemo, useRef, useState } from 'react'
import { ChevronRight, Moon, UserPlus, Bot, Search, SlidersHorizontal, MessageCircle, Image as ImageIcon, Check, Settings2, Bug, Plug, Wallet, Tags, BarChart3, Users, ListChecks } from 'lucide-react'
import {
  useAdmDay, useAdmAgents, useAdmVas, useAdmLeads, useAdmClients, useAdmBugs, useAdmActions, useAdmSettings, useAdmConnect,
  useAdmPeriod, useAdmMoney, useAdmDraws, useAdmAgentResults, useAdmDesk, useAdmCosts, PLANS, PERIODS, SETUP_FEE, ME,
} from '../data'
import { PRICES } from '../../lib/priceBook'
import { SAMPLE_AI_CALLS, SAMPLE_CENTS_PER_MIN } from '../../lib/aiCaller'
import { useAccount, useNote } from '../../template/kit'
import { useTheme } from '../../hooks/useTheme'
import { useApp, SubPage, Row, Ini, Toggle, SignOutButton, BottomSheet, rise } from '../../template/m/AppKit'
import { useNoAutoKeyboard } from '../../template/m/useKeyboard'
import { firstName } from '../../template/m/va/vaModel'
import {
  money, halvesOf, LEAD_FILTERS, LEAD_WORD, LEAD_TONE, leadStage, filterLeads, CLIENT_FILTERS, filterClients, BUG_WORD, BUG_TONE,
  appOf, pageOf, connectionsOf, callSplit,
} from './admModel'
import { useOwnerMe, useAdmName } from './useAdm'
import { AssignSheet } from './ASubsAdm'
import { useMessageTo } from './useAdm'

// P986 — You: a dark card (you, Admin, your next payout and payday, how many agents), two tiles (Unassigned leads,
// AI caller), then All leads, All clients, Reports, Bug reports, Setup, Payouts, Plans and prices, Theme, Settings,
// and Sign out as plain red text. Everything here is the desktop admin's data; changes that need the desktop (plans,
// prices, live switches, connections) say so instead of offering a switch.
const shortPay = p => String(p || '').replace(/^(\w{3}), \w{3} (\d+)$/, '$1 $2')
const Sym = ({ tone, Icon }) => <span className={`ma-sym is-${tone}`}><Icon size={16} aria-hidden="true" /></span>

export default function AYou() {
  const app = useApp()
  const me = useOwnerMe()
  const { data: day } = useAdmDay()
  const { data: agents } = useAdmAgents()
  const { data: month } = useAdmPeriod('month')
  const { data: m } = useAdmMoney()
  const { data: settings } = useAdmSettings()
  const { data: bugs } = useAdmBugs()
  const [theme, setTheme] = useTheme()
  const ai = aiWeek()
  const mine = me ? month.split.find(o => o.id === me.id) : null
  const name = useAdmName() || ME.name
  const openBugs = bugs.filter(b => b.status !== 'fixed').length
  return (
    <div className="ma-tabpage">
      <h1 className="ma-h1 ma-rise">You</h1>
      <div className="ma-plan ma-rise" style={rise(0)}>
        <i className="ma-glow is-sky" aria-hidden="true" />
        <div className="ma-plan-me">
          <Ini name={name} tone="sky" size={58} className="is-ring" />
          <span className="ma-grow"><b>{name}</b><small>Admin · Ohvara</small></span>
        </div>
        <div className="ma-plan-stats">
          <div><b className="tp-money">{mine ? money(mine.owed) : '–'}</b><small>{mine ? 'next payout' : 'not an owner'}</small></div>
          <div><b>{shortPay(m.payday)}</b><small>payday</small></div>
          <div><b>{agents.length}</b><small>agents</small></div>
        </div>
      </div>

      <div className="ma-tiles ma-rise" style={rise(1)}>
        <button type="button" className={`ma-tile is-${day.unassigned.length ? 'apricot' : 'butter'}`} onClick={() => app.openSub('unassigned')}>
          <span className="ma-tile-ic" aria-hidden="true"><UserPlus size={19} /></span>
          <ChevronRight size={20} strokeWidth={2.4} className="ma-tile-go" aria-hidden="true" />
          <span><b>Unassigned leads</b><small>{day.unassigned.length ? `${day.unassigned.length} waiting for an agent` : 'None waiting'}</small></span>
        </button>
        <button type="button" className="ma-tile is-sky" onClick={() => app.openSub('ai')}>
          <span className="ma-tile-ic" aria-hidden="true"><Bot size={19} /></span>
          <ChevronRight size={20} strokeWidth={2.4} className="ma-tile-go" aria-hidden="true" />
          <span><b>AI caller</b><small>{settings.switches?.ai_caller_live ? `${ai.calls} calls · ${ai.booked} booked` : 'Off until launch'}</small></span>
        </button>
      </div>

      <div className="ma-glass ma-list ma-acct-list ma-rise" style={rise(2)}>
        <Row onClick={() => app.openSub('leads')} lead={<Sym tone="sky" Icon={ListChecks} />} title="All leads" sub={`${day.week.in} this week across every agent`} />
        <Row onClick={() => app.openSub('clients')} lead={<Sym tone="sage" Icon={Users} />} title="All clients" sub="Every policy we look after" />
        <Row onClick={() => app.openSub('reports')} lead={<Sym tone="butter" Icon={BarChart3} />} title="Reports" sub="This week and this month" />
        <Row onClick={() => app.openSub('bugs')} lead={<Sym tone="coral" Icon={Bug} />} title="Bug reports" sub={openBugs ? `${openBugs} open` : 'Nothing open'} />
        <Row onClick={() => app.openSub('setup')} lead={<Sym tone="stone" Icon={Plug} />} title="Setup" sub="Every connection, view only" />
      </div>
      <div className="ma-glass ma-list ma-acct-list ma-rise" style={rise(3)}>
        <Row onClick={() => app.openSub('payouts')} lead={<Sym tone="sage" Icon={Wallet} />} title="Payouts" sub="Your split, VA pay, the bank" />
        <Row onClick={() => app.openSub('plans')} lead={<Sym tone="sky" Icon={Tags} />} title="Plans and prices" sub="View only" />
        <div className="ma-row ma-theme-row">
          <span className="ma-sym is-stone"><Moon size={16} aria-hidden="true" /></span>
          <span className="ma-grow"><b>Theme</b><small>{theme === 'dark' ? 'Dark' : 'Light'}</small></span>
          <Toggle on={theme === 'dark'} label="Dark theme" onChange={v => setTheme(v ? 'dark' : 'light')} />
        </div>
        <Row onClick={() => app.openSub('settings')} lead={<Sym tone="stone" Icon={Settings2} />} title="Settings" sub="Account, alerts, sample or real" />
      </div>
      <SignOutButton />
    </div>
  )
}

// The AI caller this week (sample calls until it's live; real numbers come from the desktop's AI calls page).
function aiWeek() {
  const calls = SAMPLE_AI_CALLS
  const booked = calls.filter(c => c.outcome === 'booked' || c.outcome === 'transferred').length
  const mins = calls.reduce((t, c) => t + Math.max(1, Math.ceil((Number(c.duration) || 0) / 60)), 0)
  return { calls: calls.length, booked, mins, cost: (mins * SAMPLE_CENTS_PER_MIN) / 100 }
}

export function AUnassigned() {
  const { data: day } = useAdmDay()
  const [give, setGive] = useState(null)
  return (
    <SubPage title="Unassigned leads" line="Leads that matched no agent" big>
      <div className="ma-glass ma-list ma-rise">
        {day.unassigned.map(l => (
          <div key={l.id} className="ma-row am-unrow">
            <span className="ma-grow"><b>{l.name}</b><small>{l.state} · {l.product} · {l.came}</small></span>
            <button type="button" className="ma-nb is-main ma-press" onClick={() => setGive([l])}>Give to an agent</button>
          </div>
        ))}
        {!day.unassigned.length && <p className="ma-empty">None waiting. Every lead found its agent.</p>}
      </div>
      <p className="ma-note">A lead lands here when its ad link had no agent ID and its campaign matched no one.</p>
      <AssignSheet leads={give} onClose={() => setGive(null)} />
    </SubPage>
  )
}

export function AAi() {
  const { data: settings } = useAdmSettings()
  const live = !!settings.switches?.ai_caller_live
  const ai = aiWeek()
  return (
    <SubPage title="AI caller" line={live ? 'Calling new leads now' : 'Off until launch'} big>
      <div className="ma-glass ma-pad am-status ma-rise"><i className={live ? 'is-on' : 'is-off'} aria-hidden="true" /><span className="ma-grow"><b>{live ? 'On' : 'Off'}</b><small>{live ? 'It calls every new lead within a minute.' : 'It starts calling when it’s switched on at launch, on the desktop.'}</small></span></div>
      <p className="ma-cap is-out">{live ? 'This week' : 'Sample week'}</p>
      <div className="am-stats ma-rise" style={rise(1)}>
        <div><b>{ai.calls}</b><small>Calls</small></div>
        <div><b>{ai.booked}</b><small>Booked or transferred</small></div>
        <div><b>{ai.mins} min</b><small>On the phone</small></div>
        <div><b className="tp-money">{money(ai.cost)}</b><small>Cost</small></div>
      </div>
      <p className="ma-note">Every call, its transcript and the voice test are on the desktop’s AI calls page.</p>
    </SubPage>
  )
}

// ── All leads ────────────────────────────────────────────────────────────────────────────────────────────────────
export function ALeadsAll() {
  const app = useApp()
  const { data: leads } = useAdmLeads({ all: true })
  const { data: agents } = useAdmAgents()
  const [q, setQ] = useState('')
  const [stage, setStage] = useState(null)
  const [agent, setAgent] = useState(null)
  const [pick, setPick] = useState(false)
  const input = useRef(null)
  useNoAutoKeyboard(input)
  const list = useMemo(() => filterLeads(leads, { q, stage, agent }).slice().reverse(), [leads, q, stage, agent])
  const agentName = agents.find(a => a.id === agent)?.name
  return (
    <SubPage title="All leads" line={`${leads.length} leads across every agent`} big>
      <div className="am-findrow ma-rise">
        <label className="va-find"><Search size={18} aria-hidden="true" /><input ref={input} type="search" inputMode="search" placeholder="Name, phone or agent" aria-label="Search leads" value={q} onChange={e => setQ(e.target.value)} /></label>
        <button type="button" className={`ma-round ma-press am-filt${agent ? ' is-on' : ''}`} aria-label={agent ? `Agent: ${agentName}. Change` : 'Filter by agent'} onClick={() => setPick(true)}><SlidersHorizontal size={19} aria-hidden="true" /></button>
      </div>
      <div className="ma-chips ma-rise" style={rise(1)}>
        {LEAD_FILTERS.map(([k, w]) => <button key={k} type="button" className={`ma-fchip${stage === k ? ' is-on' : ''}`} aria-pressed={stage === k} onClick={() => setStage(stage === k ? null : k)}>{w}</button>)}
        {agent && <button type="button" className="ma-fchip is-on" onClick={() => setAgent(null)}>{agentName} ✕</button>}
      </div>
      <div className="ma-glass ma-list ma-rise" style={rise(2)}>
        {list.slice(0, 80).map(l => {
          const st = leadStage(l)
          return (
            <button key={l.id} type="button" className="ma-row" onClick={() => app.openSub('lead', { t: l.id })}>
              <span className="ma-grow"><b>{l.name}</b><small>{l.agent || 'No agent yet'} · {l.came}</small></span>
              <span className={`ma-tag is-${LEAD_TONE[st]}`}>{LEAD_WORD[st]}</span>
            </button>
          )
        })}
        {!list.length && <p className="ma-empty">No lead matches that.</p>}
      </div>
      <BottomSheet open={pick} onClose={() => setPick(false)} label="Filter by agent" tall>
        <p className="ma-sheet-t">Show one agent’s leads</p>
        <div className="am-sheetlist">
          <button type="button" className={`ma-pick${!agent ? ' is-on' : ''}`} onClick={() => { setAgent(null); setPick(false) }}><span className="ma-grow"><b>Every agent</b></span></button>
          {agents.map(a => (
            <button key={a.id} type="button" className={`ma-pick${agent === a.id ? ' is-on' : ''}`} onClick={() => { setAgent(a.id); setPick(false) }}>
              <Ini name={a.name} tone="sky" size={36} /><span className="ma-grow"><b>{a.name}</b><small>{leads.filter(l => l.agent_id === a.id).length} leads</small></span>
            </button>
          ))}
        </div>
      </BottomSheet>
    </SubPage>
  )
}

const F = ({ k, v }) => <span><small>{k}</small><b>{v || 'Not given'}</b></span>
export function ALeadAdm({ id }) {
  const { data: leads } = useAdmLeads({ all: true })
  const [give, setGive] = useState(null)
  const l = leads.find(x => x.id === id)
  if (!l) return <SubPage title="Lead"><p className="ma-empty">This lead isn’t here any more.</p></SubPage>
  const st = leadStage(l)
  const foot = <button type="button" className="ma-btn is-solid is-grow is-tall ma-press" onClick={() => setGive([l])}>{l.agent_id ? 'Change the agent' : 'Give to an agent'}</button>
  return (
    <SubPage title={l.name} line={`${LEAD_WORD[st]} · ${l.agent || 'No agent yet'}`} foot={foot} big>
      <div className="ma-glass ma-pad va-facts is-glass ma-rise">
        <F k="Phone" v={l.phone} /><F k="Lives in" v={[l.city, l.state].filter(Boolean).join(', ')} />
        <F k="Wants" v={l.product} /><F k="Came in" v={l.came} />
        <F k="How" v={l.kind === 'live' ? 'Live transfer' : l.kind === 'appointment' ? 'Booked appointment' : 'Not reached yet'} /><F k="Appointment" v={l.appt} />
        <F k="Source" v={l.source} /><F k="Agent ID" v={l.agentRef || (l.campaignId ? 'From the campaign' : '')} />
      </div>
      {l.note && <p className="ma-note">{l.note}</p>}
      <p className="ma-note">Results come from the agent and the system, never set by hand. You can change which agent has it.</p>
      <AssignSheet leads={give} current={l.agent_id} onClose={() => setGive(null)} />
    </SubPage>
  )
}

// ── All clients ──────────────────────────────────────────────────────────────────────────────────────────────────
const CLIENT_TONE = { needs_attention: 'apricot', working: 'sky', protected: 'sage', closed: 'stone' }
const CLIENT_WORD = { needs_attention: 'Needs attention', working: 'Working', protected: 'Protected', closed: 'Closed' }
export function AClientsAll() {
  const app = useApp()
  const { data: clients } = useAdmClients()
  const [q, setQ] = useState('')
  const [stage, setStage] = useState(null)
  const input = useRef(null)
  useNoAutoKeyboard(input)
  const list = filterClients(clients, { q, stage })
  const count = k => clients.filter(c => c.stage === k).length
  return (
    <SubPage title="All clients" line={`${clients.length} policies across every agent`} big>
      <div className="am-ctiles ma-rise" role="tablist" aria-label="Show">
        {CLIENT_FILTERS.map(([k, w]) => (
          <button key={k} type="button" role="tab" aria-selected={stage === k} className={`am-ctile ma-press is-${CLIENT_TONE[k]}${stage === k ? ' is-on' : ''}`} onClick={() => setStage(stage === k ? null : k)}><b>{count(k)}</b><small>{w}</small></button>
        ))}
      </div>
      <label className="va-find ma-rise" style={rise(1)}><Search size={18} aria-hidden="true" /><input ref={input} type="search" inputMode="search" placeholder="Name, phone, policy or agent" aria-label="Search clients" value={q} onChange={e => setQ(e.target.value)} /></label>
      {[...CLIENT_FILTERS, ['closed', 'Closed']].map(([k, w]) => {
        const items = list.filter(c => c.stage === k)
        if (!items.length) return null
        return (
          <div key={k} className="ma-rise" style={rise(2)}>
            <p className="ma-cap is-out">{w} · {items.length}</p>
            <div className="ma-glass ma-list">
              {items.map(c => (
                <button key={c.id} type="button" className="ma-row" onClick={() => app.openSub('client', { t: c.id })}>
                  <Ini name={c.name} tone={CLIENT_TONE[c.stage] === 'apricot' ? 'stone' : 'sky'} size={40} />
                  <span className="ma-grow"><b>{c.name}</b><small>{c.attention || c.tag || `${c.carrier} · ${c.agent}`}</small></span>
                  <ChevronRight size={18} className="ma-chev" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )
      })}
      {!list.length && <p className="ma-empty is-glass">No client matches that.</p>}
    </SubPage>
  )
}

const ORD = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}` }
export function AClientAdm({ id }) {
  const { data: clients } = useAdmClients()
  const { data: agents } = useAdmAgents()
  const msg = useMessageTo()
  const c = clients.find(x => x.id === id)
  if (!c) return <SubPage title="Client"><p className="ma-empty">This client isn’t here any more.</p></SubPage>
  const agent = agents.find(a => a.id === c.agent_id)
  const next = c.steps.find(s => s.status !== 'done')
  const timeline = [
    ...c.steps.map(s => ({ id: s.id, what: s.kind, when: s.due, tone: s.late ? 'apricot' : 'sky' })),
    { id: 'sold', what: `Sold by ${c.agent}`, when: c.sold, tone: 'sage' },
  ]
  const foot = agent ? <button type="button" className="ma-btn is-solid is-grow is-tall ma-press" onClick={() => msg(agent, 'Agent')}><MessageCircle size={18} aria-hidden="true" />Message {firstName(c.agent)}</button> : null
  return (
    <SubPage title={c.name} line={`${CLIENT_WORD[c.stage]} · ${c.agent}’s client`} foot={foot} big>
      {c.attention && <div className={`ma-need is-${CLIENT_TONE[c.stage]} am-flag ma-rise`}><div className="ma-need-top"><span className="ma-grow"><b>{c.attention}</b><small>{c.va ? `${c.va} is on it` : 'Our team is on it'}</small></span></div></div>}
      <div className="ma-glass ma-pad va-facts is-glass ma-rise" style={rise(1)}>
        <span><small>Policy</small><b>{c.policy}</b></span>
        <span><small>Carrier</small><b>{c.carrier}</b></span>
        <span><small>Product</small><b>{c.product}</b></span>
        <span><small>Premium</small><b className="tp-money">${Number(c.premium).toFixed(2)}/mo</b></span>
        <span><small>Draft day</small><b>The {ORD(Number(c.draft))}</b></span>
        <span><small>Phone</small><b>{c.phone}</b></span>
      </div>
      <p className="ma-cap is-out">What’s next</p>
      <div className="ma-glass ma-list ma-rise" style={rise(2)}>
        {next ? <div className="ma-row"><span className="ma-grow"><b>{next.kind}</b><small>{next.due}{next.late ? ' · late' : ''} · {next.va || 'the team'}</small></span></div> : <p className="ma-empty">Nothing booked. We check in before each draft.</p>}
      </div>
      <p className="ma-cap is-out">Timeline</p>
      <div className="ma-glass ma-list ma-rise" style={rise(3)}>
        {timeline.map(t => <div key={t.id} className="ma-row"><span className={`ma-dot is-${t.tone}`} aria-hidden="true" /><span className="ma-grow"><b>{t.what}</b><small>{t.when}</small></span></div>)}
      </div>
      <p className="ma-cap is-out">People</p>
      <div className="ma-glass ma-list ma-rise" style={rise(4)}>
        <div className="ma-row"><Ini name={c.agent} tone="sky" size={36} /><span className="ma-grow"><b>{c.agent}</b><small>Agent</small></span></div>
        {c.va && <div className="ma-row"><Ini name={c.va} tone="sage" size={36} /><span className="ma-grow"><b>{c.va}</b><small>VA · notes from their calls are in the desktop’s client drawer</small></span></div>}
      </div>
    </SubPage>
  )
}

// ── Reports (view only) ──────────────────────────────────────────────────────────────────────────────────────────
export function AReports() {
  const [period, setPeriod] = useState('week')
  const { data: p } = useAdmPeriod(period)
  const { data: res } = useAdmAgentResults(period)
  const { data: day } = useAdmDay()
  const { data: clients } = useAdmClients()
  const { data: desk } = useAdmDesk()
  const { data: costs } = useAdmCosts()
  const me = useOwnerMe()
  const w = day.week
  const kept = clients.length ? Math.round((clients.filter(c => c.stage !== 'closed').length / clients.length) * 100) : 0
  const sp = callSplit(desk)
  const periods = PERIODS.filter(([k]) => k !== 'last')
  return (
    <SubPage title="Reports" line="View only" big>
      <div className="ma-seg am-seg ma-rise" role="tablist" aria-label="Period">
        {periods.map(([k, wd]) => <button key={k} type="button" role="tab" aria-selected={period === k} className={`is-sky${period === k ? ' is-on' : ''}`} onClick={() => setPeriod(k)}>{wd}</button>)}
      </div>
      <div className="am-stats ma-rise" style={rise(1)}>
        <div><b className="tp-money">{money(p.inTotal)}</b><small>Revenue</small></div>
        <div><b className="tp-money">{money(p.profit)}</b><small>Profit</small></div>
        {halvesOf(p.split, me).map(h => <div key={h.id}><b className="tp-money">{money(h.amount)}</b><small>{h.label}</small></div>)}
      </div>
      <p className="ma-cap is-out">Leads {period === 'month' ? '(the sample week)' : ''}</p>
      <div className="am-stats is-3 ma-rise" style={rise(2)}>
        <div><b>{w.in}</b><small>Leads</small></div>
        <div><b>{w.booked + w.transferred}</b><small>Booked</small></div>
        <div><b>{w.sold}</b><small>Sold</small></div>
        <div><b>{kept}%</b><small>Policies kept</small></div>
        <div><b className="tp-money">{costs?.total?.perBooked != null ? money(costs.total.perBooked) : '–'}</b><small>Cost per booked</small></div>
        <div><b>{sp.done}</b><small>VA calls done today</small></div>
      </div>
      {!costs && <p className="ma-note">Cost per booked shows once ad spend comes in from GoHighLevel.</p>}
      <p className="ma-cap is-out">Agents ranked by what they paid</p>
      <div className="ma-glass ma-list ma-rise" style={rise(3)}>
        {res.rows.map((r, i) => (
          <div key={r.id} className="ma-row">
            <span className="ma-sym is-stone">{i + 1}</span>
            <span className="ma-grow"><b>{r.name}</b><small>{r.plan} · kept <span className="tp-money">{money(r.kept)}</span></small></span>
            <span className="ma-val tp-money">{money(r.paid)}</span>
          </div>
        ))}
      </div>
      <p className="ma-cap is-out">VA calls today</p>
      <div className="ma-glass ma-list ma-rise" style={rise(4)}>
        <div className="ma-row"><span className="ma-grow"><b>Done</b><small>Old policy cancelled or the job finished</small></span><span className="ma-val">{sp.counts.done}</span></div>
        <div className="ma-row"><span className="ma-grow"><b>Saves</b><small>Clients who were leaving and stayed</small></span><span className="ma-val">0</span></div>
        <div className="ma-row"><span className="ma-grow"><b>Still to do</b><small>To call, no answer or needs a result</small></span><span className="ma-val">{sp.total - sp.counts.done}</span></div>
      </div>
    </SubPage>
  )
}

// ── Bug reports ──────────────────────────────────────────────────────────────────────────────────────────────────
export function ABugs() {
  const app = useApp()
  const { data: bugs } = useAdmBugs()
  return (
    <SubPage title="Bug reports" line="From agents and VAs, newest first" big>
      <div className="ma-glass ma-list ma-rise">
        {bugs.map(b => (
          <button key={b.id} type="button" className="ma-row" onClick={() => app.openSub('bug', { t: b.id })}>
            <span className="ma-grow"><b>{b.text}</b><small>{b.who} · {appOf(b)}, {pageOf(b)} · {b.at}</small></span>
            <span className={`ma-tag is-${BUG_TONE[b.status] || 'stone'}`}>{BUG_WORD[b.status] || b.status}</span>
          </button>
        ))}
        {!bugs.length && <p className="ma-empty">No reports yet. Agents and VAs send them from Help, Report a problem.</p>}
      </div>
    </SubPage>
  )
}

export function ABug({ id }) {
  const { data: bugs } = useAdmBugs()
  const { data: agents } = useAdmAgents()
  const { data: vas } = useAdmVas()
  const { setBugStatus } = useAdmActions()
  const note = useNote()
  const msg = useMessageTo()
  const b = bugs.find(x => x.id === id)
  if (!b) return <SubPage title="Bug report"><p className="ma-empty">This report isn’t here any more.</p></SubPage>
  const person = [...agents, ...vas].find(p => p.name === b.who)
  const setStatus = s => { setBugStatus(b.id, s, b.who); note(`Marked ${BUG_WORD[s].toLowerCase()}`) }
  const foot = person ? <button type="button" className="ma-btn is-solid is-grow is-tall ma-press" onClick={() => msg(person, b.role === 'Fulfillment' ? 'VA' : 'Agent')}><MessageCircle size={18} aria-hidden="true" />Reply to {firstName(b.who)}</button> : null
  return (
    <SubPage title="Bug report" line={`${b.who} · ${b.at}`} foot={foot} big>
      <div className="ma-seg am-seg ma-rise" role="radiogroup" aria-label="Status">
        {['new', 'seen', 'fixed'].map(s => <button key={s} type="button" role="radio" aria-checked={b.status === s} className={`is-${BUG_TONE[s]}${b.status === s ? ' is-on' : ''}`} onClick={() => setStatus(s)}>{b.status === s && <Check size={14} aria-hidden="true" />}{BUG_WORD[s]}</button>)}
      </div>
      <div className="ma-glass ma-pad am-bugtext ma-rise" style={rise(1)}>
        <small>What happened</small><p>{b.text}</p>
        {b.expected && <><small>What they expected</small><p>{b.expected}</p></>}
      </div>
      <div className="ma-glass ma-pad va-facts is-glass ma-rise" style={rise(2)}>
        <span><small>App</small><b>{appOf(b)}</b></span>
        <span><small>Page</small><b>{pageOf(b)}</b></span>
        <span><small>Browser</small><b>{b.browser || 'Not recorded'}</b></span>
        <span><small>Screen</small><b>{b.screen || 'Not recorded'}</b></span>
      </div>
      <div className="ma-glass ma-list ma-rise" style={rise(3)}>
        <div className="ma-row"><span className="ma-sym is-stone"><ImageIcon size={16} aria-hidden="true" /></span><span className="ma-grow"><b>{b.shot ? 'Screenshot attached' : 'No screenshot'}</b><small>{b.shot ? (b.file || 'Open it on the desktop’s Bug reports page') : 'They didn’t add one'}</small></span></div>
      </div>
    </SubPage>
  )
}

// ── Setup: every connection, view only ───────────────────────────────────────────────────────────────────────────
export function ASetupView() {
  const { data: connect } = useAdmConnect()
  const { data: settings } = useAdmSettings()
  const [checked] = useState(() => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
  const rows = connectionsOf({ connect, settings })
  return (
    <SubPage title="Setup" line={`${rows.filter(r => r.on).length} of ${rows.length} connected · last checked ${checked}`} big>
      <div className="ma-glass ma-list ma-rise">
        {rows.map(r => (
          <div key={r.key} className="ma-row am-conn">
            <span className={`am-cdot${r.on ? ' is-on' : ''}`} aria-hidden="true" />
            <span className="ma-grow"><b>{r.name}</b><small>{r.what}</small><small className={r.on ? 'am-ok' : 'am-warn'}>{r.on ? 'Connected' : 'Not connected'} · {r.note}</small></span>
          </div>
        ))}
      </div>
      <p className="ma-note">Connections are changed on the desktop (Connect and Settings). Nothing here switches anything.</p>
    </SubPage>
  )
}

// ── Payouts, plans, settings ─────────────────────────────────────────────────────────────────────────────────────
export function APayouts() {
  const me = useOwnerMe()
  const { data: p } = useAdmPeriod('month')
  const { data: m } = useAdmMoney()
  const { data: draws } = useAdmDraws()
  const mine = me ? p.split.find(o => o.id === me.id) : null
  const myDraws = me ? draws.find(o => o.id === me.id)?.draws || [] : []
  return (
    <SubPage title="Payouts" line={`Next payday ${m.payday}`} big>
      {mine && (
        <div className="ma-plan ma-rise">
          <div className="ma-plan-stats">
            <div><b className="tp-money">{money(mine.amount)}</b><small>your {mine.pct}% this month</small></div>
            <div><b className="tp-money">{money(mine.paid)}</b><small>paid so far</small></div>
            <div><b className="tp-money">{money(mine.owed)}</b><small>still to pay</small></div>
          </div>
        </div>
      )}
      {mine && <>
        <p className="ma-cap is-out">Your payouts</p>
        <div className="ma-glass ma-list ma-rise" style={rise(1)}>
          {myDraws.map(d => <div key={d.id} className="ma-row"><span className="ma-grow"><b>{d.what || 'Payout'}</b><small>{d.paid || d.when || d.at}</small></span><span className="ma-val tp-money">{money(d.amount)}</span></div>)}
          {!myDraws.length && <p className="ma-empty">No payouts yet.</p>}
        </div>
      </>}
      <p className="ma-cap is-out">VA pay · {m.payday}</p>
      <div className="ma-glass ma-list ma-rise" style={rise(2)}>
        {m.run.map(r => <div key={r.va_id} className="ma-row"><span className="ma-grow"><b>{r.name}</b><small>{Math.round(r.hours * 10) / 10} h · {r.bank === 'ready' ? 'bank ready' : r.bank === 'held' ? 'held' : 'no bank yet'}</small></span><span className="ma-val tp-money">{money(r.amount)}</span></div>)}
        <div className="ma-row am-line is-strong"><span className="ma-grow"><b>Paid Monday</b><small>Only VAs with a bank ready</small></span><span className="ma-val tp-money">{money(m.runTotal)}</span></div>
      </div>
      <p className="ma-cap is-out">The bank</p>
      <div className="ma-glass ma-list ma-rise" style={rise(3)}>
        <div className="ma-row"><span className="ma-grow"><b>Stripe balance</b><small>{m.paused ? 'Pay runs paused' : m.live ? 'Pays out automatically' : 'Pay runs are off until launch'}</small></span><span className="ma-val tp-money">{money(m.stripeBalance)}</span></div>
      </div>
      <p className="ma-note">Bank details and pausing a pay run are done on the desktop.</p>
    </SubPage>
  )
}

export function APlans() {
  return (
    <SubPage title="Plans and prices" line="View only · changed on the desktop" big>
      <div className="ma-glass ma-list ma-rise">
        {Object.entries(PLANS).map(([k, p]) => <div key={k} className="ma-row"><span className="ma-grow"><b>{p.label}</b><small>{p.sub}</small></span><span className="ma-val tp-money">{money(p.price)}/mo</span></div>)}
      </div>
      <div className="ma-glass ma-list ma-rise" style={rise(1)}>
        <div className="ma-row"><span className="ma-grow"><b>Setup fee</b><small>One time, when they sign up</small></span><span className="ma-val tp-money">{money(SETUP_FEE)}</span></div>
        <div className="ma-row"><span className="ma-grow"><b>Lead fee</b><small>On every lead plan, apart from the plan fee</small></span><span className="ma-val">{Math.round(PRICES.leadFee * 100)}% of lead spend</span></div>
      </div>
    </SubPage>
  )
}

export function ASettingsAdm() {
  const account = useAccount()
  const { data: s } = useAdmSettings()
  const view = account?.view
  const name = useAdmName() || s.profile?.name
  return (
    <SubPage title="Settings" big>
      <p className="ma-cap is-out">Account</p>
      <div className="ma-glass ma-list ma-rise">
        <div className="ma-row"><span className="ma-grow"><b>Name</b><small>{name}</small></span></div>
        <div className="ma-row"><span className="ma-grow"><b>Email</b><small>{account?.email || s.profile?.email}</small></span></div>
        <div className="ma-row"><span className="ma-grow"><b>Role</b><small>Admin (full access)</small></span></div>
      </div>
      {view?.canPreview && (
        <>
          <p className="ma-cap is-out">What you see</p>
          <div className="ma-seg am-seg ma-rise" role="radiogroup" aria-label="View">
            {['sample', 'real'].map(k => <button key={k} type="button" role="radio" aria-checked={view.mode === k} className={`is-sky${view.mode === k ? ' is-on' : ''}`} onClick={() => view.setView(k)}>{k === 'sample' ? 'Sample' : 'Real'}</button>)}
          </div>
          <p className="ma-note">Only changes what you see. Everyone else stays on {view.show ? 'sample' : 'real'} info.</p>
        </>
      )}
      <p className="ma-cap is-out">Alerts</p>
      <div className="ma-glass ma-list ma-rise" style={rise(1)}>
        {(s.notifications || []).map(n => <div key={n.key} className="ma-row"><span className="ma-grow"><b>{n.label}</b><small>{[n.push && 'Phone', n.email && 'Email'].filter(Boolean).join(' and ') || 'Only in the bell'}</small></span></div>)}
      </div>
      <p className="ma-note">Alerts, people, live switches and everything else are changed in the desktop’s Settings.</p>
    </SubPage>
  )
}
