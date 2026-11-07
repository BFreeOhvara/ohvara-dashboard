import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, FileSignature, CircleCheck, Camera, Lock } from 'lucide-react'
import { useByToken, docActions } from '../template/docs886/data'
import { SIGNER_ROLE } from '../lib/documents'
import '../template/p886.css'

// P886 — /sign/<token>: the client's private link (N-E-30 e-sign, N-E-31 uploads). No login; leads see Deedstone.
// Real links call the doc-sign edge function (GET the form, POST sign / decline / upload). /sign/sample, or a link
// made on sample data in this browser, plays the same page on sample data (nothing leaves the browser).
// The consent wording is DRAFT until Brayden approves it (doc-sign core.ts CONSENT_TEXT is the one the server records).

const FN = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/doc-sign`
const CONSENT = 'I agree to sign this form electronically. My typed name is my signature and has the same effect as signing on paper. I can ask Deedstone for a paper copy at no cost, and I can choose not to sign.'
const SAMPLE = { state: 'sign', mode: 'sign', title: 'Mutual of Omaha change of beneficiary', carrier: 'Mutual of Omaha', name: 'Denise Walker', role: 'Policy owner',
  others: [{ role: 'Irrevocable beneficiary', name: 'Marcus Walker', signed: false }], facts: [['Owner', 'Denise Walker'], ['Policy', 'MO-2291804'], ['New beneficiary', 'Marcus Walker, son']] }

const toB64 = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file) })

export default function SignLink() {
  const { token } = useParams()
  const local = useByToken(token)
  const sample = token === 'sample' || !!local
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [file, setFile] = useState(null)

  useEffect(() => {
    if (sample) return
    let gone = false
    fetch(`${FN}?t=${encodeURIComponent(token)}`).then(r => r.json()).then(b => { if (!gone) setInfo(b) }).catch(() => { if (!gone) setError('We couldn’t open this link. Check your signal and try again.') })
    return () => { gone = true }
  }, [token, sample])

  const view = useMemo(() => {
    if (!sample) return info
    if (!local) return SAMPLE
    const { d, g } = local
    const state = d.status === 'void' ? 'void' : g.signed_at ? (g.role === 'uploader' ? 'done' : 'signed') : g.declined_at ? 'declined' : g.role === 'uploader' ? 'upload' : 'sign'
    return { state, mode: g.role === 'uploader' ? 'upload' : 'sign', title: d.title, carrier: d.carrier, name: g.name, role: SIGNER_ROLE[g.role],
      others: d.signers.filter(x => x.id !== g.id).map(x => ({ role: SIGNER_ROLE[x.role], name: x.name, signed: !!x.signed_at })), facts: [['Owner', local.who], ['Carrier', d.carrier]] }
  }, [sample, local, info])

  const pdfUrl = useMemo(() => {
    if (!info?.pdf) return null
    const bin = atob(info.pdf); const b = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i)
    return URL.createObjectURL(new Blob([b], { type: 'application/pdf' }))
  }, [info])

  const post = async body => {
    setBusy(true); setError(null)
    try {
      if (sample) {
        if (local && body.action === 'sign') docActions.sign(local.who, local.d.id, local.g.id, body.name)
        if (local && body.action === 'decline') docActions.decline(local.who, local.d.id, local.g.id, body.reason)
        if (local && body.action === 'upload') docActions.uploaded(local.who, local.d.id)
        setDone(body.action)
      } else {
        const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, t: token }) })
        const b = await r.json()
        if (!r.ok) setError(b.error || 'That didn’t work. Try again.')
        else setDone(body.action)
      }
    } catch { setError('That didn’t work. Check your signal and try again.') }
    setBusy(false)
  }
  const upload = async () => { if (!file) return; post({ action: 'upload', type: file.type, name: file.name, file: await toB64(file) }) }

  const first = (view?.name || '').split(' ')[0]
  let body
  if (!view && !error) body = <div className="sg-center"><Loader2 size={22} className="animate-spin" aria-label="Loading" /></div>
  else if (done === 'sign') body = <Plain ok title="Signed. Thank you" text={view?.others?.some(o => !o.signed) ? 'We’ll send it to the carrier once everyone has signed. We’ll be in touch.' : 'We’ll send it to the carrier and let you know when they have it.'} />
  else if (done === 'decline') body = <Plain title="Got it" text="We won’t send this form. Someone from Deedstone will call you." />
  else if (done === 'upload') body = <Plain ok title="Received. Thank you" text="It’s saved with your policy. We’ll take it from here." />
  else if (!view) body = <Plain title="Something went wrong" text={error} />
  else if (view.state === 'not_found') body = <Plain title="This link isn’t valid" text="Check that you opened the full link from the text message." />
  else if (view.state === 'expired') body = <Plain title="This link ran out" text="Reply to the text or call us and we’ll send a new one." />
  else if (view.state === 'signed' || view.state === 'done') body = <Plain ok title="Already done" text="You’ve already finished this one. Thank you." />
  else if (view.state === 'declined' || view.state === 'void') body = <Plain title="Nothing to do here" text="This form isn’t needed any more. Call us with any questions." />
  else if (view.mode === 'upload') {
    body = (
      <>
        <h1>Hi {first}, send us a photo</h1>
        <p className="sg-lead">Take a clear photo of the {view.title?.toLowerCase() || 'document'} (all four corners), or pick a PDF. It’s kept with your policy.</p>
        <label className="sg-file"><Camera size={18} aria-hidden="true" /><span>{file ? file.name : 'Take a photo or choose a file'}</span>
          <input type="file" accept="image/*,application/pdf" capture="environment" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
        {error && <p className="sg-err" role="alert">{error}</p>}
        <button type="button" className="sg-btn" disabled={!file || busy || file.size > 10 * 1024 * 1024} onClick={upload}>{busy ? 'Sending…' : 'Send'}</button>
        {file && file.size > 10 * 1024 * 1024 && <p className="sg-err">That file is over 10 MB. Try a smaller photo.</p>}
      </>
    )
  } else {
    body = (
      <>
        <h1>Hi {first}, please sign</h1>
        <p className="sg-lead">{view.carrier ? `${view.carrier} needs your signature on` : 'Your signature is needed on'} <b>{view.title}</b>. You’re signing as {view.role?.toLowerCase()}.</p>
        {pdfUrl ? <object className="sg-pdf" data={pdfUrl} type="application/pdf" aria-label={view.title}><a href={pdfUrl} target="_blank" rel="noreferrer">Open the form</a></object>
          : <dl className="sg-facts">{(view.facts || []).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}<p className="sg-note">Sample: the real link shows the carrier’s form, filled in from your policy.</p></dl>}
        {view.others?.length > 0 && <p className="sg-note">Also signing: {view.others.map(o => `${o.name} (${o.signed ? 'signed' : 'not yet'})`).join(', ')}.</p>}
        <label className="sg-field"><span>Type your full name</span><input value={name} autoComplete="name" onChange={e => setName(e.target.value)} placeholder="Your full name" /></label>
        <label className="sg-agree"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /><span>{CONSENT}</span></label>
        {error && <p className="sg-err" role="alert">{error}</p>}
        <button type="button" className="sg-btn" disabled={busy || !agree || name.trim().length < 2} onClick={() => post({ action: 'sign', name: name.trim(), consent: true })}><FileSignature size={17} aria-hidden="true" />{busy ? 'Signing…' : 'Sign'}</button>
        {!declining ? <button type="button" className="sg-link" onClick={() => setDeclining(true)}>I don’t want to sign this</button> : (
          <div className="sg-decline">
            <label className="sg-field"><span>Tell us why (optional)</span><input value={reason} onChange={e => setReason(e.target.value)} /></label>
            <button type="button" className="sg-link" disabled={busy} onClick={() => post({ action: 'decline', reason })}>Don’t sign</button>
          </div>
        )}
      </>
    )
  }
  return (
    <main className="sg-page">
      <div className="sg-card">
        <p className="sg-brand"><Lock size={13} aria-hidden="true" />Deedstone · private link{sample ? ' · sample' : ''}</p>
        {body}
      </div>
    </main>
  )
}

function Plain({ title, text, ok }) {
  return <div className="sg-plain">{ok && <CircleCheck size={28} aria-hidden="true" className="sg-ok" />}<h1>{title}</h1><p className="sg-lead">{text}</p></div>
}
