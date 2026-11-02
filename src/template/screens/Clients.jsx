import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, Plus } from 'lucide-react'
import { useSampleClients } from '../data'
import { Avatar, Chip, Money, SampleTag, Seg, Empty } from '../kit'

export const stageLabel = { protected: ['green', 'Protected'], setting_up: ['blue', 'Setting up'], needs_attention: ['warn', 'Needs attention'], requests: ['teal', 'Request open'] }

export default function Clients() {
  const { data: clients } = useSampleClients()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const stage = params.get('stage') || 'all'
  const counts = useMemo(() => Object.fromEntries(['protected', 'setting_up', 'needs_attention', 'requests'].map(s => [s, clients.filter(c => c.stage === s).length])), [clients])
  const rows = clients.filter(c => (stage === 'all' || c.stage === stage) && `${c.client_first_name} ${c.client_last_name} ${c.policy_number} ${c.client_phone}`.toLowerCase().includes(q.trim().toLowerCase()))
  const options = [{ key: 'all', label: 'All', count: clients.length }, { key: 'needs_attention', label: 'Needs attention', count: counts.needs_attention }, { key: 'setting_up', label: 'Setting up', count: counts.setting_up }, { key: 'protected', label: 'Protected', count: counts.protected }, { key: 'requests', label: 'Requests', count: counts.requests }]
  return (
    <div className="tp-page">
      <section className="ov-hero tp-hero" style={{ padding: '24px 28px' }}>
        <div><h2 style={{ fontSize: 30, margin: 0 }}>{clients.length} clients, {clients.length + 2} policies</h2><p>Search any status, or filter below.</p></div>
        <Link to="/submit" className="tp-white"><Plus size={18} />Submit a sale</Link>
      </section>
      <label className="ov-card tp-row tp-card" style={{ padding: '0 16px', minHeight: 52 }}>
        <Search size={18} aria-hidden="true" />
        <input className="tp-grow" style={{ background: 'none', border: 0, outline: 0, minHeight: 48 }} aria-label="Find a client" placeholder="Find any client by name, phone or policy number" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <Seg label="Status" value={stage} onChange={s => setParams(s === 'all' ? {} : { stage: s })} options={options} />
      <section className="ov-card" aria-label="Clients">
        <div className="tp-trow tp-cols-clients tp-head-row"><span>Client</span><span>Carrier</span><span>Next step</span><span>Premium</span><span>Status</span></div>
        {rows.map(c => {
          const [tone, label] = stageLabel[c.stage]
          return (
            <Link key={c.id} to={`/clients/${c.id}`} className="tp-trow tp-cols-clients">
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
    </div>
  )
}
