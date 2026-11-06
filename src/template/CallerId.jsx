import { useState } from 'react'
import { PhoneCall, RotateCcw, ShieldCheck } from 'lucide-react'
import { Chip, Switch, useNote } from './kit'
import './calls.css'

// P847 — optional agent caller ID, in Settings. When fulfillment calls the agent's client, the call shows the agent's
// number, so the client sees who it is (they often have it saved, like "John Insurance"). It keeps the live system's
// shape (migration 108_agent_caller_id + the agent-caller-id function): start gives a 6-digit code and the phone
// rings; the agent types the code on the keypad; check confirms; the agent keeps an on/off switch.
// Sample only: no call or text goes out from here. status: not_set | pending | confirmed
const STATUS = { not_set: ['mute', 'Not set'], pending: ['warn', 'Pending'], confirmed: ['green', 'Confirmed'] }

export function CallerIdCard({ value, onSave, defaultPhone }) {
  const note = useNote()
  const [phone, setPhone] = useState(value.number || defaultPhone || '')
  const v = value
  const [tone, word] = STATUS[v.status] || STATUS.not_set
  const digits = phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  const okPhone = digits.length === 10
  const start = () => { onSave({ status: 'pending', number: phone.trim(), code: '482 913', on: true }); note('Sample: in the live portal your phone would ring now') }
  return (
    <section className="fx-callerid" aria-label="Caller ID">
      <header className="fx-callerid-h">
        <span className="fx-callerid-ic"><PhoneCall size={17} aria-hidden="true" /></span>
        <span className="tp-grow"><b>Confirm your phone number</b><small>Optional. When fulfillment calls your clients, the call shows your number, so they know it{'’'}s you.</small></span>
        <Chip tone={tone}>{word}</Chip>
      </header>

      {v.status === 'not_set' && (
        <div className="fx-callerid-b">
          <label className="tp-field"><span>Your phone number</span><input value={phone} inputMode="tel" autoComplete="off" onChange={e => setPhone(e.target.value)} placeholder="(555) 555-0100" /></label>
          <button type="button" className="tp-primary fx-accent fx-self" disabled={!okPhone} onClick={start}><ShieldCheck size={15} aria-hidden="true" />Confirm this number</button>
          <small className="tp-sub">We call this number once with a 6-digit code. Clients keep seeing Ohvara{'’'}s number until it{'’'}s confirmed.</small>
        </div>
      )}

      {v.status === 'pending' && (
        <div className="fx-callerid-b">
          <p className="fx-callerid-code"><small>When {v.number} rings, type this code on the keypad</small><b className="tp-num">{v.code}</b></p>
          <div className="tp-row tp-wrap">
            <button type="button" className="tp-primary fx-accent" onClick={() => { onSave({ ...v, status: 'confirmed' }); note('Caller ID confirmed (sample)') }}><ShieldCheck size={15} aria-hidden="true" />I typed the code</button>
            <button type="button" className="tp-btn ov-ghost" onClick={() => onSave({ status: 'not_set', number: '' })}><RotateCcw size={15} aria-hidden="true" />Start over</button>
          </div>
        </div>
      )}

      {v.status === 'confirmed' && (
        <div className="fx-callerid-b">
          <div className="fx-form-row fx-form-sw">
            <div className="tp-grow"><b className="tp-num">{v.number}</b><p className="tp-sub">{v.on ? 'Fulfillment’s calls to your clients show this number' : 'Off. Clients see Ohvara’s number'}</p></div>
            <Switch on={v.on} label="Show my number on fulfillment's calls" onChange={on => onSave({ ...v, on })} />
          </div>
          <button type="button" className="tp-btn ov-ghost fx-self" onClick={() => { onSave({ status: 'not_set', number: '' }); setPhone(v.number) }}>Use a different number</button>
        </div>
      )}
      <p className="tp-pending">Sample. No call or text goes out from this page.</p>
    </section>
  )
}
