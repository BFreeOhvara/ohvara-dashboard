import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  GraduationCap, Lock, CircleCheck, ChevronRight, Search, ArrowLeft, ArrowRight, Check, X, MessageSquareQuote, ListOrdered,
  ThumbsUp, Ban, MousePointerClick, RotateCcw, Trophy, Clock3, PlayCircle, Hand,
} from 'lucide-react'
import { useAccount } from '../../template/kit'
import { fp } from '../../template/ful/paths'
import { lessonNo, searchLessons, endsInQuiz } from './model.js'
import { PASS_MARK } from './lessons.js'
import { useLessons, useTraining } from './store.js'
import SHOTS from './shots.json'
import VideoPlayer from './VideoPlayer.jsx'
import { hasVideo, videoFor, fmtTime } from './videoModel.js'
import { hasTour, tourOf } from './tours.js'
import { FUL } from '../../template/ful/paths'
import { writePractice, practiceUrl } from '../../lib/practice.js'
import { useWatchedMap } from './videoStore.js'
import './training.css'

// P872 — Training, for VAs: one lesson per job (./lessons.js). Home: "Finish your training" with progress and the path
// (lessons unlock in order), and "How do I…?" search. A lesson: why it matters, the steps in order, the words to say,
// do's and don'ts, what to click (a picture of that screen with numbered spots), then a short check to pass. Sample
// progress in this browser until P852. P924: no draft markers on screen; the words to approve are in admin Settings › Wording to approve.

const pctText = n => `${Math.round(n * 100)}%`

// P979 — Practice (P948's walkthrough, now guided and required): open the practice copy of the portal (lib/practice.js) on the tour's
// first page; Mark talks the VA through 3–4 clicks they make themselves. A lesson that ends in Try it comes back to the
// Training list ticked; one that ends in a check comes back to its lesson, where the check is now open.
const onPreview = () => window.location.pathname.startsWith('/template/')
function practise(lesson, who) {
  const pre = onPreview() ? '/template' : ''
  const back = endsInQuiz(lesson) ? `${pre}${fp('training', lesson.id)}` : `${pre}${fp('training')}?lesson=${lesson.id}`
  const t = tourOf(lesson.id)
  writePractice({ lesson: lesson.id, name: who, back })
  const page = FUL[t.start] || FUL.overview
  window.location.assign(practiceUrl(t.open ? `${page}/${t.open}` : page))
}
const unbold = s => String(s).replace(/\*\*/g, '')

// What Practice will have them do: the steps' captions, in order.
function PracticeSteps({ lesson }) {
  const t = tourOf(lesson.id)
  return <ol className="tr-psteps">{t.steps.map(x => <li key={x.say}>{unbold(x.say)}</li>)}</ol>
}

// P979 — when the lesson video ends, Practice starts by itself after a short count (they can start now, or wait).
const COUNT = 6
function PracticeNext({ lesson, who, onWait }) {
  const [n, setN] = useState(COUNT)
  const ref = useRef(null)
  useEffect(() => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    ref.current?.querySelector('button')?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    if (n <= 0) { practise(lesson, who); return undefined }
    const id = setTimeout(() => setN(x => x - 1), 1000)
    return () => clearTimeout(id)
  }, [n, lesson, who])
  return (
    <section ref={ref} className="fx-tile is-hero tr-next" aria-label="Practice">
      <span className="tr-cta-ic" aria-hidden="true"><Hand size={18} /></span>
      <span className="tp-grow">
        <h2>Now practise it</h2>
        <p>Mark talks you through it in a practice copy of the portal. You do the clicks. Starting in <b className="tp-num">{Math.max(n, 0)}</b>…</p>
      </span>
      <span className="tr-next-acts">
        <button type="button" className="tp-primary fx-accent" onClick={() => practise(lesson, who)}><PlayCircle size={16} />Start practice</button>
        <button type="button" className="tp-btn ov-ghost" onClick={onWait}>I need a moment</button>
      </span>
    </section>
  )
}

// Back from the practice copy: a short note at the top of the page.
function PractisedNote({ lessons, here = null }) {
  const [sp, setSp] = useSearchParams()
  const how = sp.get('practised')
  if (!how) return null
  const l = lessons.find(x => x.id === (sp.get('lesson') || here))
  const clear = () => { const n = new URLSearchParams(sp); n.delete('practised'); n.delete('lesson'); setSp(n, { replace: true }) }
  return (
    <p className={`fx-calm tr-practised${how === 'done' ? ' is-done' : ''}`} role="status">
      {how === 'done' ? <CircleCheck size={16} aria-hidden="true" /> : <Hand size={16} aria-hidden="true" />}
      <span className="tp-grow">{how === 'done'
        ? (l && endsInQuiz(l) ? `Practice done. Now take the check for ${l.title}.` : l ? `That’s it, you’ve got it. ${l.title} is done.` : 'That’s it, you’ve got it.')
        : 'You left Practice before the end. Nothing there was real. The lesson counts once its Practice is finished.'}</span>
      <button type="button" className="tr-practised-x" onClick={clear} aria-label="Dismiss"><X size={14} /></button>
    </p>
  )
}

function Ring({ value, size = 64 }) {
  const r = (size - 8) / 2
  const c = 2 * Math.PI * r
  return (
    <svg className="tr-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${pctText(value)} done`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="tr-ring-bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className="tr-ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - value)} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="tp-num">{pctText(value)}</text>
    </svg>
  )
}

// The Overview card for a VA who has not finished (P872 "Finish your training").
export function TrainingNudge() {
  const account = useAccount()
  const { sum } = useTraining(account.name)
  const lessons = useLessons()
  if (sum.complete) return null
  const next = lessons.find(l => l.id === sum.next)
  return (
    <section className="fx-tile tr-nudge" aria-label="Finish your training">
      <span className="tr-nudge-ic" aria-hidden="true"><GraduationCap size={20} /></span>
      <span className="tp-grow">
        <b>Finish your training</b>
        <small>{sum.passed} of {sum.total} lessons done{next ? ` · next: ${next.title}` : ''}</small>
        <span className="tr-bar" aria-hidden="true"><i style={{ '--w': sum.pct }} /></span>
      </span>
      <Link to={next ? fp('training', next.id) : fp('training')} className="tp-primary fx-accent tr-nudge-go">{sum.passed ? 'Keep going' : 'Start'}<ArrowRight size={15} /></Link>
    </section>
  )
}

// P918 — the Overview's training box while training isn't finished: progress, the next lesson, one button.
export function TrainingTile({ i = 2 }) {
  const account = useAccount()
  const { sum } = useTraining(account.name)
  const lessons = useLessons()
  if (sum.complete) return null
  const next = lessons.find(l => l.id === sum.next)
  return (
    <section className="fx-tile tr-tile" style={{ '--i': i }} aria-label="Training">
      <header className="fx-tile-h"><span className="tp-grow"><h2>Training</h2><p>{sum.left} {sum.left === 1 ? 'lesson' : 'lessons'} to go</p></span></header>
      <div className="tr-tile-mid"><Ring value={sum.pct} size={64} /><span className="tp-grow"><b>{sum.passed} of {sum.total} lessons done</b><small>{next ? `Next: ${next.title}` : 'Pick up where you left off'}</small></span></div>
      <Link to={next ? fp('training', next.id) : fp('training')} className="tp-primary sm fx-accent tr-tile-go">{sum.passed ? 'Keep going' : 'Start'}<ArrowRight size={15} /></Link>
    </section>
  )
}

function Home({ lessons, t, who, live }) {
  const [q, setQ] = useState('')
  const seen = useWatchedMap(who, live)
  const hits = useMemo(() => searchLessons(q, lessons), [q, lessons])
  const byId = Object.fromEntries(t.states.map(s => [s.id, s]))
  const next = lessons.find(l => l.id === t.sum.next)
  return (
    <div className="tp-page fx-page fx-ovl tr-home">
      <div className="fx-ovl-main">
        <PractisedNote lessons={lessons} />
        <section className={`fx-tile is-hero tr-hero${t.sum.complete ? ' is-done' : ''}`} style={{ '--i': 0 }} aria-label="Your training">
          <Ring value={t.sum.pct} size={76} />
          <span className="tp-grow">
            <h2>{t.sum.complete ? 'Training complete' : 'Finish your training'}</h2>
            <p>{t.sum.complete
              ? `All ${t.sum.total} lessons passed. Come back any time: use How do I…? or the ? on any task.`
              : `${t.sum.passed} of ${t.sum.total} lessons done, in the order of your day. Watch each video, then finish its Practice (and its check, where there is one) to open the next.`}</p>
          </span>
          {next && <Link to={fp('training', next.id)} className="tp-primary fx-accent">{t.sum.passed ? 'Next lesson' : 'Start lesson 1'}<ArrowRight size={16} /></Link>}
        </section>

        <section className="fx-tile tr-path" style={{ '--i': 1 }} aria-label="Lessons">
          <header className="fx-tile-h"><span className="tp-grow"><h2>Your lessons</h2><p>In the order of your day: start of shift first, what to steer clear of last</p></span></header>
          <ol className="tr-list">
            {lessons.map((l, i) => {
              const s = byId[l.id]
              const locked = s.state === 'locked'
              const inner = (
                <>
                  <span className={`tr-n is-${s.state}`} aria-hidden="true">{s.state === 'passed' ? <Check size={14} /> : locked ? <Lock size={13} /> : i + 1}</span>
                  <span className="tp-grow"><b>{l.title}</b><small>{l.job}</small></span>
                  {s.assigned && <i className="fx-delta is-warn">Assigned</i>}
                  {s.stale && <i className="fx-delta is-blue">Updated</i>}
                  {s.score && <small className="tp-num tr-score">{s.score.correct}/{s.score.total}</small>}
                  <small className={`tr-end${endsInQuiz(l) ? ' is-quiz' : ''}`}>{hasTour(l.id) ? (endsInQuiz(l) ? 'Practice + check' : 'Practice') : endsInQuiz(l) ? 'Check' : 'Try it'}</small>
                  {hasVideo(l.id)
                    ? <small className={`tr-min tr-hasvid${seen[l.id]?.watched ? ' is-seen' : ''}`} title={seen[l.id]?.watched ? 'Video watched' : 'Has a video'}><PlayCircle size={12} aria-hidden="true" />{fmtTime(videoFor(l.id).duration)}</small>
                    : <small className="tr-min"><Clock3 size={12} aria-hidden="true" />{l.minutes} min</small>}
                  {!locked && <ChevronRight size={15} aria-hidden="true" />}
                </>
              )
              return (
                <li key={l.id} style={{ '--r': i }}>
                  {locked
                    ? <span className="fx-mrow tr-row is-locked" aria-label={`${l.title}, locked until the lessons before it are passed`}>{inner}</span>
                    : <Link to={fp('training', l.id)} className={`fx-mrow tr-row is-${s.state}`}>{inner}</Link>}
                </li>
              )
            })}
          </ol>
        </section>
      </div>

      <div className="fx-ovl-side">
        <section className="fx-tile tr-ask" style={{ '--i': 2 }} aria-label="How do I…?">
          <header className="fx-tile-h"><span className="tp-grow"><h2>How do I…?</h2><p>Search every lesson</p></span></header>
          <label className="fx-find tr-find"><Search size={16} aria-hidden="true" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. book in their time zone" aria-label="How do I…? Search every lesson" /></label>
          {q.trim() && (hits.length ? (
            <ul className="tp-list tr-hits" aria-label="Lessons that answer it">
              {hits.slice(0, 6).map(h => (
                <li key={h.id}><Link to={`${fp('training', h.id)}?from=search`} className="fx-mrow"><span className="tp-grow"><b>{h.title}</b><small>{h.hit}</small></span><ChevronRight size={15} aria-hidden="true" /></Link></li>
              ))}
            </ul>
          ) : <p className="fx-calm">No lesson covers that yet. Ask the team in Messages.</p>)}
          {!q.trim() && (
            <div className="tr-try">{['someone says stop', 'confirmation number', 'time zone', 'day off', 'failed payment'].map(s => <button key={s} type="button" className="fx-pillbtn" onClick={() => setQ(s)}>{s}</button>)}</div>
          )}
        </section>
        <section className="fx-tile tr-rules" style={{ '--i': 3 }} aria-label="How training works">
          <header className="fx-tile-h"><span className="tp-grow"><h2>How it works</h2></span></header>
          <ul className="tr-bul">
            <li><PlayCircle size={15} aria-hidden="true" />Every lesson has a short video. Watching about 90% counts as watched.</li>
            <li><ListOrdered size={15} aria-hidden="true" />Lessons open in order. Where a mistake costs money or breaks a rule, also pass a check ({pctText(PASS_MARK)} or better).</li>
            <li><Hand size={15} aria-hidden="true" />Practice starts when the video ends: Mark talks you through the task in a practice copy of the portal and you do the clicks. A lesson counts once its Practice is finished. Nothing there is real: no calls, no texts.</li>
            <li><MousePointerClick size={15} aria-hidden="true" />Every task in the portal has a ? that opens its lesson.</li>
          </ul>
        </section>
      </div>
    </div>
  )
}

function Shot({ portal }) {
  const [broken, setBroken] = useState(false)
  const shot = SHOTS[portal.shot]
  const clicks = portal.clicks || []
  return (
    <figure className="tr-shot">
      {!broken && (
        <div className="tr-shot-img">
          <img src={`/training/${portal.shot}.jpg`} alt={`The ${shot?.label || portal.shot} screen`} loading="lazy" onError={() => setBroken(true)} />
          {shot && clicks.map((c, i) => {
            const b = shot.spots?.[c.spot]
            return b ? <i key={c.spot} className="tr-spot" style={{ left: `${b[0]}%`, top: `${b[1]}%`, width: `${b[2]}%`, height: `${b[3]}%` }}><b>{i + 1}</b></i> : null
          })}
        </div>
      )}
      <figcaption>
        <ol className="tr-clicks">{clicks.map((c, i) => <li key={c.spot}><b className="tr-cn">{i + 1}</b>{c.text}</li>)}</ol>
      </figcaption>
    </figure>
  )
}

function Quiz({ lesson, onSubmit, onBack, last }) {
  const [answers, setAnswers] = useState([])
  const [result, setResult] = useState(null)
  const all = lesson.check.every((_, i) => Number.isInteger(answers[i]))
  if (result) {
    return (
      <section className={`fx-tile tr-result is-${result.pass ? 'pass' : 'fail'}`} aria-label="Your result" aria-live="polite">
        <span className="tr-res-ic" aria-hidden="true">{result.pass ? <Trophy size={26} /> : <RotateCcw size={24} />}</span>
        <h2>{result.pass ? 'Passed' : 'Not yet'}</h2>
        <p className="tp-num tr-res-n">{result.correct} of {result.total} right</p>
        <p>{result.pass ? (last ? 'That was the last lesson. Your training is complete.' : 'The next lesson is open.') : `You need ${pctText(PASS_MARK)} to pass. Read the answers below, then try again.`}</p>
        <ol className="tr-review">
          {lesson.check.map((c, i) => {
            const right = answers[i] === c.answer
            return (
              <li key={c.q} className={right ? 'is-right' : 'is-wrong'}>
                <span className="tr-rv-ic" aria-hidden="true">{right ? <Check size={14} /> : <X size={14} />}</span>
                <span className="tp-grow"><b>{c.q}</b><small>{right ? c.why : `Answer: ${c.options[c.answer]}. ${c.why}`}</small></span>
              </li>
            )
          })}
        </ol>
        <div className="tr-acts">
          {result.pass
            ? <button type="button" className="tp-primary fx-accent" onClick={() => onBack(true)}>{last ? 'Back to training' : 'Next lesson'}<ArrowRight size={16} /></button>
            : <button type="button" className="tp-primary fx-accent" onClick={() => { setAnswers([]); setResult(null) }}><RotateCcw size={16} />Try again</button>}
          <button type="button" className="tp-btn ov-ghost" onClick={() => onBack(false)}>Read the lesson again</button>
        </div>
      </section>
    )
  }
  return (
    <section className="fx-tile tr-check" aria-label={`Check: ${lesson.title}`}>
      <header className="fx-tile-h"><span className="tp-grow"><h2>Check: {lesson.title}</h2><p>{lesson.check.length} questions · pass with {pctText(PASS_MARK)} or better</p></span>
        <span className="tp-num tr-count" aria-label={`${answers.filter(Number.isInteger).length} of ${lesson.check.length} answered`}>{answers.filter(Number.isInteger).length}/{lesson.check.length}</span></header>
      <ol className="tr-qs">
        {lesson.check.map((c, i) => (
          <li key={c.q}>
            <fieldset>
              <legend><b className="tr-qn">{i + 1}</b>{c.q}</legend>
              <div className="tr-opts" role="radiogroup" aria-label={c.q}>
                {c.options.map((o, j) => (
                  <label key={o} className={`tr-opt${answers[i] === j ? ' is-on' : ''}`}>
                    <input type="radio" name={`q${i}`} checked={answers[i] === j} onChange={() => setAnswers(a => { const n = [...a]; n[i] = j; return n })} />
                    <span>{o}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="tr-acts">
        <button type="button" className="tp-primary fx-accent" disabled={!all} onClick={() => setResult(onSubmit(answers))}><CircleCheck size={16} />Check my answers</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => onBack(false)}>Back to the lesson</button>
      </div>
    </section>
  )
}

function Lesson({ lesson, lessons, t, who, live }) {
  const navigate = useNavigate()
  const [sp] = useSearchParams()
  const [mode, setMode] = useState('read')
  const [next, setNext] = useState(false) // P979: the video just ended; Practice is about to start
  const i =lessons.findIndex(l => l.id === lesson.id)
  const st = t.states.find(s => s.id === lesson.id)
  const locked = st.state === 'locked'
  const blocker = locked ? lessons[t.states.findIndex(s => s.state === 'next')] : null
  const fromHelp = sp.get('from') === 'help'
  const startAt = Number.isFinite(Number(sp.get('t'))) && sp.get('t') !== null ? Number(sp.get('t')) : null
  const done = back => {
    setMode('read')
    if (back) {
      const nxt = t.states.find(s => s.state === 'next')
      navigate(nxt ? fp('training', nxt.id) : fp('training'))
    }
    window.scrollTo({ top: 0 })
  }
  const quiz = endsInQuiz(lesson)
  const vid = hasVideo(lesson.id)
  const tour = hasTour(lesson.id)
  const mustPractise = tour && !locked && !st.practised
  const ended = () => { if (mustPractise) setNext(true) }
  // P985: Practice opens only once the video has played to the end (on the desk or the phone; a done lesson stays open).
  const watchedMap = useWatchedMap(who, live)
  const videoDone = !vid || st.state === 'passed' || !!watchedMap[lesson.id]?.watched
  return (
    <div className="tp-page fx-page fx-ovl tr-lesson">
      <div className="fx-ovl-main">
        <PractisedNote lessons={lessons} here={lesson.id} />
        <nav className="tr-crumb" aria-label="Training">
          <Link to={fp('training')}><ArrowLeft size={15} aria-hidden="true" />All lessons</Link>
          <span className="tp-num">Lesson {i + 1} of {lessons.length}</span>
          {hasVideo(lesson.id) && mode !== 'check' && <b className="tr-crumb-t">{lesson.title}</b>}
          {st.state === 'passed' && <i className="fx-delta is-up"><Check size={12} aria-hidden="true" />{st.score ? `Passed ${st.score.correct}/${st.score.total}` : 'Done'}</i>}
          {st.assigned && <i className="fx-delta is-warn">Assigned to you</i>}
        </nav>

        {mode === 'check' ? (
          <Quiz lesson={lesson} last={i === lessons.length - 1} onSubmit={answers => t.submit(lesson.id, answers)} onBack={done} />
        ) : (
          <>
            <VideoPlayer lessonId={lesson.id} who={who} start={startAt} onEnded={ended} free={st.state === 'passed'} />
            {next && mustPractise && <PracticeNext lesson={lesson} who={who} onWait={() => setNext(false)} />}
            {/* P897: a lesson with a video shows only the video (plus its check or Try it and progress); the written
                steps, script and picture are for lessons without one. */}
            {vid ? (
              <>
                {fromHelp && <p className="fx-calm tr-from"><MousePointerClick size={15} aria-hidden="true" />Opened from the ? on a task. Your page is one step back.</p>}
              </>
            ) : (<>
            <section className="fx-tile tr-intro" style={{ '--i': 0 }} aria-label={lesson.title}>
              <h2>{lesson.title}</h2>
              <p className="tr-job">{lesson.job}</p>
              <p className="tr-why"><b>Why it matters.</b> {lesson.why}</p>
              {fromHelp && <p className="fx-calm tr-from"><MousePointerClick size={15} aria-hidden="true" />Opened from the ? on a task. Your page is one step back.</p>}
            </section>

            <section className="fx-tile tr-steps" style={{ '--i': 1 }} aria-label="Steps">
              <header className="fx-tile-h"><span className="tp-grow"><h2>Step by step</h2></span><ListOrdered size={16} aria-hidden="true" /></header>
              <ol className="tr-ol">{lesson.steps.map((s, k) => <li key={s}><b className="tr-cn">{k + 1}</b><span>{s}</span></li>)}</ol>
            </section>

            {lesson.script && (
              <section className="fx-tile tr-script" style={{ '--i': 2 }} aria-label="What to say">
                <header className="fx-tile-h"><span className="tp-grow"><h2>What to say</h2><p>{lesson.script.title}</p></span></header>
                <ul className="tr-lines">
                  {lesson.script.lines.map(x => (
                    <li key={x.text} className={`is-${x.who.toLowerCase()}${x.approve ? ' is-approve' : ''}`}>
                      <span className="tr-who">{x.who === 'Note' ? <MessageSquareQuote size={14} aria-hidden="true" /> : x.who}</span>
                      <p>{x.text}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="fx-tile tr-portal" style={{ '--i': 3 }} aria-label="What to click">
              <header className="fx-tile-h"><span className="tp-grow"><h2>What to click</h2><p>Sample screen. The numbers match the list.</p></span><MousePointerClick size={16} aria-hidden="true" /></header>
              <Shot portal={lesson.portal} />
            </section>
            </>)}
          </>
        )}
      </div>

      <div className="fx-ovl-side">
        {mode === 'read' && (
          <section className={`fx-tile tr-cta${locked ? '' : ' is-hero'}`} style={{ '--i': 1 }} aria-label={mustPractise || (tour && !quiz) ? 'Practice' : quiz ? 'Check' : 'Try it'}>
            {locked ? (
              <>
                <span className="tr-cta-ic" aria-hidden="true"><Lock size={18} /></span>
                <h2>{tour ? 'Practice opens later' : quiz ? 'Check opens later' : 'Try it opens later'}</h2>
                <p>Lessons open in order. You can watch and read this one now; its {tour ? 'Practice' : quiz ? 'check' : 'Try it'} opens after you finish “{blocker?.title || 'the lessons before it'}”.</p>
                {blocker && <Link to={fp('training', blocker.id)} className="tp-btn ov-ghost">Go to {blocker.title}<ArrowRight size={15} /></Link>}
              </>
            ) : mustPractise || (tour && !quiz) ? (
              <>
                <span className="tr-cta-ic" aria-hidden="true"><Hand size={18} /></span>
                <h2>{st.state === 'passed' ? 'Done. Practise again?' : 'Practice'}</h2>
                <p>{st.state === 'passed' ? 'Mark talks you through it again. Your lesson stays done.' : `Mark talks you through it in a practice copy of the portal. You do the clicks.${quiz ? ' Then take the check.' : ' This lesson counts once you finish.'}`}</p>
                <PracticeSteps lesson={lesson} />
                <p className="fx-calm tr-practice-why">Nothing real changes: no calls, no texts.{vid && st.state !== 'passed' ? ' It starts by itself when the video ends.' : ''}</p>
                {videoDone
                  ? <button type="button" className="tp-primary fx-accent" onClick={() => practise(lesson, who)}><PlayCircle size={16} />{st.state === 'passed' ? 'Practice again' : 'Start practice'}</button>
                  : <button type="button" className="tp-primary fx-accent is-shut" aria-disabled="true" title="Practice opens when the video ends" onClick={() => document.querySelector('.tr-vid video')?.focus()}><Lock size={16} />Finish the video first</button>}
              </>
            ) : !quiz ? (
              <>
                <span className="tr-cta-ic" aria-hidden="true"><Hand size={18} /></span>
                <h2>{st.state === 'passed' ? 'Done. Try it again?' : t.trying === lesson.id ? 'Your turn' : 'Now try it'}</h2>
                <p>{lesson.tryIt.do} It’s sample data, so nothing real changes.</p>
                {t.trying === lesson.id && <p className="fx-calm tr-trying"><MousePointerClick size={15} aria-hidden="true" />Waiting for you to press <b>{lesson.tryIt.button}</b>.</p>}
                <button type="button" className="tp-primary fx-accent" onClick={() => { t.startTry(lesson.id); navigate(fp(...lesson.tryIt.path)) }}>{t.trying === lesson.id ? 'Go there' : st.state === 'passed' ? 'Try it again' : 'Try it now'}<ArrowRight size={16} /></button>
                {t.trying === lesson.id && <button type="button" className="tp-btn ov-ghost" onClick={t.stopTry}>Stop</button>}
              </>
            ) : (
              <>
                <span className="tr-cta-ic" aria-hidden="true"><GraduationCap size={18} /></span>
                <h2>{st.state === 'passed' ? 'Passed. Take it again?' : 'Ready? Take the check'}</h2>
                <p>{lesson.check.length} quick questions. Pass with {pctText(PASS_MARK)} or better{i < lessons.length - 1 && st.state !== 'passed' ? ' to open the next lesson' : ''}.</p>
                <button type="button" className="tp-primary fx-accent" onClick={() => { setMode('check'); window.scrollTo({ top: 0 }) }}>{st.state === 'passed' ? 'Retake the check' : 'Take the check'}<ArrowRight size={16} /></button>
                {tour && <button type="button" className="tp-btn ov-ghost" onClick={() => practise(lesson, who)}><PlayCircle size={16} />Practice again</button>}
              </>
            )}
          </section>
        )}
        {!vid && <>
        <section className="fx-tile tr-do" style={{ '--i': 2 }} aria-label="Do">
          <header className="fx-tile-h"><span className="tp-grow"><h2>Do</h2></span><ThumbsUp size={16} aria-hidden="true" /></header>
          <ul className="tr-bul is-do">{lesson.dos.map(d => <li key={d}><Check size={14} aria-hidden="true" />{d}</li>)}</ul>
        </section>
        <section className="fx-tile tr-dont" style={{ '--i': 3 }} aria-label="Don't">
          <header className="fx-tile-h"><span className="tp-grow"><h2>Don’t</h2></span><Ban size={16} aria-hidden="true" /></header>
          <ul className="tr-bul is-dont">{lesson.donts.map(d => <li key={d}><X size={14} aria-hidden="true" />{d}</li>)}</ul>
        </section>
        </>}
        <nav className="tr-pn" aria-label="Other lessons">
          {i > 0 && <Link to={fp('training', lessons[i - 1].id)} className="fx-pillbtn"><ArrowLeft size={14} />{lessonNo(lessons[i - 1].id)}. {lessons[i - 1].title}</Link>}
          {i < lessons.length - 1 && t.states[i + 1].state !== 'locked' && <Link to={fp('training', lessons[i + 1].id)} className="fx-pillbtn">{lessonNo(lessons[i + 1].id)}. {lessons[i + 1].title}<ArrowRight size={14} /></Link>}
        </nav>
      </div>
    </div>
  )
}

export default function Training() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const account = useAccount()
  const t = useTraining(account.name)
  const lessons = useLessons()
  const lesson = id ? lessons.find(l => l.id === id) : null
  if (id && !lesson) {
    return <div className="tp-page fx-page"><section className="fx-tile"><p className="fx-calm">That lesson isn’t here. <Link to={fp('training')}>See all lessons</Link></p></section></div>
  }
  return lesson ? <Lesson key={`${lesson.id}-${sp.get('t') || ''}`} lesson={lesson} lessons={lessons} t={t} who={account.name} live={!!account.live} /> : <Home lessons={lessons} t={t} who={account.name} live={!!account.live} />
}
