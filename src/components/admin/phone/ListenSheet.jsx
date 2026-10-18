import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Pause, Play } from 'lucide-react'
import { useDecideCancel, loadRecordingUrl } from '../../../hooks/useFulfillmentPayouts'
import { money, clock } from '../../../lib/adminPayouts'
import { PhoneSheet } from '../../agent/phone/PhoneSheet'
import { listenWhen } from './useAdminPay'
import { useOnce } from '../../../hooks/useOneAtATime'

// Prompt 774 — "Needs a listen" as a bottom sheet (mockup AdmListen.dc.html):
// who, what and why, a player (big waveform, −15 / play / +15) streaming from
// fulfillment-recording (admin only, never stored), a Jump to chip at the
// moment the AI pointed at, and Pay it / Don't pay through the same
// fulfillment_decide_cancel RPC as desktop Payouts (a note is needed for
// Don't pay, as there). `loadAudio` is swappable for the QA harness.

const BARS = 40

// Same bars every time for a cancel, so the wave doesn't shuffle.
function bars(id) {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return Array.from({ length: BARS }, (_, i) => 8 + Math.round(Math.abs(Math.sin(i * 1.7 + (h % 7)) * 26 + Math.sin(i * 0.6 + (h % 5)) * 12)))
}

function why(c) {
  const carrier = c.carrier_name || 'the carrier'
  if (c.reason === 'no_recording') return 'No recording was found for this call. Decide from what you know.'
  if (c.reason === 'agent_flag') return 'The agent flagged this cancel. Listen, then decide.'
  if (c.reason === 'over_cap') return 'This one is over the weekly cap. Listen, then decide.'
  return `AI couldn’t hear ${carrier} confirm the cancel. Listen, then decide.`
}

let playing = null // one recording at a time

function Player({ c, loadAudio }) {
  const rec = c.recording
  const start = Number(c.listen_at_seconds) || 0
  const hasAudio = !!(c.recording_id && rec?.status === 'ready')
  const [phase, setPhase] = useState('idle') // idle · loading · ready · error
  const [on, setOn] = useState(false)
  const [at, setAt] = useState(start)
  const [len, setLen] = useState(rec?.duration_seconds || 0)
  const [err, setErr] = useState('')
  const audio = useRef(null)
  const url = useRef(null)
  const seekTo = useRef(start) // where to start once the audio has loaded
  const heights = useMemo(() => bars(c.id), [c.id])

  useEffect(() => () => {
    audio.current?.pause()
    if (playing === audio.current) playing = null
    if (url.current) URL.revokeObjectURL(url.current)
  }, [])

  async function ensure() {
    if (audio.current) return audio.current
    setPhase('loading'); setErr('')
    try {
      url.current = await loadAudio(c.recording_id)
    } catch (e) { setErr(e.message); setPhase('error'); return null }
    const a = new Audio(url.current)
    a.addEventListener('timeupdate', () => setAt(a.currentTime))
    a.addEventListener('play', () => setOn(true))
    a.addEventListener('pause', () => setOn(false))
    a.addEventListener('ended', () => setOn(false))
    // A file the phone can't decode fails here, not in play().
    a.addEventListener('error', () => { setOn(false); setErr('Couldn’t play this recording on this phone.') })
    a.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(a.duration) && a.duration > 0) setLen(a.duration)
      if (seekTo.current && seekTo.current < (a.duration || Infinity)) a.currentTime = seekTo.current
    }, { once: true })
    audio.current = a
    setPhase('ready')
    return a
  }

  async function play() {
    const a = await ensure()
    if (!a) return
    if (playing && playing !== a) playing.pause()
    playing = a
    a.play().catch(e => setErr(e.name === 'NotAllowedError' ? 'Tap play again to listen.' : 'Couldn’t play this recording on this phone.'))
  }

  async function toggle() {
    if (on) { audio.current.pause(); return }
    play()
  }

  // Before the audio loads, a seek just moves where it will start.
  function seek(sec, andPlay = false) {
    const t = Math.max(0, len ? Math.min(len, sec) : sec)
    seekTo.current = t
    setAt(t)
    if (audio.current) audio.current.currentTime = t
    if (andPlay && !on) play()
  }

  const done = len ? Math.min(1, at / len) : 0
  const marks = c.listen_at_seconds != null && Number(c.listen_at_seconds) > 0
    ? [{ t: Number(c.listen_at_seconds), l: c.reason === 'over_cap' ? 'Carrier confirms the cancel' : 'Where the cancel comes up' }]
    : []

  return (
    <>
      <div className="aph-player">
        <div className="aph-wave" aria-hidden="true"
          onClick={e => { if (!hasAudio || !len) return; const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * len) }}>
          {heights.map((h, i) => <span key={i} className={i / BARS < done ? 'is-on' : ''} style={{ height: h }} />)}
        </div>
        <div className="aph-times ph-mono">
          <span>{hasAudio ? clock(at) : '—'}</span><span>{hasAudio && len ? clock(len) : '—'}</span>
        </div>
        <div className="aph-ctrls">
          <button type="button" className="aph-skip" disabled={!hasAudio} onClick={() => seek(at - 15)} aria-label="Back 15 seconds">−15</button>
          <button type="button" className="aph-play" disabled={!hasAudio || phase === 'loading'} onClick={toggle}
            aria-label={on ? 'Pause the recording' : 'Play the recording'}>
            {phase === 'loading' ? <Loader2 size={24} className="animate-spin" aria-hidden="true" />
              : on ? <Pause size={24} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                : <Play size={24} fill="currentColor" strokeWidth={0} aria-hidden="true" style={{ marginLeft: 3 }} />}
          </button>
          <button type="button" className="aph-skip" disabled={!hasAudio} onClick={() => seek(at + 15)} aria-label="Forward 15 seconds">+15</button>
        </div>
        {!hasAudio && <p className="aph-noaudio">No recording to play for this call.</p>}
        {err && <p role="alert" className="aph-err">{err}</p>}
      </div>
      {hasAudio && marks.length > 0 && (
        <div>
          <div className="aph-label">Jump to</div>
          <div className="aph-marks">
            {marks.map(m => (
              <button key={m.t} type="button" className="aph-mark" onClick={() => seek(m.t, true)}>
                <span className="ph-mono">{clock(m.t)}</span>{m.l}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

export function ListenSheet({ c, rep, tz, onClose, onDecided, loadAudio = loadRecordingUrl }) {
  const decide = useDecideCancel()
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState('')
  const [hint, setHint] = useState('')
  const [error, setError] = useState('')
  const repName = rep?.full_name || 'The rep'
  const busy = decide.isPending
  const once = useOnce() // P780: a double-tap decides once

  const go = once(async pay => {
    if (!pay && note.trim().length < 3) { setNoting(true); setHint('Say why it isn’t paid'); return }
    setHint(''); setError('')
    try {
      await decide.mutateAsync({ id: c.id, pay, note })
      onDecided?.(pay)
    } catch (e) { setError(e.message) }
  })

  return (
    <PhoneSheet
      label="Needs a listen" onClose={onClose}
      head={(
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="aph-kicker">Needs a listen</span>
          <span className="aph-title">{c.client_name || 'Client'} · <span className="ph-mono">{money(c.amount_cents)}</span></span>
          <span className="aph-sub">{[c.carrier_name, repName, listenWhen(c.logged_at, tz)].filter(Boolean).join(' · ')}</span>
        </span>
      )}
      foot={(
        <div className="ph-foot-main" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {noting && (
            <input className="aph-note" value={note} onChange={e => { setNote(e.target.value); setHint('') }}
              placeholder="Why it isn’t paid (needed)" aria-label="Note" maxLength={300} autoFocus />
          )}
          {hint && <span role="alert" className="aph-err">{hint}</span>}
          {error && <span role="alert" className="aph-err">{error}</span>}
          <div className="aph-btnrow">
            <button type="button" className="aph-pay" disabled={busy} onClick={() => go(true)}>
              {busy && decide.variables?.pay ? 'Paying…' : <>Pay it · <span className="ph-mono">{money(c.amount_cents)}</span></>}
            </button>
            <button type="button" className="aph-nopay" disabled={busy} onClick={() => go(false)}>
              {busy && decide.variables && !decide.variables.pay ? 'Saving…' : 'Don’t pay'}
            </button>
          </div>
          <span className="aph-footnote">{repName} sees your choice on their pay page.</span>
        </div>
      )}
    >
      <div className="aph-listen">
        <div className="aph-why">{why(c)}</div>
        <Player c={c} loadAudio={loadAudio} />
      </div>
    </PhoneSheet>
  )
}
