import { useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Inbox, Phone, MessageSquare, Users, ArrowRightLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { useSampleActivity, useSampleClients } from '../data'
import { Empty } from '../kit'
import { CountUp } from '../motion'
import { paths } from '../paths'
import { clockNow, dayLabel } from '../leadLifecycle'
import '../p893.css'

const KINDS = { lead: ['Leads', Inbox, 'blue'], call: ['Calls', Phone, 'warn'], text: ['Texts', MessageSquare, 'teal'], client: ['Clients', Users, 'green'], moved: ['Moves', ArrowRightLeft, 'mute'] }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const BACK_DAYS = 30 // the feed holds the last 30 days

const isoDay = D => D.toISOString().slice(0, 10)
const addDays = (iso, n) => isoDay(new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000))
// The day an activity row's label points at ("Today, 2:06 PM", "Yesterday, …", "Fri, Oct 30, 9:12 AM"), as YYYY-MM-DD.
function dayKey(at, today) {
  if (at.startsWith('Today')) return today
  if (at.startsWith('Yesterday')) return addDays(today, -1)
  if (at.startsWith('Tomorrow')) return addDays(today, 1)
  const m = at.match(/^[A-Za-z]{3}, ([A-Za-z]{3}) (\d{1,2})/)
  if (!m) return today
  const mon = MON.indexOf(m[1])
  let year = Number(today.slice(0, 4))
  if (mon > Number(today.slice(5, 7)) - 1) year -= 1 // a later month than now is last year
  return isoDay(new Date(Date.UTC(year, mon, Number(m[2]), 12)))
}
const timeOf = at => at.match(/\d{1,2}:\d{2} [AP]M$/)?.[0] || ''
const minutes = t => { const m = t.match(/(\d+):(\d+) ([AP])M/); return m ? ((Number(m[1]) % 12) + (m[3] === 'P' ? 12 : 0)) * 60 + Number(m[2]) : -1 }

// P893: one box, one day at a time, newest first, scrolling inside itself; a day switcher steps through the days
// (◀ day ▶, plus Today). The side tile counts that day by kind; tap a kind to see only that.
// P910: both boxes the same height, filling the page to the bottom of the window (data-fold-fit); the day box keeps
// its full size with a few rows (blank space below) and scrolls inside with many.
// Results moved to Billing; the old ?view=results address goes there.
export default function Activity() {
  const [params] = useSearchParams()
  if (params.get('view') === 'results') return <Navigate to={`${paths.billing()}#results`} replace />
  return <Feed />
}

function Feed() {
  const { data: items } = useSampleActivity()
  const { data: clients } = useSampleClients()
  const today = clockNow().slice(0, 10)
  const [day, setDay] = useState(today)
  const [kind, setKind] = useState(null)
  const keyed = useMemo(() => items.map(a => ({ ...a, day: dayKey(a.at, today), time: timeOf(a.at) })), [items, today])
  const onDay = keyed.filter(a => a.day === day).sort((a, b) => minutes(b.time) - minutes(a.time))
  const rows = kind ? onDay.filter(a => a.kind === kind) : onDay
  const idOf = who => clients.find(c => `${c.client_first_name} ${c.client_last_name}` === who)?.id
  const most = Math.max(1, ...Object.keys(KINDS).map(k => onDay.filter(a => a.kind === k).length))
  const first = addDays(today, -BACK_DAYS)
  const word = day === today ? 'Today' : day === addDays(today, -1) ? 'Yesterday' : null
  const go = n => { setDay(d => addDays(d, n)); setKind(null) }
  return (
    <div className="tp-page fx-page">
      <div className="fx-grid fx-actgrid" data-fold data-fold-fit="420">
        <section className="fx-tile fx-s8 fx-act-day" style={{ '--i': 0 }} aria-label="Activity">
          <header>
            <button type="button" className="fx-act-nav" aria-label="Day before" disabled={day <= first} onClick={() => go(-1)}><ChevronLeft size={16} /></button>
            <span className="tp-grow"><h2 aria-live="polite">{dayLabel(`${day}T12:00`)}</h2>{word && <small>{word}</small>}</span>
            <button type="button" className="fx-act-today" disabled={day === today} onClick={() => { setDay(today); setKind(null) }}>Today</button>
            <button type="button" className="fx-act-nav" aria-label="Day after" disabled={day >= today} onClick={() => go(1)}><ChevronRight size={16} /></button>
          </header>
          <div className="fx-act-body">
            <ol className="fx-feed-l" key={day}>
              {rows.map((a, n) => {
                const [, Icon, tone] = KINDS[a.kind] || KINDS.moved
                const to = idOf(a.who) ? paths.client(idOf(a.who)) : null
                const body = <><span className={`fx-feed-ic is-${tone}`}><Icon size={15} /></span><span className="tp-grow"><b>{a.who}</b><small>{a.text}</small></span><time>{a.time}</time></>
                return <li key={a.id} style={{ '--i': n + 1 }}>{to ? <Link to={to} className="fx-feed-r">{body}</Link> : <div className="fx-feed-r">{body}</div>}</li>
              })}
            </ol>
            {rows.length === 0 && <Empty title={kind ? 'None of that kind' : 'Nothing this day'} sub={kind ? 'Tap the kind again to see everything.' : 'Step back a day to see more.'} />}
          </div>
        </section>
        <aside className="fx-tile fx-s4 fx-kinds" style={{ '--i': 1 }} aria-label="By kind">
          <header className="fx-tile-h"><span className="tp-grow"><h2>By kind</h2><p>{kind ? 'One kind shown. Tap it again for all.' : 'Tap one to see only that.'}</p></span></header>
          <b className="tp-num fx-huge2"><CountUp value={onDay.length} /><small> things happened</small></b>
          <ul className="fx-kind-l">
            {Object.entries(KINDS).map(([k, [label, Icon, tone]], i) => {
              const c = onDay.filter(a => a.kind === k).length
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
