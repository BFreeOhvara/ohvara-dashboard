import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Captions, CaptionsOff, CircleCheck, Clapperboard, ListVideo, VideoOff } from 'lucide-react'
import { cueMarkup, fmtTime, resumeAt, videoFor, WATCHED_AT } from './videoModel.js'
import { useVideoProgress } from './videoStore.js'

// P877 — the lesson video at the top of a lesson: the browser's own controls, our captions (word-timed, from the same
// script the voice reads, on by default, toggle; P960: one text track on the video itself, the only caption source), speed 1x / 1.25x / 1.5x, chapters, resume where you left off, and
// "watched" once about 90% has really been played. `start` (seconds) comes from the "?" on a task.
const SPEEDS = [1, 1.25, 1.5]
const PREFS = 'ful-training-video-prefs:v1'
const loadPrefs = () => { try { return { cc: true, speed: 1, ...JSON.parse(localStorage.getItem(PREFS) || '{}') } } catch { return { cc: true, speed: 1 } } }

export default function VideoPlayer({ lessonId, who, start = null, onEnded = null }) {
  const v = useMemo(() => videoFor(lessonId, import.meta.env), [lessonId])
  const ref = useRef(null)
  const last = useRef(0)
  const [prefs, setPrefs] = useState(loadPrefs)
  const [loaded, setLoaded] = useState({ url: null, cues: null })
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
    fetch(v.captionsUrl).then(r => (r.ok ? r.json() : null)).then(c => { if (live) setLoaded({ url: v.captionsUrl, cues: c }) }).catch(() => {})
    return () => { live = false }
  }, [v?.captionsUrl])

  // P960 — the single caption source: one text track on the video, filled from the word-timed lines. The Captions button
  // shows/hides it; the browser's own CC menu stays in step with the button. The track is cleared when the lesson changes
  // so two sets of lines can never be on screen together, and the video file itself carries no captions.
  const cues = loaded.url && loaded.url === v?.captionsUrl ? loaded.cues : null // a new lesson never shows the last lesson's lines
  const trackRef = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !cues || typeof el.addTextTrack !== 'function' || typeof VTTCue === 'undefined') return undefined
    const tr = el.addTextTrack('captions', 'English', 'en')
    for (const c of cues) { try { tr.addCue(new VTTCue(c.t0, c.t1, cueMarkup(c))) } catch { /* skip a bad line */ } }
    tr.mode = 'disabled' // the effect below shows it when Captions is on
    trackRef.current = tr
    const onChange = () => { const on = tr.mode === 'showing'; setPrefs(p => (p.cc === on ? p : { ...p, cc: on })) }
    el.textTracks.addEventListener('change', onChange)
    return () => {
      el.textTracks.removeEventListener('change', onChange)
      tr.mode = 'disabled'
      for (const q of [...(tr.cues || [])]) tr.removeCue(q)
      if (trackRef.current === tr) trackRef.current = null
    }
  }, [cues])
  useEffect(() => { const tr = trackRef.current; if (tr) tr.mode = prefs.cc ? 'showing' : 'disabled' }, [prefs.cc, cues])

  if (!v) return null
  if (broken) {
    return (
      <section className="fx-tile tr-video is-missing" aria-label="Lesson video">
        <p className="fx-calm"><VideoOff size={16} aria-hidden="true" />The video for this lesson isn’t available here yet. The steps below cover the same thing.</p>
      </section>
    )
  }
  const seek = s => { const el = ref.current; if (!el) return; el.currentTime = s; last.current = s; el.play().catch(() => {}) }
  const onMeta = () => { const el = ref.current; if (el) el.playbackRate = prefs.speed }
  const onTime = () => {
    const el = ref.current
    if (!el) return
    const now = el.currentTime
    if (!el.paused && !el.seeking) prog.seen(last.current, now)
    last.current = now
  }
  const pct = Math.round((prog.pct || 0) * 100)
  return (
    <section className="fx-tile tr-video" style={{ '--i': 0 }} aria-label="Lesson video">
      <div className="tr-vid">
        <video ref={ref} src={v.url} poster={v.posterUrl || undefined} controls playsInline preload="metadata"
          onLoadedMetadata={onMeta} onTimeUpdate={onTime} onPlay={() => setStarted(true)} onSeeked={() => { last.current = ref.current?.currentTime || 0 }}
          onPause={() => prog.savePos(ref.current?.currentTime || 0)} onEnded={() => { prog.savePos(0); onEnded?.() }} onError={() => setBroken(true)}
          aria-label={`Video: ${v.title}, ${fmtTime(v.duration)}`} />
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
