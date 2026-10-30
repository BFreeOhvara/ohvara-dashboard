import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pause, Play, TriangleAlert, X } from 'lucide-react'
import { useSetBillingInbound } from '../../../hooks/useBillingInbound'
import { usePhoneLayout } from '../../../hooks/usePhoneLayout'
import { PhoneSheet } from '../phone/PhoneSheet'
import { aboutText, digitsOnly, estimateCount, formatMoney, initialAmount, parseDollars, plainError, TYPE_LABEL, TYPE_ORDER } from '../../../lib/billingInbound'
import { isNativeApp } from '../../../lib/native'

// The weekly amount for one type: the existing drawer on desktop, the existing bottom sheet on a phone,
// both portaled to <body> (.page-enter traps fixed children, see Gotchas). `choose` adds the type switch
// (Start from the hero). A failed save keeps it open with the server's message, word for word.

const MONO = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }
const LABEL = { fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)', marginBottom: 8 }

function Drawer({ label, head, foot, onClose, children }) {
  const [closing, setClosing] = useState(false)
  const closeBtn = useRef(null)
  const timer = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  const close = useRef(() => {
    if (timer.current) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { onCloseRef.current(); return }
    setClosing(true)
    timer.current = setTimeout(() => onCloseRef.current(), 200)
  })
  useEffect(() => {
    closeBtn.current?.focus({ preventScroll: true })
    const onKey = e => { if (e.key === 'Escape') close.current() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(timer.current) }
  }, [])
  return createPortal(
    <>
      <div className={`ov-scrim${closing ? ' is-closing' : ''}`} onClick={() => close.current()} aria-hidden="true" />
      <aside className={`ov-drawer${closing ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-label={label} style={{ color: 'var(--ov-hi)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '22px 24px 0' }}>
          <div style={{ flex: 1, minWidth: 0 }}>{head}</div>
          <button ref={closeBtn} type="button" className="ov-ghost" onClick={() => close.current()} aria-label="Close"
            style={{ width: 44, height: 44, margin: '-6px -6px 0 0', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '18px 24px' }}>{children}</div>
        <div style={{ display: 'flex', gap: 10, padding: '14px 24px 22px', borderTop: '1px solid var(--ov-line)' }}>{foot}</div>
      </aside>
    </>,
    document.body,
  )
}

export function InboundSpendSheet({ data, type: startType, choose, onClose }) {
  const phone = usePhoneLayout()
  const [type, setType] = useState(startType)
  const saved = data.types.find(t => t.type === type) || { weekly_cents: 0, paused: false }
  const [{ preset, custom }, setAmount] = useState(() => initialAmount(data.presets, saved.weekly_cents))
  const [error, setError] = useState('')
  const set = useSetBillingInbound()

  if (isNativeApp()) return null

  const label = saved.label || TYPE_LABEL[type]
  const min = data.min_weekly_cents
  const hasCustom = custom !== ''
  const cents = hasCustom ? parseDollars(custom) : preset
  const below = cents != null && cents < min
  const busy = set.isPending
  const hasAmount = saved.weekly_cents > 0
  const estimate = cents == null ? 'Pick an amount' : below ? 'Below the minimum' : aboutText(estimateCount(cents, data.estimate_cents?.[type]))

  async function send(body) {
    setError('')
    try {
      await set.mutateAsync({ type, ...body })
      onClose()
    } catch (e) {
      setError(plainError(e.message, 'Couldn’t save that. Try again.'))
    }
  }
  // Below the minimum Save looks off, as in the mockup, but the tap still goes through so the server's own message shows.
  const save = () => { if (cents != null && !busy) send({ weekly_cents: cents, paused: hasAmount ? !!saved.paused : false }) }
  const pause = () => send({ weekly_cents: saved.weekly_cents, paused: true })
  const resume = () => send({ weekly_cents: cents != null && !below ? cents : saved.weekly_cents, paused: false })
  const pick = next => { setError(''); setAmount({ preset: next, custom: '' }) }

  const sub = !hasAmount ? null : (
    <small style={{ display: 'block', marginTop: 4, fontSize: 13.5, color: 'var(--ov-mute)' }}>
      {saved.paused ? 'Paused at ' : 'Now '}<span style={{ ...MONO, fontSize: 13, color: 'var(--ov-mid)' }}>{formatMoney(saved.weekly_cents)}</span> a week
    </small>
  )
  const head = (
    <div style={{ minWidth: 0 }}>
      <b style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.15 }}>{choose ? 'Start getting inbounds' : label}</b>
      {sub}
    </div>
  )
  const footBtn = { height: 50, padding: '0 20px', borderRadius: 999, fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }
  const foot = (
    <>
      {hasAmount && (saved.paused ? (
        <button type="button" className="ov-ghost" style={footBtn} disabled={busy} onClick={resume}><Play size={15} strokeWidth={2} aria-hidden="true" />Resume</button>
      ) : (
        <button type="button" className="ov-ghost" style={footBtn} disabled={busy} onClick={pause}><Pause size={15} strokeWidth={2} aria-hidden="true" />Pause</button>
      ))}
      <button type="button" className="ov-primary" onClick={save} disabled={busy || cents == null}
        style={{ flex: '1 1 0', minWidth: 0, width: 'auto', height: 50, fontSize: 15, ...(below || cents == null ? { opacity: 0.5 } : null), ...(busy || cents == null ? { cursor: 'default' } : null) }}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </>
  )
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, ...(phone ? { paddingTop: 16 } : null) }}>
      {choose && (
        <div className="ov-range ov-invite-seg" role="group" aria-label="Type">
          {TYPE_ORDER.map(t => (
            <button key={t} type="button" className={t === type ? 'is-on' : undefined} aria-pressed={t === type} onClick={() => { setError(''); setType(t) }}
              style={{ height: 44, fontSize: phone ? 13 : 14 }}>{TYPE_LABEL[t]}</button>
          ))}
        </div>
      )}
      <div>
        <div style={LABEL}>Weekly amount</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {(data.presets || []).map(p => {
            const on = !hasCustom && preset === p
            return (
              <button key={p} type="button" className="ov-box" aria-pressed={on} onClick={() => pick(p)}
                style={{ ...MONO, height: 48, minWidth: 0, borderRadius: 14, fontSize: 15, fontWeight: 600, cursor: 'pointer', color: 'var(--ov-hi)', ...(on ? { background: 'var(--ov-hi)', borderColor: 'var(--ov-hi)', color: 'var(--ov-on-kind)' } : null) }}>
                {formatMoney(p)}
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <label htmlFor="inbound-amount" style={{ ...LABEL, display: 'block' }}>Or enter your own</label>
        <div className={`ov-input${below ? ' is-error' : ''}`} style={MONO}>
          <span aria-hidden="true">$</span>
          <input id="inbound-amount" type="text" inputMode="numeric" autoComplete="off" value={custom} placeholder={`${Math.ceil(min / 100)} or more`}
            aria-invalid={below || undefined} style={{ ...MONO, fontWeight: 600 }}
            onChange={e => { setError(''); setAmount({ preset: null, custom: digitsOnly(e.target.value) }) }}
            onKeyDown={e => { if (e.key === 'Enter') save() }} />
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13.5, whiteSpace: 'nowrap' }}>a week</span>
        </div>
        <div style={{ marginTop: 6, fontSize: 12.5, ...(below ? { color: 'var(--danger)', fontWeight: 600 } : { color: 'var(--ov-mute)' }) }}>
          {below ? 'The minimum is ' : 'Minimum '}<span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(min)}</span> a week.
        </div>
      </div>
      <div className="ov-box" role="status" style={{ padding: '14px 16px', borderRadius: 14 }}>
        <b style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: phone ? 22 : 24, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.15, ...(below || cents == null ? { color: 'var(--ov-mute)' } : null) }}>{estimate}</b>
        <span style={{ display: 'block', marginTop: 3, fontSize: 12.5, color: 'var(--ov-mute)' }}>An estimate. It moves from week to week.</span>
      </div>
      {error && (
        <div className="ov-mb-notice is-error" role="alert">
          <TriangleAlert size={16} strokeWidth={2.2} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} /><span>{error}</span>
        </div>
      )}
    </div>
  )

  return phone
    ? <PhoneSheet label={label} head={head} foot={foot} onClose={onClose}>{body}</PhoneSheet>
    : <Drawer label={label} head={head} foot={foot} onClose={onClose}>{body}</Drawer>
}
