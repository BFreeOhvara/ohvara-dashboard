import { Link, useNavigate } from 'react-router-dom'
import { ClipboardCheck, PhoneIncoming, ShieldQuestion, Wallet, Phone, ChevronRight } from 'lucide-react'
import { Avatar } from '../kit'
import { telOf } from '../phoneMask'
import { mp } from './mpaths'

// P908 — small pieces the phone screens share.
const LOOK = {
  outcome: { tone: 'blue', Icon: ClipboardCheck },
  live: { tone: 'blue', Icon: PhoneIncoming },
  check: { tone: 'warn', Icon: ShieldQuestion },
}
// Where a to-do's one button goes on the phone.
const toOf = item => (item.key ? mp.billing() : item.kind === 'check' ? mp.clients() : item.kind === 'client' ? mp.client(item.ref)
  : mp.lead(item.ref, item.trigger === 'outcome' || item.trigger === 'live'))

// Your to-dos: one row each, its one action on the right (a 44 px button). Billing notices ride along (key set).
export function NeedList({ items, onDone, empty = 'Nothing waiting on you. We text you when something comes up.' }) {
  const navigate = useNavigate()
  if (!items.length) return <p className="mx-empty">{empty}</p>
  return (
    <ul className="mx-rows">
      {items.map(item => {
        const look = item.key ? { tone: 'warn', Icon: Wallet } : LOOK[item.trigger] || LOOK.outcome
        return (
          <li key={item.id || item.key} className={`mx-row is-${look.tone}`}>
            <span className="mx-row-ic"><look.Icon size={18} aria-hidden="true" /></span>
            <span className="tp-grow"><b>{item.key ? item.title : item.name}</b><small>{item.key ? item.what : `${item.title} · ${item.what}`}</small></span>
            <button type="button" className="mx-btn is-sm is-primary" onClick={() => { onDone?.(); navigate(toOf(item)) }}>{item.key ? item.name : item.action}</button>
          </li>
        )
      })}
    </ul>
  )
}

// A tap-to-call button, 44 px round. Agents call from their own phone.
export const CallBtn = ({ phone, label = 'Call', big = false }) => (phone
  ? <a href={telOf(phone)} className={big ? 'mx-btn is-primary is-wide' : 'mx-call'} aria-label={`${label} ${phone}`} onClick={e => e.stopPropagation()}><Phone size={big ? 18 : 19} aria-hidden="true" />{big && label}</a>
  : null)

// A section title with an optional link on the right.
export const Sec = ({ title, to, link, children, className = '' }) => (
  <section className={`mx-sec ${className}`}>
    <header className="mx-sec-h"><h2>{title}</h2>{to && <Link to={to} className="mx-sec-link">{link}<ChevronRight size={16} aria-hidden="true" /></Link>}</header>
    {children}
  </section>
)

// A person row that opens their sheet: avatar in their colour, name, one line, and something on the right.
export function PersonRow({ to, name, tone, sub, right, children }) {
  return (
    <li className={`mx-person is-${tone}`}>
      <Link to={to} className="mx-cover" aria-label={`Open ${name}`} />
      <Avatar name={name} tone={tone} />
      <span className="tp-grow"><b>{name}</b>{sub && <small>{sub}</small>}{children}</span>
      {right}
    </li>
  )
}
