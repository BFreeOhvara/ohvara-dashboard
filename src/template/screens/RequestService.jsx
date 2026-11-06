import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useSampleClients, useSampleActions, useSampleSettings } from '../data'
import { Avatar, Field, useNote } from '../kit'
import { paths } from '../paths'
import { stageLabel } from '../stages'
import { CallTime } from '../CallTime'
import { EMPTY_CALL_TIME, callTimeReady, callTimeText } from '../callTimeModel'
import { BOOK_DAYS } from '../carriers'
import { agentBooksCall } from '../ful/data'

const KINDS = ['Change address', 'Update phone', 'Change beneficiary', 'Change billing date', 'Reinstate policy', 'Cancel policy', 'Policy question', 'Other']

export default function RequestService() {
  const { data: clients } = useSampleClients()
  const { submitRequest, bookFulfillmentCall } = useSampleActions()
  const { data: settings } = useSampleSettings()
  const note = useNote()
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(null)
  const [kind, setKind] = useState(null)
  const [text, setText] = useState('')
  // P847: when fulfillment calls about it: an exact time, the best time, or let the team set it
  const [ct, setCt] = useState(EMPTY_CALL_TIME)
  const [sentVa, setSentVa] = useState(null)
  const [sent, setSent] = useState(false)
  const rows = clients.filter(c => `${c.client_first_name} ${c.client_last_name}`.toLowerCase().includes(q.trim().toLowerCase()))
  const callKind = kind === 'Cancel policy' ? 'cancellation' : 'service'
  const ready = callTimeReady(ct)
  const send = () => {
    const who = `${pick.client_first_name} ${pick.client_last_name}`
    submitRequest({ name: who, kind })
    if (ct.mode !== 'none') {
      const va = agentBooksCall({ who, state: pick.state, city: pick.city, oldCarrier: pick.carrier_name, kind: callKind, mode: ct.mode, day: ct.day, time: ct.time, iso: ct.iso, tz: ct.tz, vaId: ct.vaId, window: ct.window })
      bookFulfillmentCall({ who, kind: callKind, mode: ct.mode, day: BOOK_DAYS.find(d => d[1] === ct.day)?.[0], date: ct.day, time: ct.time, window: ct.window, va: va?.name })
      setSentVa(va)
    }
    setSent(true)
    note('Request sent to the team')
  }
  if (sent) {
    return <div className="tp-page"><section className="ov-card tp-card" style={{ maxWidth: 560 }}><div className="tp-row"><span className="tp-ic teal"><Check size={18} /></span><h2 className="tp-h2">Request sent</h2></div>
      <p className="tp-mid" style={{ margin: '10px 0' }}>The team has your request for {pick.client_first_name} {pick.client_last_name}. {ct.mode === 'exact' && sentVa ? `${callTimeText(ct, sentVa)}.` : ct.mode === 'window' ? `${callTimeText(ct)}.` : ''} You will see the update in Activity.</p>
      <Link to={paths.activity()} className="tp-primary fx-accent">Open Activity</Link></section></div>
  }
  return (
    <div className="tp-page">
      <div className="tp-split">
        <section className="ov-card tp-card tp-stack">
          <div><h2 className="tp-h2">Find a client</h2><p className="tp-sub">Showing {rows.length} of {clients.length}. Search to find the rest.</p></div>
          <input className="tp-input" aria-label="Search clients" placeholder="Search by name" value={q} onChange={e => setQ(e.target.value)} />
          <ul className="tp-list">
            {rows.map(c => (
              <li key={c.id}><button type="button" className="tp-li" aria-pressed={pick?.id === c.id} onClick={() => setPick(c)}>
                <Avatar name={`${c.client_first_name} ${c.client_last_name}`} tone={stageLabel[c.stage]?.[0]} /><span className="tp-grow"><b>{c.client_first_name} {c.client_last_name}</b><small>{c.policy_number}</small></span>
                <span className="tp-chip is-blue" style={{ opacity: pick?.id === c.id ? 1 : 0 }}>Picked</span></button></li>
            ))}
            {rows.length === 0 && <li className="tp-li"><span className="tp-sub">No client matches. Check the spelling, or search by phone number.</span></li>}
          </ul>
          <div><h2 className="tp-h2">A change on the policy</h2></div>
          <div className="tp-row tp-wrap" role="group" aria-label="Kind of request">{KINDS.map(k => <button key={k} type="button" className={`tp-btn ov-ghost${kind === k ? ' tp-on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)} style={kind === k ? { borderColor: 'var(--ov-data-a)', background: 'var(--ov-data-a-tint)' } : undefined}>{k}</button>)}</div>
          <Field label="Note for the team"><textarea value={text} onChange={e => setText(e.target.value)} placeholder="What needs doing" /></Field>
          <CallTime kind={callKind} value={ct} onChange={setCt} state={pick?.state} city={pick?.city} oldCarrier={pick?.carrier_name} viewerTz={settings.timeZone} />
        </section>
        <div className="ov-card tp-card tp-stack">
          <h2 className="tp-h2">Request summary</h2>
          <p className="tp-mid">{pick ? `${pick.client_first_name} ${pick.client_last_name}` : 'No client picked yet'}<br /><span className="tp-sub">{kind || 'Pick what needs doing'}</span></p>
          <p className="tp-sub">{callTimeText(ct)}</p>
          <button type="button" className="tp-primary fx-accent" disabled={!pick || !kind || !ready} onClick={send}>Send request</button>
          <p className="tp-sub">Included in policy servicing.</p>
        </div>
      </div>
    </div>
  )
}
