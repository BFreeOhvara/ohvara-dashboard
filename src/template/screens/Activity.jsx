import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Inbox, Phone, MessageSquare, Users, ArrowRightLeft } from 'lucide-react'
import { useSampleActivity, useSampleClients } from '../data'
import { Seg, Empty } from '../kit'
import { CountUp } from '../motion'
import { paths } from '../paths'
import { Results } from '../Results'

const KINDS = { lead: ['Leads', Inbox, 'blue'], call: ['Calls', Phone, 'warn'], text: ['Texts', MessageSquare, 'teal'], client: ['Clients', Users, 'green'], moved: ['Moves', ArrowRightLeft, 'mute'] }
const dayOf = at => (at.startsWith('Today') ? 'Today' : at.startsWith('Yesterday') ? 'Yesterday' : 'Earlier this week')

// What happened, newest first, down one line grouped by day. The side tile counts it by kind with meters;
// tap a kind to see only that.
// P878: a Results tab (what your spend bought) beside the feed; ?view=results opens it.
export default function Activity() {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'results' ? 'results' : 'feed'
  const viewTabs = <Seg label="View" value={view} onChange={v => setParams(v === 'results' ? { view: 'results' } : {}, { replace: true })} options={[{ key: 'results', label: 'Results' }, { key: 'feed', label: 'Activity' }]} />
  if (view === 'results') return <div className="tp-page fx-page"><div className="fx-tools">{viewTabs}</div><Results /></div>
  return <Feed tabs={viewTabs} />
}

function Feed({ tabs }) {
  const { data: items } = useSampleActivity()
  const { data: clients } = useSampleClients()
  const [range, setRange] = useState('week')
  const [kind, setKind] = useState(null)
  const inRange = range === 'today' ? items.filter(a => a.at.startsWith('Today')) : items
  const rows = kind ? inRange.filter(a => a.kind === kind) : inRange
  const idOf = who => clients.find(c => `${c.client_first_name} ${c.client_last_name}` === who)?.id
  const groups = [...new Set(rows.map(a => dayOf(a.at)))]
  const most = Math.max(1, ...Object.keys(KINDS).map(k => inRange.filter(a => a.kind === k).length))
  let n = 0
  return (
    <div className="tp-page fx-page">
      <div className="fx-tools">{tabs}</div>
      <div className="fx-tools">
        <Seg label="Range" value={range} onChange={setRange} options={[{ key: 'today', label: 'Today' }, { key: 'week', label: 'This week' }, { key: 'all', label: 'All' }]} />
        <span className="tp-grow" />
        <p className="tp-sub">Mon, Nov 2 to Thu, Nov 5 · latest 2:06 PM</p>
      </div>
      <div className="fx-grid">
        <section className="fx-tile fx-s8 fx-feed" style={{ '--i': 0 }} aria-label="Activity">
          {groups.map(g => (
            <div key={g} className="fx-feed-g">
              <h2 className="fx-feed-day">{g}</h2>
              <ol className="fx-feed-l">
                {rows.filter(a => dayOf(a.at) === g).map(a => {
                  const [, Icon, tone] = KINDS[a.kind]
                  const to = idOf(a.who) ? paths.client(idOf(a.who)) : null
                  const body = <><span className={`fx-feed-ic is-${tone}`}><Icon size={15} /></span><span className="tp-grow"><b>{a.who}</b><small>{a.text}</small></span><time>{a.at.replace(/^(Today|Yesterday), /, '')}</time></>
                  n += 1
                  return <li key={a.id} style={{ '--i': n }}>{to ? <Link to={to} className="fx-feed-r">{body}</Link> : <div className="fx-feed-r">{body}</div>}</li>
                })}
              </ol>
            </div>
          ))}
          {rows.length === 0 && <Empty title="Nothing yet" sub="New activity shows up here." />}
        </section>
        <aside className="fx-tile fx-s4 fx-kinds" style={{ '--i': 1 }} aria-label="By kind">
          <header className="fx-tile-h"><span className="tp-grow"><h2>By kind</h2><p>{kind ? 'One kind shown. Tap it again for all.' : 'Tap one to see only that.'}</p></span></header>
          <b className="tp-num fx-huge2"><CountUp value={inRange.length} /><small> things happened</small></b>
          <ul className="fx-kind-l">
            {Object.entries(KINDS).map(([k, [label, Icon, tone]], i) => {
              const c = inRange.filter(a => a.kind === k).length
              return (
                <li key={k}><button type="button" className={`fx-kind${kind === k ? ' is-on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
                  <span className={`fx-feed-ic is-${tone}`}><Icon size={15} /></span><b className="tp-grow">{label}</b><span className="tp-num">{c}</span>
                  <span className={`fx-meter is-${tone}`} aria-hidden="true"><i style={{ '--w': c / most, '--d': i }} /></span>
                </button></li>
              )
            })}
          </ul>
        </aside>
      </div>
    </div>
  )
}
