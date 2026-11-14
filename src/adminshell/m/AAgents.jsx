import { useRef, useState } from 'react'
import { ChevronRight, MessageCircle, AlertTriangle, CreditCard, Search, X, Mail, Smartphone, Send } from 'lucide-react'
import { useAdmAgents, useAdmIdleSignups, useAdmClients, useAdmLeads, useAdmAudit, useAdmDay, useAdmSource, useAdmInvites, useAdmActions, PLANS, chargeFor } from '../data'
import { chipsText, planLineOf, planPriceOf, hasLeads } from '../products955'
import { useAdmReactivation } from '../reactivation952'
import { useNote } from '../../template/kit'
import { useApp, SubPage, Ini, CallButton, rise } from '../../template/m/AppKit'
import { useNoAutoKeyboard } from '../../template/m/useKeyboard'
import { money, flagOf, statusLine, dailySpend, agentGroups, buysOf, buysLeads } from './admModel'
import { useMessageTo } from './useAdm'

// P986 — Agents: "7 agents · $X a day in lead spend", the list grouped Need you (orange cards) and Doing fine. An agent
// opens from the right: who they are and what they buy, a flag banner if anything's wrong, their numbers, billing (view
// only: plan and price changes are done on the desktop), access (read only), recent activity, Message and Call.
// P1002: Find an agent (name, email, phone or city), the desktop's filter pills (All · Take transfers · Booking only ·
// Past due · Leads paused · Signed up, not active, each with its count) and Invites out (Resend, Cancel).
export default function AAgents() {
  const app = useApp()
  const note = useNote()
  const { data: agents } = useAdmAgents()
  const { data: day } = useAdmDay()
  const { data: invites } = useAdmInvites()
  const { data: idle = [] } = useAdmIdleSignups()
  const { resendInvite, cancelInvite } = useAdmActions()
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const input = useRef(null)
  useNoAutoKeyboard(input)
  const n = q.trim().toLowerCase()
  const keep = a => (filter === 'all' || (filter === 'duty' && a.active) || (filter === 'booking' && hasLeads(a) && !a.active) || (filter === 'due' && a.billing.status === 'past_due') || (filter === 'paused' && a.paused))
  const found = (filter === 'idle' ? idle : agents).filter(a => (filter === 'idle' || keep(a)) && (!n || `${a.name} ${a.email} ${a.phone} ${a.city}`.toLowerCase().includes(n)))
  // P999: sign-ups that did nothing sit behind their own pill.
  const groups = filter === 'idle' ? [{ key: 'idle', label: 'Signed up, not active', items: found }] : agentGroups(found, 'all', day.todayIso)
  const pills = [
    ['all', 'All', agents.length], ['duty', 'Take transfers', agents.filter(a => a.active).length], ['booking', 'Booking only', agents.filter(a => hasLeads(a) && !a.active).length],
    ['due', 'Past due', agents.filter(a => a.billing.status === 'past_due').length], ['paused', 'Leads paused', agents.filter(a => a.paused).length],
    ...(idle.length ? [['idle', 'Signed up, not active', idle.length]] : []),
  ]
  const out = invites.filter(i => i.role === 'agent')
  return (
    <div className="ma-tabpage">
      <div className="ma-top ma-rise"><span className="ma-grow"><h1>Agents</h1><small>{agents.length} agents · <span className="tp-money">{money(dailySpend(agents))}</span> a day in lead spend</small></span></div>
      <label className="va-find ma-rise" style={rise(0)}><Search size={18} aria-hidden="true" /><input ref={input} type="search" inputMode="search" enterKeyHint="search" placeholder="Find by name, email, phone or city" aria-label="Find an agent" value={q} onChange={e => setQ(e.target.value)} />{q && <button type="button" className="ma-ib" aria-label="Clear" onClick={() => setQ('')}><X size={18} aria-hidden="true" /></button>}</label>
      <div className="ma-chips am-tabs ma-rise" style={rise(0)} role="tablist" aria-label="Show">
        {pills.map(([k, w, c]) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={`ma-fchip am-fchip${filter === k ? ' is-on' : ''}`} onClick={() => setFilter(k)}>{w} <span className="tp-num">{c}</span></button>)}
      </div>
      {groups.map((g, gi) => (
        <div key={g.key} className="ma-rise" style={rise(gi + 1)}>
          <div className="ma-h2"><h2>{g.label}</h2><span>{g.items.length}</span></div>
          {g.key === 'need'
            ? g.items.map(a => {
              const f = flagOf(a)
              return (
                <button key={a.id} type="button" className="ma-row am-needrow is-apricot ma-press" onClick={() => app.openSub('agent', { t: a.id })}>
                  <Ini person name={a.name} size={44} />
                  <span className="ma-grow"><b>{a.name}</b><small>{planLineOf(a, PLANS).label}{buysLeads(a) ? <> · <span className="tp-money">{money(a.spend)}</span> a day</> : ''}</small><small className="am-flagline">{f.title}</small></span>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              )
            })
            : (
              <div className="ma-glass ma-list">
                {g.items.map(a => (
                  <button key={a.id} type="button" className="ma-row" onClick={() => app.openSub('agent', { t: a.id })}>
                    <Ini person name={a.name} size={44} />
                    <span className="ma-grow"><b>{a.name}</b><small>{planLineOf(a, PLANS).label}{buysLeads(a) ? <> · <span className="tp-money">{money(a.spend)}</span> a day</> : ''}</small><small>{statusLine(a)}</small></span>
                    <ChevronRight size={18} className="ma-chev" aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
        </div>
      ))}
      {!groups.length && <p className="ma-empty is-glass ma-rise">{n ? 'No agent matches that.' : filter === 'all' ? 'No agents here.' : 'No agent in this view.'}</p>}
      {out.length > 0 && (
        <section className="ma-rise" aria-label="Invites out">
          <div className="ma-h2"><h2>Invites out</h2><span>Not signed up yet</span></div>
          <div className="ma-glass ma-list">
            {out.map(v => (
              <div key={v.id} className="ma-row am-reqrow">
                <span className="ma-sym is-sky">{v.via === 'text' ? <Smartphone size={16} aria-hidden="true" /> : <Mail size={16} aria-hidden="true" />}</span>
                <span className="ma-grow"><b>{v.name}</b><small>{v.to} · sent {v.sent}</small></span>
                <button type="button" className="ma-nb ma-press am-nb" onClick={() => { resendInvite(v.id); note(`Invite sent again to ${v.name} (sample)`) }}><Send size={15} aria-hidden="true" />Resend</button>
                <button type="button" className="ma-ib am-x" aria-label={`Cancel ${v.name}'s invite`} onClick={() => { cancelInvite(v.id); note('Invite cancelled') }}><X size={18} aria-hidden="true" /></button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export function AAgent({ id }) {
  const { data: listed } = useAdmAgents()
  const { data: idle = [] } = useAdmIdleSignups()
  const agents = [...listed, ...idle] // P999: a "Signed up, not active" row opens here too
  const { data: clients } = useAdmClients()
  const { data: leads } = useAdmLeads()
  const { data: audit } = useAdmAudit()
  const src = useAdmSource()
  const react = useAdmReactivation(src)
  const msg = useMessageTo()
  const a = agents.find(x => x.id === id)
  if (!a) return <SubPage title="Agent"><p className="ma-empty">This agent isn’t here any more.</p></SubPage>
  const f = flagOf(a)
  const mine = clients.filter(c => c.agent_id === a.id)
  const kept = mine.filter(c => c.stage !== 'closed').length
  const keptPct = mine.length ? `${Math.round((kept / mine.length) * 100)}%` : '–'
  const buys = buysOf(a)
  const leadsBuyer = buys.includes('Leads')
  const reactOnly = !leadsBuyer && !buys.includes('Servicing') && buys.includes('Reactivation')
  const uploaded = (react.lists || []).filter(l => l.agent === a.name).reduce((t, l) => t + (l.uploaded || 0), 0)
  const tiles = leadsBuyer
    ? [['Booked this week', (a.week.booked || 0) + (a.week.transferred || 0)], ['Sold', a.week.sold || 0], ['Policies kept', keptPct], ['Lead spend a day', money(a.spend), true]]
    : reactOnly
      ? [['Leads uploaded', uploaded.toLocaleString('en-US')], ['Lists', (react.lists || []).filter(l => l.agent === a.name).length]]
      : [['Clients protected', mine.filter(c => c.stage === 'protected').length], ['Clients', mine.length], ['Policies kept', keptPct], ['Being worked', mine.filter(c => c.stage === 'working' || c.stage === 'needs_attention').length]]
  const plan = planLineOf(a, PLANS)
  const charge = chargeFor(a)
  const acts = [
    ...audit.filter(r => String(r.target || '').includes(a.name)).map(r => ({ id: r.id, title: r.what, when: r.at })),
    ...leads.filter(l => l.agent_id === a.id).slice(-3).reverse().map(l => ({ id: l.id, title: `New ${l.kind === 'live' ? 'live transfer' : 'lead'}: ${l.name}`, when: l.came })),
  ].slice(0, 5)
  const foot = (
    <div className="ma-two am-foot2">
      <button type="button" className="ma-btn is-soft is-tall ma-press" onClick={() => msg(a, 'Agent')}><MessageCircle size={18} aria-hidden="true" />Message</button>
      <CallButton phone={a.phone} className="ma-btn is-solid is-tall" label="Call" />
    </div>
  )
  return (
    <SubPage title={a.name} line={`${plan.label} · since ${a.joined}`} foot={foot} big>
      <p className="am-buys ma-rise">{a.city}{a.state ? `, ${a.state}` : ''} · Buys {chipsText(a) || buys.join(' · ')}</p>
      {f && (
        <div className={`ma-need is-${f.tone} am-flag ma-rise`} role="status">
          <div className="ma-need-top"><span className="ma-need-ic" aria-hidden="true">{f.kind === 'failed' || f.kind === 'past_due' ? <CreditCard size={19} /> : <AlertTriangle size={19} />}</span><span className="ma-grow"><b>{f.title}</b><small>{f.text}</small></span></div>
        </div>
      )}
      <div className="am-stats ma-rise" style={rise(1)}>
        {tiles.map(([k, v, m]) => <div key={k}><b className={m ? 'tp-money' : ''}>{v}</b><small>{k}</small></div>)}
      </div>
      <p className="ma-cap is-out">Billing</p>
      <div className="ma-glass ma-list ma-rise" style={rise(2)}>
        <div className="ma-row"><span className="ma-grow"><b>Plan</b><small>{plan.label}</small></span><span className="ma-val tp-money">{money(planPriceOf(a, PLANS))}/mo</span></div>
        <div className="ma-row"><span className="ma-grow"><b>Next bill</b><small>{a.billing.next || 'Not set'}</small></span>{charge && <span className="ma-val tp-money">{money(charge.total)}</span>}</div>
        <div className="ma-row"><span className="ma-grow"><b>Card</b><small>{a.billing.card || a.billing.method || 'None on file'}</small></span></div>
        {leadsBuyer && <div className="ma-row"><span className="ma-grow"><b>Lead spend</b><small>{a.paused ? 'Paused' : 'Charged each night, one day ahead'}</small></span><span className="ma-val tp-money">{money(a.spend)}/day</span></div>}
      </div>
      <p className="ma-note">Plan and price changes are done on the desktop.</p>
      <p className="ma-cap is-out">Access</p>
      <div className="ma-glass ma-list ma-rise" style={rise(2)}>
        {leadsBuyer && <div className="ma-row"><span className="ma-grow"><b>{a.active ? 'Active for transfers' : 'Booking only'}</b><small>Live calls can ring them while they are on duty · {a.onDuty ? 'on duty right now' : 'not on duty right now'}</small></span></div>}
        <div className="ma-row"><span className="ma-grow"><b>Servicing</b><small>{a.servicing ? 'Leads and Servicing' : 'Leads only'}</small></span></div>
        <div className="ma-row"><span className="ma-grow"><b>Role</b></span><span className="ma-val">Agent</span></div>
        <div className="ma-row"><span className="ma-grow"><b>Sign-in</b><small>{a.access === false ? 'Turned off: they can’t sign in' : 'They can sign in'}</small></span></div>
      </div>
      <p className="ma-note">Live transfers, Servicing, role and sign-in access are changed on the desktop.</p>
      <p className="ma-cap is-out">Recent activity</p>
      <div className="ma-glass ma-list ma-rise" style={rise(3)}>
        {acts.map(x => <div key={x.id} className="ma-row"><span className="ma-grow"><b>{x.title}</b><small>{x.when}</small></span></div>)}
        {!acts.length && <p className="ma-empty">Nothing yet.</p>}
      </div>
    </SubPage>
  )
}
