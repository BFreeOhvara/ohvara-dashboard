import { Link } from 'react-router-dom'
import './leads873.css'
import { PhoneIncoming, PhoneCall, ClipboardCheck, MessageSquareReply, CalendarClock, TriangleAlert, Info } from 'lucide-react'
import { Avatar } from './kit'
import { paths } from './paths'

// P873 — Needs you now: the six triggers (leadLifecycle.js TRIGGERS), most urgent first, each with its one action.
// The Overview shows them as cards, the bell as rows. FYI items sit apart and quiet: the team is already on them.
const TRIGGER_LOOK = {
  live: { tone: 'warn', Icon: PhoneIncoming },
  starting: { tone: 'blue', Icon: PhoneCall },
  outcome: { tone: 'violet', Icon: ClipboardCheck },
  reply: { tone: 'teal', Icon: MessageSquareReply },
  follow: { tone: 'teal', Icon: CalendarClock },
  servicing: { tone: 'green', Icon: TriangleAlert },
}

const toOf = item => (item.kind === 'client' ? paths.client(item.ref) : paths.lead(item.ref))

export function NeedCard({ item, i, onAct }) {
  const { tone, Icon } = TRIGGER_LOOK[item.trigger]
  return (
    <article className={`fx-card fx-ncard lc-ncard is-${tone}`} style={{ '--i': i }} data-trigger={item.trigger}>
      <Link to={toOf(item)} className="fx-cover" aria-label={`Open ${item.name}`} />
      <span className="fx-ncard-k"><Icon size={13} aria-hidden="true" />{item.title}</span>
      <h3>{item.name}</h3>
      <p>{item.what}</p>
      <div className="fx-ncard-bot"><span className="fx-when">{item.when}</span><button type="button" className="tp-primary sm fx-accent fx-over" onClick={() => onAct(item)}>{item.action}</button></div>
    </article>
  )
}

export function NeedRows({ items, onAct }) {
  return (
    <ul className="tp-list lc-rows">
      {items.map(item => {
        const { tone, Icon } = TRIGGER_LOOK[item.trigger]
        return (
          <li key={item.id} className={`tp-li lc-row is-${tone}`} data-trigger={item.trigger}>
            <Avatar name={item.name} tone={tone} />
            <span className="tp-grow"><b>{item.name}</b><small><Icon size={12} aria-hidden="true" />{item.title} · {item.what}</small></span>
            <button type="button" className="tp-primary sm fx-accent" onClick={() => onAct(item)}>{item.action}</button>
          </li>
        )
      })}
    </ul>
  )
}

export function FyiList({ items, onPick }) {
  if (!items.length) return null
  return (
    <div className="lc-fyi" aria-label="For your info">
      <h3><Info size={13} aria-hidden="true" />For your info</h3>
      <ul>
        {items.map(f => <li key={f.id}><Link to={paths.lead(f.ref)} onClick={onPick}><b>{f.name}</b><span>{f.title}. {f.what}</span></Link></li>)}
      </ul>
    </div>
  )
}
