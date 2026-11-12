import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { CalendarCheck, PhoneIncoming, FileCheck, CreditCard, ShieldAlert, MessageCircle, ShieldCheck, ArrowRightLeft, BadgeCheck, CircleAlert, BellOff, CheckCheck, FileX, Banknote, LifeBuoy } from 'lucide-react'
import { useSampleActivity } from '../data'
import { SubPage, rise } from './AppKit'
import { NOTE_KIND, kindOfActivity, dayOf, groupByDay } from './appModel'
import { useWho, useGo, useNotifItems, SEEN, READ, byTime } from './useNotes'

// P972 — Notifications and Activity, built out. Every row has a coloured icon for what happened (new booking, live
// call, packet in, payment, client at risk, team message…), a bold title and one line, the time, and a tap that goes
// to the thing: the lead, the client, the chat or Billing. Notifications groups Today / Yesterday / Earlier; Activity
// groups by day. Opening Notifications clears the bell's badge; a row stays bold with a dot until it's tapped or
// "Mark all read". Seen and read live on this device.
const ICON = { booking: CalendarCheck, live: PhoneIncoming, packet: FileCheck, payment: CreditCard, risk: ShieldAlert, message: MessageCircle, protected: ShieldCheck, moved: ArrowRightLeft, sold: BadgeCheck, todo: CircleAlert, cancel: FileX, drafted: Banknote, save: LifeBuoy }
export function NoteIcon({ kind, size = 40 }) {
  const Icon = ICON[kind] || CircleAlert
  return <span className={`ma-nic is-${(NOTE_KIND[kind] || NOTE_KIND.todo).tone}`} style={{ '--s': `${size}px` }} aria-hidden="true"><Icon size={Math.round(size * 0.48)} strokeWidth={2.1} /></span>
}

export function NoteRow({ it, unread, onClick, i = 0 }) {
  return (
    <button type="button" className={`ma-note-row ma-rise${unread ? ' is-new' : ''}`} style={rise(Math.min(i, 8))} onClick={onClick} disabled={!onClick}>
      <NoteIcon kind={it.kind} />
      <span className="ma-grow"><b>{it.title}</b><small>{it.what}</small></span>
      <span className="ma-note-end">{it.time && <small>{it.time}</small>}{unread && <i className="ma-new-dot" aria-label="New" />}</span>
    </button>
  )
}

export function ANotif() {
  const items = useNotifItems()
  const go = useGo()
  const read = useSyncExternalStore(READ.sub, READ.get)
  // Opening clears the badge (everything here is seen); the dots stay until read.
  useEffect(() => { SEEN.add(items.filter(i => i.group === 'today').map(i => i.id)) }, [items])
  const unread = it => !it.old && !read.includes(it.id)
  const left = items.filter(unread).length
  const groups = groupByDay(items)
  const tap = it => { READ.add([it.id]); go(it.to) }
  const markAll = <button type="button" className="ma-textbtn ma-press" onClick={() => READ.add(items.map(i => i.id))} disabled={!left}><CheckCheck size={18} aria-hidden="true" />Mark all read</button>
  return (
    <SubPage className="is-notif" big title="Notifications" line={left ? `${left} new` : 'You’re all caught up'} close="Close notifications" left={markAll}>
      {groups.map(g => (
        <section key={g.key} className="ma-notes">
          <p className="ma-cap is-out">{g.label}</p>
          <div className="ma-glass ma-note-list">
            {g.items.map((it, i) => <NoteRow key={it.id} it={it} i={i} unread={unread(it)} onClick={it.to ? () => tap(it) : null} />)}
          </div>
        </section>
      ))}
      {!items.length && (
        <div className="ma-blank ma-rise">
          <span className="ma-blank-ic" aria-hidden="true"><BellOff size={30} /></span>
          <b>No notifications</b>
          <small>New bookings, live calls and messages from the team show here.</small>
        </div>
      )}
    </SubPage>
  )
}

// Activity: everything that happened, grouped by day, with the same icons; each row opens its lead or client.
export function AActivity() {
  const { data: act } = useSampleActivity()
  const who = useWho()
  const go = useGo()
  const days = useMemo(() => {
    const out = []
    act.forEach(a => {
      const d = dayOf(a.at)
      let g = out.find(x => x.day === d.day)
      if (!g) { g = { day: d.day, items: [] }; out.push(g) }
      g.items.push({ id: a.id, kind: kindOfActivity(a), title: a.who, what: a.text, time: d.time, to: who(a.who) })
    })
    const rank = d => (d === 'Today' ? 0 : d === 'Yesterday' ? 1 : 2)
    out.sort((x, y) => rank(x.day) - rank(y.day))
    out.forEach(g => g.items.sort(byTime))
    return out
  }, [act, who])
  return (
    <SubPage big title="Activity" line="Everything our team did for you">
      {days.map(g => (
        <section key={g.day} className="ma-notes">
          <p className="ma-cap is-out">{g.day}</p>
          <div className="ma-glass ma-note-list">
            {g.items.map((it, i) => <NoteRow key={it.id} it={it} i={i} onClick={it.to ? () => go(it.to) : null} />)}
          </div>
        </section>
      ))}
      {!days.length && (
        <div className="ma-blank ma-rise">
          <span className="ma-blank-ic" aria-hidden="true"><ArrowRightLeft size={30} /></span>
          <b>Nothing yet</b>
          <small>Everything our team does for you shows here.</small>
        </div>
      )}
    </SubPage>
  )
}
