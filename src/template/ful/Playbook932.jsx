import { useState } from 'react'
import { BookOpen, Pencil, Phone, Clock3, FileSignature, ExternalLink, Send, CircleCheck, Check, Bot, Sparkles, CalendarClock, History } from 'lucide-react'
import { Chip, Drawer, Field, Seg, useNote } from '../kit'
import { pathFor, openState, doItNow, hoursLine, METHOD, ACTION_WORD, VIA_WORD, ESIGN_STEPS, actionOf } from '../../lib/servicing/playbook.js'
import { normalizeName } from '../../lib/carriers.js'
import { usePlaybookState, playbookActions } from './playbook932Store'
import { sampleNowMs } from './data'
import './playbook932.css'

// P932 — the path of least resistance, on the VA's call panel (Brayden, Nov 9 22:32): the system already knows how
// each carrier does each change, so everything is ready before the call.
//   CarrierWay     the carrier's way for this change: method, service line and hours (open now?), the form, where it
//                  goes, what the client needs ready. E-sign path → EsignTrack. Call path → DoItNow. Not in the
//                  playbook → "New carrier: we'll learn it on this call" and Save what you learned. Edit → logged.
//   FrontDeskNote  what the AI front desk learned before the call reached the VA (the client never repeats it).

const span = m => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`)
function openWords(st) {
  if (st.open) return st.reason === 'closing' ? { tone: 'warn', text: `Closing in ${span(st.closesIn)}` } : { tone: 'green', text: `Open now · closes in ${span(st.closesIn)}` }
  if (st.reason === 'before') return { tone: 'mute', text: `Opens in ${span(st.opensIn)}` }
  return { tone: 'mute', text: st.reason === 'weekend' ? 'Closed for the weekend' : 'Closed now' }
}

export function CarrierWay({ carrier, kind, itemId, first = 'them', done = false, vaFree = true, now = null, blocked = null }) {
  const s = usePlaybookState()
  const [edit, setEdit] = useState(false)
  const p = pathFor(carrier, kind, s.edits)
  const action = actionOf(kind)
  if (!action || !carrier) return null
  const at = now ?? sampleNowMs()
  const st = openState(p.carrier, at)
  const ow = openWords(st)
  const m = METHOD[p.step?.method || 'check']
  const name = p.name || carrier
  return (
    <section className="pb932" aria-label={`How ${name} does it`}>
      <header className="pb-h">
        <BookOpen size={16} aria-hidden="true" />
        <b>{p.known ? `How ${name} does it` : 'New carrier'}</b>
        {p.known && <Chip tone={m.tone}>{m.short}</Chip>}
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost sm" onClick={() => setEdit(true)}><Pencil size={14} />{p.known ? 'Edit' : 'Save what you learned'}</button>
      </header>
      <p className={`pb-line${p.learn ? ' is-learn' : ''}`}>{p.line}</p>
      <dl className="pb-facts">
        <div><dt><Phone size={12} aria-hidden="true" />Service line</dt><dd>{p.phone || 'Find it on the call'}</dd></div>
        <div><dt><Clock3 size={12} aria-hidden="true" />Hours</dt><dd>{p.carrier ? hoursLine(p.carrier) : 'Not known yet'}{p.carrier && <span className={`pb-open is-${ow.tone}`}>{ow.text}</span>}</dd></div>
        {p.step?.form && <div><dt><FileSignature size={12} aria-hidden="true" />Form</dt><dd>{p.step.url ? <a href={p.step.url} target="_blank" rel="noreferrer">{p.step.form}<ExternalLink size={12} aria-hidden="true" /></a> : p.step.form}</dd></div>}
        {p.step?.via && <div><dt><Send size={12} aria-hidden="true" />Goes by</dt><dd>{VIA_WORD[p.step.via]} {p.step.to}</dd></div>}
      </dl>
      {p.step?.have?.length > 0 && (
        <div className="pb-ready"><small>{first} needs ready</small><ul>{p.step.have.map(h => <li key={h}><Check size={13} aria-hidden="true" />{h}</li>)}</ul></div>
      )}
      {(p.step?.notes || p.entry?.phoneNote) && <p className="pb-note">{[p.step?.notes, p.entry?.phoneNote].filter(Boolean).join(' ')}</p>}
      {!done && (p.path === 'esign'
        ? <EsignTrack itemId={itemId} carrier={name} first={first} action={action} via={p.step.via} to={p.step.to} wetInk={p.wetInk} blocked={blocked} />
        : <DoItNow carrier={p.carrier} name={name} first={first} vaFree={vaFree} now={at} />)}
      {edit && <PlaybookEditor carrierKey={p.key} name={name} action={action} entry={p.step} onClose={() => setEdit(false)} />}
    </section>
  )
}

// The e-sign path: link texted (prefilled) → signed on their phone → sent to the carrier (P886) → a follow-up checks the
// carrier processed it → the client's "done" text.
export function EsignTrack({ itemId, carrier, first, action, via, to, wetInk = false, blocked = null }) {
  const s = usePlaybookState()
  const note = useNote()
  const stage = s.esign[itemId]?.stage || 0
  const go = (k, msg) => { playbookActions.esign(itemId, k); if (msg) note(msg) }
  const doneText = `Deedstone Insurance: your ${ACTION_WORD[action].toLowerCase()} change with ${carrier} is done. Questions? Call us at this number.`
  return (
    <div className="pb-esign">
      <ol className="pb-track" aria-label="E-sign progress">
        {ESIGN_STEPS.map((x, i) => (
          <li key={x.key} className={i < stage ? 'is-done' : i === stage ? 'is-now' : ''}>
            <span className="pb-dot" aria-hidden="true">{i < stage ? <Check size={11} /> : i + 1}</span>
            <span><b>{x.label}</b>{x.sub && <small>{x.key === 'to_carrier' ? `${VIA_WORD[via]} ${to}` : x.sub}</small>}</span>
          </li>
        ))}
      </ol>
      {blocked && stage === 0 ? <p className="pb-note">{blocked}</p>
        : stage === 0 ? <button type="button" className="tp-primary fx-accent" onClick={() => go(1, `E-sign link texted to ${first}`)}><FileSignature size={16} />{wetInk ? 'Text the form (they sign by hand, send a photo)' : 'Text the e-sign link'}</button>
        : stage === 1 ? <div className="pb-row"><span className="pb-wait">Waiting for {first} to sign. You’ll get a notification.</span><button type="button" className="tp-btn ov-ghost sm" onClick={() => go(2)}>Sample: they signed</button></div>
        : stage === 2 ? <button type="button" className="tp-primary fx-accent" onClick={() => go(3, `Sent to ${carrier}`)}><Send size={16} />Send to {carrier}</button>
        : stage === 3 ? <div className="pb-row"><span className="pb-wait"><CalendarClock size={14} aria-hidden="true" />Follow-up task: check {carrier} processed it, next business day.</span><button type="button" className="tp-btn ov-ghost sm" onClick={() => go(5, `${first} gets the “done” text`)}>{carrier} processed it</button></div>
        : <p className="pb-donetext"><CircleCheck size={15} aria-hidden="true" /><span><small>“Done” text</small>{doneText}</span></p>}
    </div>
  )
}

// A call-type change: do it now while the carrier is open and a VA is free; closing soon, closed or the weekend → the
// next times the carrier is open and the client is free.
export function DoItNow({ carrier, name, first, vaFree = true, now }) {
  const note = useNote()
  const [booked, setBooked] = useState(null)
  const r = doItNow(carrier, now, { vaFree, name })
  if (booked) return <p className="pb-donetext"><CalendarClock size={15} aria-hidden="true" /><span><small>Booked</small>{`Call ${first} and ${name} ${booked}. ${first} gets a text to confirm.`}</span></p>
  return (
    <div className={`pb-now is-${r.mode}`}>
      {r.mode === 'now'
        ? <><b>Do it now</b><q className="cp-say">{`${name} is open. ${r.say}`}</q>
            <div className="pb-row"><button type="button" className="tp-primary fx-accent" onClick={() => note(`Ringing ${name}. ${first} holds or gets a ring back.`)}><Phone size={16} />Ring {name} now</button><span className="pb-wait">If {first} says yes.</span></div></>
        : <><b>{r.mode === 'busy' ? 'Book a time' : 'Not now: book their next open time'}</b><q className="cp-say">{r.say}</q>
            <div className="pb-row">{r.times.map(t => <button key={t.at} type="button" className="tp-btn ov-ghost sm" onClick={() => { setBooked(t.label); note(`Booked ${t.label}`) }}>{t.label[0].toUpperCase() + t.label.slice(1)}</button>)}</div></>}
    </div>
  )
}

// Edit one carrier's way for one change (admin and VAs). Every save is logged.
const METHODS = ['esign', 'online', 'merge', 'check'].map(k => ({ key: k, label: METHOD[k].short }))
export function PlaybookEditor({ carrierKey, name: initialName, action: initialAction, entry, onClose }) {
  const s = usePlaybookState()
  const note = useNote()
  const [name, setName] = useState(initialName || '')
  const [action, setAction] = useState(initialAction || 'cancel')
  const [f, setF] = useState({ method: entry?.method || 'merge', form: entry?.form || '', url: entry?.url || '', via: entry?.via || 'fax', to: entry?.to || '', have: (entry?.have || []).join('\n'), notes: entry?.notes || '' })
  const up = k => e => setF({ ...f, [k]: e.target.value })
  const key = carrierKey || `new-${normalizeName(name).replace(/ /g, '-')}`
  const err = !name.trim() ? 'Which carrier?' : f.method === 'esign' && !f.to.trim() ? 'Where does the form go?' : null
  const save = () => {
    playbookActions.save(key, name.trim(), action, { method: f.method, esign: 'unknown', form: f.form.trim() || null, url: f.url.trim() || null,
      via: f.method === 'esign' ? f.via : null, to: f.method === 'esign' ? f.to.trim() : null, have: f.have.split('\n').map(x => x.trim()).filter(Boolean), notes: f.notes.trim() || null })
    note(`Saved: ${name.trim()} ${ACTION_WORD[action].toLowerCase()}`)
    onClose()
  }
  const log = s.log.filter(l => l.key === key).slice(0, 4)
  return (
    <Drawer open center onClose={onClose} title={carrierKey ? `${name}: ${ACTION_WORD[action]}` : 'New carrier: what you learned'} sub="Admin and VAs can edit. Every change is logged."
      footer={<button type="button" className="tp-primary fx-accent" disabled={!!err} onClick={save} title={err || undefined}><CircleCheck size={16} />Save</button>}>
      <div className="pb-edit">
        {!carrierKey && <Field label="Carrier"><input value={name} onChange={e => setName(e.target.value)} placeholder="Carrier name" /></Field>}
        {!initialAction && <Field label="Change"><Seg label="Change" value={action} onChange={setAction} role="radiogroup" options={Object.entries(ACTION_WORD).map(([key, label]) => ({ key, label }))} /></Field>}
        <Field label="Easiest way"><Seg role="radiogroup" label="Easiest way" value={f.method} onChange={v => setF({ ...f, method: v })} options={METHODS} /></Field>
        {f.method !== 'check' && <Field label="Form (if any)"><input value={f.form} onChange={up('form')} placeholder="Form name and number" /></Field>}
        {f.method !== 'check' && <Field label="Form link" hint="Public PDF or page, if there is one"><input value={f.url} onChange={up('url')} placeholder="https://" inputMode="url" /></Field>}
        {f.method === 'esign' && <div className="pb-two">
          <Field label="Send by"><select value={f.via} onChange={up('via')}>{['fax', 'email', 'upload'].map(v => <option key={v} value={v}>{VIA_WORD[v]}</option>)}</select></Field>
          <Field label={f.via === 'fax' ? 'Fax number' : f.via === 'email' ? 'Email' : 'Upload page'}><input value={f.to} onChange={up('to')} /></Field>
        </div>}
        <Field label="Client needs ready" hint="One per line"><textarea rows={3} value={f.have} onChange={up('have')} /></Field>
        <Field label="Notes"><input value={f.notes} onChange={up('notes')} placeholder="Witness needed, notarized, wet ink…" maxLength={400} /></Field>
        {log.length > 0 && <div className="pb-log"><small><History size={12} aria-hidden="true" />Edits</small><ul>{log.map(l => <li key={l.id}><b>{l.by}</b> · {l.at} · {ACTION_WORD[l.action]}: {l.what}</li>)}</ul></div>}
      </div>
    </Drawer>
  )
}

// What the AI front desk learned when every VA was busy: shows on the call the VA picks up.
export function FrontDeskNote({ summary, compact = false }) {
  if (!summary) return null
  const [l1, ...rest] = String(summary).split('\n')
  return (
    <section className={`pb-desk${compact ? ' is-compact' : ''}`} aria-label="From the AI front desk">
      <span className="pb-desk-ic" aria-hidden="true"><Bot size={compact ? 14 : 16} /></span>
      <span><small><Sparkles size={11} aria-hidden="true" />AI front desk · they won’t need to repeat it</small><b>{l1}</b>{rest.map(r => <span key={r}>{r}</span>)}</span>
    </section>
  )
}

// Submit (agent): once the old carrier is picked, how our team will cancel it. One line, no setup for the agent.
export function CancelWayHint({ carrier }) {
  const s = usePlaybookState()
  if (!carrier) return null
  const p = pathFor(carrier, 'cancel', s.edits)
  const m = METHOD[p.step?.method || 'check']
  const text = !p.known ? `New carrier for us: our team learns how ${p.name || carrier} cancels on the first call.`
    : p.path === 'esign' ? `${p.name} cancels with a signed form. We text the client an e-sign link, no call needed.`
    : p.step?.method === 'check' ? `${p.name}: our team confirms how they cancel on the first call.`
    : `${p.name} cancels by phone. Our team calls them with the client on the line.`
  return <p className="tp-sub tp-row pb-hint" role="status"><BookOpen size={14} aria-hidden="true" />{p.known && <Chip tone={m.tone}>{m.short}</Chip>}{text}</p>
}
