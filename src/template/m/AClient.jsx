import { useMemo, useState } from 'react'
import { MessageCircle, Phone, ShieldCheck, ShieldAlert, Wrench, CalendarCheck, Send, Check } from 'lucide-react'
import { useSampleClients, useSampleActivity, useSampleActions, useDataSource } from '../data'
import { useNote } from '../kit'
import { useCheckSettings, todayFor } from '../checkSettings'
import { clientStatusOf, clientStatus, dueCheck, nextCheck, shortDate, ordinal } from '../../lib/clientCheck.js'
import { stagesOf } from '../../lib/clientStages.js'
import { agentOpensSaveCall } from '../ful/data'
import { targetOf } from '../../lib/deedstoneCall'
import { usd } from '../motion'
import { useApp, SubPage, BottomSheet, CallButton, rise } from './AppKit'
import { useAnswer, AppLinkSheet } from './MClients'
import { useThreadList } from './AMessages'
import { threadIdFor } from './threadStore'
import { NoteIcon } from './ANotes'
import { kindOfActivity, last4 } from './appModel'

// P972 — one client, as its own screen (it used to be a sheet). A coloured hero with where they stand (Protected /
// Working / Needs attention), the policy, what our team is doing now in one plain line, a timeline of what happened,
// and "Message the team about {name}", which opens that client's chat. Agents don't work clients: the portal's
// client drawer already has Call (through Deedstone), so it stays as a small button on the hero, nothing more.
const fullName = c => `${c.client_first_name} ${c.client_last_name}`
const TONE = { working: 'sky', needs_attention: 'apricot', protected: 'sage', closed: 'stone' }
const ICON = { protected: ShieldCheck, working: Wrench, needs_attention: ShieldAlert, closed: ShieldAlert }

// What the team is doing now, in one line: the next step if there is one, else the current stage.
function nowLine(c, st, stages, next) {
  if (st === 'closed') return c.track?.closed || 'Closed. Nothing more to do.'
  if (st === 'needs_attention') return 'Waiting on you: is it still on the books?'
  if (c.next_step) return c.next_step
  if (stages.current) return `${stages.current.label}${stages.current.next ? ` · ${stages.current.next}` : ''}`
  if (next) return `Nothing needed. Next check ${shortDate(next.askOn)}`
  return c.note || 'Nothing needed right now.'
}

export function AClient({ id }) {
  const app = useApp()
  const { data: clients } = useSampleClients()
  const { data: act } = useSampleActivity()
  const { markLapsed } = useSampleActions()
  const { threads } = useThreadList()
  const source = useDataSource()
  const settings = useCheckSettings()
  const today = todayFor(source)
  const answer = useAnswer()
  const note = useNote()
  const money = usd(true)
  const [appLink, setAppLink] = useState(false)
  const [lapsing, setLapsing] = useState(false)
  const c = clients.find(x => x.id === id)
  const timeline = useMemo(() => {
    if (!c) return []
    const name = fullName(c).toLowerCase()
    const done = stagesOf(c).steps.filter(s => s.state === 'done').reverse().map(s => ({ id: `st-${s.key}`, kind: s.key === 'first_payment' ? 'payment' : s.key === 'sold' ? 'sold' : 'protected', text: s.label, at: s.at || '' }))
    const logged = act.filter(a => String(a.who).toLowerCase() === name).map(a => ({ id: a.id, kind: kindOfActivity(a), text: a.text, at: a.at }))
    return [...logged, ...done, { id: 'start', kind: 'sold', text: c.added ? 'Added to your book' : 'Became your client', at: c.submitted || '' }]
  }, [c, act])
  if (!c) return <SubPage title="Client"><p className="ma-empty">This client isn’t here any more.</p></SubPage>

  const name = fullName(c)
  const st = clientStatusOf(c, today, settings)
  const { label, sub } = clientStatus(st)
  const tone = TONE[st] || 'sage'
  const Icon = ICON[st] || ShieldCheck
  const stages = stagesOf(c)
  const due = st === 'needs_attention' ? dueCheck(c, today, settings) : null
  const next = st === 'protected' ? nextCheck(c, today, settings) : null
  const closed = st === 'closed'
  const policy = [
    ['Carrier', c.carrier_name || 'Not given yet'],
    ['Type', c.product_name || 'Life insurance'],
    ['Premium', Number(c.monthly_premium) > 0 ? <span className="tp-money" key="p">{money(Number(c.monthly_premium))}<em> a month</em></span> : 'Not given yet'],
    ['Draft day', c.draft_day ? `The ${ordinal(Number(c.draft_day))}` : 'Not given yet'],
    ['Policy', last4(c.policy_number) || 'Number not in yet'],
  ]
  const chat = () => app.openSub('thread', { t: threadIdFor(threads, c) })
  const lapse = () => {
    markLapsed?.(c.id, today)
    agentOpensSaveCall({ who: name, why: 'lapsed', state: c.state, city: c.city })
    note(`${name} marked lapsed. Our team is calling to get it back on`)
    setLapsing(false)
  }
  const foot = <button type="button" className="ma-btn is-solid is-grow is-tall ma-press" onClick={chat}><MessageCircle size={18} aria-hidden="true" />Message the team about {c.client_first_name}</button>

  return (
    <SubPage title={name} line="Client" foot={foot} className="is-client">
      <div className={`ma-hero is-${tone} ma-rise`}>
        <i className="ma-glow" aria-hidden="true" />
        <div className="ma-hero-top">
          <span className="ma-hero-st"><Icon size={16} aria-hidden="true" />{label}</span>
          {!closed && <CallButton phone={c.client_phone} to={targetOf('client', c)} label={`Call ${c.client_first_name}`} className="ma-round is-sm is-onhero"><Phone size={18} aria-hidden="true" /></CallButton>}
        </div>
        <b className="ma-hero-name">{name}</b>
        <small>{[c.city, c.state].filter(Boolean).join(', ') || 'Client'}{c.submitted ? ` · since ${c.submitted}` : ''}</small>
        <p className="ma-hero-sub">{sub}</p>
      </div>

      {due && (
        <div className="ma-glass ma-pad ma-ask ma-rise" style={rise(1)}>
          <b><CalendarCheck size={18} aria-hidden="true" />Still on the books?</b>
          <small>It drafted {shortDate(due.draft)}. One tap and our team takes it from there.</small>
          <div className="ma-two"><button type="button" className="ma-btn is-solid ma-press" onClick={() => answer([c], due.draft)}><Check size={17} aria-hidden="true" />Yes, still on</button><button type="button" className="ma-btn is-soft ma-press" onClick={() => answer([c], due.draft, [c.id])}>No</button></div>
        </div>
      )}

      <p className="ma-cap is-out">What our team is doing</p>
      <div className={`ma-doing is-${tone} ma-rise`} style={rise(2)}>
        <span className="ma-doing-dot" aria-hidden="true" />
        <span className="ma-grow"><b>{nowLine(c, st, stages, next)}</b>{st === 'working' && stages.current && <small>Step {stages.at} of {stages.of} · {stages.label}</small>}</span>
      </div>

      <p className="ma-cap is-out">Policy</p>
      <div className="ma-glass ma-list ma-rise" style={rise(3)}>
        {policy.map(([k, v]) => <div key={k} className="ma-row is-fact"><span className="ma-grow"><small>{k}</small></span><span className="ma-val">{v}</span></div>)}
      </div>

      <p className="ma-cap is-out">What happened</p>
      <div className="ma-glass ma-pad is-tight ma-rise" style={rise(4)}>
        <ol className="ma-ctl">
          {timeline.map(e => (
            <li key={e.id}><NoteIcon kind={e.kind} size={30} /><span className="ma-grow"><b>{e.text}</b>{e.at && <small>{e.at}</small>}</span></li>
          ))}
        </ol>
      </div>

      {!closed && (
        <div className="ma-glass ma-list ma-rise" style={rise(5)}>
          <button type="button" className="ma-row" onClick={() => setAppLink(true)}><span className="ma-sym is-sky"><Send size={16} aria-hidden="true" /></span><span className="ma-grow"><b>Send {c.client_first_name} their app link</b><small>Their policy, and changes that go straight to our team</small></span></button>
          {!c.fixing && !due && <button type="button" className="ma-row" onClick={() => setLapsing(true)}><span className="ma-sym is-coral"><ShieldAlert size={16} aria-hidden="true" /></span><span className="ma-grow"><b>Mark lapsed</b><small>Our team calls to get it back on</small></span></button>}
        </div>
      )}

      <AppLinkSheet c={c} open={appLink} onClose={() => setAppLink(false)} />
      <BottomSheet open={lapsing} onClose={() => setLapsing(false)} label="Mark lapsed?">
        <p className="ma-sheet-t">Mark lapsed?</p>
        <p className="ma-sheet-s">{name} moves to Working and our team calls to get it back on.</p>
        <div className="ma-two"><button type="button" className="ma-btn is-soft ma-press" onClick={() => setLapsing(false)}>Cancel</button><button type="button" className="ma-btn is-solid ma-press" onClick={lapse}><ShieldAlert size={17} aria-hidden="true" />Yes, it lapsed</button></div>
      </BottomSheet>
    </SubPage>
  )
}
