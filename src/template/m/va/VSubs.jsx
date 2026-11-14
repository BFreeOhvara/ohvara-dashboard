import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, MessageCircle, Phone, CheckCheck, Check, Minus, ShieldCheck, Archive, CalendarClock, TriangleAlert, LayoutGrid, PhoneCall, LifeBuoy, ChevronRight, Users } from 'lucide-react'
import { useFulFeed, useFulClients, useFulSchedule, useFulTasks, useFulClock } from '../../ful/data'
import { clientStatusOf, clientStatus, requestTag } from '../../../lib/clientCheck.js'
import { stagesOf } from '../../../lib/clientStages.js'
import { KIND } from '../../ful/words'
import { whyShort } from '../../ful/callSteps'
import { useApp, SubPage, Ini, rise } from '../AppKit'
import { useNoAutoKeyboard } from '../useKeyboard'
import { NoteRow } from '../ANotes'
import { useVaCall, FEED_SEEN } from './vaStore'
import { useVaChat } from './useVaChat'
import { useVaNow, dayOfItem } from './useVaNow'
import { stateOf, STATE_TONE, STATE_TAG, forLine } from './vaModel'
import { dayWords, CLIENT_TONE } from '../appModel'

// P975 — the small screens: Notifications (from the left, like the agent app), search, and a client.
// P1002 — Search covers clients, booked calls, client steps and pages (the desktop palette); a client shows the whole
// desktop client: status, the help alert, steps, policy with product and premium, the note, the calls with you, and a
// Message button that is always there.
const KIND_OF = { call: 'live', servicing: 'protected', shift: 'booking', message: 'message' }

export function VNotif() {
  const { data: feed } = useFulFeed()
  const [read, setRead] = useState(() => FEED_SEEN.get())
  useEffect(() => { FEED_SEEN.add(feed.map(f => f.id)) }, [feed])
  const left = feed.filter(f => !read.includes(f.id)).length
  const markAll = <button type="button" className="ma-textbtn ma-press" onClick={() => setRead(feed.map(f => f.id))} disabled={!left}><CheckCheck size={18} aria-hidden="true" />Mark all read</button>
  return (
    <SubPage title="Notifications" line={left ? `${left} new` : 'All caught up'} close="Close notifications" className="is-notif" left={markAll} arrowRight big>
      {feed.map((f, i) => (
        <NoteRow key={f.id} i={i} unread={!read.includes(f.id)} it={{ kind: KIND_OF[f.kind] || 'todo', title: f.who, what: f.text, time: f.at }} onClick={() => setRead(r => [...new Set([...r, f.id])])} />
      ))}
      {!feed.length && <p className="ma-empty is-glass">Nothing new. Bookings, messages and shift news show here.</p>}
    </SubPage>
  )
}

const digits = s => String(s || '').replace(/\D/g, '')

// The pages a search can open, by their phone address.
const PAGES = [
  { label: 'Today', go: app => app.goTab('today') },
  { label: 'Calendar', go: app => app.goTab('calendar') },
  { label: 'Clients', go: app => app.openSub('clients') },
  { label: 'Schedule', go: app => app.goTab('rota') },
  { label: 'Pay', go: app => app.openSub('pay') },
  { label: 'Training', go: app => app.openSub('training') },
  { label: 'Messages', go: app => app.goTab('messages') },
  { label: 'Settings', go: app => app.openSub('settings') },
]

export function VSearch() {
  const app = useApp()
  const vc = useVaCall()
  const { data: clients } = useFulClients()
  const { data: all } = useFulSchedule()
  const { data: tasks } = useFulTasks()
  const [q, setQ] = useState('')
  const input = useRef(null)
  useNoAutoKeyboard(input) // P982: no focus on open; the keyboard only comes up when they tap the field
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase()
    const d = digits(t)
    const has = (hay, phone) => !t || hay.toLowerCase().includes(t) || (d.length >= 3 && digits(phone).includes(d))
    const cut = (rows, few, many) => rows.slice(0, t ? many : few)
    const cl = clients.filter(c => has(`${c.name} ${c.client_phone} ${c.agent} ${c.policy_number}`, c.client_phone))
      .map(c => ({ id: `c-${c.id}`, name: c.name, sub: `${c.agent}’s client · ${c.carrier_name || c.client_phone || ''}`, go: () => app.openSub('client', { c: c.id }) }))
    const calls = all.filter(i => !i.done && has(`${i.name} ${whyShort(i)} ${i.agent} ${i.time}`, i.row?.client?.client_phone))
      .map(i => ({ id: `k-${i.ref}`, name: i.name, sub: `Booked call · ${i.time} · ${forLine(whyShort(i), i.agent)}`, Icon: PhoneCall, go: () => vc.openBrief(i) }))
    const steps = tasks.filter(x => x.due !== 'done' && !x.iso && has(`${x.name} ${String(x.kind || '').replace(/_/g, ' ')} ${KIND[x.kind] || ''}`, x.client?.client_phone))
      .map(x => ({ id: `t-${x.id}`, name: x.name, sub: `Client step · ${KIND[x.kind] || 'Step'}${x.due_text ? ` · ${x.due_text}` : ''}`, Icon: LifeBuoy, go: () => (x.client_id ? app.openSub('client', { c: x.client_id }) : app.goTab('calendar')) }))
    const pages = PAGES.filter(p => has(p.label, '')).map(p => ({ id: `g-${p.label}`, name: p.label, sub: 'Page', Icon: LayoutGrid, go: () => p.go(app) }))
    return [['Clients', cut(cl, 8, 20)], ['Calls and steps', cut([...calls, ...steps], 3, 10)], ['Pages', cut(pages, 6, 6)]].filter(([, rows]) => rows.length)
  }, [clients, all, tasks, q, app, vc])
  return (
    <SubPage title="Search" line="Clients, calls, steps and pages" big>
      <label className="va-find ma-rise"><Search size={18} aria-hidden="true" /><input ref={input} type="search" inputMode="search" placeholder="Name, phone, policy or page" aria-label="Search clients, booked calls, pages" value={q} onChange={e => setQ(e.target.value)} /></label>
      {groups.map(([label, rows], g) => (
        <section key={label} aria-label={label}>
          <p className="ma-cap is-out">{label}</p>
          <div className="ma-glass ma-list ma-rise" style={rise(1 + g)}>
            {rows.map(r => (
              <button key={r.id} type="button" className="ma-row" onClick={r.go}>
                {r.Icon ? <span className="ma-sym is-sky" aria-hidden="true"><r.Icon size={16} /></span> : <Ini name={r.name} tone="sky" size={40} />}
                <span className="ma-grow"><b>{r.name}</b><small>{r.sub}</small></span>
                <ChevronRight size={18} className="ma-chev" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      ))}
      {!groups.length && <p className="ma-empty is-glass">No match for “{q.trim()}”. Try a last name, phone or policy number.</p>}
      <button type="button" className="ma-pillbtn ma-press" onClick={() => app.openSub('clients')}><Users size={17} aria-hidden="true" />All clients</button>
    </SubPage>
  )
}

const money = n => `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`

// The client's steps (the desktop's StageChecklist, read-only: a VA moves a step from the call itself).
function Steps({ c }) {
  const s = stagesOf(c)
  return (
    <ol className="va-steps" aria-label={`${s.label}: ${s.closed ? 'closed' : s.complete ? 'done' : `stage ${s.at} of ${s.of}`}`}>
      {s.steps.map((st, i) => (
        <li key={st.key} className={`va-step is-${st.state}`} aria-current={st.state === 'current' ? 'step' : undefined}>
          <span className="va-step-dot" aria-hidden="true">{st.state === 'done' ? <Check size={14} strokeWidth={2.6} /> : st.state === 'skipped' ? <Minus size={14} /> : i + 1}</span>
          <span className="ma-grow"><b>{st.label}</b>
            <small>
              {st.state === 'done' && (st.at ? `Done ${st.at}` : 'Done')}
              {st.state === 'current' && (st.next ? `Booked ${st.next}` : 'Now')}
              {st.state === 'upcoming' && (st.sub || 'Up next')}
              {st.state === 'skipped' && 'Not needed (n/a)'}
            </small>
          </span>
          {st.state === 'current' && <em className="va-tag">Now</em>}
        </li>
      ))}
      <li className={`va-step va-step-end is-${s.closed ? 'closed' : s.complete ? 'done' : 'upcoming'}`}>
        <span className="va-step-dot" aria-hidden="true">{s.closed ? <Archive size={14} /> : <ShieldCheck size={14} />}</span>
        <span className="ma-grow"><b>{s.closed ? 'Closed' : 'Protected'}</b><small>{s.closed || (s.complete ? 'Back in the green' : 'When every step is done')}</small></span>
      </li>
    </ol>
  )
}

export function VClient({ id }) {
  const vc = useVaCall()
  const chat = useVaChat()
  const { data: clients } = useFulClients()
  const { data: all } = useFulSchedule()
  const { today, isoOf } = useFulClock()
  const { nowMs, tz, todayIso } = useVaNow()
  const c = clients.find(x => x.id === id)
  if (!c) return <SubPage title="Client"><p className="ma-empty">This client isn’t here any more.</p></SubPage>
  const calls = all.filter(i => (i.row?.client_id || i.row?.client?.id) === c.id)
  const st = clientStatusOf(c, isoOf(today))
  const { label, sub } = clientStatus(st)
  const tone = CLIENT_TONE[st] || 'sage'
  const stage = stagesOf(c)
  const tag = requestTag(c)
  // The Message button is always here (the desktop's client Message): it opens the chat about this client, or starts one.
  // P986: Call is one of the few places the phone opens (with Start call, the brief and the hold line).
  const foot = (
    <div className="ma-two va-clientfoot">
      <button type="button" className="ma-btn is-soft is-tall ma-press" onClick={() => chat.message(c.id)}><MessageCircle size={18} aria-hidden="true" />Message {c.agent.split(' ')[0]}</button>
      <button type="button" className="ma-btn is-solid is-tall ma-press" onClick={() => vc.callClient(c)}><Phone size={18} aria-hidden="true" />Call</button>
    </div>
  )
  return (
    <SubPage title={c.name} line={`${c.agent}’s client${c.submitted ? ` · since ${c.submitted}` : ''}`} foot={foot} big>
      <div className={`va-chead is-${tone} ma-rise`}>
        <span className="ma-grow"><b>{label}</b><small>{tag || sub}</small></span>
        <em className="va-tag">{label}</em>
      </div>
      {c.attention && (
        <div className="va-alert is-apricot ma-rise" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <span><b>{c.attention}</b><small>{c.agent} asked for help.{c.next_step ? ` It is booked as ${c.next_step.toLowerCase()}.` : ''}</small></span>
        </div>
      )}
      {(st === 'working' || c.track?.closed) && (
        <>
          <p className="ma-cap is-out">{stage.label}<span className="va-stagecount">{stage.closed ? 'Closed' : stage.complete ? 'Done' : `Stage ${stage.at} of ${stage.of}`}</span></p>
          <div className="ma-glass ma-pad ma-rise"><Steps c={c} /></div>
        </>
      )}
      <p className="ma-cap is-out">Policy</p>
      <div className="ma-glass ma-pad va-facts is-glass ma-rise">
        <span><small>Carrier</small><b>{c.carrier_name || 'Not given'}</b></span>
        <span><small>Product</small><b>{c.product_name || 'Not given'}</b></span>
        <span><small>Policy</small><b>{c.policy_number || 'Not given'}</b></span>
        <span><small>Premium</small><b className="tp-money">{c.monthly_premium ? `${money(c.monthly_premium)} / month` : 'Not given'}</b></span>
        <span><small>Phone</small><b>{c.client_phone || 'Not given'}</b></span>
        <span><small>Lives in</small><b>{[c.city, c.state].filter(Boolean).join(', ') || 'Not given'}</b></span>
        <span><small>Agent</small><b>{c.agent}</b></span>
        {c.note && <span className="is-wide"><small>Note</small><b>{c.note}</b></span>}
      </div>
      <p className="ma-cap is-out">Calls with you</p>
      <div className="ma-coming ma-rise" style={rise(1)}>
        {calls.map(i => {
          const cs = stateOf(i, nowMs)
          return (
            <button key={i.ref} type="button" className={`ma-up is-${STATE_TONE[cs]} ma-press`} onClick={() => (cs === 'open' ? vc.needResult(i) : vc.openBrief(i))}>
              <span className="ma-up-when"><b>{dayWords(dayOfItem(i, tz), todayIso).replace(/^\w+, /, '')}</b><small>{i.time}</small></span>
              <span className="ma-grow"><b>{whyShort(i)}</b><small>{forLine(STATE_TAG[cs], i.agent)}</small></span>
              <Phone size={16} aria-hidden="true" />
            </button>
          )
        })}
        {!calls.length && <p className="ma-empty is-glass">No calls booked with {c.name.split(' ')[0]}.</p>}
      </div>
      <p className="ma-note"><CalendarClock size={12} aria-hidden="true" /> The client never sees your messages with {c.agent.split(' ')[0]}.</p>
    </SubPage>
  )
}
