import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, RotateCcw, UserPlus, Save, Undo2, TriangleAlert } from 'lucide-react'
import { Field, Chip, Avatar, useNote } from '../../template/kit'
import { Dropdown, DField } from '../kit'
import { LESSONS } from '../../fulshell/training/lessons.js'
import { useLessons, useTrainingAdmin } from '../../fulshell/training/store.js'
import { endsInQuiz } from '../../fulshell/training/model.js'
import { hasVideo } from '../../fulshell/training/videoModel.js'
import { useWatchedMap } from '../../fulshell/training/videoStore.js'
import '../../fulshell/training/training.css'

// P872 — admin Settings → Training: each VA's progress and check scores, assign or reset a lesson, and edit a
// lesson's text. Sample data in this browser until P852 wires progress and edits to the database. Lesson ids, checks
// and the order stay in the repo (src/fulshell/training/lessons.js); edits change the words a VA reads.
const STATE = { passed: ['Passed', 'green'], next: ['Up next', 'blue'], open: ['Open', 'blue'], locked: ['Locked', 'mute'] }
const pct = n => `${Math.round(n * 100)}%`

// P877: per lesson, the video (watched, or how much), then the check score or whether Try it was done.
function lessonLine(l, r, v) {
  const video = !hasVideo(l.id) ? null : v?.watched ? 'Video watched' : v?.pct ? `Video ${pct(v.pct)} watched` : 'Video not watched'
  const end = endsInQuiz(l)
    ? (r?.total ? `Check ${r.correct}/${r.total} · ${r.tries} ${r.tries === 1 ? 'try' : 'tries'}` : 'Check not taken')
    : (r?.tried ? 'Try it done' : 'Try it not done')
  return [video, end].filter(Boolean).join(' · ')
}

function Person({ p, onAssign, onReset, onResetAll }) {
  const [open, setOpen] = useState(false)
  const seen = useWatchedMap(p.name)
  const watched = LESSONS.filter(l => seen[l.id]?.watched).length
  const nextIdx = LESSONS.findIndex(l => l.id === p.sum.next)
  const status = p.sum.complete ? ['Complete', 'green'] : p.sum.passed === 0 && !Object.keys(p.progress.results).length ? ['Not started', 'warn'] : [`On lesson ${nextIdx + 1}`, 'blue']
  const assigned = p.states.filter(s => s.assigned).length
  return (
    <li className="adm-tr-person">
      <button type="button" className="fx-mrow adm-tr-row" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Avatar name={p.name} />
        <span className="tp-grow"><b>{p.name}</b>
          <small>{p.sum.passed} of {p.sum.total} done · {watched} videos watched{p.sum.avg != null ? ` · checks average ${pct(p.sum.avg)}` : ''}{assigned ? ` · ${assigned} assigned` : ''}</small>
          <span className="tr-bar" aria-hidden="true"><i style={{ '--w': p.sum.pct }} /></span>
        </span>
        <Chip tone={status[1]}>{status[0]}</Chip>
        {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      </button>
      {open && (
        <div className="adm-tr-detail">
          <ul className="tp-list adm-tr-lessons" aria-label={`${p.name}'s lessons`}>
            {LESSONS.map((l, i) => {
              const s = p.states[i]
              const r = p.progress.results[l.id]
              return (
                <li key={l.id} className="fx-mrow">
                  <span className={`tr-n is-${s.state}`} aria-hidden="true">{s.state === 'passed' ? <Check size={13} /> : i + 1}</span>
                  <span className="tp-grow"><b>{l.title}</b><small>{lessonLine(l, r, seen[l.id])}</small></span>
                  {s.assigned ? <Chip tone="warn">Assigned</Chip> : <Chip tone={STATE[s.state][1]}>{STATE[s.state][0]}</Chip>}
                  <button type="button" className="fx-pillbtn" disabled={s.assigned} onClick={() => onAssign(l)}><UserPlus size={13} />Assign</button>
                  <button type="button" className="fx-pillbtn" disabled={!r && !s.assigned} onClick={() => onReset(l)}><RotateCcw size={13} />Reset</button>
                </li>
              )
            })}
          </ul>
          <div className="fx-form-row"><span className="tp-grow" /><button type="button" className="tp-btn ov-ghost" onClick={onResetAll}><RotateCcw size={14} />Start {p.name.split(' ')[0]}'s training over</button></div>
        </div>
      )}
    </li>
  )
}

function Editor() {
  const lessons = useLessons()
  const { saveEdit, dropEdit, edits } = useTrainingAdmin()
  const note = useNote()
  const [id, setId] = useState(LESSONS[0].id)
  const l = lessons.find(x => x.id === id)
  const [draft, setDraft] = useState(null)
  const d = draft && draft.id === id ? draft : { id, title: l.title, job: l.job, why: l.why, steps: l.steps.join('\n') }
  const set = patch => setDraft({ ...d, ...patch })
  const dirty = d.title !== l.title || d.job !== l.job || d.why !== l.why || d.steps !== l.steps.join('\n')
  const approve = (l.script?.lines || []).filter(x => x.approve)
  const save = () => {
    saveEdit(id, { title: d.title.trim(), job: d.job.trim(), why: d.why.trim(), steps: d.steps.split('\n').map(s => s.trim()).filter(Boolean) })
    setDraft(null)
    note(`${d.title.trim()} saved. VAs see it now (sample, this browser)`)
  }
  return (
    <section className="adm-tr-edit" aria-label="Edit a lesson">
      <h3 className="adm-tr-h">Edit a lesson</h3>
      <DField label="Lesson"><Dropdown label="Lesson" value={id} onChange={v => { setId(v); setDraft(null) }} options={lessons.map((x, i) => ({ value: x.id, label: `${i + 1}. ${x.title}${edits[x.id] ? ' (edited)' : ''}` }))} /></DField>
      <Field label="Title"><input value={d.title} onChange={e => set({ title: e.target.value })} /></Field>
      <Field label="What it is for" hint="One line under the title"><input value={d.job} onChange={e => set({ job: e.target.value })} /></Field>
      <Field label="Why it matters"><textarea className="tp-input fx-ta" rows={2} value={d.why} onChange={e => set({ why: e.target.value })} /></Field>
      <Field label="Steps" hint="One step per line, in order"><textarea className="tp-input fx-ta" rows={7} value={d.steps} onChange={e => set({ steps: e.target.value })} /></Field>
      {approve.length > 0 && (
        <div className="adm-tr-approve">
          <p><TriangleAlert size={14} aria-hidden="true" /><b>Draft: Brayden and Jordan approve.</b> What leads and clients hear in this lesson. The words to say change in the repo for now (P852 makes them editable here).</p>
          <ul>{approve.map(x => <li key={x.text}>{x.text}</li>)}</ul>
        </div>
      )}
      <footer className="fx-form-f">
        {edits[id] && <button type="button" className="tp-btn ov-ghost" onClick={() => { dropEdit(id); setDraft(null); note('Back to the original lesson') }}><Undo2 size={14} />Back to the original</button>}
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost" disabled={!dirty} onClick={() => setDraft(null)}>Discard</button>
        <button type="button" className="tp-primary fx-accent" disabled={!dirty || !d.title.trim()} onClick={save}><Save size={15} />Save lesson</button>
      </footer>
    </section>
  )
}

export default function TrainingAdmin() {
  const { people, assign, reset, resetAll } = useTrainingAdmin()
  const note = useNote()
  const done = people.filter(p => p.sum.complete).length
  return (
    <>
      <header className="fx-form-h"><h2>Training</h2><p>Every VA's lessons: videos watched, Try it done and check scores. Assign a lesson to have it done again, or reset it. Sample until the backend step.</p></header>
      <ul className="adm-tr-sum" aria-label="Training at a glance">
        <li><b className="tp-num">{done}/{people.length}</b><small>VAs fully trained</small></li>
        <li><b className="tp-num">{LESSONS.length}</b><small>lessons</small></li>
        <li><b className="tp-num">{people.reduce((a, p) => a + p.states.filter(s => s.assigned).length, 0)}</b><small>assigned to retake</small></li>
      </ul>
      <ul className="tp-list adm-tr-people">
        {people.map(p => (
          <Person key={p.name} p={p}
            onAssign={l => { assign(p.name, l.id); note(`${l.title} assigned to ${p.name.split(' ')[0]}`) }}
            onReset={l => { reset(p.name, l.id); note(`${l.title} reset for ${p.name.split(' ')[0]}`) }}
            onResetAll={() => { resetAll(p.name); note(`${p.name.split(' ')[0]} starts training from lesson 1`) }} />
        ))}
      </ul>
      <Editor />
    </>
  )
}
