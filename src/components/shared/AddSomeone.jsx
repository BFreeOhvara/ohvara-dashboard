import { useEffect, useEffectEvent, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Copy, Check } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCreateInvite, useInviteStatus, useSendAgentInvite } from '../../hooks/useProfiles'
import { formatPhoneInput, phoneText } from '../../lib/policyFormat'
import { webUrl } from '../../lib/native'

// Add someone (Prompt 762, moved here Prompt 766): the Admin invite dialog —
// role Agent or Fulfillment, send by email or text, or copy a one-time link.
// Opened from the Users page and from the Admin account menu ("Invite someone").

export function AddSomeone({ defaultRole, onClose }) {
  const { profile } = useAuth()
  const status = useInviteStatus()
  const send = useSendAgentInvite()
  const createInvite = useCreateInvite()
  const [role, setRole] = useState(defaultRole)
  const [channel, setChannel] = useState('email')
  const [to, setTo] = useState('')
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(null)   // { sent } | { link }
  const [copied, setCopied] = useState(false)
  const ready = status.data?.[channel]
  const busy = send.isPending || createInvite.isPending

  const onKey = useEffectEvent(e => { if (e.key === 'Escape' && !busy) onClose() })
  useEffect(() => {
    const h = e => onKey(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    try {
      await send.mutateAsync({ channel, to, role })
      setDone({ sent: channel === 'email' ? to.trim() : phoneText(to) })
    } catch (x) { setErr(x.message) }
  }
  async function makeLink() {
    setErr(null)
    try {
      const inv = await createInvite.mutateAsync({ role, createdBy: profile.id })
      const link = webUrl(`/join?t=${inv.token}`)
      setDone({ link })
      try { await navigator.clipboard.writeText(link); setCopied(true) } catch { /* the link is on screen */ }
    } catch (x) { setErr(x.message || 'Couldn’t make a link.') }
  }

  const roleWord = role === 'agent' ? 'an agent' : 'Fulfillment'
  return createPortal(
    <>
      <div className="ov-scrim ap-scrim" onClick={busy ? undefined : onClose} aria-hidden="true" />
      <div className="ov-card ap-modal au-modal" role="dialog" aria-modal="true" aria-label="Add someone">
        <div className="ap-modal-head">
          <div>
            <h2>Add someone</h2>
            <p>They get a link that works once and lasts 7 days. They pick their own password.</p>
          </div>
          <button type="button" className="ap-x" aria-label="Close" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>

        {done ? (
          <div className="au-modal-body">
            {done.sent ? <p>Invite sent to <b>{done.sent}</b> as {roleWord}.</p> : (
              <>
                <p>{copied ? 'Link copied.' : 'Here’s the link.'} Send it to them yourself. It joins them as {roleWord}.</p>
                <p className="au-linkbox"><code>{done.link}</code>
                  <button type="button" className="au-link" onClick={async () => { try { await navigator.clipboard.writeText(done.link); setCopied(true) } catch { /* shown */ } }}>
                    {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                  </button>
                </p>
              </>
            )}
            <div className="ap-fix-foot"><button type="button" className="ap-solid" onClick={onClose}>Done</button></div>
          </div>
        ) : (
          <form className="au-modal-body" onSubmit={submit}>
            <div className="au-field">
              <span>Role</span>
              <div className="au-seg" role="radiogroup" aria-label="Role">
                {[['agent', 'Agent'], ['fulfillment', 'Fulfillment']].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={role === v} className={role === v ? 'is-on' : ''} onClick={() => setRole(v)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="au-field">
              <span>Send by</span>
              <div className="au-seg" role="radiogroup" aria-label="Send by">
                {[['email', 'Email'], ['sms', 'Text']].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={channel === v} className={channel === v ? 'is-on' : ''} onClick={() => { setChannel(v); setTo(''); setErr(null) }}>{l}</button>
                ))}
              </div>
            </div>
            <label className="au-field">
              <span>{channel === 'email' ? 'Their email' : 'Their phone'}</span>
              <input
                className="au-input" value={to} autoComplete="off" disabled={status.isSuccess && !ready}
                type={channel === 'email' ? 'email' : 'tel'} inputMode={channel === 'email' ? 'email' : 'tel'}
                placeholder={channel === 'email' ? 'name@example.com' : '(555) 123-4567'}
                onChange={e => setTo(channel === 'sms' ? formatPhoneInput(e.target.value) : e.target.value)}
              />
            </label>
            {status.isSuccess && !ready && (
              <p className="au-note">{channel === 'email' ? 'Email invites aren’t set up yet.' : 'Texting invites is coming soon.'} Copy a link instead.</p>
            )}
            {status.isError && <p className="au-note">Couldn’t check which ways can send. You can still copy a link.</p>}
            {err && <p className="au-err" role="alert">{err}</p>}
            <div className="ap-fix-foot">
              <button type="button" className="au-link au-copy" onClick={makeLink} disabled={busy}>Copy a link instead</button>
              <button type="submit" className="ap-solid" disabled={busy || !ready || !to.trim()}>{send.isPending ? 'Sending…' : 'Send invite'}</button>
            </div>
          </form>
        )}
      </div>
    </>,
    document.body,
  )
}
