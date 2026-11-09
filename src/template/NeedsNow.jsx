import { Link } from 'react-router-dom'
import './leads873.css'
import { PhoneIncoming, ClipboardCheck, ShieldQuestion, Wallet, Info, FileSignature } from 'lucide-react'
import { Avatar } from './kit'
import { paths } from './paths'

// P910 — Your to-dos (leadLifecycle.js TRIGGERS): only real agent jobs, calls to mark and the monthly "Still on the
// books?" check, each with its one action. The Overview shows them as cards, the bell as rows. FYI items sit apart and
// quiet: the team is already on them. Billing notices (a declined card) sit apart too: Fix card.
const TRIGGER_LOOK = {
  outcome: { tone: 'blue', Icon: ClipboardCheck },
  live: { tone: 'blue', Icon: PhoneIncoming },
  submit: { tone: 'green', Icon: FileSignature },
  check: { tone: 'warn', Icon: ShieldQuestion },
  billing: { tone: 'warn', Icon: Wallet },
}

const toOf = item => (item.kind === 'billing' ? paths.billing() : item.kind === 'check' ? paths.clients('needs_attention') : item.kind === 'client' ? paths.client(item.ref) : item.kind === 'submit' ? paths.submit(item.ref) : paths.lead(item.ref))

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

// Billing notices (a declined card, no card on file): one row each with its fix, never a to-do.
export function NoticeRows({ items, onPick }) {
  if (!items?.length) return null
  return (
    <ul className="tp-list lc-rows" aria-label="Billing">
      {items.map(b => (
        <li key={b.key} className="tp-li lc-row is-warn" data-notice={b.key}>
          <span className="tp-av" aria-hidden="true"><Wallet size={14} /></span>
          <span className="tp-grow"><b>{b.title}</b><small>{b.what}</small></span>
          <Link to={paths.billing()} className="tp-primary sm fx-accent" onClick={onPick}>{b.name}</Link>
        </li>
      ))}
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
