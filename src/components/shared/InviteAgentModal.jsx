import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, MessageCircle, Mail, Phone, Lock, UserPlus, CheckCircle2 } from 'lucide-react'
import { useInviteStatus, useSendAgentInvite } from '../../hooks/useProfiles'
import { formatPhoneInput } from '../../lib/policyFormat'

// Invite an agent (Prompt 731) — opened from the account menu, agents only.
// The agent picks Text message or Email, types the number or address and
// presses Send invite; the send-agent-invite edge function mints a single-use
// /join link and sends it. The agent never sees or copies the link, and the
// invited person gets a free-standing account: no team, no upline, no tie to
// whoever sent it. A channel that can't send yet (no Resend / texting not
// live) stays visible but muted and says "coming soon". Built to the P731
// canvas (media/p731-invite-an-agent/ in the vault). See DESIGN.md v16 "P731".

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SOON = { sms: 'Texting invites is coming soon.', email: 'Email invites are coming soon.' }

// Digits of a US number; a pasted/typed leading country code 1 is dropped.
function phoneDigits(raw) {
  const d = String(raw || '').replace(/\D/g, '')
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d
}

export function InviteAgentModal({ onClose }) {
  const [channel, setChannel] = useState('sms')
  const [value, setValue] = useState('')
  const [sentTo, setSentTo] = useState(null)
  const field = useRef(null)
  const status = useInviteStatus()
  const send = useSendAgentInvite()

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Until the status answers, nothing is "available"; a failed status call
  // (e.g. the function isn't deployed) leaves both channels as coming soon.
  const avail = status.data?.[channel] === true
  const soon = status.isFetched && !avail

  useEffect(() => {
    if (!sentTo && !soon) field.current?.focus({ preventScroll: true })
  }, [channel, sentTo, soon])

  const digits = phoneDigits(value)
  const valid = channel === 'email' ? EMAIL_RE.test(value.trim()) : digits.length === 10
  const canSend = avail && valid && !send.isPending

  function pick(c) {
    if (c === channel) return
    setChannel(c); setValue(''); send.reset()
  }

  function onInput(e) {
    send.reset()
    setValue(channel === 'sms' ? formatPhoneInput(phoneDigits(e.target.value)) : e.target.value)
  }

  function submit(e) {
    e.preventDefault()
    if (!canSend) return
    const to = channel === 'email' ? value.trim().toLowerCase() : digits
    send.mutate({ channel, to }, { onSuccess: () => setSentTo(channel === 'email' ? to : formatPhoneInput(digits)) })
  }

  function another() {
    setSentTo(null); setValue(''); send.reset()
  }

  const tabs = [
    { key: 'sms', label: 'Text message', Icon: MessageCircle },
    { key: 'email', label: 'Email', Icon: Mail },
  ]

  return createPortal(
    <>
      <div className="ov-scrim" onClick={onClose} aria-hidden="true" />
      <div className="ov-invite-wrap" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <form className="ov-card ov-invite" role="dialog" aria-modal="true" aria-labelledby="invite-title" onSubmit={submit} noValidate>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h2 id="invite-title" className="ov-invite-title">Invite an agent</h2>
              <p className="ov-invite-sub">We send them a personal link to sign up for Ohvara. It only works for the number or email you enter.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="ov-invite-x">
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          {sentTo ? (
            <>
              <div className="ov-invite-ok" role="status">
                <CheckCircle2 size={22} strokeWidth={2} style={{ color: 'var(--ov-up)', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div className="ov-invite-ok-title">Invite sent to {sentTo}</div>
                  <div className="ov-invite-ok-sub">They'll get their own account once they sign up.</div>
                </div>
              </div>
              <div className="ov-invite-actions">
                <button type="button" className="ov-ghost ov-invite-btn" onClick={another}>Invite another</button>
                <button type="button" className="ov-solid ov-invite-btn" onClick={onClose} autoFocus>Done</button>
              </div>
            </>
          ) : (
            <>
              <div className="ov-range ov-invite-seg" role="tablist" aria-label="Send by">
                {tabs.map(({ key, label, Icon }) => {
                  const off = status.isFetched && status.data?.[key] !== true
                  return (
                    <button
                      key={key} type="button" role="tab" aria-selected={channel === key}
                      className={[channel === key && 'is-on', off && 'is-muted'].filter(Boolean).join(' ') || undefined}
                      onClick={() => pick(key)}
                    >
                      <Icon size={15} strokeWidth={2.1} aria-hidden="true" />{label}
                    </button>
                  )
                })}
              </div>

              {soon ? (
                <div className="ov-note ov-invite-note">
                  <Lock size={16} strokeWidth={1.9} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                  <p>{SOON[channel]}</p>
                </div>
              ) : (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span className="ov-invite-label">{channel === 'email' ? 'Their email' : 'Their phone number'}</span>
                    <span className="ov-input ov-invite-field">
                      {channel === 'email'
                        ? <Mail size={17} strokeWidth={1.9} aria-hidden="true" />
                        : <Phone size={17} strokeWidth={1.9} aria-hidden="true" />}
                      <input
                        ref={field}
                        type={channel === 'email' ? 'email' : 'tel'}
                        inputMode={channel === 'email' ? 'email' : 'tel'}
                        autoComplete="off"
                        placeholder={channel === 'email' ? 'name@example.com' : '(555) 555-5555'}
                        value={value}
                        onChange={onInput}
                        disabled={send.isPending}
                      />
                    </span>
                  </label>
                  <div className="ov-note ov-invite-note">
                    <Lock size={16} strokeWidth={1.9} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                    <p>The link is single-use and expires in 7 days.</p>
                  </div>
                </>
              )}

              {send.isError && <p className="ov-invite-error" role="alert">{send.error?.message}</p>}

              <div className="ov-invite-actions">
                <button type="button" className="ov-ghost ov-invite-btn" onClick={onClose}>Cancel</button>
                <button type="submit" className="ov-solid ov-invite-btn" disabled={!canSend}>
                  <UserPlus size={16} strokeWidth={2.1} aria-hidden="true" />
                  {send.isPending ? 'Sending…' : 'Send invite'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </>,
    document.body
  )
}
