import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Phone, TriangleAlert } from 'lucide-react'
import { useSampleClient, useSampleThreads, useSampleActions } from '../data'
import { Avatar, Chip, Drawer, Money, SampleTag, useNote } from '../kit'
import { stageLabel } from './Clients'

export default function ClientPage() {
  const { id } = useParams()
  const { data: c } = useSampleClient(id)
  const { data: threads } = useSampleThreads()
  const { clientAction, sendMessage } = useSampleActions()
  const note = useNote()
  const [move, setMove] = useState(false)
  const [msg, setMsg] = useState('')
  const [changing, setChanging] = useState(false)
  const name = `${c.client_first_name} ${c.client_last_name}`
  const [tone, label] = stageLabel[c.stage]
  const thread = threads.find(t => t.client_id === c.id) || threads[0]
  const send = () => { sendMessage(thread.id, msg.trim()); setMsg(''); note('Message sent to the team') }
  return (
    <div className="tp-page">
      <Link to="/clients" className="tp-link"><ArrowLeft size={14} />Clients</Link>
      <section className="ov-card tp-card">
        <div className="tp-row tp-wrap">
          <Avatar name={name} tone={c.attention ? 'warn' : ''} />
          <div className="tp-grow"><h2 className="tp-h2">{name}</h2><p className="tp-sub">Lives in {c.city}, {c.state} · submitted {c.submitted}</p></div>
          <Chip tone={tone}>{label}</Chip>
          <button type="button" className="ov-hero tp-primary" onClick={() => note(`Calling ${c.client_phone}`)}><Phone size={16} />{c.client_phone}</button>
        </div>
      </section>

      {c.attention && (
        <section className="ov-attn tp-card">
          <div className="tp-row"><span className="tp-ic warn"><TriangleAlert size={16} /></span><h2 className="tp-h2">What you can do</h2></div>
          <p className="tp-mid" style={{ margin: '10px 0' }}>We could not reach {c.client_first_name} after two tries. Is {c.client_phone} still right? Confirm and we will text tomorrow morning and evening. If neither gets a reply, you will be asked to call.</p>
          <div className="tp-row tp-wrap">
            <button type="button" className="ov-hero tp-primary" onClick={() => { clientAction(c.id, 'confirm'); note('Number confirmed. The team will text her tomorrow') }}>Yes, this is the right number</button>
            <button type="button" className="tp-btn ov-ghost" onClick={() => setChanging(true)}>Change number</button>
          </div>
        </section>
      )}

      <div className="tp-split">
        <div className="tp-stack">
          <section className="ov-card tp-card"><h2 className="tp-h2">Policy</h2>
            <ul className="tp-list">
              {[['Carrier', c.carrier_name], ['Product', c.product_name], ['Policy number', c.policy_number]].map(([k, v]) => <li key={k} className="tp-li" style={{ minHeight: 44 }}><span className="tp-grow tp-mid">{k}</span><b>{v}</b></li>)}
              <li className="tp-li" style={{ minHeight: 44 }}><span className="tp-grow tp-mid">Monthly premium <SampleTag /></span><Money v={c.monthly_premium} /></li>
            </ul>
            <p className="tp-sub">{c.note}</p>
          </section>
          <section className="ov-card tp-card"><div className="tp-row tp-between"><h2 className="tp-h2">Steps</h2><button type="button" className="tp-btn ov-ghost" onClick={() => setMove(true)}>Move call</button></div>
            <ol className="tp-tl" style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>{c.steps.map((s, i) => <li key={s.label} className={s.done ? 'done' : i === c.steps.findIndex(x => !x.done) ? 'now' : ''}><i /><div><b>{s.label}</b><span>{s.at}</span></div></li>)}</ol>
          </section>
          <section className="ov-card tp-card"><h2 className="tp-h2">Calls so far <span className="tp-tb" style={{ background: 'var(--ov-stub)', color: 'var(--ov-mid)' }}>{c.calls.length}</span></h2>
            <ul className="tp-list">{c.calls.map(k => <li key={k.at} className="tp-li"><span className="tp-grow"><b>{k.result}</b><small>{k.at} · {k.by}</small></span></li>)}</ul>
          </section>
        </div>
        <section className="ov-card tp-card"><h2 className="tp-h2">Message Fulfillment</h2><p className="tp-sub">The team on this client</p>
          <ul className="tp-list">{thread.messages.slice(-3).map(m => <li key={m.id} className="tp-li" style={{ alignItems: 'flex-start' }}><span className="tp-grow"><b>{m.from === 'me' ? 'You' : 'Fulfillment'}</b><small>{m.text}</small></span></li>)}</ul>
          <textarea className="tp-input" style={{ minHeight: 76, padding: 12 }} aria-label="Message the team" placeholder="Write a message" value={msg} onChange={e => setMsg(e.target.value)} />
          <div className="tp-row tp-wrap" style={{ marginTop: 8 }}><button type="button" className="ov-hero tp-primary sm" disabled={!msg.trim()} onClick={send}>Send</button><Link to="/messages" className="tp-link">Open in Messages</Link></div>
        </section>
      </div>

      <Drawer open={move} onClose={() => setMove(false)} title="Move this call" sub={name}
        footer={<button type="button" className="ov-hero tp-primary" onClick={() => { clientAction(c.id, 'Review call moved to Mon, Nov 9, 2:00 PM'); note('Call moved to Mon, Nov 9, 2:00 PM'); setMove(false) }}>Move to Mon, Nov 9, 2:00 PM</button>}>
        <p className="tp-mid">Pick a new time. Times are the client's local time.</p>
        <p className="tp-sub">Carrier hours 9:00 AM to 5:00 PM</p>
      </Drawer>
      <Drawer open={changing} onClose={() => setChanging(false)} title="Change number" sub={name}
        footer={<button type="button" className="ov-hero tp-primary" onClick={() => { clientAction(c.id, 'Number changed'); note('Number updated'); setChanging(false) }}>Save number</button>}>
        <input className="tp-input" aria-label="New phone number" defaultValue="(305) 555-0199" />
      </Drawer>
    </div>
  )
}
