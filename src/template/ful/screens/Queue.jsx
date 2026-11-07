import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Search, Phone, Clock, PhoneIncoming, Hourglass, MapPin, CalendarCheck, CalendarClock, Hand, Undo2, PhoneMissed, Check } from 'lucide-react'
import { useFulQueue, useFulActions, useVaBooking, NOW_ISO, TODAY, dayName } from '../data'
import { Avatar, Chip, Drawer, Empty, Field, PillTabs, Seg, useNote } from '../../kit'
import { SlotPick } from '../../SlotPick'
import { useClientZone } from '../../useClientZone'
import { BOOK_DAYS, isoOf } from '../../carriers'
import { vaSlots, clocksBetween, zoneAbbr } from '../../../lib/callSlots'
import { RecordDrawer, Block } from '../../Record'
import { BookForAgent } from '../FulFrame'
import { Select } from '../../Select'
import { CarrierSelect } from '../../CarrierSelect'
import { StateSelect } from '../../StateSelect'
import { fp } from '../paths'
import { BUCKETS, QUESTION_TYPES, URGENCIES, checklistDone } from '../words'
import { HelpDot } from '../../../fulshell/training/HelpDot'
import { flagsOf } from '../p879'
import { LeadFlags, HowWeGotYou, CheckAgent, Script, Outcome, BestNumberNotes, Recuse, CallTasksStrip } from '../LeadDesk879'

// P845 — the Queue, built like the agent's Leads board: one lane per bucket (callbacks due first, then new, then not
// reached), cards filled with the lane colour. A card opens the person in a drawer at its own URL. In the drawer the
// VA takes them (a 15 minute hold), fills the four questions, then books an agent, sets a callback or marks not
// reached. Sample only: nothing is dialled or booked for real.
const toneOf = b => BUCKETS.find(x => x.key === b)?.tone || 'blue'
const ICON = { callback_due: Clock, new: PhoneIncoming, not_reached: Hourglass }

function LeadCard({ l, i }) {
  const tone = toneOf(l.bucket)
  const Icon = ICON[l.bucket]
  const when = l.bucket === 'callback_due' ? l.callback.replace('Today, ', 'Call ') : l.came.replace('Today, ', '')
  return (
    <article className={`fx-card fx-lcard is-${tone}`} style={{ '--i': i }}>
      <Link to={fp('queue', l.id)} className="fx-cover" aria-label={`Open ${l.name}`} />
      <div className="fx-lcard-top"><span className="fx-kind"><Icon size={13} aria-hidden="true" />{l.type}</span>{l.held_until && <span className="fx-tag">Yours</span>}</div>
      <h3>{l.name}</h3>
      <p>{l.city}, {l.state}{l.tries ? ` · ${l.tries} ${l.tries === 1 ? 'try' : 'tries'}` : ''}</p>
      <div className="fx-lcard-bot"><span className="fx-big">{when}</span><Avatar name={l.name} tone={tone} /></div>
    </article>
  )
}

function useLeft(until) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [until])
  if (!until) return null
  const s = Math.max(0, Math.round((until - now) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// P854: a callback is picked on the person's clock (8 AM to 8 PM there), inside a VA shift, and never under 30 minutes
// from another call of whoever takes it (lib/callSlots vaSlots; you first).
const CB_CLOCKS = clocksBetween(8 * 60, 20 * 60)

export function LeadDrawer({ id, onClose }) {
  const { data: queue } = useFulQueue()
  const { holdLead, releaseLead, setChecklist, notReached, callback, closeLead, showLive } = useFulActions()
  const note = useNote()
  const l = queue.find(x => x.id === id)
  const [panel, setPanel] = useState(null)
  const [cbDay, setCbDay] = useState(TODAY)
  const [cbTime, setCbTime] = useState('')
  const book = useVaBooking()
  const zone = useClientZone(l?.checklist?.state || l?.state, l?.city)
  const cbSlots = vaSlots({ date: isoOf(cbDay), clocks: CB_CLOCKS, clientTz: zone.tz, team: book.team, calls: book.calls, load: book.load, prefer: book.me, exceptId: l?.id })
  const cbPick = cbSlots.find(x => x.clock === cbTime && x.open && x.iso >= NOW_ISO)
  const left = useLeft(l?.held_until)
  if (!l) return <RecordDrawer label="Not in the queue" kicker="Queue" onClose={onClose} hero={<h2>Already handled</h2>}><p className="fx-calm"><Check size={16} aria-hidden="true" />This person was booked or closed out.</p></RecordDrawer>
  const tone = toneOf(l.bucket)
  // The person's state starts filled in (lib/vaQueue startingChecklist does the same).
  const c = { ...l.checklist, state: l.checklist.state || l.state }
  const done = checklistDone(c)
  const held = !!l.held_until
  const put = (k, v) => setChecklist(l.id, { ...c, [k]: v })
  const bucket = BUCKETS.find(b => b.key === l.bucket)
  return (
    <RecordDrawer label={l.name} kicker={<>Queue · came in {l.came} <HelpDot lesson="lead" inline /></>} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><Clock size={13} aria-hidden="true" />{l.bucket === 'callback_due' ? `Call back ${l.callback}` : `Came in ${l.came}`}</span><Chip tone={tone}>{bucket.label}</Chip></div>
        <h2>{l.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{l.city}, {l.state} · {l.type}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big tp-num">{l.phone}</b><Avatar name={l.name} tone={tone} /></div>
      </>}
      actions={held ? <>
        {/* P876: VAs don't dial. This lead is a task the system gave them, so it has a Call button (the phone slides in). */}
        {/* P879 (N-B-42): an opted-out lead gets no outbound call; they called in, so the VA is already talking to them. */}
        {!flagsOf(l).optedOut && <button type="button" className="tp-primary fx-accent" onClick={() => showLive({ kind: 'lead', id: l.id })}><Phone size={16} />Call</button>}
        <button type="button" className="tp-btn ov-ghost" disabled={done < 4} title={done < 4 ? 'Answer the four questions first' : undefined} onClick={() => setPanel('book')}><CalendarCheck size={16} />Book an agent</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('callback')}><CalendarClock size={15} />Call back</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => { notReached(l.id); note(`${l.name} marked not reached`); onClose() }}><PhoneMissed size={15} />Not reached</button>
        <span className="tp-grow" />
        <Recuse l={l} onDone={() => { releaseLead(l.id); onClose() }} />
        <button type="button" className="tp-btn ov-ghost" onClick={() => { releaseLead(l.id); note('Put back in the queue') }}><Undo2 size={15} />Put back</button>
      </> : <>
        <button type="button" className="tp-primary fx-accent" onClick={() => { holdLead(l.id); note(`${l.name} is yours for 15 minutes`) }}><Hand size={16} />Take it</button>
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('close')}>Not interested</button>
      </>}>
      {/* P879: banners for opted-out or closed leads, and the verbal consent line for call-ins. */}
      <LeadFlags l={l} />
      {held && (
        <section className="fx-blk fs-hold">
          <header><h3><Phone size={16} aria-hidden="true" />Yours for {left}</h3></header>
          <p className="tp-mid">Call {l.phone.replace(/^\(\d+\) /, '')} now. If the hold runs out, {l.name.split(' ')[0]} goes back to the queue for someone else.</p>
        </section>
      )}
      <Block title="Before you book" sub="Four answers the agent needs" aside={<span className="fx-count">{done}/4</span>}>
        <div className="fx-meter" role="img" aria-label={`${done} of 4 answered`}><i style={{ '--w': done / 4 }} /></div>
        <div className="fx-form-grid">
          <Field label="Question type"><Select label="Question type" value={c.question_type} disabled={!held} onChange={v => put('question_type', v)} options={QUESTION_TYPES} /></Field>
          <Field label="Their carrier"><CarrierSelect label="Their carrier" value={c.carrier} disabled={!held} placeholder="Who covers them now" onChange={v => put('carrier', v)} by="va" /></Field>
          <Field label="State"><StateSelect value={c.state} disabled={!held} placeholder={l.state || 'Pick a state'} onChange={v => put('state', v)} /></Field>
        </div>
        <div className="tp-field"><span>How soon</span>
          <PillTabs role="radiogroup" label="How soon" className="fx-chips fs-wrap" itemClass="fx-chip" value={c.urgency} onChange={v => held && put('urgency', v)} items={URGENCIES.map(u => ({ key: u, label: <b>{u}</b> }))} />
        </div>
        {!held && <p className="tp-sub">Take them first to answer.</p>}
      </Block>
      {/* P879: from a reached lead straight to Check agent or Book; the script; the outcome; notes for the agent. */}
      <CheckAgent l={l} held={held} onBook={() => setPanel('book')} />
      <Script l={l} />
      <Outcome l={l} held={held} onDone={o => { if (o === 'do_not_call') { closeLead(l.id); onClose() } }} />
      <BestNumberNotes l={l} held={held} />
      <HowWeGotYou l={l} />
      <Block title="What we know">
        <dl className="fx-facts">{[['Phone', l.phone], ['Came in', l.came], ['Tries', String(l.tries)], ['Looking for', l.type]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        {l.note && <p className="tp-sub">{l.note}</p>}
      </Block>

      <BookForAgent open={panel === 'book'} leadId={l.id} onClose={() => { setPanel(null); if (!queue.some(x => x.id === l.id)) onClose() }} />
      <Drawer open={panel === 'callback'} center onClose={() => setPanel(null)} title="Call back" sub={`${l.name} · their time`}
        footer={<button type="button" className="tp-primary fx-accent" disabled={!cbPick} onClick={() => {
          const when = `${cbDay === TODAY ? 'Today' : `${dayName(cbDay)}, Nov ${cbDay}`}, ${cbTime} ${zoneAbbr(zone.tz, cbPick.iso)}`
          callback(l.id, when, cbPick.iso, zone.tz, cbPick.va.id)
          note(`Callback set for ${when}${cbPick.va.id === book.me ? '' : `. ${cbPick.va.name} has it`}`)
          setPanel(null); onClose()
        }}><CalendarClock size={16} />Set callback</button>}>
        <SlotPick days={BOOK_DAYS} day={cbDay} onDay={setCbDay} slots={cbSlots} value={cbTime} onPick={setCbTime} zone={zone} place={`${l.city}, ${c.state}`}
          viewerTz={book.viewerTz} mine={book.me} notBefore={NOW_ISO} showVa label="Call back at" />
      </Drawer>
      <Drawer open={panel === 'close'} center onClose={() => setPanel(null)} title="Not interested?" sub={l.name}
        footer={<><button type="button" className="tp-primary fx-accent" onClick={() => { closeLead(l.id); note(`${l.name} closed out`); onClose() }}>Close them out</button><button type="button" className="tp-btn ov-ghost" onClick={() => setPanel(null)}>Keep</button></>}>
        <p className="tp-mid">They leave the queue and no one calls them again.</p>
      </Drawer>
    </RecordDrawer>
  )
}

export default function Queue() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: queue } = useFulQueue()
  const [q, setQ] = useState('')
  const [type, setType] = useState('all')
  const n = q.trim().toLowerCase()
  const shown = queue.filter(l => (type === 'all' || l.type === type) && (!n || `${l.name} ${l.city} ${l.phone}`.toLowerCase().includes(n)))
  let card = 0
  return (
    <div className="tp-page fx-page fx-leads fs-queue">
      <div className="fx-tools">
        <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label="Find someone" placeholder="Find by name, city or phone" value={q} onChange={e => setQ(e.target.value)} /></label>
        <Seg label="Looking for" value={type} onChange={setType} options={[{ key: 'all', label: 'All', count: queue.length }, { key: 'Policy help', label: 'Policy help', count: queue.filter(l => l.type === 'Policy help').length }, { key: 'Mortgage protection', label: 'Mortgage protection', count: queue.filter(l => l.type === 'Mortgage protection').length }]} />
        <HelpDot lesson="queue" />
      </div>

      <CallTasksStrip />
      <div className="fx-board fs-board3" role="region" aria-label="Queue by bucket">
        {BUCKETS.map((b, li) => {
          const rows = shown.filter(l => l.bucket === b.key)
          return (
            <section key={b.key} className={`fx-lane is-${b.tone}`} style={{ '--i': li }} aria-label={`${b.label}, ${rows.length}`}>
              <header className="fx-lane-h"><i aria-hidden="true" /><b>{b.label}</b><span>{rows.length}</span></header>
              <div className="fx-lane-b">
                {rows.map(l => <LeadCard key={l.id} l={l} i={card++} />)}
                {rows.length === 0 && <Empty title="Nothing here" sub={n ? 'No one matches that search.' : b.empty} />}
              </div>
            </section>
          )
        })}
      </div>

      {id && <LeadDrawer id={id} onClose={() => navigate(fp('queue'))} />}
    </div>
  )
}
