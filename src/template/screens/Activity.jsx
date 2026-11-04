import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, Phone, MessageSquare, Users, ArrowRightLeft } from 'lucide-react'
import { useSampleActivity, useSampleClients } from '../data'
import { Seg, Empty } from '../kit'
import { paths } from '../paths'

const KINDS = { lead: ['Leads', Inbox, ''], call: ['Calls', Phone, 'warn'], text: ['Texts', MessageSquare, 'teal'], client: ['Clients', Users, 'violet'], moved: ['Moves', ArrowRightLeft, ''] }
const dayOf = at => (at.startsWith('Today') ? 'Today' : at.startsWith('Yesterday') ? 'Yesterday' : 'Earlier this week')

// What happened, newest first, grouped by day down a single line. A side card counts it by kind; tap a kind to
// see only that. The whole page scrolls.
export default function Activity() {
  const { data: items } = useSampleActivity()
  const { data: clients } = useSampleClients()
  const [range, setRange] = useState('week')
  const [kind, setKind] = useState(null)
  const inRange = range === 'today' ? items.filter(a => a.at.startsWith('Today')) : items
  const rows = kind ? inRange.filter(a => a.kind === kind) : inRange
  const idOf = who => clients.find(c => `${c.client_first_name} ${c.client_last_name}` === who)?.id
  const groups = [...new Set(rows.map(a => dayOf(a.at)))]
  return (
    <div className="tp-page">
      <div className="tp-row tp-wrap tp-between">
        <Seg label="Range" value={range} onChange={setRange} options={[{ key: 'today', label: 'Today' }, { key: 'week', label: 'This week' }, { key: 'all', label: 'All' }]} />
        <p className="tp-sub">Mon, Nov 2 to Thu, Nov 5 · Latest 2:06 PM</p>
      </div>
      <div className="tp-actlay">
        <section className="ov-card tp-card tp-feed" aria-label="Activity">
          {groups.map(g => (
            <div key={g} className="tp-feed-g">
              <h2 className="tp-feed-day">{g}</h2>
              <ol className="tp-feed-l">
                {rows.filter(a => dayOf(a.at) === g).map(a => {
                  const [, Icon, tone] = KINDS[a.kind]
                  const to = idOf(a.who) ? paths.client(idOf(a.who)) : null
                  const body = <><span className={`tp-ic ${tone}`}><Icon size={15} /></span><span className="tp-grow"><b>{a.who}</b><small>{a.text}</small></span><time>{a.at.replace(/^(Today|Yesterday), /, '')}</time></>
                  return <li key={a.id}>{to ? <Link to={to} className="tp-li">{body}</Link> : <div className="tp-li">{body}</div>}</li>
                })}
              </ol>
            </div>
          ))}
          {rows.length === 0 && <Empty title="Nothing yet" sub="New activity shows up here." />}
        </section>
        <aside className="ov-card tp-card tp-kinds" aria-label="By kind">
          <h2 className="tp-h2">By kind</h2>
          <p className="tp-sub">{kind ? 'Showing one kind. Tap it again for all.' : 'Tap one to see only that.'}</p>
          <ul className="tp-list">
            {Object.entries(KINDS).map(([k, [label, Icon, tone]]) => (
              <li key={k}><button type="button" className={`tp-li${kind === k ? ' on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
                <span className={`tp-ic ${tone}`}><Icon size={15} /></span><b className="tp-grow">{label}</b><span className="tp-num">{inRange.filter(a => a.kind === k).length}</span>
              </button></li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}
