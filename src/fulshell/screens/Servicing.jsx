import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Hand, LifeBuoy, CalendarClock, Send, X, Check, Undo2, TriangleAlert, MessageSquare } from 'lucide-react'
import { Avatar, Field, useNote } from '../../template/kit'
import { useVaServicingDesk } from '../../hooks/useVaServicing'
import { kindLabel, toneOf, dueText, outcomesOf, outcomeLabel, SEND_REASONS, GROUPS, heldTask, servicingError, STATUS_LABEL } from '../../lib/vaServicing'
import { timeText } from '../../lib/fulfillmentDay'
import { FUL } from '../paths'
import { useFulData } from '../useFulData'

// P837 — Servicing: the VA's servicing desk on migration 206 (live; no screen read it before). Left, the queue the
// server gives a VA (open steps not with the agent and not on another VA's claim), grouped Working now / Overdue /
// Due today / Coming up / No date. Right, the step you hold: phone, notes and the agent's reply show only on your own
// claim. Outcomes are the server's closed lists; a coverage or advice question goes to the agent (a VA is unlicensed).
// Every write is a va_servicing_* function; nothing here texts, emails or calls.

function Row({ t, now, tz, held, busy, onTake }) {
  return (
    <li className={`fs-srow is-${toneOf(t.kind)}`}>
      <span className="fs-srow-dot" aria-hidden="true" />
      <span className="tp-grow">
        <b>{t.client_name || 'Client'}</b>
        <small>{kindLabel(t.kind)} · {t.agent_name ? `${t.agent_name}’s client` : 'Agent not noted'}{t.client_state ? ` · ${t.client_state}` : ''}</small>
      </span>
      <span className="fs-srow-r">
        <small className={/^Overdue/.test(dueText(t.due_at, now, tz)) ? 'is-late' : ''}>{dueText(t.due_at, now, tz)}</small>
        {t.mine ? <i className="fx-delta is-blue">Yours</i> : <button type="button" className="fx-pillbtn sm" disabled={!!held || busy} onClick={() => onTake(t)}>{busy ? 'Taking…' : 'Take it'}</button>}
      </span>
    </li>
  )
}

function Desk({ t, d, desk, onDone }) {
  const note = useNote()
  const [msg, setMsg] = useState('')
  const [mode, setMode] = useState(null) // 'send' | 'cancel' | 'schedule'
  const [reason, setReason] = useState(SEND_REASONS[0][0])
  const [text, setText] = useState('')
  const [at, setAt] = useState('')
  const busy = Object.values(desk).some(m => m.isPending)
  const run = (m, vars, ok) => {
    setMsg('')
    m.mutate(vars, {
      onSuccess: () => { if (ok) { note(ok); onDone?.() } setMode(null); setText('') },
      onError: e => setMsg(servicingError(e)),
    })
  }
  const outcomes = outcomesOf(t.kind)
  const name = t.client_name || 'this client'
  return (
    <section className="fx-tile fs-desk" aria-label={`Working ${name}`}>
      <header className="fx-tile-h">
        <Avatar name={t.client_name || '?'} />
        <span className="tp-grow"><h2>{t.client_name || 'Client'}</h2><p>{kindLabel(t.kind)} · {STATUS_LABEL[t.status] || t.status}</p></span>
        <i className={`fx-delta is-${toneOf(t.kind)}`}>Held until {timeText(t.claim_expires_at, d.tz)}</i>
      </header>

      <dl className="fs-facts">
        <div><dt>Phone</dt><dd>{t.client_phone ? <a href={`tel:${t.client_phone}`} className="tp-num">{t.client_phone}</a> : 'Not on file'}</dd></div>
        <div><dt>Best time</dt><dd>{t.best_time || 'Any time'}</dd></div>
        <div><dt>Carrier</dt><dd>{t.carrier || 'Not noted'}</dd></div>
        <div><dt>Agent</dt><dd>{t.agent_name || 'Not noted'}</dd></div>
        <div><dt>Due</dt><dd>{dueText(t.due_at, d.now, d.tz)}</dd></div>
        <div><dt>Asked by</dt><dd>{t.requested_by === 'client' ? 'The client' : t.requested_by === 'agent' ? 'The agent' : 'Servicing plan'}</dd></div>
      </dl>
      {t.note && <p className="fs-quote"><MessageSquare size={14} aria-hidden="true" />{t.note}</p>}
      {t.agent_reply_note && <p className="fs-quote is-reply"><Undo2 size={14} aria-hidden="true" /><span><b>Agent replied:</b> {t.agent_reply_note}</span></p>}

      <div className="tp-field"><span>What happened</span>
        <div className="fx-chips" role="radiogroup" aria-label="What happened">
          {outcomes.map(([v, label]) => <button key={v} type="button" role="radio" aria-checked={t.outcome === v} className={`fx-chip${t.outcome === v ? ' is-on' : ''}`} disabled={busy} onClick={() => run(desk.outcome, { task: t.task_id, outcome: v })}><b>{label}</b></button>)}
        </div>
        <small>{t.outcome ? `Saved: ${outcomeLabel(t.kind, t.outcome)}. Finish the step when you’re done.` : 'Pick one to finish the step. No advice or coverage answers here: send those to the agent.'}</small>
      </div>

      {mode === 'send' && (
        <div className="fs-sub">
          <Field label="Why it goes to the agent"><select value={reason} onChange={e => setReason(e.target.value)}>{SEND_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="The question" hint="The agent sees this. Up to 1000 characters."><textarea className="tp-input fx-ta" rows={3} maxLength={1000} value={text} onChange={e => setText(e.target.value)} placeholder="What does the client want to know?" /></Field>
          <div className="tp-row tp-wrap"><button type="button" className="tp-primary sm fx-accent" disabled={busy || !text.trim()} onClick={() => run(desk.send, { task: t.task_id, reason, question: text.trim() }, `Sent to ${t.agent_name || 'the agent'}. It leaves your desk.`)}><Send size={14} />Send to the agent</button><button type="button" className="tp-btn ov-ghost sm" onClick={() => setMode(null)}>Back</button></div>
        </div>
      )}
      {mode === 'schedule' && (
        <div className="fs-sub">
          <Field label="New time" hint="Your time. It must be in the future."><input type="datetime-local" className="tp-input" value={at} onChange={e => setAt(e.target.value)} /></Field>
          <div className="tp-row tp-wrap"><button type="button" className="tp-primary sm fx-accent" disabled={busy || !at} onClick={() => run(desk.schedule, { task: t.task_id, at: new Date(at).toISOString() }, 'New time saved')}><CalendarClock size={14} />Save the time</button><button type="button" className="tp-btn ov-ghost sm" onClick={() => setMode(null)}>Back</button></div>
        </div>
      )}
      {mode === 'cancel' && (
        <div className="fs-sub">
          <Field label="Why cancel this step" hint="Up to 500 characters. The agent sees it."><textarea className="tp-input fx-ta" rows={2} maxLength={500} value={text} onChange={e => setText(e.target.value)} /></Field>
          <div className="tp-row tp-wrap"><button type="button" className="tp-btn sm fs-danger" disabled={busy || !text.trim()} onClick={() => run(desk.cancel, { task: t.task_id, reason: text.trim() }, 'Step cancelled')}><X size={14} />Cancel the step</button><button type="button" className="tp-btn ov-ghost sm" onClick={() => setMode(null)}>Back</button></div>
        </div>
      )}

      {msg && <p className="fs-err" role="alert"><TriangleAlert size={15} aria-hidden="true" />{msg}</p>}

      {!mode && (
        <footer className="tp-row tp-wrap fs-acts">
          <button type="button" className="tp-primary sm fx-accent" disabled={busy || !t.outcome} onClick={() => run(desk.done, t.task_id, `${kindLabel(t.kind)} for ${name} is done`)}><Check size={14} />Finish the step</button>
          <button type="button" className="fx-pillbtn" disabled={busy} onClick={() => setMode('schedule')}><CalendarClock size={14} />New time</button>
          <button type="button" className="fx-pillbtn" disabled={busy} onClick={() => setMode('send')}><Send size={14} />Send to agent</button>
          <button type="button" className="fx-pillbtn" disabled={busy} onClick={() => run(desk.release, t.task_id, 'Put back in the queue')}><Undo2 size={14} />Put it back</button>
          <button type="button" className="fx-pillbtn fs-danger" disabled={busy} onClick={() => setMode('cancel')}><X size={14} />Cancel step</button>
        </footer>
      )}
    </section>
  )
}

export default function Servicing() {
  const d = useFulData()
  const desk = useVaServicingDesk()
  const [taking, setTaking] = useState(null)
  const [notice, setNotice] = useState('')
  const held = heldTask(d.servicing, d.now)
  const take = t => {
    setNotice('')
    setTaking(t.task_id)
    desk.claim.mutate(t.task_id, { onError: e => setNotice(servicingError(e)), onSettled: () => setTaking(null) })
  }
  const q = d.servQ

  return (
    <div className={`tp-page fx-page fs-serv-page${held ? ' is-held' : ''}`}>
      <section className="fx-tile fs-list" aria-label="Servicing steps">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Steps to work</h2><p>Soonest first. Taking one holds it for you for 15 minutes.</p></span></header>
        {notice && <p className="fs-err" role="alert"><TriangleAlert size={15} aria-hidden="true" />{notice}</p>}
        {!q.data ? (q.isError ? <p className="fx-calm" role="alert"><TriangleAlert size={16} aria-hidden="true" />Couldn’t load servicing. <button type="button" className="fs-link" onClick={() => q.refetch()}>Try again</button></p> : <p className="fx-calm">Loading servicing…</p>)
          : d.servicing.length === 0 ? <p className="fx-calm"><Check size={16} aria-hidden="true" />No servicing steps waiting. New ones show here as agents and clients ask.</p>
            : GROUPS.map(([key, label, empty]) => {
              const rows = d.tasks[key]
              if (!rows.length && key !== 'mine' && key !== 'overdue') return null
              return (
                <div key={key} className="fs-sgroup">
                  <h3 className="fx-h3">{label}<span className="fx-tb">{rows.length}</span></h3>
                  {rows.length ? <ul className="fs-slist">{rows.map(t => <Row key={t.task_id} t={t} now={d.now} tz={d.tz} held={held} busy={taking === t.task_id} onTake={take} />)}</ul> : <p className="fs-empty">{empty}</p>}
                </div>
              )
            })}
      </section>

      <div className="fs-deskcol">
        {held ? <Desk key={held.task_id} t={held} d={d} desk={desk} /> : (
          <section className="fx-tile fs-pick" aria-label="Pick a step">
            <span className="fx-kpi-ic"><Hand size={17} aria-hidden="true" /></span>
            <h2 className="tp-h2">Pick a step to start</h2>
            <p className="tp-sub">Overdue comes first. While you hold a step its phone and notes show here. Questions about coverage or advice go to the client’s agent.</p>
            <Link to={FUL.messages} className="fx-pillbtn"><LifeBuoy size={14} />Ask the team</Link>
          </section>
        )}
      </div>
    </div>
  )
}
