import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Search, Plus, Phone, MessageSquare, TriangleAlert, CalendarClock, MapPin, Users, UserPlus } from 'lucide-react'
import { useDataSource, useSampleClients, useSampleClient, useSampleThreads, useSampleActions } from '../data'
import { Avatar, Chip, Drawer, Money, SampleTag, Empty, useNote } from '../kit'
import { RecordDrawer, Stepper, Block } from '../Record'
import { stageLabel, CLIENT_STEPS } from '../stages'
import { paths } from '../paths'
import { MissedPaymentBlock } from '../PaymentIntake'
import { AgentDocsBlock } from '../docs886/Docs886'
import { FirstRun } from '../DataState'
import { AddClients } from '../AddClients891'
import { FilterPills } from '../FilterPills'
import { BOOK_STATUS, BOOK_STEPS, ordinal } from '../../lib/bookImport.js'

// Your book: one big card per client, filled with its stage colour. A card opens the client in a drawer at its
// own URL (paths.client); the grid stays put behind it.
function ClientCard({ c, i }) {
  const note = useNote()
  const [tone, label] = stageLabel[c.stage]
  const name = `${c.client_first_name} ${c.client_last_name}`
  // P893: no "% set up" meter; only the fields that have a value
  const where = [c.carrier_name, [c.city, c.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
  const premium = Number(c.monthly_premium) > 0
  return (
    <article className={`fx-card fx-ccard is-${tone}`} style={{ '--i': i }}>
      <Link to={paths.client(c.id)} className="fx-cover" aria-label={`Open ${name}`} />
      <div className="fx-ccard-top"><Avatar name={name} tone={tone} />{c.added && <span className="tp-tag bi-by">Added by you</span>}<span className="fx-tag">{c.added ? BOOK_STATUS[c.book][1] : label}</span></div>
      <h3>{name}</h3>
      {where && <p>{where}</p>}
      {(premium || c.next_step) && <div className="fx-ccard-mid">
        {premium && <span><small>Premium <SampleTag>Sample</SampleTag></small><Money v={c.monthly_premium} /></span>}
        {c.next_step && <span><small>Next step</small><b>{c.next_step}</b></span>}
      </div>}
      <div className="fx-ccard-bot">
        <span className="tp-grow" />
        <button type="button" className="fx-mini fx-over" aria-label={`Call ${name}`} onClick={() => note(`Calling ${c.client_phone}`)}><Phone size={14} /></button>
        <Link to={paths.messages()} className="fx-mini fx-over" aria-label={`Message the team about ${name}`}><MessageSquare size={14} /></Link>
      </div>
    </article>
  )
}

// P891: a client the agent brought in. Added (welcome call coming) → Welcomed → Serviced, like any client after that.
function BookBlock({ c }) {
  const [tone, word, sub] = BOOK_STATUS[c.book]
  const at = BOOK_STEPS.findIndex(s => s.key === c.book)
  return (
    <Block title="Added by you" sub={c.book === 'added' ? `${sub}: ${c.next_step?.replace(/^Welcome call /, '') || 'soon'}. They introduce your client care team and check these details.` : sub} aside={<Chip tone={tone}>{word}</Chip>}>
      <div className="bi-steps" role="list" aria-label="Where this client is">
        {BOOK_STEPS.map((s, i) => <span key={s.key} role="listitem" className={`${i < at ? 'is-done' : ''}${s.key === c.book ? ` is-on is-${tone}` : ''}`}>{s.label}</span>)}
      </div>
    </Block>
  )
}

function ClientDrawer({ id, onClose }) {
  const { data: c } = useSampleClient(id)
  const { data: threads } = useSampleThreads()
  const { clientAction, sendMessage } = useSampleActions()
  const note = useNote()
  const [panel, setPanel] = useState(null)
  const [msg, setMsg] = useState('')
  const name = `${c.client_first_name} ${c.client_last_name}`
  const [tone, label] = stageLabel[c.stage]
  const thread = threads.find(t => t.client_id === c.id) || threads[0]
  const send = () => { sendMessage(thread.id, msg.trim()); setMsg(''); note('Message sent to the team') }
  const pick = k => { clientAction(c.id, `Asked the team to move ${c.client_first_name} to ${CLIENT_STEPS.find(s => s.key === k).label}`); note('Sent to the team. They make the change') }
  return (
    <RecordDrawer label={name} kicker={`Client · submitted ${c.submitted}`} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><CalendarClock size={13} aria-hidden="true" />{c.next_step || 'Nothing needed from you'}</span><Chip tone={tone}>{label}</Chip></div>
        <h2>{name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{c.carrier_name} · {c.city}, {c.state}</p>
        <div className="fx-hero-bot"><span><Money v={c.monthly_premium} size="fx-hero-big" /><small> / month · sample</small></span><Avatar name={name} tone={tone} /></div>
      </>}
      stepper={<Stepper label="Servicing stage" steps={CLIENT_STEPS} current={c.stage} onPick={pick} />}
      actions={<>
        <button type="button" className="tp-primary fx-accent" onClick={() => note(`Calling ${c.client_phone}`)}><Phone size={16} />Call</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('move')}>Move call</button>
        <span className="tp-grow" />
        <Link to={paths.messages()} className="tp-btn ov-ghost"><MessageSquare size={14} />Messages</Link>
      </>}>
      {c.missed ? <MissedPaymentBlock c={c} /> : c.attention && (
        <section className="fx-blk fx-attn">
          <header><h3><TriangleAlert size={16} aria-hidden="true" />What you can do</h3></header>
          <p className="tp-mid">We could not reach {c.client_first_name} after two tries. Is {c.client_phone} still right? Confirm and we text tomorrow morning and evening.</p>
          <div className="tp-row tp-wrap">
            <button type="button" className="tp-primary sm fx-accent" onClick={() => { clientAction(c.id, 'confirm'); note('Number confirmed. The team will text her tomorrow') }}>Yes, the number is right</button>
            <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('number')}>Change number</button>
          </div>
        </section>
      )}
      {c.added && <BookBlock c={c} />}
      <Block title="Policy">
        <dl className="fx-facts">{[['Carrier', c.carrier_name], ['Product', c.product_name], ['Policy', c.policy_number], ['Phone', c.client_phone],
          ...(c.added ? [['Face amount', c.face_amount ? `$${Number(c.face_amount).toLocaleString('en-US')}` : 'Not given'], ['Draft day', c.draft_day ? `The ${ordinal(c.draft_day)}` : 'Not given'], ['Effective', c.effective || 'Not given']] : [])].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <p className="tp-sub">{c.note}</p>
      </Block>
      <Block title="Steps">
        <ol className="tp-tl fx-tl">{c.steps.map((s, i) => <li key={s.label} className={s.done ? 'done' : i === c.steps.findIndex(x => !x.done) ? 'now' : ''}><i /><div><b>{s.label}</b><span>{s.at}</span></div></li>)}</ol>
      </Block>
      <Block title="Calls so far" aside={<span className="fx-count">{c.calls.length}</span>}>
        <ul className="tp-list">{c.calls.map(k => <li key={k.at} className="tp-li"><span className="tp-grow"><b>{k.result}</b><small>{k.at} · {k.by}</small></span></li>)}</ul>
      </Block>
      <AgentDocsBlock who={name} />
      <Block title="Message Fulfillment" sub="The team on this client">
        <ul className="tp-list">{thread.messages.slice(-2).map(m => <li key={m.id} className="tp-li fx-msg"><span className="tp-grow"><b>{m.from === 'me' ? 'You' : 'Fulfillment'}</b><small>{m.text}</small></span></li>)}</ul>
        <textarea className="tp-input fx-ta" aria-label="Message the team" placeholder="Write a message" value={msg} onChange={e => setMsg(e.target.value)} />
        {msg.trim() && <button type="button" className="tp-primary sm fx-accent fx-self" onClick={send}>Send</button>}
      </Block>

      <Drawer open={panel === 'move'} center onClose={() => setPanel(null)} title="Move this call" sub={name}
        footer={<button type="button" className="tp-primary fx-accent" onClick={() => { clientAction(c.id, 'Review call moved to Mon, Nov 9, 2:00 PM'); note('Call moved to Mon, Nov 9, 2:00 PM'); setPanel(null) }}>Move to Mon, Nov 9, 2:00 PM</button>}>
        <p className="tp-mid">Pick a new time. Times are the client's local time.</p>
        <p className="tp-sub">Carrier hours 9:00 AM to 5:00 PM</p>
      </Drawer>
      <Drawer open={panel === 'number'} center onClose={() => setPanel(null)} title="Change number" sub={name}
        footer={<button type="button" className="tp-primary fx-accent" onClick={() => { clientAction(c.id, 'Number changed'); note('Number updated'); setPanel(null) }}>Save number</button>}>
        <input className="tp-input" aria-label="New phone number" defaultValue="(305) 555-0199" />
      </Drawer>
    </RecordDrawer>
  )
}

export default function Clients() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: clients } = useSampleClients()
  const source = useDataSource()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(params.get('add') === '1')
  const stage = params.get('stage') || 'all'
  const counts = useMemo(() => Object.fromEntries(Object.keys(stageLabel).map(s => [s, clients.filter(c => c.stage === s).length])), [clients])
  const rows = clients.filter(c => (stage === 'all' || c.stage === stage) && `${c.client_first_name} ${c.client_last_name} ${c.policy_number} ${c.client_phone}`.toLowerCase().includes(q.trim().toLowerCase()))
  const options = [{ key: 'all', label: 'All', count: clients.length }, { key: 'needs_attention', label: 'Needs attention', count: counts.needs_attention }, { key: 'setting_up', label: 'Setting up', count: counts.setting_up }, { key: 'protected', label: 'Protected', count: counts.protected }, { key: 'requests', label: 'Requests', count: counts.requests }]
  // P893: each status pill carries its stage colour (FilterPills); All stays neutral.
  return (
    <div className="tp-page fx-page">
      <div className="fx-tools">
        <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label="Find a client" placeholder="Find a client, phone or policy" value={q} onChange={e => setQ(e.target.value)} /></label>
        <FilterPills label="Status" value={stage} onChange={k => setParams(k === 'all' ? {} : { stage: k })} items={options.map(o => ({ ...o, tone: stageLabel[o.key]?.[0] }))} />
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost" onClick={() => setAdding(true)}><UserPlus size={16} />Add clients</button>
        <Link to={paths.submit()} className="tp-primary fx-accent"><Plus size={16} />Submit a policy</Link>
      </div>

      <div className="fx-cgrid" aria-label="Clients">
        {rows.map((c, i) => <ClientCard key={c.id} c={c} i={i} />)}
        {rows.length === 0 && clients.length > 0 && <section className="fx-tile"><Empty title="No clients match" sub="Check the spelling, or show every status." /></section>}
        {clients.length === 0 && <FirstRun icon={Users} title="Your clients show here" sub="Submit a sale and it shows here with every servicing step: packet check, review call, and the old policy cancelled. The team keeps each one on the books."><Link to={paths.submit()} className="tp-primary fx-accent"><Plus size={16} />Submit your first policy</Link><button type="button" className="tp-btn ov-ghost" onClick={() => setAdding(true)}><UserPlus size={16} />Add clients you already have</button></FirstRun>}
      </div>

      <AddClients open={adding} onClose={() => setAdding(false)} />
      {id && (source === 'sample' || clients.some(c => c.id === id)) && <ClientDrawer id={id} onClose={() => navigate(paths.clients(stage === 'all' ? undefined : stage))} />}
    </div>
  )
}
