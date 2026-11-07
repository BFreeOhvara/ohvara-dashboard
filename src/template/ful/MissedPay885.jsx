import { useState } from 'react'
import { Inbox, KeyRound, CircleCheck, Search, Send, TriangleAlert, Link2, Ban, ShieldAlert } from 'lucide-react'
import { useFulMissedDesk, useFulActions } from './data'
import { Drawer, Empty, Field, PillTabs, useNote } from '../kit'
import { Block } from '../Record'
import '../p885.css'

// P885 — the VA's missed-payment desk (N-E-08; Q37, Q38), on the Servicing page. Sample only: P852 wires it to
// va_missed_payment_desk, va_payment_intake_match / _dismiss and va_portal_check_done.
//   Forwarded emails to match: carrier emails an agent forwarded that the system couldn't tie to one policy.
//   Carrier portal checks: one per agent per carrier each week. Look only (Q38): anything that needs changing in the
//   portal is written up for the agent, who does it.
// A match, or a miss found in a portal, opens a lapse save due by the end of the next business day and warns the agent.

const WHY = { no_policy: 'No policy with that number', several_policies: 'Fits more than one policy', unclear: 'Not clear it’s a missed payment' }
const RESULTS = [
  { key: 'nothing_missed', label: 'Nothing missed' },
  { key: 'missed_found', label: 'Found a missed payment' },
  { key: 'agent_action', label: 'Agent needs to do something' },
  { key: 'no_access', label: 'Couldn’t get in' },
]

function MatchDrawer({ e, onClose }) {
  const { matchIntake, dismissIntake } = useFulActions()
  const note = useNote()
  const [pick, setPick] = useState(null)
  const [q, setQ] = useState(e.guess || '')
  const n = q.trim().toLowerCase()
  const shown = e.clients.filter(c => !n || `${c.client_first_name} ${c.client_last_name} ${c.policy_number}`.toLowerCase().includes(n))
  return (
    <Drawer open center onClose={onClose} title="Match this email" sub={`${e.agent} forwarded it · ${e.at}`}
      footer={<>
        <button type="button" className="tp-btn ov-ghost" onClick={() => { dismissIntake(e.id); note('Set aside'); onClose() }}><Ban size={15} />Not a missed payment</button>
        <span className="tp-grow" />
        <button type="button" className="tp-primary fx-accent" disabled={!pick} onClick={() => { matchIntake(e.id, pick); note(`Matched. Save call opened and ${e.agent} told`); onClose() }}><Link2 size={16} />Match</button>
      </>}>
      <p className="mp-rule"><TriangleAlert size={15} aria-hidden="true" />{WHY[e.why]}</p>
      <b className="pi-sub">{e.subject}</b>
      <pre className="mp-excerpt">{e.excerpt}</pre>
      <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label={`Find ${e.agent}'s client`} placeholder="Name or policy number" value={q} onChange={ev => setQ(ev.target.value)} /></label>
      <div className="mp-picks" role="radiogroup" aria-label="Which policy">
        {shown.map(c => (
          <label key={c.id} className={`mp-pick${pick === c.id ? ' is-on' : ''}`}>
            <input type="radio" name={`m-${e.id}`} checked={pick === c.id} onChange={() => setPick(c.id)} />
            <span className="tp-grow"><b>{c.client_first_name} {c.client_last_name}</b> <small>{c.carrier_name} · {c.policy_number}</small></span>
          </label>
        ))}
        {shown.length === 0 && <Empty title="No client matches" sub={`Try another name, or ask ${e.agent.split(' ')[0]}.`} />}
      </div>
    </Drawer>
  )
}

function CheckDrawer({ k, onClose }) {
  const { finishPortalCheck } = useFulActions()
  const note = useNote()
  const [result, setResult] = useState(null)
  const [picks, setPicks] = useState([])
  const [action, setAction] = useState('')
  const mine = k.clients.filter(c => c.carrier_name === k.carrier)
  const first = k.agent.split(' ')[0]
  const needsText = result === 'agent_action' || result === 'no_access'
  const ready = result && (result !== 'missed_found' || picks.length > 0) && (!needsText || action.trim())
  const save = () => {
    finishPortalCheck(k.id, result, result === 'missed_found' ? picks : [], action)
    note(result === 'nothing_missed' ? 'Recorded: nothing missed' : result === 'missed_found' ? `Save call opened and ${first} told` : `Sent to ${first}`)
    onClose()
  }
  return (
    <Drawer open center onClose={onClose} title={`Check ${k.carrier}`} sub={`${k.agent}'s portal · ${k.policies} policies`}
      footer={<button type="button" className="tp-primary fx-accent" disabled={!ready} onClick={save}><CircleCheck size={16} />Save</button>}>
      <p className="mp-rule"><KeyRound size={15} aria-hidden="true" />Look only. Don{'’'}t change anything in the portal: if something needs changing, write it for {first} below and they do it.</p>
      <PillTabs role="radiogroup" label="What you found" className="fx-chips fs-wrap" itemClass="fx-chip" value={result} onChange={setResult} items={RESULTS.map(r => ({ key: r.key, label: <b>{r.label}</b> }))} />
      {result === 'missed_found' && (
        <div className="mp-picks" role="group" aria-label="Which client missed">
          {mine.map(c => (
            <label key={c.id} className={`mp-pick${picks.includes(c.id) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={picks.includes(c.id)} onChange={ev => setPicks(ev.target.checked ? [...picks, c.id] : picks.filter(x => x !== c.id))} />
              <span className="tp-grow"><b>{c.client_first_name} {c.client_last_name}</b> <small>{c.policy_number}</small></span>
            </label>
          ))}
          {mine.length === 0 && <Empty title="No clients with this carrier" sub="Sample: pick another check." />}
        </div>
      )}
      {result && result !== 'nothing_missed' && (
        <Field label={needsText ? `What ${first} needs to do` : `Anything ${first} needs to do in the portal (optional)`}>
          <textarea className="tp-input fx-ta mp-ta" maxLength={500} value={action} onChange={ev => setAction(ev.target.value)}
            placeholder={result === 'no_access' ? 'e.g. The login asks for a code sent to your phone. Can you add us as a sub-user?' : 'e.g. Re-run the November draft for Ann Lee'} />
        </Field>
      )}
    </Drawer>
  )
}

export function MissedPayDesk() {
  const { data } = useFulMissedDesk()
  const [open, setOpen] = useState(null)
  const email = data.emails.find(e => e.id === open)
  const check = data.checks.find(c => c.id === open)
  return (
    <div className="mp-desk" role="region" aria-label="Missed payments">
      <section className="fx-tile" aria-label="Forwarded emails to match">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Forwarded emails to match</h2><p>{data.emails.length} waiting · carrier emails agents forwarded</p></span><Inbox size={18} aria-hidden="true" /></header>
        <ul className="mp-list">{data.emails.map(e => (
          <li key={e.id} className="mp-row"><span className="tp-grow"><b>{e.subject}</b><small>{e.agent} · {e.at} · {WHY[e.why]}</small></span>
            <button type="button" className="tp-btn ov-ghost" onClick={() => setOpen(e.id)}><Link2 size={15} />Match</button></li>
        ))}</ul>
        {data.emails.length === 0 && <Empty title="All matched" sub="Every forwarded email is tied to a policy." />}
      </section>
      <section className="fx-tile" aria-label="Carrier portal checks">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Carrier portal checks</h2><p>{data.checks.length} this week · look for missed payments, change nothing</p></span><KeyRound size={18} aria-hidden="true" /></header>
        <ul className="mp-list">{data.checks.map(c => (
          <li key={c.id} className="mp-row"><span className="tp-grow"><b>{c.carrier}</b><small>{c.agent} · {c.policies} policies · {c.due_text}</small></span>
            <button type="button" className="tp-btn ov-ghost" onClick={() => setOpen(c.id)}><Send size={15} />Record</button></li>
        ))}</ul>
        {data.checks.length === 0 && <Empty title="All checked" sub="The next checks come next week." />}
      </section>
      {email && <MatchDrawer key={email.id} e={email} onClose={() => setOpen(null)} />}
      {check && <CheckDrawer key={check.id} k={check} onClose={() => setOpen(null)} />}
    </div>
  )
}

// On a lapse save that a missed payment opened: what happened and the chargeback watch month.
export function MissedFacts({ t }) {
  const m = t.missed
  return (
    <Block title={m.chargeback ? 'Missed payment · chargeback risk' : 'Missed payment'} sub="Due by the end of the next business day">
      <dl className="fx-facts">{[['Payment due', m.due], ['How we found it', m.how], ['Grace ends', m.grace], ...(m.chargeback ? [['Chargeback watch', `Month ${m.month} of ${m.of}`]] : []), ...(m.repeat ? [['Repeat', 'Second miss in 12 months']] : [])]
        .map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <p className="mp-rule"><ShieldAlert size={15} aria-hidden="true" />{t.agent} was told at once. Anything to change in the carrier portal goes to {t.agent.split(' ')[0]}: use Send to agent.</p>
    </Block>
  )
}
