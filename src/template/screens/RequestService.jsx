import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useSampleClients, useSampleActions } from '../data'
import { Avatar, Field, Seg, useNote } from '../kit'
import { paths } from '../paths'

const KINDS = ['Change address', 'Update phone', 'Change beneficiary', 'Change billing date', 'Reinstate policy', 'Cancel policy', 'Policy question', 'Other']

export default function RequestService() {
  const { data: clients } = useSampleClients()
  const { submitRequest } = useSampleActions()
  const note = useNote()
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(null)
  const [kind, setKind] = useState(null)
  const [text, setText] = useState('')
  const [best, setBest] = useState('Mornings')
  const [sent, setSent] = useState(false)
  const rows = clients.filter(c => `${c.client_first_name} ${c.client_last_name}`.toLowerCase().includes(q.trim().toLowerCase()))
  if (sent) {
    return <div className="tp-page"><section className="ov-card tp-card" style={{ maxWidth: 560 }}><div className="tp-row"><span className="tp-ic teal"><Check size={18} /></span><h2 className="tp-h2">Request sent</h2></div>
      <p className="tp-mid" style={{ margin: '10px 0' }}>The team has your request for {pick.client_first_name} {pick.client_last_name}. You will see the update in Activity.</p>
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
                <Avatar name={`${c.client_first_name} ${c.client_last_name}`} tone={pick?.id === c.id ? 'blue' : ''} /><span className="tp-grow"><b>{c.client_first_name} {c.client_last_name}</b><small>{c.policy_number}</small></span>
                <span className="tp-chip is-blue" style={{ opacity: pick?.id === c.id ? 1 : 0 }}>Picked</span></button></li>
            ))}
            {rows.length === 0 && <li className="tp-li"><span className="tp-sub">No client matches. Check the spelling, or search by phone number.</span></li>}
          </ul>
          <div><h2 className="tp-h2">A change on the policy</h2></div>
          <div className="tp-row tp-wrap" role="group" aria-label="Kind of request">{KINDS.map(k => <button key={k} type="button" className={`tp-btn ov-ghost${kind === k ? ' tp-on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)} style={kind === k ? { borderColor: 'var(--ov-data-a)', background: 'var(--ov-data-a-tint)' } : undefined}>{k}</button>)}</div>
          <Field label="Note for the team"><textarea value={text} onChange={e => setText(e.target.value)} placeholder="What needs doing" /></Field>
          <div><p className="tp-sub" style={{ marginBottom: 6 }}>Best time to reach them. Client's local time.</p><Seg label="Best time" value={best} onChange={setBest} options={['Mornings', 'Afternoons', 'Evenings'].map(x => ({ key: x, label: x }))} /></div>
        </section>
        <div className="ov-card tp-card tp-stack">
          <h2 className="tp-h2">Request summary</h2>
          <p className="tp-mid">{pick ? `${pick.client_first_name} ${pick.client_last_name}` : 'No client picked yet'}<br /><span className="tp-sub">{kind || 'Pick what needs doing'}</span></p>
          <button type="button" className="tp-primary fx-accent" disabled={!pick || !kind} onClick={() => { submitRequest({ name: `${pick.client_first_name} ${pick.client_last_name}`, kind }); setSent(true); note('Request sent to the team') }}>Send request</button>
          <p className="tp-sub">Does not use a submission.</p>
        </div>
      </div>
    </div>
  )
}
