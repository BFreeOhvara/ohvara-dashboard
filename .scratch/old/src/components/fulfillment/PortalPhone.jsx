import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useMarkCancelled, useEndCall } from '../../hooks/usePolicies'
import { useOneAtATime } from '../../hooks/useOneAtATime'
import { useAuth } from '../../hooks/useAuth'
import { zonedDateStr, DEFAULT_TIMEZONE } from '../../lib/timezones'
import { phoneView, clock } from '../../lib/portalPhone'
import { I, PAD } from './phoneIcons'

// Prompt 751 — the pop-up phone panel, a literal port of
// media/fulfillment-my-calls/phone.dc.html (its five stages are worked out in
// lib/portalPhone.js). Portaled to <body> so DashboardLayout's animated page
// wrapper can't trap its position: fixed (Gotchas).
// Prompt 764 (media/fulfillment-pay-per-cancel/phone.dc.html): a red
// Recording pill while a recorded call is live (recovery_config.recording_live);
// on the Result screen the confirmation number is optional, and saving a
// Cancelled says the AI will check the recording.


export const Svg = ({ d, size = 24, w = 2, stroke = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
)

export function Key({ k, icon, onPress, disabled }) {
  return (
    <button type="button" className="pp-key" data-on={!!k.on} disabled={disabled || k.off || !k.act} onClick={() => onPress(k.act)} aria-pressed={k.on ? true : undefined}>
      <span><Svg d={icon} /></span>{k.label}
    </button>
  )
}

const REASONS = [{ value: 'waiting_carrier', label: 'Waiting on carrier' }, { value: 'waiting_client', label: 'Waiting on client' }]

function Result({ p, s, onClose, error: callError, recording }) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const update = useMarkCancelled()
  const endCall = useEndCall()
  const cancelOnce = useOneAtATime(update)
  const endOnce = useOneAtATime(endCall)
  const [pick, setPick] = useState('cancelled')
  const [conf, setConf] = useState('')
  const [effective, setEffective] = useState(() => zonedDateStr(Date.now(), tz))
  const [drafts, setDrafts] = useState(false)
  const [reason, setReason] = useState(null)
  const [checking, setChecking] = useState(false) // saved as Cancelled, recording on
  const took = s.joinedAt && s.endedAt ? clock((s.endedAt - s.joinedAt) / 1000) : null
  // The confirmation number is optional while the call is recorded (P764): the
  // recording is the proof. With recording off it's the only proof (P784).
  const ready = pick === 'no_answer' || (effective && drafts && (recording || conf.trim()))
  const saving = update.isPending || endCall.isPending
  const error = update.error || endCall.error

  function save() {
    const done = { onSuccess: onClose }
    if (pick === 'cancelled') {
      // The same write as Mark cancelled, with the proof.
      cancelOnce({
        id: p.id, proof: { confirmation: conf.trim() || null, effectiveDate: effective, draftsStopped: true },
      }, recording ? { onSuccess: () => { setChecking(true); setTimeout(onClose, 2600) } } : done)
    } else {
      endOnce({ id: p.id, outcome: 'no_answer', reason }, done)
    }
  }

  return (
    <div className="pp-result">
      <div className="pp-result-h"><div>{took ? `Call ended · ${took}` : 'Call ended'}</div><div>How did it go?</div></div>
      <div className="pp-choice" role="radiogroup" aria-label="Result">
        {[['cancelled', 'Cancelled'], ['no_answer', 'No answer']].map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={pick === v} data-on={pick === v} data-v={v} onClick={() => setPick(v)}>{l}</button>
        ))}
      </div>
      {pick === 'cancelled' ? (
        <>
          <label className="pp-field"><span>Confirmation number {recording ? <em>(optional)</em> : <em>(needed)</em>}</span>
            <input className="pp-mono" value={conf} onChange={e => setConf(e.target.value)} placeholder={recording ? 'If the carrier gave one' : 'The number the carrier read out'} autoComplete="off" />
          </label>
          <label className="pp-field"><span>Takes effect</span>
            <input type="date" value={effective} onChange={e => setEffective(e.target.value)} />
          </label>
          <button type="button" className="pp-check" data-on={drafts} role="checkbox" aria-checked={drafts} onClick={() => setDrafts(v => !v)}>
            <i>{drafts && <Svg d={I.check} size={12} w={3.2} />}</i>No more payments will be drafted
          </button>
          {checking && (
            <p className="pp-checking" role="status"><span aria-hidden="true" />Saved. AI listens to the recording to check the carrier confirmed the cancel.</p>
          )}
        </>
      ) : (
        <div>
          <div className="pp-field"><span>Why it needs another call · optional</span></div>
          <div className="pp-reasons">
            {REASONS.map(r => (
              <button key={r.value} type="button" data-on={reason === r.value} aria-pressed={reason === r.value} onClick={() => setReason(x => (x === r.value ? null : r.value))}>{r.label}</button>
            ))}
          </div>
        </div>
      )}
      <div style={{ flex: 1 }} />
      {(error || callError) && <p className="pp-note" data-tone="err" style={{ margin: 0 }}>{error ? `Couldn't save: ${error.message || 'try again'}` : callError}</p>}
      <button type="button" className="pp-save" disabled={!ready || saving || checking} onClick={save}>{saving ? 'Saving…' : checking ? 'Saved' : 'Save'}</button>
      <span className="pp-fine">
        Picked the wrong one? <button type="button" className="pp-link" onClick={() => navigate(`/fulfillment/desk?open=${p.id}`)}>Change it</button> until the end of the day.
      </span>
    </div>
  )
}

export function PortalPhone({ s, names, legs, answered, muted, busy, error, canRingCarrier, devices, onDevice, onPress, onAllowMic, onCollapse, onClose, recording = false }) {
  const [now, setNow] = useState(() => Date.now())
  const [pad, setPad] = useState(false)
  const [typed, setTyped] = useState('')
  const [menu, setMenu] = useState(false)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const preview = s.mode === 'preview'
  const inCall = s.mode === 'call' || s.mode === 'connecting' || preview
  const v = phoneView({ legs: preview ? [] : legs, names, answered, canRingCarrier, muted, now })
  // Preview: the first stage's look, nothing live.
  const view = preview ? { ...v, sub: 'Client', tip: null, timer: '00:00' } : v
  const keypadOn = pad && view.keys.keypad.act
  const off = preview || s.mode === 'connecting' || !!busy

  if (s.collapsed) {
    return createPortal(
      <div className="pp-pill" data-bg={inCall ? view.bg : 'navy'} role="region" aria-label="Phone">
        <span className="pp-dot" data-tone={view.bg === 'amber' ? 'hold' : undefined} />
        <b>{s.mode === 'result' ? 'How did it go?' : view.name}</b>
        {s.mode === 'call' && <span className="pp-timer">{view.timer}</span>}
        <button type="button" className="pp-round" onClick={() => onCollapse(false)} aria-label="Open the phone"><Svg d={I.up} size={13} w={2.4} /></button>
      </div>,
      document.body,
    )
  }

  const press = (act, extra) => {
    if (act === 'keypad') { setPad(true); setTyped(''); return }
    onPress(act, extra)
  }
  const dial = d => { setTyped(t => (t + d).slice(-18)); onPress('dtmf', { digits: d }) }

  return createPortal(
    <div className="pp-phone" data-bg={inCall ? view.bg : 'navy'} data-tight={inCall && (view.other || preview) && (view.tip || preview) ? '' : undefined} role="dialog" aria-label="Phone">
      <div className="pp-top">
        <button type="button" className="pp-dev" onClick={() => devices && setMenu(m => !m)} aria-expanded={menu} aria-label="Audio devices">
          <Svg d={I.headset} size={14} w={2.2} />{devices?.label || 'Headset'}
        </button>
        {recording && s.mode === 'call' && <span className="pp-rec" role="status"><i aria-hidden="true" />Recording</span>}
        <button type="button" className="pp-round" onClick={() => (preview ? onClose() : onCollapse(true))} aria-label={preview ? 'Close the phone' : 'Collapse the phone'}>
          <Svg d={I.down} size={13} w={2.4} />
        </button>
        {menu && devices && (
          <div className="pp-menu">
            <label>Microphone
              <select value={devices.input} onChange={e => { onDevice('input', e.target.value); setMenu(false) }}>
                {devices.inputs.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </label>
            {devices.outputs.length > 0 && (
              <label>Speaker
                <select value={devices.output} onChange={e => { onDevice('output', e.target.value); setMenu(false) }}>
                  {devices.outputs.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
      </div>

      {s.mode === 'mic' && (
        <div className="pp-mic">
          <span className="pp-av"><Svg d={I.mic} /></span>
          <h3>Allow your microphone to call from the portal</h3>
          <p>Your browser will ask once. Use a headset so the client and the carrier hear you clearly.</p>
          <button type="button" className="pp-save" style={{ width: '100%' }} onClick={onAllowMic}>Allow microphone</button>
          {error && <p className="pp-note" data-tone="err" style={{ margin: 0 }}>{error}</p>}
          <button type="button" className="pp-link" style={{ fontSize: 13 }} onClick={onClose}>Not now</button>
        </div>
      )}

      {inCall && (
        <>
          {view.other && (
            <div className="pp-other">
              <span className="pp-dot" data-tone={view.other.dot} />
              <b>{view.other.name}</b>
              <em>{view.other.state}</em>
            </div>
          )}
          <div className="pp-who">
            <div className="pp-avs">
              {view.avatars.map(a => <span key={a.key} className="pp-av" data-tone={a.tone}>{a.t}</span>)}
            </div>
            <div className="pp-timer">{view.timer}</div>
            <div className="pp-name">{view.name}</div>
            <div className="pp-sub" data-tone={view.subTone}>
              {view.bars && <span className="pp-bars" aria-hidden="true"><i /><i /><i /></span>}
              {view.sub}
            </div>
            <div style={{ flex: 1 }} />
          </div>

          {preview && (
            <p className="pp-note">
              Calling in the portal turns on when Ohvara's phone number is approved. Until then, use Call client.{' '}
              <button type="button" className="pp-link" onClick={onClose}>Close</button>
            </p>
          )}
          {!preview && error && <p className="pp-note" data-tone="err">{error}</p>}

          {view.tip && !keypadOn && (
            <div className="pp-tip">
              <span className="pp-tip-t"><b>{view.tip.title}</b><span>{view.tip.text}</span></span>
              <button type="button" className="pp-pill-btn" disabled={off} onClick={() => press(view.tip.act)}>{view.tip.btn}</button>
            </div>
          )}

          {keypadOn ? (
            <>
              <div className="pp-typed" aria-live="polite">{typed}</div>
              <div className="pp-pad">
                {PAD.map(d => <button key={d} type="button" disabled={off} onClick={() => dial(d)} aria-label={`Send ${d}`}>{d}</button>)}
              </div>
            </>
          ) : (
            <div className="pp-keys">
              <Key k={view.keys.mute} icon={I.mic} onPress={press} disabled={preview} />
              <Key k={view.keys.keypad} icon={I.keypad} onPress={press} disabled={off} />
              <Key k={view.keys.hold} icon={I.pause} onPress={a => press(a, { party: view.keys.hold.party })} disabled={off} />
              <Key k={view.keys.ring} icon={I.add} onPress={press} disabled={off} />
              <Key k={view.keys.swap} icon={I.swap} onPress={press} disabled={off} />
              <Key k={view.keys.merge} icon={I.merge} onPress={press} disabled={off} />
            </div>
          )}

          <div className="pp-end-row">
            <button type="button" className="pp-key pp-end" disabled={preview}
              onClick={() => onPress(s.mode === 'connecting' ? 'end_all' : view.end.act, view.end.party ? { party: view.end.party } : undefined)}>
              <span><Svg d={I.end} size={26} w={2.2} stroke="var(--pp-ink)" /></span>{view.endLabel}
            </button>
            {keypadOn && <button type="button" className="pp-hide" onClick={() => setPad(false)}>Hide</button>}
          </div>
        </>
      )}

      {s.mode === 'result' && <Result p={s.p} s={s} onClose={onClose} error={error} recording={recording} />}
    </div>,
    document.body,
  )
}
