import { useRef, useState } from 'react'
import { Music, Play, Pause, Upload, Bot } from 'lucide-react'
import { Chip, Switch, SampleTag, Empty, useNote } from '../../template/kit'
import { Dropdown, DField } from '../kit'
import { useAdmSettings } from '../data'
import { usePlaybookState, playbookActions } from '../../template/ful/playbook932Store'
import { FrontDeskNote } from '../../template/ful/Playbook932'
import '../../template/ful/playbook932.css'

// P932 — the Hold line (the music, the timings and the AI front desk), on Lines & pods › Limits and hold line.
// P936: the admin Carrier playbook page is off the rail. The playbook stays in the database and on the VA call panel,
// and VAs still fill "check on first call" entries after calls (template/ful/Playbook932.jsx).

const TRACKS = [{ key: 'calm', label: 'Calm', sub: 'Soft piano chords' }, { key: 'warm', label: 'Warm', sub: 'Mellow pads' }, { key: 'bright', label: 'Bright', sub: 'Light and upbeat' }]
const SECS = [15, 20, 30].map(v => ({ value: v, label: `${v} seconds` }))
const EVERY = [45, 60, 90].map(v => ({ value: v, label: `Every ${v} seconds` }))
const MAXW = [5, 10, 15].map(v => ({ value: v, label: `${v} minutes` }))

export function HoldLineSettings() {
  const s = usePlaybookState()
  const { data: adm } = useAdmSettings()
  const note = useNote()
  const h = s.hold
  const [playing, setPlaying] = useState(null)
  const audio = useRef(null)
  const file = useRef(null)
  const play = (key, url) => {
    if (audio.current) { audio.current.pause(); audio.current = null }
    if (playing === key) { setPlaying(null); return }
    const a = new Audio(url); a.onended = () => setPlaying(null); a.play().catch(() => setPlaying(null)); audio.current = a; setPlaying(key)
  }
  const sw = adm.switches || {}
  const set = (patch, msg) => { playbookActions.setHold(patch); if (msg) note(msg) }
  const upload = e => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    if (!/^audio\//.test(f.type)) { note('Pick an audio file (MP3 or WAV)'); return }
    if (f.size > 15 * 1024 * 1024) { note('Too big: 15 MB at most'); return }
    set({ track: 'custom', custom_name: f.name, custom_url: URL.createObjectURL(f) }, `Uploaded ${f.name} (sample)`)
  }
  return (
    <>
      <header className="fx-form-h"><h2>Hold line</h2><p>When every VA is on a call, the caller hears our music. After {h.ai_after_sec} seconds the AI front desk answers as Deedstone Insurance, finds who they are and what they need, says the wait and offers hold, a callback or the e-sign link. The first free VA (their pod first) gets the summary on screen. Waits over {h.max_wait_min} minutes and after hours become a booked callback. The same music plays when a VA holds a merge call.</p></header>
      <div className="tp-row tp-wrap">
        <Chip tone={sw.voice_live ? 'green' : 'mute'}>Calls {sw.voice_live ? 'on' : 'off'}</Chip>
        <Chip tone={sw.ai_caller_live ? 'green' : 'mute'}>AI {sw.ai_caller_live ? 'on' : 'off'}</Chip>
        <Chip tone={sw.sms_live ? 'green' : 'mute'}>Texts {sw.sms_live ? 'on' : 'off'}</Chip>
        <SampleTag>Sample</SampleTag>
      </div>
      <p className="tp-sub">Nothing plays or answers until Calls and AI are on (Settings › Switches). The e-sign-by-text choice is offered only while Texts is on.</p>

      <h3 className="fx-h3"><Music size={15} aria-hidden="true" /> Music</h3>
      <ul className="tp-list pba-tracks" role="radiogroup" aria-label="Hold music">
        {TRACKS.map(t => (
          <li key={t.key} className={`fx-form-row${h.track === t.key ? ' is-on' : ''}`}>
            <button type="button" className="tp-btn ov-ghost sm" onClick={() => play(t.key, `/hold/${t.key}.mp3`)} aria-label={`${playing === t.key ? 'Stop' : 'Play'} ${t.label}`}>{playing === t.key ? <Pause size={14} /> : <Play size={14} />}</button>
            <div className="tp-grow"><b>{t.label}</b><p className="tp-sub">{t.sub} · royalty-free, made for us</p></div>
            <button type="button" role="radio" aria-checked={h.track === t.key} className={h.track === t.key ? 'tp-primary fx-accent sm' : 'tp-btn ov-ghost sm'} onClick={() => set({ track: t.key }, `${t.label} is the hold music`)}>{h.track === t.key ? 'In use' : 'Use this'}</button>
          </li>
        ))}
        <li className={`fx-form-row${h.track === 'custom' ? ' is-on' : ''}`}>
          {h.custom_url ? <button type="button" className="tp-btn ov-ghost sm" onClick={() => play('custom', h.custom_url)} aria-label={`${playing === 'custom' ? 'Stop' : 'Play'} your upload`}>{playing === 'custom' ? <Pause size={14} /> : <Play size={14} />}</button> : <span className="pba-gap" />}
          <div className="tp-grow"><b>{h.custom_name || 'Your own track'}</b><p className="tp-sub">MP3 or WAV, 15 MB at most. Only use music you have the rights to.</p></div>
          <input ref={file} type="file" accept="audio/mpeg,audio/wav,audio/*" hidden onChange={upload} />
          {h.custom_url && h.track !== 'custom' && <button type="button" role="radio" aria-checked={false} className="tp-btn ov-ghost sm" onClick={() => set({ track: 'custom' }, 'Your track is the hold music')}>Use this</button>}
          <button type="button" className="tp-btn ov-ghost sm" onClick={() => file.current?.click()}><Upload size={14} />{h.custom_url ? 'Replace' : 'Upload'}</button>
        </li>
      </ul>

      <h3 className="fx-h3"><Bot size={15} aria-hidden="true" /> AI front desk</h3>
      <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>AI answers when everyone{'’'}s busy</b><p className="tp-sub">Off: the caller hears the wait and the music, with press 1 for a callback. No questions.</p></div>
        <Switch on={h.front_desk_on} label="AI front desk" onChange={v => set({ front_desk_on: v }, `AI front desk ${v ? 'on' : 'off'} (sample)`)} /></div>
      <div className="fx-form-grid">
        <DField label="AI answers after" hint="Music plays first."><Dropdown label="AI answers after" value={h.ai_after_sec} options={SECS} onChange={v => set({ ai_after_sec: v })} /></DField>
        <DField label="Wait update" hint="Press 1 for a callback, any time."><Dropdown label="Wait update" value={h.update_every_sec} options={EVERY} onChange={v => set({ update_every_sec: v })} /></DField>
        <DField label="Longest hold" hint="Then the callback is booked."><Dropdown label="Longest hold" value={h.max_wait_min} options={MAXW} onChange={v => set({ max_wait_min: v })} /></DField>
      </div>

      <h3 className="fx-h3">On hold now</h3>
      {s.waiting.length ? <ul className="tp-list pba-wait">{s.waiting.map(w => (
        <li key={w.id}><div className="tp-row"><b>{w.name}</b><span className="tp-sub">since {w.since} · about {w.minutes} min · {w.ahead ? `${w.ahead} ahead` : 'next'}</span></div><FrontDeskNote summary={w.summary} compact /></li>
      ))}</ul> : <Empty title="Nobody on hold" />}
    </>
  )
}
