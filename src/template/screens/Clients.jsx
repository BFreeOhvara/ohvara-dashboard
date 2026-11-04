import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, Plus, LayoutGrid, Rows3, Phone, MessageSquare } from 'lucide-react'
import { useSampleClients } from '../data'
import { Avatar, Chip, Money, SampleTag, Empty, useNote } from '../kit'
import { paths } from '../paths'

export const stageLabel = { protected: ['green', 'Protected'], setting_up: ['blue', 'Setting up'], needs_attention: ['warn', 'Needs attention'], requests: ['teal', 'Request open'] }

// How far along servicing is, for the little progress line on each card.
const doneShare = c => c.steps.filter(s => s.done).length / c.steps.length

// Your book as a directory: one card per client (or the table, for scanning many). The whole page scrolls.
export default function Clients() {
  const { data: clients } = useSampleClients()
  const [params, setParams] = useSearchParams()
  const note = useNote()
  const [q, setQ] = useState('')
  const [view, setView] = useState('grid')
  const stage = params.get('stage') || 'all'
  const counts = useMemo(() => Object.fromEntries(['protected', 'setting_up', 'needs_attention', 'requests'].map(s => [s, clients.filter(c => c.stage === s).length])), [clients])
  const rows = clients.filter(c => (stage === 'all' || c.stage === stage) && `${c.client_first_name} ${c.client_last_name} ${c.policy_number} ${c.client_phone}`.toLowerCase().includes(q.trim().toLowerCase()))
  const options = [{ key: 'all', label: 'All', count: clients.length }, { key: 'needs_attention', label: 'Needs attention', count: counts.needs_attention }, { key: 'setting_up', label: 'Setting up', count: counts.setting_up }, { key: 'protected', label: 'Protected', count: counts.protected }, { key: 'requests', label: 'Requests', count: counts.requests }]
  return (
    <div className="tp-page">
      <div className="tp-ctools">
        <label className="tp-find ov-card"><Search size={16} aria-hidden="true" /><input aria-label="Find a client" placeholder="Find a client, phone or policy" value={q} onChange={e => setQ(e.target.value)} /></label>
        <div className="tp-pills" role="tablist" aria-label="Status">
          {options.map(o => (stage === o.key
            ? <span key={o.key} role="tab" aria-selected="true" className="tp-pill on">{o.label}<b>{o.count}</b></span>
            : <button key={o.key} type="button" role="tab" aria-selected="false" className="tp-pill" onClick={() => setParams(o.key === 'all' ? {} : { stage: o.key })}>{o.label}<b>{o.count}</b></button>))}
        </div>
        <span className="tp-grow" />
        <div className="tp-viewsw ov-card" role="group" aria-label="View">
          {[['grid', 'Cards', LayoutGrid], ['table', 'Table', Rows3]].map(([k, label, Icon]) => (view === k
            ? <span key={k} className="on" aria-current="true"><Icon size={15} aria-hidden="true" />{label}</span>
            : <button key={k} type="button" onClick={() => setView(k)}><Icon size={15} aria-hidden="true" />{label}</button>))}
        </div>
        <Link to={paths.submit()} className="ov-hero tp-primary"><Plus size={16} />Submit a sale</Link>
      </div>

      {view === 'grid' ? (
        <div className="tp-cgrid" aria-label="Clients">
          {rows.map(c => {
            const [tone, label] = stageLabel[c.stage]
            const name = `${c.client_first_name} ${c.client_last_name}`
            return (
              <article key={c.id} className={`tp-ccard ov-card is-${c.stage}`}>
                <Link to={paths.client(c.id)} className="tp-ccard-top">
                  <Avatar name={name} tone={c.stage === 'needs_attention' ? 'warn' : 'blue'} />
                  <span className="tp-grow"><b>{name}</b><small>{c.city}, {c.state} · {c.policy_number}</small></span>
                  <Chip tone={tone}>{label}</Chip>
                </Link>
                <div className="tp-ccard-mid">
                  <span><small>Carrier</small><b>{c.carrier_name}</b></span>
                  <span><small>Premium <SampleTag>Sample</SampleTag></small><Money v={c.monthly_premium} /></span>
                </div>
                <div className="tp-prog" aria-label={`${Math.round(doneShare(c) * 100)}% through servicing`}><i style={{ width: `${Math.round(doneShare(c) * 100)}%` }} /></div>
                <div className="tp-row tp-between">
                  <span className="tp-sub tp-grow">{c.next_step || 'Nothing needed from you'}</span>
                  <button type="button" className="tp-icbtn sm" aria-label={`Call ${name}`} onClick={() => note(`Calling ${c.client_phone}`)}><Phone size={15} /></button>
                  <Link to={paths.messages()} className="tp-icbtn sm" aria-label={`Message the team about ${name}`}><MessageSquare size={15} /></Link>
                </div>
              </article>
            )
          })}
          {rows.length === 0 && <section className="ov-card"><Empty title="No clients match" sub="Check the spelling, or show every status." /></section>}
        </div>
      ) : (
        <section className="ov-card" aria-label="Clients">
          <div className="tp-trow tp-cols-clients tp-head-row"><span>Client</span><span>Carrier</span><span>Next step</span><span>Premium</span><span>Status</span></div>
          {rows.map(c => {
            const [tone, label] = stageLabel[c.stage]
            return (
              <Link key={c.id} to={paths.client(c.id)} className="tp-trow tp-cols-clients">
                <span className="tp-row"><Avatar name={`${c.client_first_name} ${c.client_last_name}`} tone={c.stage === 'needs_attention' ? 'warn' : ''} /><span><b>{c.client_first_name} {c.client_last_name}</b><small>{c.client_phone} · {c.policy_number}</small></span></span>
                <span className="hide-sm">{c.carrier_name}<small>{c.product_name}</small></span>
                <span className="hide-sm">{c.next_step || 'Nothing needed from you'}</span>
                <span className="hide-sm"><Money v={c.monthly_premium} /><small><SampleTag /></small></span>
                <Chip tone={tone}>{label}</Chip>
              </Link>
            )
          })}
          {rows.length === 0 && <Empty title="No clients match" sub="Check the spelling, or show every status." />}
        </section>
      )}
    </div>
  )
}
