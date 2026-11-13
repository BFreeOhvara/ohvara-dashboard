import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Captions, CaptionsOff, CircleCheck, Clapperboard, ListVideo, Lock, VideoOff } from 'lucide-react'
import { useAccount } from '../../template/kit'
import { clampSeek, cueMarkup, fmtTime, furthestOf, resumeAt, videoFor } from './videoModel.js'
import { useVideoProgress } from './videoStore.js'

// P877 — the lesson video at the top of a lesson: the browser's own controls, our captions (word-timed, from the same
// script the voice reads, on by default, toggle; P960: one text track on the video itself, the only caption source),
// chapters, resume where you left off. P985: no skipping ahead and no speeding up. They can go back freely, but never
// past the furthest point they have really played to (a drag, key, chapter or remote forward snaps back there, with
// "Watch to unlock the rest"); always normal speed. Watched = played to the end; then (or once the lesson is done,
// `free`) they can move anywhere. Their spot is saved per person, per lesson, per version, on the server when signed in
// (./videoStore.js). `start` (seconds) comes from the "?" on a task, and is held to what they may reach.
const PREFS = 'ful-training-video-prefs:v1'
const loadPrefs = () => { try { const p = JSON.parse(localStorage.getItem(PREFS) || '{}'); return { cc: p.cc !== false } } catch { return { cc: true } } }
const AHEAD = 0.75 // a little past the furthest point is just playback catching up
const FORWARD_KEYS = new Set(['ArrowRight', 'End', 'PageDown', 'l', 'L'])

export default function VideoPlayer({ lessonId, who, start = null, onEnded = null, variant = null, free = false }) {
  const v = useMemo(() => videoFor(lessonId, import.meta.env, variant), [lessonId, variant])
  const account = useAccount()
  const ref = useRef(null)
  const last = useRef(0)
  const [prefs, setPrefs] = useState(loadPrefs)
  const [loaded, setLoaded] = useState({ url: null, cues: null })
  const [broken, setBroken] = useState(false)
  const [started, setStarted] = useState(false)
  const [hint, setHint] = useState(false)
  const dur = v?.duration || 1
  const prog = useVideoProgress(who, lessonId, dur, v?.variant || null, !!account?.live)
  const open = free || !!prog.watched
  const savedFar = furthestOf(prog, dur)
  // The furthest point reached, kept live while playing (the store saves every couple of seconds).
  const far = useRef(0)
  const openRef = useRef(open)
  useEffect(() => { far.current = Math.max(far.current, savedFar) }, [savedFar])
  useEffect(() => { openRef.current = open }, [open])
  const limit = () => (openRef.current ? Infinity : Math.max(far.current, savedFar))

  // Where it opens: their spot (or the "?" moment), never past what they may reach. Follows the server copy until they
  // press play (a new device learns their spot a moment after opening).
  const target = start != null ? clampSeek(prog, start, dur, free) : resumeAt(prog, dur, free)
  const [firstPos, setFirstPos] = useState(target)
  if (!started && target !== firstPos) setFirstPos(target)
  const placed = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !firstPos) return undefined
    const go = () => { if (placed.current === firstPos) return; placed.current = firstPos; el.currentTime = firstPos; last.current = firstPos }
    if (el.readyState >= 1) go()
    el.addEventListener('loadedmetadata', go)
    return () => el.removeEventListener('loadedmetadata', go)
  }, [firstPos])

  const hintT = useRef(null)
  const nudge = () => { setHint(true); clearTimeout(hintT.current); hintT.current = setTimeout(() => setHint(false), 2600) }
  useEffect(() => () => clearTimeout(hintT.current), [])
  // Leaving the lesson saves the spot.
  const savePos = prog.savePos
  useEffect(() => { const el = ref.current; return () => { if (el && el.currentTime > 0 && !el.ended) savePos(el.currentTime) } }, [savePos])

  useEffect(() => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)) } catch { /* fine */ } }, [prefs])
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
  const seek = s => {
    const el = ref.current
    if (!el) return
    if (s > limit() + AHEAD) { nudge(); return }
    el.currentTime = s; last.current = s; el.play().catch(() => {})
  }
  const normal = () => { const el = ref.current; if (el) { el.defaultPlaybackRate = 1; if (el.playbackRate !== 1) el.playbackRate = 1 } }
  const onTime = () => {
    const el = ref.current
    if (!el) return
    const now = el.currentTime
    if (!el.paused && !el.seeking) {
      if (now > last.current && now - last.current <= 3 && last.current <= far.current + 1) far.current = Math.max(far.current, now)
      prog.seen(last.current, now)
    }
    last.current = now
  }
  // Any move forward past the furthest point (drag, keys, the native forward controls, a remote) snaps back.
  const onSeeking = () => {
    const el = ref.current
    if (!el) return
    const lim = limit()
    if (el.currentTime > lim + AHEAD) { el.currentTime = lim; last.current = lim; nudge() }
  }
  const onKey = e => { if (!openRef.current && FORWARD_KEYS.has(e.key)) { e.preventDefault(); e.stopPropagation(); nudge() } }
  const pct = Math.round((prog.pct || 0) * 100)
  const lim = open ? Infinity : savedFar
  return (
    <section className="fx-tile tr-video" style={{ '--i': 0 }} aria-label="Lesson video">
      <div className={`tr-vid${v.variant === 'phone' ? ' is-phone' : ''}`} onKeyDownCapture={onKey}>
        <video ref={ref} src={v.url} poster={v.posterUrl || undefined} controls playsInline preload="metadata"
          controlsList="noplaybackrate nodownload" disablePictureInPicture
          onLoadedMetadata={normal} onRateChange={normal} onTimeUpdate={onTime} onPlay={() => { normal(); setStarted(true) }} onSeeking={onSeeking}
          onSeeked={() => { last.current = ref.current?.currentTime || 0 }}
          onPause={() => { const el = ref.current; if (el && !el.ended) prog.savePos(el.currentTime || 0) }}
          onEnded={() => { far.current = Infinity; prog.finish(); onEnded?.() }} onError={() => setBroken(true)}
          aria-label={`Video: ${v.title}, ${fmtTime(v.duration)}${open ? '' : '. Watch it through to move ahead.'}`} />
        {!started && firstPos > 0 && <span className="tr-vid-resume" aria-hidden="true"><Play size={13} />{start != null ? `Starts at ${fmtTime(firstPos)}` : `Resumes at ${fmtTime(firstPos)}`}</span>}
        <span className={`tr-vid-hint${hint ? ' is-on' : ''}`} role="status" aria-live="polite">{hint ? <><Lock size={13} aria-hidden="true" />Watch to unlock the rest</> : null}</span>
      </div>
      <div className="tr-vbar">
        <span className="tr-vkind">{v.kind === 'walkthrough' ? <><Clapperboard size={14} aria-hidden="true" />Portal walkthrough</> : <><ListVideo size={14} aria-hidden="true" />Explainer</>} · <span className="tp-num">{fmtTime(v.duration)}</span></span>
        <span className="tp-grow" />
        {prog.watched
          ? <i className="fx-delta is-up"><CircleCheck size={12} aria-hidden="true" />Watched</i>
          : <small className="tr-vpct" aria-label={`${pct}% watched. Watch to the end to finish it.`}><span className="tr-bar" aria-hidden="true"><i style={{ '--w': prog.pct || 0 }} /></span><span className="tp-num">{pct}%</span></small>}
        <button type="button" className={`fx-pillbtn tr-ccbtn${prefs.cc ? ' is-on' : ''}`} aria-pressed={prefs.cc} onClick={() => setPrefs(p => ({ ...p, cc: !p.cc }))}>
          {prefs.cc ? <Captions size={15} aria-hidden="true" /> : <CaptionsOff size={15} aria-hidden="true" />}Captions
        </button>
      </div>
      {v.chapters?.length > 0 && (
        <details className="tr-chap">
          <summary>In this video · {v.chapters.length} parts</summary>
          <ol>{v.chapters.map(c => {
            const shut = c.t > lim + AHEAD
            return (
              <li key={`${c.t}-${c.label}`}>
                <button type="button" className={`fx-mrow${shut ? ' is-shut' : ''}`} aria-disabled={shut || undefined} title={shut ? 'Watch to unlock' : undefined} onClick={() => seek(c.t)}>
                  <span className="tp-num">{fmtTime(c.t)}</span><span className="tp-grow">{c.label}</span>{shut && <Lock size={12} aria-label="Locked" />}
                </button>
              </li>
            )
          })}</ol>
        </details>
      )}
    </section>
  )
}
