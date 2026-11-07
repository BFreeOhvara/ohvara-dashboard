import { useState } from 'react'
import { Copy, Mail, RefreshCw, ShieldAlert, CircleCheck, Clock3, TriangleAlert, Inbox } from 'lucide-react'
import { Chip, Drawer, SampleTag, useNote } from './kit'
import { useSampleSettings, useSampleActions } from './data'
import './p885.css'

// P885 — missed payments (N-E-08; Q37, Q38, Q42), the agent's side.
//   PaymentIntakeCard: the agent's own forwarding address. Carrier lapse / missed-payment / NSF emails forwarded
//     there become a save call for the team (the payment-intake function → payment_intake_receive). New address =
//     rotate_my_payment_intake_address (the old one stops at once). Recent emails show what happened to each.
//   MissedPaymentBlock: on a client who missed a payment: when, how we found out, grace, the save call, and the
//     chargeback watch month in year one. The agent is warned at the first miss (Q42); any change in a carrier
//     portal is the agent's to do (Q38).
// Sample only: P848 wires my_payment_intake_address, payment_intake_emails and payment_missed_events.

const EMAIL_STATUS = {
  matched: ['warn', 'Save call opened'],
  unmatched: ['mute', 'Team is matching it'],
  paid_notice: ['green', 'Payment received'],
  not_a_notice: ['mute', 'Not a missed payment'],
}

export function PaymentIntakeCard() {
  const { data: s } = useSampleSettings()
  const { rotateIntake } = useSampleActions()
  const note = useNote()
  const [ask, setAsk] = useState(false)
  const pi = s.paymentIntake
  const copy = async () => {
    try { await navigator.clipboard.writeText(pi.address); note('Address copied') } catch { note(pi.address) }
  }
  return (
    <section className="pi-card" aria-labelledby="pi-h">
      <header className="pi-h">
        <Mail size={18} aria-hidden="true" />
        <div className="tp-grow"><h3 id="pi-h">Missed-payment emails</h3>
          <p className="tp-sub">Forward carrier lapse, missed-payment and returned-draft emails here. We open a save call for the client the same day and tell you straight away.</p></div>
        <SampleTag>Sample</SampleTag>
      </header>
      <div className="pi-addr">
        <code className="pi-code" aria-label="Your forwarding address">{pi.address}</code>
        <button type="button" className="tp-btn ov-ghost" onClick={copy}><Copy size={15} />Copy</button>
      </div>
      <ol className="pi-how">
        <li><b>Best:</b> make a mail rule that forwards anything from your carriers with “lapse”, “past due”, “returned” or “NSF” in it to this address.</li>
        <li>Or forward a notice by hand when it comes in. Forwarding it twice is fine; we only open one save call.</li>
        <li>The team also checks your carrier portals every week. Anything that needs changing in a portal comes to you; the team only looks.</li>
      </ol>
      {pi.recent.length > 0 && (
        <div className="pi-recent">
          <b className="pi-sub"><Inbox size={14} aria-hidden="true" />Recently received</b>
          <ul className="tp-list">{pi.recent.map(r => {
            const [tone, label] = EMAIL_STATUS[r.status]
            return <li key={r.id} className="tp-li"><span className="tp-grow"><b>{r.subject}</b><small>{r.at}{r.client ? ` · ${r.client}` : ''}</small></span><Chip tone={tone}>{label}</Chip></li>
          })}</ul>
        </div>
      )}
      <div className="fx-form-row">
        <span className="tp-sub tp-grow">Someone else has this address?</span>
        <button type="button" className="tp-btn ov-ghost" onClick={() => setAsk(true)}><RefreshCw size={15} />New address</button>
      </div>
      <Drawer open={ask} center onClose={() => setAsk(false)} title="Make a new address?" sub="The old one stops working right away."
        footer={<button type="button" className="tp-primary fx-accent" onClick={() => { rotateIntake(); setAsk(false); note('New address made. Update your mail rule') }}><RefreshCw size={16} />Make a new address</button>}>
        <p className="tp-mid">Emails sent to <b>{pi.address}</b> will be ignored. Update any mail rule to the new address.</p>
      </Drawer>
    </section>
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
