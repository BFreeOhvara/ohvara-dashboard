import { useState } from 'react'
import { MessageSquareText, Check } from 'lucide-react'
import { Chip, SampleTag, useNote } from '../../template/kit'
import { useAdmSource } from '../data'
import { CLIENT_LINE_WORDS } from '../../lib/clientLine'
import { DRAFT_TEXTS } from '../../template/leadTexts'
import { DRAFT_WORDS } from '../../lib/aiCaller'
import { TEAM_CALL_ACK, WELCOME_TEXT_ASK } from '../../lib/bookImport'
import { LICENSED_WORDS } from '../../template/licenceModel'
import { LESSONS } from '../../fulshell/training/lessons'
import './wording924.css'

// P924 — Settings › Wording to approve. No screen in any role says "draft" any more; every piece of wording still
// waiting for Brayden (and a lawyer, where it's legal) is listed here, with where it's used. Approving here is the
// sample only: the real sign-off is Brayden's yes in chat, then the text is wired (GoHighLevel, the AI caller).
const approveIn = v => (Array.isArray(v) ? v.flatMap(approveIn) : v && typeof v === 'object' ? (v.approve && v.text ? [v.text] : Object.values(v).flatMap(approveIn)) : [])
const lessonLines = () => LESSONS.flatMap(l => [...new Set(approveIn(l))].map(t => [l.title, t]))

const label = k => k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

const WORDING_GROUPS = () => [
  { key: 'client', title: 'Clients reaching our team (P924)', where: 'Automatic replies to client texts, the welcome text with the contact card, the next-day check',
    items: Object.entries(CLIENT_LINE_WORDS).map(([k, v]) => [label(k), v]) },
  { key: 'leads', title: 'Lead texts', where: 'GoHighLevel workflows: no-show, rebook, follow-ups, the automatic replier, after hours',
    items: Object.entries(DRAFT_TEXTS).map(([k, v]) => [label(k), v]) },
  { key: 'ai', title: 'AI caller', where: 'What the AI says on a lead’s first call (needs a lawyer for the consent line)',
    items: Object.entries(DRAFT_WORDS).map(([k, v]) => [label(k), v]) },
  { key: 'book', title: 'Adding clients', where: 'The agent’s book import and the welcome call',
    items: [['Team may call', TEAM_CALL_ACK], ['Text updates question', WELCOME_TEXT_ASK]] },
  { key: 'licence', title: 'Licence', where: 'What an agent confirms about their licence',
    items: [['Licensed in my states', LICENSED_WORDS]] },
  { key: 'missing', title: 'Still to write (lawyer)', where: 'Not written yet. The screens show nothing in their place until it is',
    items: [['Deedstone page: consent and privacy', 'The consent and privacy lines under the Deedstone form (must name calls using an artificial or prerecorded voice before the AI caller runs).'],
      ['Leads: consent', 'The consent line shown with a lead’s details.'], ['Leads: opt-out', 'The opt-out line on texts to leads.'],
      ['Sign-up: terms', 'Terms, privacy and text-message consent on sign-up.'], ['Submit: texting consent', 'Texting consent for a new client on Submit.'],
      ['Welcome: agent agreement', 'The agent agreement and terms on the welcome steps.']] },
  { key: 'lessons', title: 'VA training lines', where: 'Words the VA lessons teach VAs to say',
    items: lessonLines() },
]

export function WordingToApprove() {
  const src = useAdmSource()
  const note = useNote()
  const [ok, setOk] = useState({})
  const groups = WORDING_GROUPS().filter(g => g.items.length)
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const done = Object.values(ok).filter(Boolean).length
  return (
    <>
      <header className="fx-form-h">
        <div className="tp-row tp-wrap"><h2>Wording to approve</h2>{src !== 'real' && <SampleTag>Sample</SampleTag>}</div>
        <p>Every text and line that leads, clients or agents see or hear and that you haven’t signed off yet. Screens never show it as a draft; this is the one list. <b className="tp-num">{done}</b> of <span className="tp-num">{total}</span> approved.</p>
      </header>
      {groups.map(g => (
        <section key={g.key} className="wd-group" aria-labelledby={`wd-${g.key}`}>
          <h3 id={`wd-${g.key}`} className="fx-h3"><MessageSquareText size={16} aria-hidden="true" />{g.title}</h3>
          <p className="wd-where">{g.where}</p>
          <ul className="wd-list">{g.items.map(([name, text], i) => {
            const id = `${g.key}:${i}`
            return (
              <li key={id} className="wd-row">
                <span className="tp-grow"><small>{name}</small><q>{text}</q></span>
                {ok[id] ? <Chip tone="green">Approved</Chip> : <button type="button" className="tp-btn" onClick={() => { setOk({ ...ok, [id]: true }); note(src === 'real' ? 'Approved here. Tell CC to wire it.' : 'Approved (sample)') }}><Check size={15} aria-hidden="true" />Approve</button>}
              </li>
            )
          })}</ul>
        </section>
      ))}
    </>
  )
}
