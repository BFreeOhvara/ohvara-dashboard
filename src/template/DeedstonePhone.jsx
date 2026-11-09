import { useState } from 'react'
import { Smartphone, PhoneCall, Check } from 'lucide-react'
import { Chip, useNote } from './kit'
import { PhoneInput } from './PhoneInput'
import { useDeedstone, useDataSource } from './data'
import { CODE_WORDS, codeOk, shown } from '../lib/deedstoneCall'
import { SAMPLE_CODE } from './deedstone.js'
import './deedstone916.css'

// P916 — Settings → Hours and calls: "Your phone for Deedstone calls". Calls through Deedstone ring this phone first,
// then dial the client from Deedstone, so the client never sees it. Confirmed by a short voice call that reads a
// 6-digit code (works while texting is off). Required before Call works. The agent never sees a Deedstone number.
export function DeedstonePhone() {
  const ds = useDeedstone()
  const sample = useDataSource() === 'sample'
  const me = ds.usePhone()
  const note = useNote()
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const asking = editing || !me.phone
  const waiting = me.pending && !!me.pendingPhone

  const send = async () => {
    setBusy(true); setErr('')
    try {
      await ds.sendCode(phone || me.pendingPhone)
      await me.refresh()
      note('Calling you now with your code')
    } catch (e) { setErr(e.message || 'Couldn’t call you. Try again.') }
    setBusy(false)
  }
  const confirm = async () => {
    setBusy(true); setErr('')
    try {
      const r = await ds.confirm(code)
      if (r?.ok) { setEditing(false); setCode(''); setPhone(''); await me.refresh(); note('Your phone is connected') }
      else setErr(CODE_WORDS[r?.reason] || 'That didn’t work. Try again.')
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const disconnect = async () => {
    setBusy(true)
    try { await ds.disconnect(); await me.refresh(); note('Phone disconnected') } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <section className="ds-phone" aria-labelledby="ds-phone-h">
      <div className="ds-phone-h">
        <div className="tp-grow">
          <b id="ds-phone-h">Your phone for Deedstone calls</b>
          <p className="tp-sub">Tap Call on a lead or client: this phone rings, you press 1, and we dial them. They see Deedstone Insurance, never your number.</p>
        </div>
        {me.loading ? null : me.phone ? <Chip tone="green">Connected</Chip> : <Chip tone="warn">Needed to call</Chip>}
      </div>

      {me.phone && !asking && (
        <div className="ds-phone-row">
          <Smartphone size={16} aria-hidden="true" /><span className="ds-phone-n">{shown(me.phone)}</span>
          <button type="button" className="tp-btn ov-ghost sm" onClick={() => { setEditing(true); setErr('') }} disabled={busy}>Change</button>
          <button type="button" className="tp-btn ov-ghost sm" onClick={disconnect} disabled={busy}>Disconnect</button>
        </div>
      )}

      {asking && !waiting && (
        <div className="ds-phone-row">
          <PhoneInput value={phone} onChange={d => setPhone(d)} aria-label="Your phone number" />
          <button type="button" className="tp-primary fx-accent" onClick={send} disabled={busy || phone.length !== 10}><PhoneCall size={16} aria-hidden="true" />Call me with a code</button>
          {editing && <button type="button" className="tp-btn ov-ghost" onClick={() => { setEditing(false); setErr('') }}>Cancel</button>}
        </div>
      )}

      {waiting && (
        <>
          <p className="ds-hint">We’re calling <b className="ds-phone-n">{shown(me.pendingPhone)}</b>. Answer it and type the 6-digit code you hear.</p>
          <div className="ds-phone-row">
            <input className="ds-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" aria-label="6-digit code"
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            <button type="button" className="tp-primary fx-accent" onClick={confirm} disabled={busy || !codeOk(code)}><Check size={16} aria-hidden="true" />Confirm</button>
            <button type="button" className="tp-btn ov-ghost" onClick={send} disabled={busy}>Call me again</button>
          </div>
          {sample && <p className="ds-hint">Sample: nothing rings. The code is {SAMPLE_CODE}.</p>}
        </>
      )}
      {err && <p className="ds-err" role="alert">{err}</p>}
    </section>
  )
}
