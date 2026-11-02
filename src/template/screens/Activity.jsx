import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, Phone, MessageSquare, Users, ArrowRightLeft } from 'lucide-react'
import { useSampleActivity, useSampleClients } from '../data'
import { Seg, Empty } from '../kit'

const ICONS = { lead: Inbox, call: Phone, text: MessageSquare, client: Users, moved: ArrowRightLeft }

export default function Activity() {
  const { data: items } = useSampleActivity()
  const { data: clients } = useSampleClients()
  const [range, setRange] = useState('week')
  const rows = range === 'today' ? items.filter(a => a.at.startsWith('Today')) : items
  const idOf = who => clients.find(c => `${c.client_first_name} ${c.client_last_name}` === who)?.id
  return (
    <div className="tp-page">
      <div className="tp-row tp-wrap tp-between">
        <Seg label="Range" value={range} onChange={setRange} options={[{ key: 'today', label: 'Today' }, { key: 'week', label: 'This week' }, { key: 'all', label: 'All' }]} />
        <p className="tp-sub">Mon, Nov 2 to Thu, Nov 5 · Latest 2:06 PM</p>
      </div>
      <section className="ov-card tp-card" aria-label="Activity">
        <ul className="tp-list">
          {rows.map(a => {
            const Icon = ICONS[a.kind]
            const to = idOf(a.who) ? `/clients/${idOf(a.who)}` : null
            const body = <><span className="tp-ic"><Icon size={16} /></span><span className="tp-grow"><b>{a.who}</b><small>{a.text}</small></span><small>{a.at}</small></>
            return <li key={a.id}>{to ? <Link to={to} className="tp-li">{body}</Link> : <div className="tp-li">{body}</div>}</li>
          })}
        </ul>
        {rows.length === 0 && <Empty title="Nothing yet" sub="New activity shows up here." />}
      </section>
    </div>
  )
}
