import { useState } from 'react'
import { FileSignature, FileUp, Send, RotateCcw, CircleCheck, CircleX, Copy, ShieldCheck, Clock3, TriangleAlert, ExternalLink, Link2, Lock } from 'lucide-react'
import { Chip, Drawer, Field, Seg, Empty, useNote } from '../kit'
import { Block } from '../Record'
import { DOC_TYPE, DOC_STATUS, SEND_STATUS, CHANNEL, SIGNER_ROLE, SOURCE, showFax, sendTo, nextStep, gateWords, signLink, MAX_ATTEMPTS } from '../../lib/documents.js'
import { useDocs, useGate, useCarrierDocs, docActions, pickChannel, addressFor, TEMPLATES } from '../docs886/data'
import '../p886.css'

// P886 — documents on a policy (N-E-30, N-E-31, N-E-32) and the replacement-timing gate. Sample only; 852 wires the
// VA side and 848 the agent side to src/lib/documents.js docsApi (policy_documents_for, doc_start_signing,
// doc_request_upload, doc_send_request, doc_send_result, doc_send_confirm, carrier_docs_update, replacement_mark).
//   DocsBlock      VA: every paper on the client; send a carrier form to sign (prefilled, 1-4 signers), ask for a
//                  file, send to the carrier the way it takes them, see the receipt or the failure, retry, confirm.
//   GateBlock      VA, on the old-policy cancel call: issued + first payment, or the call waits.
//   AgentDocsBlock (../docs886/Docs886.jsx) is the agent's side; it never names engines or ads.

const PREFILL = [['Owner', 'name'], ['Policy', 'policy'], ['Phone', 'phone'], ['Address', 'from intake'], ['Date of birth', 'from intake']]

function SignDrawer({ who, client, carrier, task, kinds, onClose }) {
  const note = useNote()
  const forms = TEMPLATES.filter(t => (!t.carrier || t.carrier === carrier) && (!kinds || kinds.includes(t.doc_type)))
  const [pick, setPick] = useState(forms[0]?.id || 'own')
  const t = forms.find(f => f.id === pick)
  const roles = t ? t.roles : ['owner']
  const [names, setNames] = useState({ owner: who })
  const [made, setMade] = useState(null)
  const ready = roles.every(r => (names[r] || '').trim().length >= 2)
  const create = () => {
    const d = docActions.startSigning(who, { template: t?.id, doc_type: t?.doc_type || kinds?.[0] || 'other', title: t?.name || `${carrier} form`, carrier, task, signers: roles.map(r => ({ role: r, name: names[r].trim() })) })
    setMade(d); note(`Links made for ${roles.length === 1 ? names[roles[0]] : `${roles.length} signers`}`)
  }
  const copy = async l => { try { await navigator.clipboard.writeText(l); note('Link copied') } catch { note(l) } }
  if (made) {
    return (
      <Drawer open center onClose={onClose} title="Links ready" sub={made.title}
        footer={<button type="button" className="tp-primary fx-accent" onClick={onClose}><CircleCheck size={16} />Done</button>}>
        <p className="dc-rule"><Lock size={15} aria-hidden="true" />One private link each. Texted from Deedstone; you hear when each one signs. Links last 7 days.</p>
        <span className="dc-engine"><i aria-hidden="true" />Powered by GoHighLevel · not connected yet</span>
        <ul className="dc-links">{made.signers.map(g => (
          <li key={g.id}><span className="tp-grow"><b>{g.name}</b><small>{SIGNER_ROLE[g.role]}</small></span>
            <button type="button" className="tp-btn ov-ghost sm" onClick={() => copy(signLink(g.token))}><Copy size={14} />Copy link</button></li>
        ))}</ul>
        <p className="tp-sub">Until texts are connected, read the link out or send it from the client’s thread.</p>
      </Drawer>
    )
  }
  return (
    <Drawer open center onClose={onClose} title="Send a form to sign" sub={`${client} · ${carrier}`}
      footer={<button type="button" className="tp-primary fx-accent" disabled={!ready} onClick={create}><FileSignature size={16} />Make the links</button>}>
      <Field label="Which form">
        <div className="dc-picks" role="radiogroup" aria-label="Which form">
          {forms.map(f => (
            <label key={f.id} className={`dc-pick${pick === f.id ? ' is-on' : ''}`}>
              <input type="radio" name="form" checked={pick === f.id} onChange={() => setPick(f.id)} />
              <span className="tp-grow"><b>{f.name}</b><small>{f.form} · {f.roles.map(r => SIGNER_ROLE[r]).join(' + ')}</small></span>
            </label>
          ))}
          <label className={`dc-pick${pick === 'own' ? ' is-on' : ''}`}>
            <input type="radio" name="form" checked={pick === 'own'} onChange={() => setPick('own')} />
            <span className="tp-grow"><b>The carrier’s own form</b><small>Upload the PDF they gave you. It’s saved on the policy first.</small></span>
          </label>
        </div>
      </Field>
      <div className="dc-signers">{roles.map(r => (
        <Field key={r} label={SIGNER_ROLE[r]} hint={r === 'irrevocable_beneficiary' ? 'An irrevocable beneficiary must sign too' : r === 'owner' && names.owner !== who ? 'The owner, not always the insured' : null}>
          <input value={names[r] || ''} placeholder="Full name" onChange={e => setNames({ ...names, [r]: e.target.value })} />
        </Field>
      ))}</div>
      <div className="dc-pre"><b>Prefilled from the policy</b><span>{PREFILL.map(([k]) => k).join(' · ')}. Never bank or account numbers.</span></div>
    </Drawer>
  )
}

function SendDrawer({ who, d, retryOf, onClose }) {
  const note = useNote()
  const carrier = useCarrierDocs(d.carrier)
  const [channel, setChannel] = useState(pickChannel(carrier) || 'fax')
  const [dest, setDest] = useState(addressFor(carrier, channel) || '')
  const [save, setSave] = useState(!addressFor(carrier, channel))
  const [err, setErr] = useState(null)
  const choose = c => { setChannel(c); setDest(addressFor(carrier, c) || ''); setSave(!addressFor(carrier, c)); setErr(null) }
  const go = () => {
    const e = docActions.send(who, d.id, { channel, destination: dest })
    if (e) { setErr(e); return }
    if (save && channel !== 'agent_portal' && dest.trim()) docActions.saveCarrier(d.carrier, { [channel === 'fax' ? 'docs_fax' : channel === 'email' ? 'docs_email' : 'docs_upload_url']: channel === 'fax' ? dest.replace(/\D/g, '').slice(-10) : dest.trim(), docs_channels: [...new Set([channel, ...(carrier.docs_channels || [])])] })
    note(channel === 'agent_portal' ? 'Sent to the agent to upload' : channel === 'upload' ? 'Open the carrier’s page and upload it, then mark it' : 'Sent (sample). A confirm call comes due in 3 business days')
    onClose()
  }
  const label = channel === 'fax' ? 'Fax number' : channel === 'email' ? 'Email address' : 'Upload page'
  return (
    <Drawer open center onClose={onClose} title={retryOf ? 'Send it again' : `Send to ${d.carrier}`} sub={d.title}
      footer={<button type="button" className="tp-primary fx-accent" onClick={go}><Send size={16} />{channel === 'agent_portal' ? 'Ask the agent' : 'Send'}</button>}>
      {!pickChannel(carrier) && <p className="dc-rule"><TriangleAlert size={15} aria-hidden="true" />{d.carrier} has no fax, email or upload page on file. Ask them how they take signed forms; it’s saved for next time.</p>}
      {carrier.docs_notes && <p className="dc-rule"><ShieldCheck size={15} aria-hidden="true" />{carrier.docs_notes}</p>}
      <Seg label="How" value={channel} onChange={choose} className="fs-wrap" options={Object.entries(CHANNEL).map(([k, v]) => ({ key: k, label: v }))} />
      {channel === 'agent_portal'
        ? <p className="tp-sub">The agent is asked to upload it in their {d.carrier} producer portal and tap I uploaded it. You don’t log in to agents’ portals.</p>
        : <Field label={label} hint={channel === 'fax' ? 'From the carrier list. Change it if they gave you another' : null}>
            <input value={channel === 'fax' && /^\d{10}$/.test(dest) ? showFax(dest) : dest} inputMode={channel === 'fax' ? 'tel' : channel === 'email' ? 'email' : 'url'} onChange={e => { setDest(e.target.value); setErr(null) }} placeholder={channel === 'fax' ? '(800) 555-0142' : channel === 'email' ? 'forms@carrier.com' : 'https://'} />
          </Field>}
      {channel !== 'agent_portal' && <label className="dc-check"><input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} />Save this on {d.carrier} for everyone</label>}
      {err && <p className="dc-err" role="alert"><CircleX size={15} aria-hidden="true" />{err}</p>}
      <p className="tp-sub">Sample: nothing is faxed or emailed. A fax number ending 0000 fails, to try Retry.</p>
    </Drawer>
  )
}

function SendRow({ s }) {
  const [tone, words] = SEND_STATUS[s.status]
  return (
    <li className="dc-send">
      <span className="tp-grow"><b>{CHANNEL[s.channel]} {s.channel === 'agent_portal' ? '' : `to ${sendTo(s)}`}</b>
        <small>Try {s.attempt} · {s.at}{s.status === 'delivered' && s.confirm_due ? ` · confirm by ${s.confirm_due}` : ''}{s.sandbox ? ' · sample' : ''}</small>
        {s.failure_reason && <small className="dc-why"><TriangleAlert size={12} aria-hidden="true" />{s.failure_reason}</small>}</span>
      <Chip tone={tone}>{words}</Chip>
    </li>
  )
}

function DocRow({ who, d, onSend }) {
  const note = useNote()
  const [tone, words] = DOC_STATUS[d.status]
  const step = nextStep(d)
  const last = d.sends[0]
  const waiting = d.signers.filter(g => !g.signed_at)
  return (
    <li className="dc-doc">
      <div className="dc-doc-h">
        <span className="tp-grow"><b>{d.title}</b><small>{DOC_TYPE[d.doc_type]} · {SOURCE[d.source]} · {d.date}</small></span>
        <Chip tone={tone}>{words}</Chip>
      </div>
      {d.signers.length > 0 && d.source === 'esign' && (
        <ul className="dc-signed">{d.signers.map(g => (
          <li key={g.id}>{g.signed_at ? <CircleCheck size={13} aria-hidden="true" className="is-ok" /> : g.declined_at ? <CircleX size={13} aria-hidden="true" className="is-bad" /> : <Clock3 size={13} aria-hidden="true" />}
            {g.name} <small>{SIGNER_ROLE[g.role]}{g.signed_at ? ` · signed ${g.signed_at}` : g.declined_at ? ` · declined: ${g.decline_reason}` : g.viewed_at ? ' · opened' : ' · not opened yet'}</small></li>
        ))}</ul>
      )}
      {d.sends.length > 0 && <ul className="dc-sends">{d.sends.map(s => <SendRow key={s.id} s={s} />)}</ul>}
      <div className="dc-acts">
        {step === 'wait' && waiting.length > 0 && d.status !== 'awaiting_upload' && <button type="button" className="tp-btn ov-ghost sm" onClick={() => { docActions.signAll(who, d.id); note('Sample: marked signed') }}><FileSignature size={14} />Sample: they signed</button>}
        {d.status === 'awaiting_upload' && <button type="button" className="tp-btn ov-ghost sm" onClick={() => { docActions.uploaded(who, d.id); note('Sample: file received') }}><FileUp size={14} />Sample: they sent it</button>}
        {step === 'relink' && waiting.map(g => <button key={g.id} type="button" className="tp-btn ov-ghost sm" onClick={() => { docActions.newLink(who, d.id, g.id); note(`New link for ${g.name}`) }}><Link2 size={14} />New link for {g.name.split(' ')[0]}</button>)}
        {step === 'send' && <button type="button" className="tp-primary sm fx-accent" onClick={() => onSend(d)}><Send size={14} />Send to {d.carrier}</button>}
        {step === 'retry' && <button type="button" className="tp-primary sm fx-accent" onClick={() => onSend(d, last.id)}><RotateCcw size={14} />Retry or another way</button>}
        {step === 'call' && <span className="dc-why"><TriangleAlert size={13} aria-hidden="true" />Tried {MAX_ATTEMPTS} times: call {d.carrier} to check the address, or ask an admin.</span>}
        {step === 'confirm' && <>
          <button type="button" className="tp-primary sm fx-accent" onClick={() => { docActions.confirm(who, d.id, last.id, true); note(`${d.carrier} has it`) }}><CircleCheck size={14} />Carrier has it</button>
          <button type="button" className="tp-btn ov-ghost sm" onClick={() => { docActions.confirm(who, d.id, last.id, false); note('Logged. Fix the address and send it again') }}><CircleX size={14} />They say not received</button>
        </>}
        {last?.status === 'sending' && last.channel === 'upload' && <>
          <a className="tp-btn ov-ghost sm" href={last.destination} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open upload page</a>
          <button type="button" className="tp-primary sm fx-accent" onClick={() => { docActions.markSent(who, d.id, last.id); note('Marked uploaded. Confirm call set') }}><CircleCheck size={14} />I uploaded it</button>
        </>}
        {last?.status === 'sending' && last.channel === 'agent_portal' && <span className="tp-sub">Waiting for the agent to upload it</span>}
      </div>
    </li>
  )
}

// VA: every paper on this client. kinds narrows the forms offered (e.g. a beneficiary change step).
export function DocsBlock({ who, carrier, task, kinds, title = 'Documents' }) {
  const { docs } = useDocs(who)
  const note = useNote()
  const [panel, setPanel] = useState(null)
  const [sending, setSending] = useState(null)
  const ask = () => { docActions.requestUpload(who, { doc_type: kinds?.includes('poa') ? 'poa' : 'carrier_letter', title: kinds?.includes('poa') ? 'Power of attorney' : 'Photo of the carrier letter', carrier, task }); note(`Upload link made for ${who.split(' ')[0]}`) }
  return (
    <Block title={title} sub="Signed forms, letters and proof, kept on the policy" aside={<span className="fx-count">{docs.length}</span>}>
      <div className="dc-top">
        <button type="button" className="tp-btn ov-ghost sm" onClick={() => setPanel('sign')}><FileSignature size={14} />Send a form to sign</button>
        <button type="button" className="tp-btn ov-ghost sm" onClick={ask}><FileUp size={14} />Ask for a file</button>
      </div>
      {docs.length ? <ul className="dc-list">{docs.map(d => <DocRow key={d.id} who={who} d={d} onSend={(x, retry) => setSending({ d: x, retry })} />)}</ul>
        : <Empty title="No papers yet" sub="Carrier forms they sign and letters they send show here." />}
      {panel === 'sign' && <SignDrawer who={who} client={who} carrier={carrier} task={task} kinds={kinds} onClose={() => setPanel(null)} />}
      {sending && <SendDrawer key={sending.d.id + (sending.retry || '')} who={who} d={sending.d} retryOf={sending.retry} onClose={() => setSending(null)} />}
    </Block>
  )
}

const TODAY = 'Nov 5'
// VA, on the cancel call: the old policy goes only after the new one is issued and its first payment clears.
export function GateBlock({ who }) {
  const g = useGate(who)
  const note = useNote()
  if (!g.applies) return null
  const mark = (what, label) => { docActions.markGate(who, what, TODAY); note(`${label}: ${TODAY}`) }
  return (
    <section className={`fx-blk dc-gate${g.open ? ' is-open' : ''}`} aria-label="When the old policy can go">
      <header><h3>{g.open ? <ShieldCheck size={16} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />}{g.open ? 'Ready to cancel the old policy' : 'Not yet: keep the old policy'}</h3></header>
      <p className="tp-mid">{gateWords(g)}</p>
      <dl className="fx-facts">
        <div><dt>New policy issued</dt><dd>{g.issued_on || <button type="button" className="tp-btn ov-ghost sm" onClick={() => mark('issued', 'Issued')}>Mark issued today</button>}</dd></div>
        <div><dt>First payment cleared</dt><dd>{g.first_payment_on || <button type="button" className="tp-btn ov-ghost sm" disabled={!g.issued_on} onClick={() => mark('first_payment', 'First payment cleared')}>Mark cleared today</button>}</dd></div>
      </dl>
    </section>
  )
}
