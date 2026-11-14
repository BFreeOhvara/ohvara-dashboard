import { useState } from 'react'
import { Bug, Mail, Search, Copy, UserPlus } from 'lucide-react'
import { useAdmActions, useAdmSettings } from '../data'
import { useNote } from '../../template/kit'
import { ReportBug } from '../../template/ReportBug'
import { SUPPORT_EMAIL } from '../../components/auth/authUtils'
import { useApp, SubPage, BottomSheet, Row, rise } from '../../template/m/AppKit'

// P1002 — Help and support and Add a VA on the admin phone (the desktop's Help drawer and "Add a VA" drawer in
// AdminFrame.jsx, same words and the same invite action). Help: Report a bug (the one pop-up all three portals share),
// Bug reports, the support mailbox, Search anything. The audit log is a desktop page.
const Sym = ({ tone, Icon }) => <span className={`ma-sym is-${tone}`}><Icon size={16} aria-hidden="true" /></span>

export function AHelpAdm() {
  const app = useApp()
  const [bug, setBug] = useState(false)
  return (
    <SubPage title="Help and support" line="Where things live on the admin side." big>
      <div className="ma-glass ma-list ma-rise">
        <Row onClick={() => setBug(true)} lead={<Sym tone="coral" Icon={Bug} />} title="Report a bug" sub="Something broken in the admin side" />
        <Row onClick={() => app.openSub('bugs')} lead={<Sym tone="butter" Icon={Bug} />} title="Bug reports" sub="What agents, VAs and admins sent from Help and support" />
        <a href={`mailto:${SUPPORT_EMAIL}`} className="ma-row"><Sym tone="sky" Icon={Mail} /><span className="ma-grow"><b>Support mailbox</b><small>{SUPPORT_EMAIL}</small></span></a>
        <Row onClick={() => app.openSub('search')} lead={<Sym tone="stone" Icon={Search} />} title="Search anything" sub="Agents, VAs, leads and clients" />
      </div>
      <p className="ma-note" style={rise(1)}>The audit log (every admin action, newest first) is on the desktop, in Settings.</p>
      <ReportBug open={bug} onClose={() => setBug(false)} role="Admin" />
    </SubPage>
  )
}

// Add someone: a Fulfillment person, by email, by text, or a link to copy. No admin from here (as today).
export function AddVaSheet({ open, onClose }) {
  const { invite } = useAdmActions()
  const { data: settings } = useAdmSettings()
  const note = useNote()
  const [via, setVia] = useState('email')
  const [name, setName] = useState('')
  const [to, setTo] = useState('')
  const textOff = !settings.switches?.invite_sms_live
  const ready = name.trim().length > 1 && (via === 'link' || to.trim().length > 4)
  const send = () => {
    invite({ name: name.trim(), role: 'fulfillment', via, to: via === 'link' ? 'Link copied' : to.trim() })
    note(via === 'link' ? `Invite link for ${name.trim()} copied (sample)` : `Invite sent to ${name.trim()} (sample: nothing was sent)`)
    setName(''); setTo(''); onClose()
  }
  return (
    <BottomSheet open={open} onClose={onClose} label="Add a VA" tall>
      <p className="ma-sheet-t">Add a VA</p>
      <p className="ma-sheet-s">They get a link to set a password and land on the Fulfillment side.</p>
      <label className="va-field"><span>Full name</span><input value={name} onChange={e => setName(e.target.value)} placeholder="First and last name" autoComplete="off" /></label>
      <p className="ma-cap is-out">Send it by</p>
      <div className="ma-seg am-seg" role="radiogroup" aria-label="Send by">
        {[['email', 'Email'], ['text', 'Text'], ['link', 'Copy a link']].map(([k, w]) => <button key={k} type="button" role="radio" aria-checked={via === k} className={`is-sky${via === k ? ' is-on' : ''}`} onClick={() => setVia(k)}>{w}</button>)}
      </div>
      {via === 'text' && textOff && <p className="ma-hint">Invite by text is off in Settings, so this would go as a link to copy.</p>}
      {via !== 'link' && (
        <label className="va-field"><span>{via === 'email' ? 'Email' : 'Mobile number'}</span>
          <input type={via === 'email' ? 'email' : 'tel'} value={to} onChange={e => setTo(e.target.value)} placeholder={via === 'email' ? 'name@example.com' : '(555) 555-0100'} /></label>
      )}
      <button type="button" className="ma-btn is-solid is-tall ma-press am-wide" disabled={!ready} onClick={send}>{via === 'link' ? <Copy size={18} aria-hidden="true" /> : <UserPlus size={18} aria-hidden="true" />}{via === 'link' ? 'Copy the link' : 'Send invite'}</button>
      <p className="ma-hint">Agents sign up and pay on their own; they show on Setup once they've paid. Admins are added by another admin outside the portal.</p>
    </BottomSheet>
  )
}
