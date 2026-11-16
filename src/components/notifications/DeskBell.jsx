import { useNavigate } from 'react-router-dom'
import {
  CalendarCheck, PhoneIncoming, FileCheck, CreditCard, ShieldAlert, MessageCircle, ShieldCheck, ArrowRightLeft, BadgeCheck,
  CircleAlert, FileX, Banknote, LifeBuoy, BellOff, CheckCheck,
} from 'lucide-react'
import { Drawer } from '../../template/kit'
import { useBell } from '../../hooks/useBell'
import './bell1023.css'

// P1023 — the desktop bell for agent, VA and admin: only notifications (to-dos stay on Home), Today / Yesterday /
// Earlier, each row opening the exact thing and marking itself read; "Mark all read" in the footer.
const ICON = { booking: CalendarCheck, live: PhoneIncoming, packet: FileCheck, payment: CreditCard, risk: ShieldAlert, message: MessageCircle, protected: ShieldCheck, moved: ArrowRightLeft, sold: BadgeCheck, todo: CircleAlert, cancel: FileX, drafted: Banknote, save: LifeBuoy }
const TONE = { booking: 'sky', live: 'apricot', packet: 'butter', payment: 'coral', risk: 'coral', message: 'stone', protected: 'sage', moved: 'butter', sold: 'sage', todo: 'apricot', cancel: 'stone', drafted: 'sage', save: 'butter' }
const GROUPS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['earlier', 'Earlier']]

export function BellIcon({ kind, size = 36 }) {
  const Icon = ICON[kind] || CircleAlert
  return <span className={`nb-ic is-${TONE[kind] || 'apricot'}`} style={{ '--s': `${size}px` }} aria-hidden="true"><Icon size={Math.round(size * 0.48)} strokeWidth={2.1} /></span>
}

export function DeskBell({ role, open, onClose, emptyLine, extra = null }) {
  const { items, unread, markRead } = useBell(role)
  const navigate = useNavigate()
  const pick = it => {
    if (it.unread) markRead([it.id])
    if (it.to) { onClose(); navigate(it.to) }
  }
  const footer = <button type="button" className="tp-btn ov-ghost" onClick={() => markRead(null)} disabled={!unread}><CheckCheck size={16} aria-hidden="true" />Mark all read</button>
  return (
    <Drawer open={open} onClose={onClose} title="Notifications" sub={unread ? `${unread} new` : 'You’re all caught up'} footer={footer}>
      {extra}
      {GROUPS.map(([key, label]) => {
        const rows = items.filter(i => i.group === key)
        if (!rows.length) return null
        return (
          <section key={key} className="nb-group" aria-label={label}>
            <h3 className="nb-h">{label}</h3>
            <ul className="nb-list">
              {rows.map(it => (
                <li key={it.id}>
                  <button type="button" className={`nb-row${it.unread ? ' is-new' : ''}`} onClick={() => pick(it)}>
                    <BellIcon kind={it.kind} />
                    <span className="nb-grow"><b>{it.title}</b>{it.what && <small>{it.what}</small>}</span>
                    <span className="nb-end"><small>{it.time}</small>{it.unread && <i className="nb-dot" aria-label="New" />}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {!items.length && (
        <div className="nb-blank">
          <span className="nb-blank-ic" aria-hidden="true"><BellOff size={26} /></span>
          <b>No notifications</b>
          <small>{emptyLine || 'What needs you shows here.'}</small>
        </div>
      )}
    </Drawer>
  )
}
