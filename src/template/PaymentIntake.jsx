import { useEffect, useMemo, useState } from 'react'
import { Copy, Mail, RefreshCw, ShieldAlert, CircleCheck, Clock3, TriangleAlert, Inbox, Lock, X, Plus, ExternalLink } from 'lucide-react'
import { Chip, Drawer, SampleTag, Seg, useNote } from './kit'
import { useCarrierEmails } from './data'
import './p885.css'

// P885 + P1027 — Connect carrier emails, the agent's side.
//   CarrierEmails (PaymentIntakeCard in Settings, compact in setup): the agent's own address (dana-7k2f@notices.ohvara.com),
//     the carriers whose notices they forward, step-by-step Gmail / Outlook filters that forward ONLY those carriers'
//     emails, Gmail's confirmation code (we receive it and show it here), a Test, and the last few notices.
//     A missed / returned payment, grace period or pending lapse becomes a save call for the team and a "Client's
//     payment failed: Our team is on it" alert (migration 284 + payment-intake). Never their password or inbox.
//   MissedPaymentBlock: on a client who missed a payment: when, how we found out, grace, the save call, and the
//     chargeback watch month in year one.

const EMAIL_STATUS = {
  matched: ['warn', 'Team is on it'],
  unmatched: ['mute', 'Team is checking it'],
  paid_notice: ['green', 'Payment received'],
  not_a_notice: ['mute', 'Not a notice'],
}
const CATEGORY = {
  failed: 'Payment failed', returned: 'Payment returned', grace: 'Grace period', pending_lapse: 'Lapse pending',
  lapsed: 'Lapsed', login: 'Log in to view', paid: 'Paid', other: 'Notice',
}
const when = iso => {
  try { return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return '' }
}

export function PaymentIntakeCard() { return <CarrierEmails /> }

export function CarrierEmails({ compact = false, onTested }) {
  const ce = useCarrierEmails()
  const note = useNote()
  const [ask, setAsk] = useState(false)
  const [mail, setMail] = useState('gmail')
  const d = ce.data
  const tested = !!d?.test_ok
  useEffect(() => { if (tested && onTested) onTested() }, [tested, onTested])

  if (ce.loading) return <section className="pi-card" aria-busy="true"><p className="tp-sub">Loading carrier emails…</p></section>
  if (ce.unavailable || !d) {
    return <section className="pi-card"><header className="pi-h"><Mail size={18} aria-hidden="true" /><div className="tp-grow"><h3>Connect carrier emails</h3>
      <p className="tp-sub">Opens soon: forward your carriers{'’'} policy notices so our team catches missed payments for you.</p></div></header></section>
  }
  const copy = async (t, what) => { try { await navigator.clipboard.writeText(t); note(`${what} copied`) } catch { note(t) } }
  return (
    <section className="pi-card" aria-labelledby="pi-h">
      {!compact && (
        <header className="pi-h">
          <Mail size={18} aria-hidden="true" />
          <div className="tp-grow"><h3 id="pi-h">Connect carrier emails</h3>
            <p className="tp-sub">Forward your carriers{'’'} policy notices to Ohvara so our team catches missed payments for you. When a payment fails, bounces or a policy heads for lapse, we call your client the same day and tell you we{'’'}re on it.</p></div>
          <SampleTag>Sample</SampleTag>
        </header>
      )}
      <p className="pi-safe"><Lock size={14} aria-hidden="true" /><span>We only get the emails your carriers send that your filter forwards, never the rest of your inbox. We never ask for your email password.</span></p>
      <div className="pi-addr">
        <code className="pi-code" aria-label="Your Ohvara address">{d.address}</code>
        <button type="button" className="tp-btn ov-ghost" onClick={() => copy(d.address, 'Address')}><Copy size={15} />Copy</button>
      </div>
      <CarrierList ce={ce} />
      <ForwardSetup value={{ mail, tested }} address={d.address} carriers={d.carriers} gmail={d.gmail}
        waiting={!!d.test_started_at && !tested} onChange={v => setMail(v.mail)}
        onTest={async () => { try { await ce.startTest(); note('Now forward any email to your Ohvara address') } catch (e) { note(e.message) } }} />
      {!compact && d.recent?.length > 0 && (
        <div className="pi-recent">
          <b className="pi-sub"><Inbox size={14} aria-hidden="true" />Recent carrier notices</b>
          <ul className="tp-list">{d.recent.map(r => {
            const [tone, label] = EMAIL_STATUS[r.status] || EMAIL_STATUS.unmatched
            return <li key={r.id} className="tp-li"><span className="tp-grow"><b>{r.subject || 'No subject'}</b><small>{when(r.at)}{CATEGORY[r.category] ? ` · ${CATEGORY[r.category]}` : ''}{r.client ? ` · ${r.client}` : ''}</small></span><Chip tone={tone}>{label}</Chip></li>
          })}</ul>
        </div>
      )}
      {!compact && (
        <div className="fx-form-row">
          <span className="tp-sub tp-grow">Someone else has this address?</span>
          <button type="button" className="tp-btn ov-ghost" onClick={() => setAsk(true)}><RefreshCw size={15} />New address</button>
        </div>
      )}
      <Drawer open={ask} center onClose={() => setAsk(false)} title="Make a new address?" sub="The old one stops working right away."
        footer={<button type="button" className="tp-primary fx-accent" onClick={async () => { setAsk(false); try { await ce.rotate(); note('New address made. Update your mail filter') } catch (e) { note(e.message) } }}><RefreshCw size={16} />Make a new address</button>}>
        <p className="tp-mid">Emails sent to <b>{d.address}</b> will be ignored. Update your Gmail or Outlook filter to the new address.</p>
      </Drawer>
    </section>
  )
}

// Step 1: which carriers. Picked from the agent's book first, then every carrier; the email domain their notices
// come from is filled in where we know it, otherwise the agent types it (it's in any email from that carrier).
function CarrierList({ ce }) {
  const note = useNote()
  const d = ce.data
  const chosen = useMemo(() => d.carriers || [], [d.carriers])
  const options = useMemo(() => {
    const seen = new Set(chosen.map(c => c.name.toLowerCase()))
    const out = []
    for (const c of [...(d.suggested || []), ...(d.all || [])]) {
      if (seen.has(c.name.toLowerCase())) continue
      seen.add(c.name.toLowerCase())
      out.push(c)
    }
    return out
  }, [chosen, d.suggested, d.all])
  const [pick, setPick] = useState('')
  const [dom, setDom] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async list => {
    setBusy(true)
    try { await ce.saveCarriers(list); return true } catch (e) { note(e.message); return false } finally { setBusy(false) }
  }
  const add = async () => {
    const name = pick.trim()
    if (!name) return
    if (await save([...chosen, { name, domain: dom.trim() || null }])) { setPick(''); setDom('') }
  }
  return (
    <div className="pi-fwd" aria-label="Your carriers">
      <b className="pi-sub">1. Your carriers</b>
      {chosen.length === 0 && <p className="tp-sub">Add each carrier you sell with. Only their emails get forwarded.</p>}
      {chosen.length > 0 && (
        <ul className="pi-carriers">{chosen.map(c => (
          <li key={c.name}><b>{c.name}</b><code>{c.domain || 'add its email domain'}</code>
            <button type="button" className="pi-x" aria-label={`Remove ${c.name}`} disabled={busy} onClick={() => save(chosen.filter(x => x.name !== c.name))}><X size={14} /></button></li>
        ))}</ul>
      )}
      <div className="pi-add">
        <input list="pi-carrier-options" placeholder="Carrier" aria-label="Carrier" value={pick}
          onChange={e => { const v = e.target.value; setPick(v); const o = options.find(x => x.name.toLowerCase() === v.trim().toLowerCase()); if (o) setDom(o.domain || '') }} />
        <datalist id="pi-carrier-options">{options.map(o => <option key={o.name} value={o.name} />)}</datalist>
        <input placeholder="Email domain, e.g. carrier.com" aria-label="Carrier email domain" value={dom} onChange={e => setDom(e.target.value)} />
        <button type="button" className="tp-btn ov-ghost" disabled={busy || !pick.trim()} onClick={add}><Plus size={15} />Add</button>
      </div>
      <small className="tp-sub">Don{'’'}t know the domain? Open any email from that carrier: it{'’'}s the part after the @ in the sender{'’'}s address.</small>
    </div>
  )
}

// Steps 2 and 3: the filter in their mail app, then a test. Used in Settings and in setup (Welcome).
const GUIDES = (address, filter) => ({
  gmail: [
    'In Gmail on a computer, open Settings (the gear), then See all settings, then Forwarding and POP/IMAP.',
    `Click Add a forwarding address, paste ${address}, then Next and Proceed.`,
    'Gmail sends us a confirmation code. It shows up right here within a minute: click Verify in Gmail and type it in.',
    'Leave Gmail on "Disable forwarding" and Save. The filter below forwards only your carriers’ emails, nothing else.',
    `In the Gmail search bar, open Show search options. In From, paste ${filter || 'your carriers’ domains'}. Click Create filter, tick Forward it to, pick your Ohvara address, then Create filter.`,
  ],
  outlook: [
    'In Outlook, open Settings, then Mail, then Rules, then Add new rule. Name it "Ohvara carrier notices".',
    `Add a condition: From (classic Outlook: "with specific words in the sender's address") and enter each domain: ${filter ? filter.replace(/ OR /g, ', ') : 'your carriers’ domains'}.`,
    `Add an action: Forward to, paste ${address}, and Save. Outlook needs no code.`,
    'A work Outlook account may block forwarding outside the company. If the test never arrives, ask whoever runs your email.',
  ],
  other: [
    `Make a mail rule: email from ${filter ? filter.replace(/ OR /g, ', ') : 'your carriers’ domains'}, forward it to ${address}.`,
    'Your email provider’s help has a page called "forward email automatically".',
  ],
})
export function ForwardSetup({ value, address, carriers = [], gmail = null, waiting = false, onChange, onTest }) {
  const note = useNote()
  const v = { mail: 'gmail', tested: false, ...value }
  const domains = carriers.map(c => c.domain).filter(Boolean)
  const filter = domains.join(' OR ')
  const missing = carriers.filter(c => !c.domain).map(c => c.name)
  const copy = async t => { try { await navigator.clipboard.writeText(t); note('Copied') } catch { note(t) } }
  return (
    <div className="pi-fwd" aria-label="Forward carrier emails">
      <b className="pi-sub"><Clock3 size={14} aria-hidden="true" />2. Turn on forwarding (about two minutes)</b>
      <Seg label="Your email" value={v.mail} onChange={mail => onChange({ ...v, mail })} options={[{ key: 'gmail', label: 'Gmail' }, { key: 'outlook', label: 'Outlook' }, { key: 'other', label: 'Other' }]} />
      {filter && (
        <div className="pi-addr">
          <code className="pi-code" aria-label="Carrier domains to forward">{filter}</code>
          <button type="button" className="tp-btn ov-ghost" onClick={() => copy(filter)}><Copy size={15} />Copy</button>
        </div>
      )}
      {missing.length > 0 && <p className="tp-sub">Add the email domain for {missing.join(', ')} above to include them.</p>}
      <ol className="pi-how">{GUIDES(address, filter)[v.mail].map(t => <li key={t}>{t}</li>)}</ol>
      {v.mail === 'gmail' && (gmail?.code
        ? <div className="pi-gcode" aria-live="polite">
            <span className="tp-grow">Gmail{'’'}s code{gmail.for ? ` for ${gmail.for}` : ''}: <code>{gmail.code}</code></span>
            <button type="button" className="tp-btn ov-ghost" onClick={() => copy(gmail.code)}><Copy size={15} />Copy</button>
            {gmail.link && <a className="tp-btn ov-ghost" href={gmail.link} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Confirm in Gmail</a>}
          </div>
        : <p className="tp-sub">Gmail{'’'}s code will show here after step 2.</p>)}
      <b className="pi-sub">3. Test it</b>
      <div className="fx-form-row">
        <span className="tp-grow tp-sub">{v.tested ? 'It works: your email reached us.' : waiting ? 'Now forward any email to your Ohvara address. Waiting for it…' : 'Tap Send a test, then forward any email to your Ohvara address.'}</span>
        {v.tested ? <Chip tone="green"><CircleCheck size={13} aria-hidden="true" />Test received</Chip>
          : <button type="button" className="tp-btn ov-ghost" disabled={waiting} onClick={onTest}><Mail size={15} />{waiting ? 'Waiting for it…' : 'Send a test'}</button>}
      </div>
    </div>
  )
}

export function MissedPaymentBlock({ c }) {
  const m = c.missed
  return (
    <section className="fx-blk fx-attn pi-miss" aria-label="Missed payment">
      <header><h3>{m.chargeback ? <ShieldAlert size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}{m.chargeback ? 'Chargeback risk: payment missed' : 'Payment missed'}</h3></header>
      <p className="tp-mid">{c.carrier_name}: the payment due {m.due} didn{'’'}t go through ({m.how}).{m.repeat ? ' This is the second miss in 12 months.' : ''}</p>
      <dl className="fx-facts pi-facts">
        <div><dt>Grace ends</dt><dd>{m.grace}</dd></div>
        <div><dt>Save call</dt><dd>By {m.saveBy}</dd></div>
        {m.chargeback && <div><dt>Chargeback watch</dt><dd>Month {m.month} of {m.of}</dd></div>}
        <div><dt>Where it is</dt><dd className="pi-now">{m.done ? <CircleCheck size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}{m.progress}</dd></div>
      </dl>
      {m.portalAction && <p className="pi-act"><TriangleAlert size={15} aria-hidden="true" /><span><b>For you in the {c.carrier_name} portal:</b> {m.portalAction}</span></p>}
    </section>
  )
}
