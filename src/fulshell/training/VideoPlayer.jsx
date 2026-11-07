import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Captions, CaptionsOff, CircleCheck, Clapperboard, ListVideo, VideoOff } from 'lucide-react'
import { cueAt, fmtTime, resumeAt, videoFor, WATCHED_AT } from './videoModel.js'
import { useVideoProgress } from './videoStore.js'

// P877 — the lesson video at the top of a lesson: the browser's own controls, our captions (word-timed, from the same
// script the voice reads, on by default, toggle), speed 1x / 1.25x / 1.5x, chapters, resume where you left off, and
// "watched" once about 90% has really been played. `start` (seconds) comes from the "?" on a task.
const SPEEDS = [1, 1.25, 1.5]
const PREFS = 'ful-training-video-prefs:v1'
const loadPrefs = () => { try { return { cc: true, speed: 1, ...JSON.parse(localStorage.getItem(PREFS) || '{}') } } catch { return { cc: true, speed: 1 } } }

export default function VideoPlayer({ lessonId, who, start = null }) {
  const v = useMemo(() => videoFor(lessonId, import.meta.env), [lessonId])
  const ref = useRef(null)
  const last = useRef(0)
  const [prefs, setPrefs] = useState(loadPrefs)
  const [cues, setCues] = useState(null)
  const [t, setT] = useState(0)
  const [broken, setBroken] = useState(false)
  const [started, setStarted] = useState(false)
  const prog = useVideoProgress(who, lessonId, v?.duration || 1)
  const [firstPos] = useState(() => start ?? resumeAt(prog, v?.duration || 0)) // fixed when the lesson opens

  useEffect(() => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)) } catch { /* fine */ } }, [prefs])
  // Start where they left off (or at the "?" moment), even if the file's details loaded before this ran.
  const placed = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !firstPos) return undefined
    const go = () => { if (placed.current) return; placed.current = true; el.currentTime = firstPos; last.current = firstPos }
    if (el.readyState >= 1) go()
    el.addEventListener('loadedmetadata', go)
    return () => el.removeEventListener('loadedmetadata', go)
  }, [firstPos])
  useEffect(() => { if (ref.current) ref.current.playbackRate = prefs.speed }, [prefs.speed, started])
  useEffect(() => {
    if (!v?.captionsUrl) return undefined
    let live = true
    fetch(v.captionsUrl).then(r => (r.ok ? r.json() : null)).then(c => { if (live) setCues(c) }).catch(() => {})
    return () => { live = false }
  }, [v?.captionsUrl])

  if (!v) return null
  if (broken) {
    return (
      <section className="fx-tile tr-video is-missing" aria-label="Lesson video">
        <p className="fx-calm"><VideoOff size={16} aria-hidden="true" />The video for this lesson isn’t available here yet. The steps below cover the same thing.</p>
      </section>
    )
  }
  const cue = prefs.cc ? cueAt(cues, t) : null
  const seek = s => { const el = ref.current; if (!el) return; el.currentTime = s; last.current = s; el.play().catch(() => {}) }
  const onMeta = () => { const el = ref.current; if (el) el.playbackRate = prefs.speed }
  const onTime = () => {
    const el = ref.current
    if (!el) return
    const now = el.currentTime
    setT(now)
    if (!el.paused && !el.seeking) prog.seen(last.current, now)
    last.current = now
  }
  const pct = Math.round((prog.pct || 0) * 100)
  return (
    <section className="fx-tile tr-video" style={{ '--i': 0 }} aria-label="Lesson video">
      <div className="tr-vid">
        <video ref={ref} src={v.url} poster={v.posterUrl || undefined} controls playsInline preload="metadata"
          onLoadedMetadata={onMeta} onTimeUpdate={onTime} onPlay={() => setStarted(true)} onSeeked={() => { last.current = ref.current?.currentTime || 0 }}
          onPause={() => prog.savePos(ref.current?.currentTime || 0)} onEnded={() => prog.savePos(0)} onError={() => setBroken(true)}
          aria-label={`Video: ${v.title}, ${fmtTime(v.duration)}`} />
        {cue && (
          <p className="tr-cc" aria-hidden="true">{cue.words.map((w, i) => <span key={i} className={i === cue.now ? 'is-now' : i < cue.now ? 'is-said' : ''}>{w} </span>)}</p>
        )}
        {!started && firstPos > 0 && <span className="tr-vid-resume" aria-hidden="true"><Play size={13} />{start != null ? `Starts at ${fmtTime(firstPos)}` : `Resumes at ${fmtTime(firstPos)}`}</span>}
      </div>
      <div className="tr-vbar">
        <span className="tr-vkind">{v.kind === 'walkthrough' ? <><Clapperboard size={14} aria-hidden="true" />Portal walkthrough</> : <><ListVideo size={14} aria-hidden="true" />Explainer</>} · <span className="tp-num">{fmtTime(v.duration)}</span></span>
        <span className="tp-grow" />
        {prog.watched
          ? <i className="fx-delta is-up"><CircleCheck size={12} aria-hidden="true" />Watched</i>
          : <small className="tr-vpct" aria-label={`${pct}% watched. ${Math.round(WATCHED_AT * 100)}% counts as watched.`}><span className="tr-bar" aria-hidden="true"><i style={{ '--w': prog.pct || 0 }} /></span><span className="tp-num">{pct}%</span></small>}
        <div className="tr-speed" role="radiogroup" aria-label="Speed">
          {SPEEDS.map(s => <button key={s} type="button" role="radio" aria-checked={prefs.speed === s} className={`fx-pillbtn${prefs.speed === s ? ' is-on' : ''}`} onClick={() => setPrefs(p => ({ ...p, speed: s }))}>{s}x</button>)}
        </div>
        <button type="button" className={`fx-pillbtn tr-ccbtn${prefs.cc ? ' is-on' : ''}`} aria-pressed={prefs.cc} onClick={() => setPrefs(p => ({ ...p, cc: !p.cc }))}>
          {prefs.cc ? <Captions size={15} aria-hidden="true" /> : <CaptionsOff size={15} aria-hidden="true" />}Captions
        </button>
      </div>
      {v.chapters?.length > 0 && (
        <details className="tr-chap">
          <summary>In this video · {v.chapters.length} parts</summary>
          <ol>{v.chapters.map(c => <li key={`${c.t}-${c.label}`}><button type="button" className="fx-mrow" onClick={() => seek(c.t)}><span className="tp-num">{fmtTime(c.t)}</span><span className="tp-grow">{c.label}</span></button></li>)}</ol>
        </details>
      )}
    </section>
  )
}
