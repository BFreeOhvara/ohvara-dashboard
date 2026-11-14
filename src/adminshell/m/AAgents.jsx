import { useState } from 'react'
import { ChevronRight, MessageCircle, AlertTriangle, CreditCard } from 'lucide-react'
import { useAdmAgents, useAdmIdleSignups, useAdmClients, useAdmLeads, useAdmAudit, useAdmDay, useAdmSource, PLANS, chargeFor } from '../data'
import { chipsText, planLineOf, planPriceOf } from '../products955'
import { useAdmReactivation } from '../reactivation952'
import { useApp, SubPage, Ini, CallButton, rise } from '../../template/m/AppKit'
import { money, flagOf, statusLine, dailySpend, agentGroups, isNew, buysOf, buysLeads } from './admModel'
import { useMessageTo } from './useAdm'

// P986 — Agents: "7 agents · $X a day in lead spend", three count tiles that filter the list (All agents / Need you /
// New this week), then the list grouped Need you (orange cards) and Doing fine. An agent opens from the right: who
// they are and what they buy, a flag banner if anything's wrong, their numbers, billing (view only: plan and price
// changes are done on the desktop), recent activity, Message and Call.
export default function AAgents() {
  const app = useApp()
  const { data: agents } = useAdmAgents()
  const { data: day } = useAdmDay()
  const [filter, setFilter] = useState('all')
  const need = agents.filter(a => flagOf(a)).length
  const fresh = agents.filter(a => isNew(a, day.todayIso)).length
  const { data: idle = [] } = useAdmIdleSignups()
  // P999: sign-ups that did nothing sit behind the small link under the tiles.
  const groups = filter === 'idle' ? [{ key: 'idle', label: 'Signed up, not active', items: idle }] : agentGroups(agents, filter, day.todayIso)
  const tiles = [['all', 'All agents', agents.length], ['need', 'Need you', need], ['new', 'New this week', fresh]]
  return (
    <div className="ma-tabpage">
      <div className="ma-top ma-rise"><span className="ma-grow"><h1>Agents</h1><small>{agents.length} agents · <span className="tp-money">{money(dailySpend(agents))}</span> a day in lead spend</small></span></div>
      <div className="am-ctiles ma-rise" style={rise(0)} role="tablist" aria-label="Show">
        {tiles.map(([k, w, n]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} className={`am-ctile ma-press${filter === k ? ' is-on' : ''}${k === 'need' && n ? ' is-apricot' : ''}`} onClick={() => setFilter(filter === k && k !== 'all' ? 'all' : k)}>
            <b>{n}</b><small>{w}</small>
          </button>
        ))}
      </div>
      {idle.length > 0 && (
        <button type="button" className={`am-idle ma-press${filter === 'idle' ? ' is-on' : ''}`} aria-pressed={filter === 'idle'} onClick={() => setFilter(filter === 'idle' ? 'all' : 'idle')}>
          Signed up, not active ({idle.length})
        </button>
      )}
      {groups.map((g, gi) => (
        <div key={g.key} className="ma-rise" style={rise(gi + 1)}>
          <div className="ma-h2"><h2>{g.label}</h2><span>{g.items.length}</span></div>
          {g.key === 'need'
            ? g.items.map(a => {
              const f = flagOf(a)
              return (
                <button key={a.id} type="button" className="ma-row am-needrow is-apricot ma-press" onClick={() => app.openSub('agent', { t: a.id })}>
                  <Ini name={a.name} size={44} />
                  <span className="ma-grow"><b>{a.name}</b><small>{planLineOf(a, PLANS).label}{buysLeads(a) ? <> · <span className="tp-money">{money(a.spend)}</span> a day</> : ''}</small><small className="am-flagline">{f.title}</small></span>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              )
            })
            : (
              <div className="ma-glass ma-list">
                {g.items.map(a => (
                  <button key={a.id} type="button" className="ma-row" onClick={() => app.openSub('agent', { t: a.id })}>
                    <Ini name={a.name} tone="sky" size={44} />
                    <span className="ma-grow"><b>{a.name}</b><small>{planLineOf(a, PLANS).label}{buysLeads(a) ? <> · <span className="tp-money">{money(a.spend)}</span> a day</> : ''}</small><small>{statusLine(a)}</small></span>
                    <ChevronRight size={18} className="ma-chev" aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
        </div>
      ))}
      {!groups.length && <p className="ma-empty is-glass ma-rise">{filter === 'new' ? 'No new agents this week. Sign-ups being set up are on the desktop’s Setup page.' : 'No agents here.'}</p>}
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
      <p className="ma-cap is-out">Recent activity</p>
      <div className="ma-glass ma-list ma-rise" style={rise(3)}>
        {acts.map(x => <div key={x.id} className="ma-row"><span className="ma-grow"><b>{x.title}</b><small>{x.when}</small></span></div>)}
        {!acts.length && <p className="ma-empty">Nothing yet.</p>}
      </div>
    </SubPage>
  )
}
