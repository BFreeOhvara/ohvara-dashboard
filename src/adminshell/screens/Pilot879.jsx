import { useState } from 'react'
import { Check, FlaskConical, Megaphone, TriangleAlert, Clock3, ArrowRight } from 'lucide-react'
import { Chip, Drawer, Seg, Switch, SampleTag, useNote } from '../../template/kit'
import { Block } from '../../template/Record'
import { usd } from '../../template/motion'
import { Dropdown, DField, EngineSlot, Tile } from '../kit'
import {
  pilotOf, pilotLog, PAID_PLANS, campaignOf, CAMPAIGN_STATE, reviewHours, PILOT_ROWS, pilotTotals, ownerOk, OWNER_LIMIT, VA_RATE, vaCostLine,
} from '../p879'
import '../p879.css'

// P879 — pilot and campaign pieces for the agent drawer, and the Pilot results tab on Revenue. Sample only: the
// switch, the VA cost line and the plan change stay in this browser until 858/848 wire them.
const money = usd()
const cents = usd(true)
const pilots = {} // this visit's changes, by agent
const logs = {}

// N-G-01 (switch, start date, note, logged before/after), Q64 (optional VA cost line, per agent), N-G-08 (pilot to
// paid: plan and date, the agent accepts and authorises before any membership charge, 7/3/1-day reminders).
export function PilotBlock({ agent }) {
  const note = useNote()
  const [p, setP] = useState(() => pilots[agent.id] || pilotOf(agent.id))
  const [log, setLog] = useState(() => logs[agent.id] || [])
  const [paid, setPaid] = useState(false)
  const [plan, setPlan] = useState(p.toPaid?.plan || 'Growth')
  const save = (field, before, after, next) => {
    pilots[agent.id] = next; setP(next)
    const l = [pilotLog('Brayden', field, before, after), ...log]; logs[agent.id] = l; setLog(l)
  }
  const vaMin = PILOT_ROWS.filter(r => r.agent === agent.name && !r.sample).reduce((t, r) => t + r.vaMin, 0)
  return (
    <Block title="Pilot" sub="Pilot agents pay only their lead spend. No membership, setup or other fee." aside={<SampleTag>Sample</SampleTag>}>
      <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>{p.on ? `In the pilot since ${p.start}` : 'Not in the pilot'}</b><p className="tp-sub">Admin only. Every change is logged with before and after.</p></div>
        <Switch on={p.on} label="Pilot" onChange={v => { save('Pilot', p.on ? 'On' : 'Off', v ? 'On' : 'Off', { ...p, on: v, start: v ? p.start || 'Today' : p.start }); note(v ? `${agent.name} is in the pilot` : `${agent.name} left the pilot`) }} /></div>
      {p.on && <>
        <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>VA cost line</b><p className="tp-sub">VA hours on {agent.name.split(' ')[0]}'s leads and clients × {money(VA_RATE)} an hour, at cost. This week: {(vaMin / 60).toFixed(1)} h = {cents(vaCostLine(vaMin))}.</p></div>
          <Switch on={p.vaCost} label="VA cost line" onChange={v => { save('VA cost line', p.vaCost ? 'On' : 'Off', v ? 'On' : 'Off', { ...p, vaCost: v }); note(v ? 'VA cost line shows on their bill' : 'VA cost line off') }} /></div>
        <DField label="Pilot note" hint="Only admins see it.">
          <input className="p879-in" value={p.note} placeholder="Why this agent, what we agreed" onChange={e => setP({ ...p, note: e.target.value })} onBlur={() => { if ((pilots[agent.id]?.note ?? pilotOf(agent.id).note) !== p.note) save('Note', pilots[agent.id]?.note ?? pilotOf(agent.id).note, p.note, p) }} />
        </DField>
        {p.toPaid ? (
          <div className="p879-band is-blue"><Clock3 size={16} aria-hidden="true" /><span className="tp-grow"><b>Moves to {p.toPaid.plan} on {p.toPaid.date}</b>
            <small>{p.toPaid.accepted ? 'Accepted and card authorised.' : `Not accepted yet. Reminders at ${p.toPaid.reminders.join(', ')} before. No membership is charged until they accept.`}</small></span>
            <Chip tone={p.toPaid.accepted ? 'green' : 'warn'}>{p.toPaid.accepted ? 'Accepted' : 'Waiting on agent'}</Chip></div>
        ) : <button type="button" className="tp-btn ov-ghost" onClick={() => setPaid(true)}><ArrowRight size={15} />Move to a paid plan</button>}
      </>}
      {log.length > 0 && <ul className="tp-list p879-log">{log.map((l, i) => <li key={i} className="tp-sub">{l.at} · {l.who} · {l.field}: {l.before} → {l.after}</li>)}</ul>}
      <Drawer open={paid} center onClose={() => setPaid(false)} title="Move to a paid plan" sub={agent.name}
        footer={<><button type="button" className="tp-primary fx-accent" onClick={() => {
          const next = { ...p, toPaid: { plan, date: 'Mon, Nov 30', accepted: false, reminders: ['7 days', '3 days', '1 day'] } }
          save('Paid plan', 'Pilot', `${plan} from Mon, Nov 30`, next); setPaid(false); note(`${agent.name.split(' ')[0]} gets the notice to accept`)
        }}><Check size={16} />Send the notice</button><button type="button" className="tp-btn ov-ghost" onClick={() => setPaid(false)}>Cancel</button></>}>
        <DField label="Plan" hint="Tiered by daily lead spend."><Dropdown label="Plan" value={plan} options={PAID_PLANS} onChange={setPlan} /></DField>
        <p className="tp-mid">Starts Mon, Nov 30. {agent.name.split(' ')[0]} must accept and authorise the card in the app first; reminders go 7, 3 and 1 day before. If they don't accept, they stay on pilot terms with leads paused at the date.</p>
      </Drawer>
    </Block>
  )
}

// N-A-02, N-A-04: the campaign's status and its time from the engine, with the reason; an alert when an ad is
// rejected or in review over 24 h (Jordan fixes and resubmits). Admin only; agents never see ads.
export function CampaignBlock({ agent }) {
  const c = campaignOf(agent.id)
  const [w, tone] = CAMPAIGN_STATE[c.status]
  const slow = c.status === 'in_review' && reviewHours(c) > 24
  return (
    <Block title="Campaign" sub="One campaign per agent in the Deedstone ad account" aside={<EngineSlot />}>
      <div className="fx-form-row"><Megaphone size={16} aria-hidden="true" /><span className="tp-grow"><b>{w}</b><small className="tp-sub">{c.at ? `Since ${c.at}` : 'No campaign yet'}{c.reason ? ` · ${c.reason}` : ''}</small></span><Chip tone={tone}>{w}</Chip></div>
      {(c.status === 'rejected' || slow) && <p className="adm-warn-t"><TriangleAlert size={13} aria-hidden="true" />{c.status === 'rejected' ? 'Rejected. Jordan fixes it and resubmits.' : `In review ${Math.floor(reviewHours(c))} h. Admins are alerted after 24 h.`}</p>}
    </Block>
  )
}

// N-G-30, N-J-44 and the owner rule: the pilot side by side per lead type, then per agent / state / week. Spend,
// leads, reached, booked, transfers delivered (and offered), shows, sales, cost per each, VA minutes and cost,
// revenue, owner take and VA % of revenue. Sample leads are left out.
export function PilotResults() {
  const [by, setBy] = useState('agent')
  const [membership, setMembership] = useState(0)
  const all = pilotTotals(PILOT_ROWS, { membership })
  const types = [['appointment', 'Appointments'], ['live', 'Live calls']].map(([k, label]) => [label, pilotTotals(PILOT_ROWS, { type: k })])
  const keys = [...new Set(PILOT_ROWS.filter(r => !r.sample).map(r => r[by]))]
  const groups = keys.map(k => [k, pilotTotals(PILOT_ROWS.filter(r => r[by] === k))])
  const c = v => (v == null ? '–' : cents(v))
  const ok = ownerOk(all)
  return (
    <div className="p879-stack">
      <div className="adm-two">
        <Tile i={0} title="Pilot by lead type" sub="Nov 2 week · sample leads left out" aside={<SampleTag>Sample</SampleTag>}>
          <div className="p879-scroll" role="region" aria-label="Pilot by lead type" tabIndex={0}>
            <table className="p879-tbl">
              <thead><tr><th scope="col" /> {types.map(([l]) => <th key={l} scope="col">{l}</th>)}</tr></thead>
              <tbody>
                {[['Spend', t => money(t.spend)], ['Leads', t => t.leads], ['Reached', t => t.reached], ['Booked', t => t.booked], ['Transfers delivered', t => `${t.transfers} of ${t.offered} offered`], ['Shows', t => t.shows], ['Sales', t => t.sales],
                  ['Cost per lead', t => c(t.perLead)], ['Cost per booked', t => c(t.perBooked)], ['Cost per live call', t => c(t.perTransfer)], ['Cost per show', t => c(t.perShow)], ['Cost per sale', t => c(t.perSale)], ['VA time', t => `${t.vaHours} h · ${cents(t.vaCost)}`]]
                  .map(([k, f]) => <tr key={k}><th scope="row">{k}</th>{types.map(([l, t]) => <td key={l}>{f(t)}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        </Tile>
        <Tile className={`is-fill ${ok ? 'is-green' : 'is-warn'}`} i={1} title="Owner rule" sub={`VA cost at or under ${Math.round(OWNER_LIMIT * 100)}% of revenue`}>
          <dl className="fx-facts">{[['Revenue', money(all.revenue)], ['VA cost', cents(all.vaCost)], ['Owner take', cents(all.ownerTake)], ['VA % of revenue', all.vaPct == null ? 'No revenue yet' : `${all.vaPct}%`]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="tp-money">{v}</dd></div>)}</dl>
          <small>{all.revenue ? (ok ? 'Inside the rule.' : 'Over the rule. Admins are alerted.') : 'Pilot agents pay lead spend only, so revenue starts with paid plans. Try a membership amount to see the rule.'}</small>
          <Seg label="Sample membership revenue" value={membership} onChange={setMembership} options={[0, 1800, 5400].map(n => ({ key: n, label: n ? money(n) : 'None' }))} />
        </Tile>
      </div>
      <Tile i={2} title="Pilot by agent, state or week" aside={<Seg label="Group by" value={by} onChange={setBy} options={[{ key: 'agent', label: 'Agent' }, { key: 'state', label: 'State' }, { key: 'week', label: 'Week' }]} />}>
        <div className="p879-scroll" role="region" aria-label="Pilot breakdown" tabIndex={0}>
          <table className="p879-tbl">
            <thead><tr>{['', 'Spend', 'Leads', 'Reached', 'Booked', 'Transfers', 'Pickup', 'Shows', 'Sales', 'Per booked', 'Per live call', 'Per sale', 'VA hours', 'VA cost'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>{groups.map(([k, t]) => (
              <tr key={k}><th scope="row">{k}</th><td>{money(t.spend)}</td><td>{t.leads}</td><td>{t.reached}</td><td>{t.booked}</td><td>{t.transfers}</td><td>{t.pickup == null ? '–' : `${Math.round(t.pickup * 100)}%`}</td><td>{t.shows}</td><td>{t.sales}</td><td>{c(t.perBooked)}</td><td>{c(t.perTransfer)}</td><td>{c(t.perSale)}</td><td>{t.vaHours}</td><td>{cents(t.vaCost)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="tp-sub"><FlaskConical size={13} aria-hidden="true" /> A live transfer counts as delivered when the agent picks up. Offered but not taken shows as the pickup rate.</p>
      </Tile>
    </div>
  )
}
