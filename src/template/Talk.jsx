import { useState } from 'react'
import { Phone, MessageSquareWarning } from 'lucide-react'
import { Drawer, Field, Seg, useNote } from './kit'
import { Select } from './Select'
import { useSampleActions, useSampleTalks } from './data'

// P878 — Talk to someone (N-I-01), from any screen (the Help sheet, Billing, Setup): a topic, a best time and a note
// become a call task for an admin plus a notification. The agent sees the promised time and where it stands.
// And feedback on the team (N-F-43): about a lead, its calls or the VA, to admin, who answers in the app.
const TOPICS = ['My leads', 'My plan or billing', 'A client', 'Setting up', 'Something else']
const WHEN = ['Now', 'This afternoon', 'This evening', 'Tomorrow morning']

export function TalkDrawer({ open, onClose, topic: start = TOPICS[0] }) {
  const { talk } = useSampleActions()
  const note = useNote()
  const [topic, setTopic] = useState(start)
  const [when, setWhen] = useState('Now')
  const [text, setText] = useState('')
  const send = () => { talk({ topic, when, note: text.trim() }); note(when === 'Now' ? 'Requested. Someone calls you by 2:45 PM' : `Requested. Someone calls you ${when.toLowerCase()}`); setText(''); onClose() }
  return (
    <Drawer open={open} onClose={onClose} title="Talk to someone" sub="A real person from Ohvara calls you back"
      footer={<><button type="button" className="tp-primary fx-accent" onClick={send}><Phone size={15} />Request a call</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Not now</button></>}>
      <Field label="What about?"><Select label="What about?" value={topic} onChange={setTopic} options={TOPICS} /></Field>
      <div className="lc-q"><b>Best time</b><Seg role="radiogroup" label="Best time" value={when} onChange={setWhen} options={WHEN.map(w => ({ key: w, label: w }))} /></div>
      <Field label="Anything we should know first? (optional)"><textarea className="tp-input fx-ta" value={text} onChange={e => setText(e.target.value)} placeholder="A sentence or two" /></Field>
      <p className="tp-sub">You{'’'}ll see the promised time in Help, and get a notification when we{'’'}re calling.</p>
    </Drawer>
  )
}

// The agent's open requests with their promised time (shown at the top of the Help sheet).
export function TalkStatus() {
  const { data: talks } = useSampleTalks()
  if (!talks.length) return null
  return (
    <ul className="tp-list sp-talks" aria-label="Your call requests">
      {talks.slice(0, 2).map(t => <li key={t.id} className="fx-mrow"><Phone size={17} aria-hidden="true" /><span className="tp-grow"><b>{t.promised}</b><small>{t.topic} · {t.status}</small></span></li>)}
    </ul>
  )
}

const ABOUT = ['How a lead was handled', 'A call with my lead', 'A booking time', 'Something else']
export function FeedbackDrawer({ open, onClose, lead }) {
  const { sendFeedback } = useSampleActions()
  const note = useNote()
  const [about, setAbout] = useState(ABOUT[0])
  const [mood, setMood] = useState('fix')
  const [text, setText] = useState('')
  if (!lead) return null
  const name = `${lead.first_name} ${lead.last_name}`
  const send = () => { sendFeedback({ leadId: lead.id, who: name, about, mood, text: text.trim() }); note('Sent to Ohvara. You get the answer in Messages'); setText(''); onClose() }
  return (
    <Drawer open={open} onClose={onClose} title="Feedback on our team" sub={`About ${name}. It goes to Ohvara with this lead, its calls and who handled it.`}
      footer={<><button type="button" className="tp-primary fx-accent" disabled={!text.trim()} onClick={send}><MessageSquareWarning size={15} />Send feedback</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      <div className="lc-q"><b>Is it praise or something to fix?</b><Seg role="radiogroup" label="Praise or fix" value={mood} onChange={setMood} options={[{ key: 'good', label: 'Praise' }, { key: 'fix', label: 'Something to fix' }]} /></div>
      <Field label="What about?"><Select label="What about?" value={about} onChange={setAbout} options={ABOUT} /></Field>
      <Field label="Tell us"><textarea className="tp-input fx-ta" value={text} onChange={e => setText(e.target.value)} placeholder="What happened, and what you'd like instead" /></Field>
    </Drawer>
  )
}
