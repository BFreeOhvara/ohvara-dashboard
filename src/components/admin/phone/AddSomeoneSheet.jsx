import { useState } from 'react'
import { Mail, Send } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useCreateInvite, useInviteStatus, useSendAgentInvite } from '../../../hooks/useProfiles'
import { PhoneSheet } from '../../agent/phone/PhoneSheet'

// Prompt 774 — Add someone from the raised + (mockup AdmAdd.dc.html): Agent
// or Fulfillment, their name and email, a note on what happens next, Send
// invite. The invite is P762's exactly (send-agent-invite, email); the name
// only words the note and the toast (they type their own name when they join,
// so it isn't sent). If email isn't set up, a one-time link can be copied
// instead, as on desktop.

const ROLES = [['agent', 'Agent', 'Books calls'], ['fulfillment', 'Fulfillment', 'Makes the calls']]

export function AddSomeoneSheet({ onClose, onSent }) {
  const { profile } = useAuth()
  const status = useInviteStatus()
  const send = useSendAgentInvite()
  const createInvite = useCreateInvite()
  const [role, setRole] = useState('agent')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [err, setErr] = useState(null)
  const [link, setLink] = useState(null)
  const ready = status.data?.email
  const busy = send.isPending || createInvite.isPending
  const first = name.trim().split(/\s+/)[0]
  const note = role === 'agent'
    ? (first ? `${first} gets an email to set a password, then picks a plan and pays before booking.` : 'They get an email to set a password, then pick a plan and pay before booking.')
    : (first ? `${first} gets an email to set a password, then adds a bank to get paid.` : 'They get an email to set a password, then add a bank to get paid.')

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    if (!email.trim()) { setErr('Add their email.'); return }
    try {
      await send.mutateAsync({ channel: 'email', to: email.trim(), role })
      onSent?.(`Invite sent to ${name.trim() || email.trim()}`)
    } catch (x) { setErr(x.message) }
  }
  async function makeLink() {
    setErr(null)
    try {
      const inv = await createInvite.mutateAsync({ role, createdBy: profile.id })
      const url = `${window.location.origin}/join/${inv.token}`
      let copied = false
      try { await navigator.clipboard.writeText(url); copied = true } catch { /* shown below */ }
      setLink({ url, copied })
    } catch (x) { setErr(x.message || 'Couldn’t make a link.') }
  }

  return (
    <PhoneSheet
      label="Add someone" onClose={onClose}
      head={<span className="aph-title" style={{ marginTop: 0 }}>Add someone</span>}
      foot={link ? (
        <button type="button" className="aph-pay ph-foot-main" onClick={onClose}>Done</button>
      ) : (
        <div className="ph-foot-main" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button type="submit" form="aph-add" className="aph-pay" disabled={busy || (status.isSuccess && !ready)}>
            <Send size={17} strokeWidth={2.2} aria-hidden="true" />{send.isPending ? 'Sending…' : 'Send invite'}
          </button>
          <button type="button" className="aph-linkbtn" onClick={makeLink} disabled={busy}>
            {createInvite.isPending ? 'Making a link…' : 'Copy a link instead'}
          </button>
        </div>
      )}
    >
      {link ? (
        <div className="aph-add">
          <p className="aph-blue">
            {link.copied ? 'Link copied.' : 'Here’s the link.'} Send it to them yourself. It works once, lasts 7 days and joins them as {role === 'agent' ? 'an agent' : 'Fulfillment'}.
          </p>
          <code className="aph-linkbox">{link.url}</code>
        </div>
      ) : (
        <form id="aph-add" className="aph-add" onSubmit={submit} noValidate>
          <div className="aph-roles" role="radiogroup" aria-label="Role">
            {ROLES.map(([v, l, s]) => (
              <button key={v} type="button" role="radio" aria-checked={role === v} className={`aph-role${role === v ? ' is-on' : ''}`} onClick={() => setRole(v)}>
                <b>{l}</b><span>{s}</span>
              </button>
            ))}
          </div>
          <label className="aph-field">
            <span>Full name</span>
            <input className="aph-input" value={name} onChange={e => setName(e.target.value)} autoComplete="off" placeholder="Their name" />
          </label>
          <label className="aph-field">
            <span>Email</span>
            <input className="aph-input" type="email" inputMode="email" autoComplete="off" value={email}
              onChange={e => { setEmail(e.target.value); setErr(null) }} placeholder="name@example.com" disabled={status.isSuccess && !ready} />
          </label>
          <div className="aph-blue">
            <Mail size={20} strokeWidth={2} aria-hidden="true" style={{ flex: 'none', marginTop: 1 }} />
            <span>{status.isSuccess && !ready ? 'Email invites aren’t set up yet. Copy a link instead.' : note}</span>
          </div>
          {status.isError && <p className="ph-mute">Couldn’t check whether email can send. You can still copy a link.</p>}
          {err && <p className="ph-err" role="alert" style={{ margin: 0 }}>{err}</p>}
        </form>
      )}
    </PhoneSheet>
  )
}
