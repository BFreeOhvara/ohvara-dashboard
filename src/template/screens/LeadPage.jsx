import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Phone, MessageSquare, CalendarDays } from 'lucide-react'
import { useSampleLead, useSampleActions } from '../data'
import { Avatar, Chip, Pending, useNote } from '../kit'
import { stageChip, OutcomeDrawer } from '../LeadOutcome'
import { paths } from '../paths'

const TEXTS = [
  ['Automatic', 'Tue, Oct 27, 6:12 PM', 'Hi {n}, thanks for your request about mortgage protection. Your agent will call you in a few minutes.'],
  ['Automatic', 'Tue, Oct 27, 6:15 PM', 'Sorry we missed you! Reply with a good time to call, or pick one here: [booking link]'],
  ['{n}', 'Tue, Oct 27, 6:40 PM', 'Tomorrow after 5 works'],
  ['Automatic', 'Wed, Oct 28, 5:11 PM', 'You are booked. Need a different time? [reschedule link]'],
]
const JOURNEY = [['Came in', 'Tue, Oct 27, 6:12 PM', 'Filled in the mortgage protection form.'], ['Our team called', 'Tue, Oct 27, 6:14 PM', 'No answer. Sent a text to pick a time.'], ['Replied', 'Tue, Oct 27, 6:40 PM', 'Picked tomorrow after 5.'], ['Booked on your calendar', 'Wed, Oct 28, 5:10 PM', 'The team booked the appointment.']]

// One lead: an action bar on top, then two panes. Left: what they told us and your notes. Right: every text and
// the journey so far. On a desktop each pane scrolls inside itself; on a phone they stack and the page scrolls.
export default function LeadPage() {
  const { id } = useParams()
  const { data: lead } = useSampleLead(id)
  const { addLeadNote } = useSampleActions()
  const note = useNote()
  const [draft, setDraft] = useState('')
  const [outcome, setOutcome] = useState(null)
  const [tone, label] = stageChip(lead.stage)
  const name = `${lead.first_name} ${lead.last_name}`
  const asks = [['Mortgage balance', lead.mortgage_balance_band], ['Age', lead.age_band], ['Homeowner', lead.homeowner ? 'Yes' : 'No'], ['Smoker', lead.smoker ? 'Yes' : 'No'], ['Best time', lead.best_time]]
  return (
    <div className="tp-page tp-leadpage">
      <section className="tp-lbar ov-card" aria-label={name}>
        <Link to={paths.leads()} className="tp-back" aria-label="Back to Leads"><ArrowLeft size={18} /></Link>
        <Avatar name={name} tone="blue" />
        <div className="tp-grow"><h2 className="tp-h2">{name}</h2><p className="tp-sub">{lead.city}, {lead.state} · came in {lead.assigned_at}</p></div>
        <Chip tone={tone}>{label}</Chip>
        <div className="tp-row tp-wrap tp-lbar-acts">
          <button type="button" className="ov-hero tp-primary" onClick={() => note(`Calling ${lead.phone}`)}><Phone size={16} />Call {lead.phone}</button>
          <button type="button" className="tp-btn ov-ghost" onClick={() => note(`Text started with ${lead.first_name}`)}><MessageSquare size={14} />Text</button>
        </div>
      </section>

      <div className="tp-panes">
        <div className="tp-pane" tabIndex={0} aria-label="About this lead">
          {lead.appt && <section className="ov-card tp-card tp-appt"><span className="tp-ic"><CalendarDays size={16} /></span><div><b>Appointment with you</b><p className="tp-mid">{lead.appt}</p></div></section>}
          <section className="ov-card tp-card"><h2 className="tp-h2">Outcome</h2><p className="tp-sub">After the call, pick one.</p>
            <div className="tp-row tp-wrap" style={{ marginTop: 10 }}>
              {['sold', 'follow_up', 'not_interested'].map(k => <button key={k} type="button" className="tp-btn ov-ghost" onClick={() => setOutcome(k)}>{stageChip(k)[1]}</button>)}
            </div>
            {lead.stage === 'sold' && <Link to={paths.submit()} className="ov-hero tp-primary" style={{ marginTop: 12 }}>Submit for servicing</Link>}
          </section>
          <section className="ov-card tp-card"><h2 className="tp-h2">What they told us on the form</h2>
            <dl className="tp-facts">{asks.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            <Pending>Consent wording pending</Pending>
          </section>
          <section className="ov-card tp-card"><h2 className="tp-h2">Notes</h2><p className="tp-sub">Only you and our team see these</p>
            {lead.note && <p className="tp-mid" style={{ whiteSpace: 'pre-line', margin: '10px 0' }}>{lead.note}</p>}
            <textarea className="tp-input" style={{ minHeight: 80, padding: 12 }} aria-label="Add a note" placeholder="Add a note" value={draft} onChange={e => setDraft(e.target.value)} />
            <button type="button" className="tp-btn ov-ghost" style={{ marginTop: 8 }} disabled={!draft.trim()} onClick={() => { addLeadNote(lead.id, draft.trim()); setDraft(''); note('Note saved') }}>Save note</button>
          </section>
        </div>

        <div className="tp-pane tp-pane-wide" tabIndex={0} aria-label="Texts and journey">
          <section className="ov-card tp-card"><h2 className="tp-h2">Texts</h2><p className="tp-sub">Every text, including the ones we send for you</p>
            <div className="tp-chat">{TEXTS.map(([from, at, text]) => {
              const them = from === '{n}'
              return <div key={at} className={`tp-bub${them ? '' : ' me'}`}>{text.replace('{n}', lead.first_name)}<small>{them ? lead.first_name : from} · {at}</small></div>
            })}</div>
            <p className="tp-sub">Automatic texts stop as soon as {lead.first_name} replies, books or opts out.</p>
          </section>
          <section className="ov-card tp-card"><h2 className="tp-h2">What happened, and what is next</h2>
            <ol className="tp-tl" style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>{JOURNEY.map(([t, at, d], i) => <li key={t} className={i === JOURNEY.length - 1 ? 'now' : 'done'}><i /><div><b>{t}</b><span>{at}. {d}</span></div></li>)}</ol>
          </section>
        </div>
      </div>
      <OutcomeDrawer lead={outcome ? lead : null} kind={outcome} onClose={() => setOutcome(null)} />
    </div>
  )
}
