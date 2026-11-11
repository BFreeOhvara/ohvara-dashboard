import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Search, MapPin, MessageSquare, PhoneIncoming, BookUser, Radio, ShieldOff, ShieldCheck, Send, X, Mail, Smartphone } from 'lucide-react'
import { useAdmAgents, useAdmLeads, useAdmInvites, useAdmActions, useAdmCosts, useAdmSettings, PLANS, chargeFor } from '../data'
import { Avatar, Chip, Drawer, Empty, Seg, Switch, useNote } from '../../template/kit'
import { RecordDrawer, Block } from '../../template/Record'
import { usd } from '../../template/motion'
import { tierOf, PAID_MIN_DAILY, feeWords } from '../../template/spendPlan'
import { hourText } from '../../lib/priceBook'
import { Dropdown, DField, EngineSlot } from '../kit'
import { ap } from '../paths'
import { BILL_WORD, STAGE_WORD, stageTone } from '../words'
import { CampaignBlock } from './Campaign879'
import { productChips, chipsText, endingLines, hasLeads, planLineOf } from '../products955'
import '../p955.css'

// P849 — Agents: every agent, their plan and weekly lead budget, whether they take live transfers, this week's results
// and billing. A row opens the agent in a drawer at its own address (/admin/agents/:id) with every admin control the
// Users page has today (transfers, Servicing, access, role) plus plan, budget and comp. Sample only.
const money = usd()
const cents = usd(true)
// P955: an agent's products as small chips (Leads · Servicing · Reactivation); a product ending at the next bill date
// says so on its chip's title and, in the pop-up, in words ("Servicing ends Dec 9").
function ProductChips({ a }) {
  const list = productChips(a)
  return (
    <span className="adm-prod" role="list" aria-label={`Products: ${chipsText(a)}`} data-testid="adm-products">
      {list.map(c => <span key={c.key} role="listitem" className={c.ends ? 'is-ending' : undefined} title={c.ends ? `${c.label} ends ${c.ends}` : undefined}><Chip tone={c.tone}>{c.label}</Chip></span>)}
    </span>
  )
}
function ProductsBlock({ a }) {
  const ending = endingLines(a)
  const line = planLineOf(a, PLANS)
  return (
    <Block title="Products" sub={a.real ? 'What they bought. They add or remove products in their Billing.' : 'Sample. They add or remove products in their Billing.'}>
      <ProductChips a={a} />
      {ending.map(t => <p key={t} className="adm-prod-end" data-testid="adm-product-ending">{t}</p>)}
      {!line.leads && <p className="tp-sub adm-prod-sub">{line.label}{line.sub ? ` · ${line.sub}` : ''}. No lead spend, no campaign, no Setup ticket.</p>}
    </Block>
  )
}

const SORTS = [{ value: 'sold', label: 'Most sold' }, { value: 'in', label: 'Most leads' }, { value: 'name', label: 'Name' }, { value: 'spend', label: 'Biggest budget' }]

function Funnel({ w }) {
  return (
    <ul className="adm-mf" aria-label={`${w.in} in, ${w.booked} booked, ${w.transferred} live calls, ${w.sold} sold`}>
      {[['In', w.in], ['Booked', w.booked], ['Live', w.transferred], ['Sold', w.sold]].map(([k, n]) => <li key={k}><b className="tp-num">{n}</b><small>{k}</small></li>)}
    </ul>
  )
}

// P858: this agent's ad cost per lead / booked / sale (their one Meta campaign's real spend ÷ their real outcomes).
function AgentCosts({ id }) {
  const { data: costs } = useAdmCosts()
  const c = costs?.byAgent?.[id]
  if (!costs) return <p className="adm-note">Cost per lead, booked and sale <EngineSlot /></p>
  if (!c) return <p className="adm-note">No ad spend mapped to this agent this week.</p>
  const f = v => (v == null ? '–' : usd(true)(v))
  return <dl className="fx-facts">{[['Ad spend', money(c.spend)], ['Per lead', f(c.perLead)], ['Per booked', f(c.perBooked)], ['Per sale', f(c.perSale)]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="tp-money">{v}</dd></div>)}</dl>
}

// P906 — plan and budget, on the final pricing (P909): the plan from the daily spend band, daily spend + 12%, days paid
// ahead, the card on file and its last charge, Pause, the setup fee, the founding lock and the next charge. An admin can
// change the daily spend (up to the max, or raise the max for this one agent), pause lead spend, and comp the account.
// P914: no pilot, every agent pays from day one. Sample until the billing backend is wired.
// P921: a scheduled move down shows with its date (it starts with the next bill); the last move up shows what it
// charged (the difference for the days left in the month, charged at once).
function PlanBudget({ a }) {
  const { data: st } = useAdmSettings()
  const { setAgentSpend, setAgentPaused, setComped, setMaxDaily } = useAdmActions()
  const note = useNote()
  const [draft, setDraft] = useState(String(a.spend))
  const b = a.billing
  const base = st.billing.maxDaily
  const raised = st.billing.maxOverride?.[a.id]
  const max = raised ?? base
  const plan = PLANS[a.plan] || PLANS[tierOf(a.spend).key]
  const ch = chargeFor(a)
  const want = Number(String(draft).replace(/[^0-9]/g, ''))
  const bad = !want || want < PAID_MIN_DAILY || want > max
  const nextBand = tierOf(want || 0)
  const saveSpend = () => {
    if (!setAgentSpend) { note('Changing spend here is wired with the billing backend'); return }
    setAgentSpend(a.id, want)
    note(`${a.name}: ${money(want)} a day${nextBand.key !== a.plan ? `. Outside ${plan.label}: the agent switches plan in Billing (moving up is charged the difference)` : ''}`)
  }
  const flipMax = () => {
    if (!setMaxDaily) { note('Raising the max is wired with the billing backend'); return }
    if (raised) { setMaxDaily(a.id, null); note(`${a.name}: back to the ${money(base)} max`) } else { setMaxDaily(a.id, 750); note(`${a.name} can spend up to ${money(750)} a day`) }
  }
  const last = b.last
  return (
    <Block title="Plan and budget" sub={a.real ? undefined : 'Sample'} aside={b.founding ? <Chip tone="teal">Founding to {b.founding.until}</Chip> : null}>
      <div className="adm-plan-top">
        <b className="fx-hero-big">{a.comped ? 'Comped' : plan.label}</b>
        <span className="tp-sub">{a.comped ? 'No plan charge' : `${money(plan.price)} a month · ${plan.sub}`}</span>
        {a.paused && <Chip tone="warn">Leads paused</Chip>}
      </div>
      {ch ? (
        <div className="adm-plan-charge" aria-label="Tonight's charge">
          <div><small>Daily spend</small><b className="tp-money">{cents(ch.spend)}</b></div>
          <div><small>Credit</small><b className="tp-money">{ch.credit ? `−${cents(ch.credit)}` : cents(0)}</b></div>
          <div><small>+{feeWords}</small><b className="tp-money">{cents(ch.fee)}</b></div>
          <div className="is-total"><small>Tonight, {hourText(st.billing.chargeHour)}</small><b className="tp-money">{cents(ch.total)}</b></div>
        </div>
      ) : <p className="tp-sub">{a.paused ? `Nothing charged while paused${a.paused.until ? ` (to ${a.paused.until})` : ''}.` : 'No lead charge: the account is comped.'}</p>}
      <dl className="fx-facts">{[
        ['Paid ahead', b.paidAhead ? `${b.paidAhead} day${b.paidAhead === 1 ? '' : 's'} of leads` : 'None'],
        ['Card on file', b.card || 'None yet'],
        ['Last charge', last ? <span className={last.result === 'declined' ? 'adm-declined' : undefined}>{last.result === 'declined' ? `Declined${last.why ? `: ${last.why.toLowerCase()}` : ''}` : 'Approved'} · {last.when}</span> : '–'],
        ['Next charge', b.next],
        ['Setup fee', b.setup ? `${money(b.setup.amount)} paid ${b.setup.paid}` : a.comped ? 'Comped' : 'Not paid'],
        ['Founding lock', b.founding ? `Prices locked to ${b.founding.until}` : 'Not founding'],
        ['Plan change', a.planNext ? <span data-pending="down">Moves down to {PLANS[a.planNext.key].label} on {a.planNext.on}</span>
          : a.lastUpgrade ? `Moved up to ${PLANS[a.lastUpgrade.to].label} ${a.lastUpgrade.on}, ${cents(a.lastUpgrade.amount)} for ${a.lastUpgrade.days} days` : 'None scheduled'],
      ].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {b.failed && <p className="adm-warn">{b.failed.what} {money(b.failed.amount)} failed {b.failed.when}: {b.failed.why}. Tomorrow's ads don't run until it goes through; it retries at {hourText(st.billing.retryHour)}.</p>}
      <DField label="Daily lead spend" hint={`${money(PAID_MIN_DAILY)} to ${money(max)} a day${raised ? ' (raised for this agent)' : ''}. Moving up a plan is charged the difference for the days left this month; moving down starts with the next bill.`}>
        <div className="adm-spend">
          <input className="tp-money" inputMode="numeric" aria-label="Daily lead spend in dollars" value={draft} onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, ''))} />
          <button type="button" className="tp-primary fx-accent" disabled={bad || want === a.spend} onClick={saveSpend}>Save</button>
          <button type="button" className="fx-pillbtn" onClick={flipMax}>{raised ? `Back to the ${money(base)} max` : `Raise the max for ${a.name.split(' ')[0]}`}</button>
        </div>
      </DField>
      {want > max && <p className="adm-warn-t" role="alert">Over the {money(max)} max. Raise the max for this agent first.</p>}
      {want > 0 && want < PAID_MIN_DAILY && <p className="adm-warn-t" role="alert">The least is {money(PAID_MIN_DAILY)} a day.</p>}
      <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Pause lead spend</b><p className="tp-sub">{a.paused ? `Paused since ${a.paused.since}${a.paused.until ? `, resumes ${a.paused.until}` : ''}. Nothing is charged; membership and servicing keep going.` : 'Stops tonight’s charge and tomorrow’s ads. Membership and servicing keep going.'}</p></div>
        <Switch on={!!a.paused} label="Pause lead spend" onChange={v => { if (!setAgentPaused) { note('Pausing here is wired with the billing backend'); return } setAgentPaused(a.id, v); note(v ? `${a.name}: lead spend paused` : `${a.name}: lead spend back on tonight`) }} /></div>
      <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Comped</b><p className="tp-sub">Comped agents use the portal without a plan charge.</p></div><Switch on={a.comped} label="Comped" onChange={v => { setComped(a.id, v); note(v ? 'Account comped' : 'Comp ended') }} /></div>
    </Block>
  )
}

function AgentDrawer({ id, onClose }) {
  const { data: agents } = useAdmAgents()
  const { data: leads } = useAdmLeads()
  const { setAgentActive, setServicing, setAccess, setRole } = useAdmActions()
  const note = useNote()
  const navigate = useNavigate()
  const [ask, setAsk] = useState(null)
  const a = agents.find(x => x.id === id)
  if (!a) return <RecordDrawer label="Not found" kicker="Agents" onClose={onClose} hero={<h2>No agent here</h2>}><p className="fx-calm">This agent is not on the list any more.</p></RecordDrawer>
  const [billWord, billTone] = BILL_WORD[a.billing.status]
  const mine = leads.filter(l => l.agent_id === a.id).slice(-6).reverse()
  const tone = a.billing.status === 'past_due' ? 'warn' : a.active ? 'green' : 'blue'
  const withLeads = hasLeads(a)
  return (
    <RecordDrawer label={a.name} kicker={`Agent · joined ${a.joined}`} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><Radio size={13} aria-hidden="true" />{!withLeads ? 'No Leads' : a.active ? (a.onDuty ? 'On duty for live transfers' : 'Takes transfers, off duty now') : 'Appointments only'}</span><Chip tone={billTone}>{billWord}</Chip>{a.paused && <Chip tone="warn">Leads paused</Chip>}</div>
        <h2>{a.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{a.city}, {a.state} · licensed in {a.states.join(', ')}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big tp-num">{a.phone}</b><Avatar name={a.name} tone={tone} /></div>
      </>}
      actions={<>
        <Link to={`${ap('messages')}?to=${a.id}`} className="tp-primary fx-accent"><MessageSquare size={16} />Message</Link>
        <Link to={`${ap('leads')}?agent=${a.id}`} className="tp-btn ov-ghost"><PhoneIncoming size={15} />Their leads</Link>
        <Link to={`${ap('clients')}?agent=${a.id}`} className="tp-btn ov-ghost"><BookUser size={15} />Their clients</Link>
      </>}>
      {withLeads && <Block title="Live transfers" sub="On means live calls can ring this agent while they are on duty.">
        <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>{a.active ? 'Active for transfers' : 'Booking only'}</b><p className="tp-sub">{a.onDuty ? 'On duty right now' : 'Not on duty right now'}</p></div>
          <Switch on={a.active} label="Active for transfers" onChange={v => { setAgentActive(a.id, v); note(v ? `${a.name} takes live transfers` : `${a.name} is booking only`) }} /></div>
      </Block>}
      <ProductsBlock a={a} />
      {withLeads && <PlanBudget key={`pb-${a.id}-${a.spend}`} a={a} />}
      {/* P934: no Lead split block: Meta form ads only, the split is a constant in code (splitStore). */}
      {withLeads && <CampaignBlock agent={a} />}
      <Block title="This week"><Funnel w={a.week} /><AgentCosts id={a.id} /></Block>
      <Block title="Access">
        <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Servicing</b><p className="tp-sub">{a.servicing ? 'Leads and Servicing' : 'Leads only'}</p></div><Switch on={a.servicing} label="Servicing" onChange={v => { setServicing(a.id, v); note(v ? 'Servicing on' : 'Servicing off: leads only') }} /></div>
        <DField label="Role"><Dropdown label="Role" value="agent" options={[{ value: 'agent', label: 'Agent' }, { value: 'fulfillment', label: 'Fulfillment' }]} onChange={v => v !== 'agent' && setAsk('role')} /></DField>
        <div className="fx-form-row">
          {a.access
            ? <button type="button" className="tp-btn ov-ghost tp-danger" onClick={() => setAsk('off')}><ShieldOff size={15} />Turn access off</button>
            : <button type="button" className="tp-btn ov-ghost" onClick={() => { setAccess(a.id, true); note(`${a.name} can sign in again`) }}><ShieldCheck size={15} />Turn access back on</button>}
        </div>
      </Block>
      <Block title="Latest leads" aside={<Link to={`${ap('leads')}?agent=${a.id}`} className="tp-link">All</Link>}>
        <ul className="tp-list">{mine.map(l => (
          <li key={l.id}><Link to={ap('leads', l.id)} className="fx-mrow"><Avatar name={l.name} tone={stageTone(l.stage)} /><span className="tp-grow"><b>{l.name}</b><small>{l.came} · {l.product}</small></span><Chip tone={stageTone(l.stage)}>{STAGE_WORD[l.stage]}</Chip></Link></li>
        ))}{mine.length === 0 && <li className="tp-sub">No leads this week.</li>}</ul>
      </Block>

      <Drawer open={ask === 'off'} center onClose={() => setAsk(null)} title="Turn access off?" sub={a.name}
        footer={<><button type="button" className="tp-primary fx-accent" onClick={() => { setAccess(a.id, false); note(`${a.name} can't sign in now`); setAsk(null) }}>Turn it off</button><button type="button" className="tp-btn ov-ghost" onClick={() => setAsk(null)}>Keep access</button></>}>
        <p className="tp-mid">They are signed out and can't sign in. Their {a.clients} clients and their leads stay as they are. You can turn it back on any time.</p>
      </Drawer>
      <Drawer open={ask === 'role'} center onClose={() => setAsk(null)} title="Make them Fulfillment?" sub={a.name}
        footer={<><button type="button" className="tp-primary fx-accent" onClick={() => { setRole(a.id, 'fulfillment'); note(`${a.name} is Fulfillment now`); setAsk(null); navigate(ap('team', a.id)) }}>Change the role</button><button type="button" className="tp-btn ov-ghost" onClick={() => setAsk(null)}>Keep as agent</button></>}>
        <p className="tp-mid">{a.clients ? `${a.name} has ${a.clients} open clients. They stay on the books but need a new agent.` : 'They have no open clients.'} Their leads stop.</p>
      </Drawer>
    </RecordDrawer>
  )
}

export default function Agents() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: agents } = useAdmAgents()
  const { data: invites } = useAdmInvites()
  const { setAgentActive, resendInvite, cancelInvite } = useAdmActions()
  const note = useNote()
  const [q, setQ] = useState('')
  const [show, setShow] = useState('all')
  const [sort, setSort] = useState('sold')
  const n = q.trim().toLowerCase()
  const keep = a => (show === 'all' || (show === 'duty' && a.active) || (show === 'booking' && hasLeads(a) && !a.active) || (show === 'due' && a.billing.status === 'past_due') || (show === 'paused' && a.paused))
  const list = agents.filter(a => keep(a) && (!n || `${a.name} ${a.email} ${a.phone} ${a.city}`.toLowerCase().includes(n)))
    .sort((x, y) => (sort === 'name' ? x.name.localeCompare(y.name) : sort === 'spend' ? y.spend - x.spend : (y.week[sort] - x.week[sort]) || x.name.localeCompare(y.name)))
  const out = invites.filter(i => i.role === 'agent')
  const openAgent = id => navigate(ap('agents', id))
  return (
    <div className="tp-page fx-page adm-agents-page">
      <div className="fx-tools">
        <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label="Find an agent" placeholder="Find by name, email, phone or city" value={q} onChange={e => setQ(e.target.value)} /></label>
        <Seg label="Show" value={show} onChange={setShow} options={[
          { key: 'all', label: 'All', count: agents.length }, { key: 'duty', label: 'Take transfers', count: agents.filter(a => a.active).length },
          { key: 'booking', label: 'Booking only', count: agents.filter(a => hasLeads(a) && !a.active).length }, { key: 'due', label: 'Past due', count: agents.filter(a => a.billing.status === 'past_due').length },
          { key: 'paused', label: 'Leads paused', count: agents.filter(a => a.paused).length },
        ]} />
        <span className="tp-grow" />
        <Dropdown className="adm-dd-sm" label="Sort" value={sort} options={SORTS} onChange={setSort} />
      </div>

      <section className="fx-tile adm-table" style={{ '--i': 0 }} aria-label="Agents" data-fold>
        <div className="adm-tr adm-th" aria-hidden="true"><span>Agent</span><span>Plan and budget</span><span>Transfers</span><span>This week</span><span>Billing</span></div>
        {list.map((a, i) => {
          const [word, tone] = BILL_WORD[a.billing.status]
          const line = planLineOf(a, PLANS)
          return (
            // P945: the whole row opens the agent (hover highlights it); the switch and links inside still do their own job.
            <div key={a.id} className="adm-tr is-click" style={{ '--i': i }} onClick={e => { if (!e.target.closest('a, button, input, label, [role="switch"]')) openAgent(a.id) }}>
              <Link to={ap('agents', a.id)} className="adm-who"><Avatar name={a.name} /><span className="tp-grow"><b>{a.name}</b><small>{a.city}, {a.state} · {a.paused ? `leads paused${a.paused.until ? ` until ${a.paused.until}` : ''}` : a.access ? `on ${a.lastOn}` : 'access off'}</small><ProductChips a={a} /></span></Link>
              {line.leads
                ? <span className="adm-cell"><b>{a.comped ? 'Comped' : line.label}</b><small>{money(a.spend)} a day + {feeWords}{a.paused ? ' · paused' : ''}{a.planNext ? ` · ${PLANS[a.planNext.key].label} from ${a.planNext.on.replace(/^\w+, /, '')}` : ''}</small></span>
                : <span className="adm-cell"><b>{a.comped ? 'Comped' : line.label}</b><small>{line.sub}</small></span>}
              {line.leads
                ? <span className="adm-cell adm-sw"><Switch on={a.active} label={`${a.name} takes live transfers`} onChange={v => { setAgentActive(a.id, v); note(v ? `${a.name} takes live transfers` : `${a.name} is booking only`) }} /><small>{a.active ? (a.onDuty ? 'On duty' : 'Off duty') : 'Booking only'}</small></span>
                : <span className="adm-cell"><small>No Leads</small></span>}
              <span className="adm-cell"><Funnel w={a.week} /></span>
              <span className="adm-cell"><Chip tone={tone}>{word}</Chip><small>{a.billing.next}</small></span>
            </div>
          )
        })}
        {list.length === 0 && <Empty title="No agent" sub="No agent matches that." />}
      </section>

      {out.length > 0 && (
        <section className="fx-tile adm-invites" style={{ '--i': 1 }} aria-label="Invites out">
          <header className="fx-tile-h"><span className="tp-grow"><h2>Invites out</h2><p>Not signed up yet</p></span></header>
          <ul className="tp-list">{out.map(v => (
            <li key={v.id} className="fx-mrow">{v.via === 'text' ? <Smartphone size={17} aria-hidden="true" /> : <Mail size={17} aria-hidden="true" />}
              <span className="tp-grow"><b>{v.name}</b><small>{v.to} · sent {v.sent}</small></span>
              <button type="button" className="fx-pillbtn" onClick={() => { resendInvite(v.id); note(`Invite sent again to ${v.name} (sample)`) }}><Send size={13} />Resend</button>
              <button type="button" className="fx-x" aria-label={`Cancel ${v.name}'s invite`} onClick={() => { cancelInvite(v.id); note('Invite cancelled') }}><X size={15} /></button>
            </li>
          ))}</ul>
        </section>
      )}

      {id && <AgentDrawer id={id} onClose={() => navigate(ap('agents'))} />}
    </div>
  )
}
