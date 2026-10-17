import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, PhoneMissed, MessageSquareText, CalendarDays, Mic, ChevronUp } from 'lucide-react'
import { useMarkCancelled, useEndCall } from '../../../hooks/usePolicies'
import { usePaySettings } from '../../../hooks/useFulfillmentPayouts'
import { useAuth } from '../../../hooks/useAuth'
import { zonedDateStr, DEFAULT_TIMEZONE } from '../../../lib/timezones'
import { phoneView, clock } from '../../../lib/portalPhone'
import { fmtCents } from '../../../lib/payPeriod'
import { Svg, Key } from '../PortalPhone'
import { I, PAD } from '../phoneIcons'
import { PhoneSheet } from '../../agent/phone/PhoneSheet'

// Prompt 773 — the call screen on a Fulfillment rep's phone (mockups
// FulCall.dc.html + FulResult.dc.html): the desktop pop-up phone's stages and
// controls, full screen. Minimize (chevron, top left) drops to a slim red
// "On a call · mm:ss" bar above the tab bar; tapping it brings the call back.
// The Recording pill shows the whole call (P764). Once both lines are merged,
// "Get the number" swaps the keys for the confirmation-number card; the number
// carries into "How did it go?", which opens as a bottom sheet when the call
// ends. Same props and the same Twilio logic as PortalPhone (the provider
// picks one or the other).

const whole = cents => (cents % 100 ? fmtCents(cents) : fmtCents(cents).replace(/\.00$/, ''))
const first = name => (name || '').trim().split(/\s+/)[0] || 'The client'

function Result({ p, s, names, conf: saidConf, onClose, onDismiss, error: callError, recording, smsLive }) {
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const update = useMarkCancelled()
  const endCall = useEndCall()
  const { data: pay } = usePaySettings()
  const [pick, setPick] = useState('cancelled')
  const [conf, setConf] = useState(saidConf || '')
  const [effective, setEffective] = useState(() => zonedDateStr(Date.now(), tz))
  const [drafts, setDrafts] = useState(false)
  const [checking, setChecking] = useState(false)
  const took = s.joinedAt && s.endedAt ? clock((s.endedAt - s.joinedAt) / 1000) : null
  const ready = pick === 'no_answer' || (effective && drafts)
  const saving = update.isPending || endCall.isPending
  const error = update.error || endCall.error
  const amount = pay?.pay_per_cancel_cents != null ? whole(pay.pay_per_cancel_cents) : null
  const name = first(names.client)

  function save() {
    if (pick === 'cancelled') {
      update.mutate({
        id: p.id, proof: { confirmation: conf.trim() || null, effectiveDate: effective, draftsStopped: true },
      }, { onSuccess: recording ? () => { setChecking(true); setTimeout(onClose, 2600) } : onClose })
    } else {
      endCall.mutate({ id: p.id, outcome: 'no_answer' }, { onSuccess: onClose })
    }
  }

  const steps = smsLive ? [
    { icon: MessageSquareText, t: `${name} gets a text`, s: 'With a link to pick a new time that works for them.' },
    { icon: CalendarDays, t: 'No pick? Back on your calendar', s: `We put ${name} on tomorrow at the same time and text a reminder that morning.` },
  ] : [
    { icon: CalendarDays, t: 'Back on your calendar', s: `${name} stays on your calendar for another try.` },
  ]

  return (
    <PhoneSheet label="How did it go?" head={<span />} onClose={onDismiss}
      foot={(
        <div className="ph-foot-main pc-res-foot">
          {(error || callError) && <p className="pc-res-err" role="alert">{error ? `Couldn't save: ${error.message || 'try again'}` : callError}</p>}
          <button type="button" className="ov-solid pc-res-save" disabled={!ready || saving || checking} onClick={save}>
            {saving ? 'Saving…' : checking ? 'Saved' : 'Save'}
          </button>
          <span className="pc-res-fine">Picked the wrong one? You can change it until the end of the day.</span>
        </div>
      )}>
      <div className={`pc-res is-${pick === 'cancelled' ? 'cx' : 'na'}`}>
        <div className="pc-res-h">
          <div>{took ? `Call ended · ${took}` : 'Call ended'}</div>
          <h2>How did it go?</h2>
          <div>{[names.client, names.carrier].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="pc-choice" role="radiogroup" aria-label="Result">
          {[['cancelled', 'Cancelled', Check], ['no_answer', 'No answer', PhoneMissed]].map(([v, l, Icon]) => (
            <button key={v} type="button" role="radio" aria-checked={pick === v} data-on={pick === v} data-v={v} onClick={() => setPick(v)}>
              <Icon size={18} strokeWidth={2.4} aria-hidden="true" />{l}
            </button>
          ))}
        </div>
        {pick === 'cancelled' ? (
          <div className="pc-res-fields">
            <label className="pc-field"><span>Confirmation number <em>(optional)</em></span>
              <input className="pc-mono" value={conf} onChange={e => setConf(e.target.value)} placeholder="If the carrier gave one" autoComplete="off" />
            </label>
            <label className="pc-field"><span>Takes effect</span>
              <input type="date" value={effective} onChange={e => setEffective(e.target.value)} />
            </label>
            <button type="button" className="pc-check" data-on={drafts} role="checkbox" aria-checked={drafts} onClick={() => setDrafts(v => !v)}>
              <i>{drafts && <Check size={13} strokeWidth={3.2} aria-hidden="true" />}</i>No more payments will be drafted
            </button>
            <div className="pc-ai">
              <Mic size={20} strokeWidth={2} aria-hidden="true" />
              <span>
                {recording ? `After you save, AI listens to the recording to check ${names.carrier} confirmed the cancel. ` : ''}
                {amount ? <>You get <b>{amount}</b> once it's verified.</> : "You're paid once it's verified."}
              </span>
            </div>
            {checking && <p className="pc-checking" role="status"><span aria-hidden="true" />Saved. AI is listening to the recording now.</p>}
          </div>
        ) : (
          <div className="pc-res-fields">
            {steps.map(st => {
              const Icon = st.icon
              return (
                <div key={st.t} className="pc-step">
                  <span className="pc-step-ic"><Icon size={16} strokeWidth={2} aria-hidden="true" /></span>
                  <span><b>{st.t}</b><span>{st.s}</span></span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </PhoneSheet>
  )
}

export function PhoneCall({ s, names, legs, answered, muted, busy, error, canRingCarrier, onPress, onAllowMic, onCollapse, onClose, recording = false, smsLive = false }) {
  const [now, setNow] = useState(() => Date.now())
  const [pad, setPad] = useState(false)
  const [typed, setTyped] = useState('')
  const [confOpen, setConfOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saidConf, setSaidConf] = useState('')
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  // The page behind a full-screen call doesn't scroll.
  const full = !s.collapsed && s.mode !== 'result'
  useEffect(() => {
    if (!full) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [full])

  const preview = s.mode === 'preview'
  const inCall = s.mode === 'call' || s.mode === 'connecting' || preview
  const v = phoneView({ legs: preview ? [] : legs, names, answered, canRingCarrier, muted, now })
  const view = preview ? { ...v, sub: 'Client', tip: null, timer: '00:00' } : v
  const keypadOn = pad && view.keys.keypad.act
  const off = preview || s.mode === 'connecting' || !!busy
  const merged = view.stage === 'merged'
  const conf = confOpen && merged && !preview
  const total = s.joinedAt ? clock((now - s.joinedAt) / 1000) : view.timer
  // Both lines on: the carrier confirms the cancel, then reads the number out.
  const tip = view.tip || (merged && !saidConf && !preview
    ? { title: 'Got the cancel?', text: `Ask ${names.carrier} for the confirmation number.`, btn: 'Get the number', act: 'conf' }
    : null)

  if (s.mode === 'result' && !s.collapsed) {
    return (
      <Result p={s.p} s={s} names={names} conf={saidConf} onClose={onClose} onDismiss={() => onCollapse(true)}
        error={error} recording={recording} smsLive={smsLive} />
    )
  }

  if (s.collapsed) {
    const result = s.mode === 'result'
    return createPortal(
      <button type="button" className="pc-bar" onClick={() => onCollapse(false)}
        aria-label={result ? `How did it go with ${names.client}? Open` : `On a call with ${names.client}, ${total}. Open the call`}>
        <span className="pc-bar-dot" aria-hidden="true" />
        <b>{result ? 'Call ended · how did it go?' : 'On a call'}</b>
        {!result && s.mode === 'call' && <span className="pc-bar-time">{total}</span>}
        <span className="pc-bar-name">{names.client}</span>
        <ChevronUp size={18} strokeWidth={2.4} aria-hidden="true" />
      </button>,
      document.body,
    )
  }

  const press = (act, extra) => {
    if (act === 'keypad') { setPad(true); setTyped(''); return }
    if (act === 'conf') { setConfOpen(true); setPad(false); return }
    onPress(act, extra)
  }
  const dial = d => { setTyped(t => (t + d).slice(-18)); onPress('dtmf', { digits: d }) }

  return createPortal(
    <div className="pp-phone pc-screen" data-phone="" data-bg={inCall ? view.bg : 'navy'} role="dialog" aria-modal="true" aria-label="Call">
      <div className="pc-top">
        <button type="button" className="pc-min" onClick={() => (preview || s.mode === 'mic' ? onClose() : onCollapse(true))}
          aria-label={preview || s.mode === 'mic' ? 'Close the phone' : 'Minimize the call'}>
          <Svg d={I.down} size={20} w={2.4} />
        </button>
        {recording && (s.mode === 'call' || s.mode === 'connecting') ? <span className="pp-rec pc-rec" role="status"><i aria-hidden="true" />Recording</span> : <span />}
        <span className="pc-top-pad" aria-hidden="true" />
      </div>

      {s.mode === 'mic' && (
        <div className="pp-mic">
          <span className="pp-av"><Svg d={I.mic} /></span>
          <h3>Allow your microphone to call from the portal</h3>
          <p>Your phone will ask once. Use earbuds so the client and the carrier hear you clearly.</p>
          <button type="button" className="pp-save pc-wide" onClick={onAllowMic}>Allow microphone</button>
          {error && <p className="pp-note" data-tone="err" style={{ margin: 0 }}>{error}</p>}
          <button type="button" className="pp-link pc-link" onClick={onClose}>Not now</button>
        </div>
      )}

      {inCall && (
        <>
          {view.other && (
            <div className="pp-other pc-other">
              <span className="pp-dot" data-tone={view.other.dot} />
              <b>{view.other.name}</b>
              <em>{view.other.state}</em>
            </div>
          )}
          <div className={`pp-who pc-who${conf ? ' is-tight' : view.other ? ' has-other' : ''}`}>
            <div className="pp-avs">
              {view.avatars.map(a => <span key={a.key} className="pp-av" data-tone={a.tone}>{a.t}</span>)}
            </div>
            <div className="pp-timer">{view.timer}</div>
            <div className="pp-name">{view.name}</div>
            <div className="pp-sub" data-tone={view.subTone}>
              {view.bars && <span className="pp-bars" aria-hidden="true"><i /><i /><i /></span>}
              {view.sub}
            </div>
            {saidConf && merged && !conf && <div className="pc-said">Number saved · <span className="pc-mono">{saidConf}</span></div>}
            <div style={{ flex: 1 }} />
          </div>

          {preview && (
            <p className="pp-note">
              Calling in the portal turns on when Ohvara's phone number is approved. Until then, use Call client.{' '}
              <button type="button" className="pp-link" onClick={onClose}>Close</button>
            </p>
          )}
          {!preview && error && <p className="pp-note" data-tone="err">{error}</p>}

          {tip && !keypadOn && !conf && (
            <div className="pp-tip pc-tip">
              <span className="pp-tip-t"><b>{tip.title}</b><span>{tip.text}</span></span>
              <button type="button" className="pp-pill-btn pc-tip-btn" disabled={off && tip.act !== 'conf'} onClick={() => press(tip.act)}>{tip.btn}</button>
            </div>
          )}

          {conf ? (
            <div className="pc-conf">
              <div className="pc-conf-h"><span aria-hidden="true" />Get the confirmation number</div>
              <label className="pc-field">
                <span>Confirmation number from {names.carrier}</span>
                <input className="pc-mono" value={draft} onChange={e => setDraft(e.target.value)} autoComplete="off" autoFocus placeholder="Type it as they read it" />
              </label>
              <p>
                Ask {names.carrier} to read it out loud: “Could you read me the confirmation number?”
                {recording ? ' The recording is the proof, so it has to be said on the call.' : ' It goes with the cancel when you save.'}
              </p>
              <button type="button" className="pp-save pc-wide" onClick={() => { setSaidConf(draft.trim()); setConfOpen(false) }}>
                {draft.trim() ? 'Number saved · carrier can go' : 'Back to the call'}
              </button>
            </div>
          ) : keypadOn ? (
            <>
              <div className="pp-typed" aria-live="polite">{typed}</div>
              <div className="pp-pad pc-pad">
                {PAD.map(d => <button key={d} type="button" disabled={off} onClick={() => dial(d)} aria-label={`Send ${d}`}>{d}</button>)}
              </div>
            </>
          ) : (
            <div className="pp-keys pc-keys">
              <Key k={view.keys.mute} icon={I.mic} onPress={press} disabled={preview} />
              <Key k={view.keys.keypad} icon={I.keypad} onPress={press} disabled={off} />
              <Key k={view.keys.hold} icon={I.pause} onPress={a => press(a, { party: view.keys.hold.party })} disabled={off} />
              <Key k={view.keys.ring} icon={I.add} onPress={press} disabled={off} />
              <Key k={view.keys.swap} icon={I.swap} onPress={press} disabled={off} />
              <Key k={view.keys.merge} icon={I.merge} onPress={press} disabled={off} />
            </div>
          )}

          <div className="pp-end-row pc-end-row">
            <button type="button" className="pp-key pp-end" disabled={preview}
              onClick={() => onPress(s.mode === 'connecting' ? 'end_all' : view.end.act, view.end.party ? { party: view.end.party } : undefined)}>
              <span><Svg d={I.end} size={28} w={2.2} stroke="var(--pp-ink)" /></span>{view.endLabel}
            </button>
            {keypadOn && <button type="button" className="pp-hide pc-hide" onClick={() => setPad(false)}>Hide</button>}
          </div>
        </>
      )}
    </div>,
    document.body,
  )
}
