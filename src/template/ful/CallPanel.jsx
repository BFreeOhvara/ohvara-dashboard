import { useState } from 'react'
import { ChevronDown, MessageSquareText, Check } from 'lucide-react'
import { BeforeCall } from './BeforeCall'
import { DocsBlock } from './Docs886'
import { whyLine, stepsOf, factsOf, textsOf, typeOf } from './callSteps'
import { CarrierWay, FrontDeskNote } from './Playbook932'
import { pathFor } from '../../lib/servicing/playbook.js'
import { usePlaybookState } from './playbook932Store'
import './callpanel931.css'

// P931 — the call panel's body, the same for every booked call (cancel the old policy, a hand-off, a save, a change,
// a callback, a welcome, a review). Top: why we're calling in one line and the agent's note (the P923 box). Then the
// client: name, phone, carrier, draft date, agent. Then at most 3 steps for this call. Texts sit closed under
// "Texts". Start call and the result buttons are the drawer's footer. No "check it's them" on a call we booked.
export function CallBody({ item, oldCarrier = null, cancelBy = null, done = false, now = false, bookedWhen = '', welcome = null, gate = null }) {
  // P932: the carrier's way for this change (cancel the old policy, or a change) — ready before the call.
  const pb = usePlaybookState()
  const type = typeOf(item)
  const way = type === 'cancel_old' ? { carrier: oldCarrier || item.old_carrier, kind: 'cancel' } : type === 'change' ? { carrier: item.carrier, kind: item.kind } : null
  const path = way?.carrier ? pathFor(way.carrier, way.kind, pb.edits).path : null
  const steps = stepsOf(item, path)
  const texts = textsOf(item, done ? '' : bookedWhen)
  const c = item.client || {}
  return (
    <div className="cp931">
      <p className="cp-why">{whyLine(item)}</p>
      {gate}
      <FrontDeskNote summary={item.front_desk?.summary} />
      <BeforeCall client={c} agent={item.agent} oldCarrier={oldCarrier} cancelBy={cancelBy} note={item.note || null} noteBy="Note" />
      <dl className="cp-facts" aria-label="Client">{factsOf(item).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <ol className="cp-steps" aria-label="On this call">
        {steps.map((s, i) => (
          <li key={s.key} className={done ? 'is-done' : now && i === 0 ? 'is-now' : ''}>
            <span className="cp-n" aria-hidden="true">{done ? <Check size={13} /> : i + 1}</span>
            <div>
              <b>{s.title}</b>
              {s.sub && <span>{s.sub}</span>}
              {s.say && <q className="cp-say">{s.say}</q>}
              {s.part === 'way' && <CarrierWay carrier={way.carrier} kind={way.kind} itemId={item.id} first={c.first_name || (item.name || '').split(' ')[0] || 'They'} done={done} />}
              {s.part === 'facts' && <Facts c={c} item={item} />}
              {s.part === 'texts' && welcome}
              {(s.part === 'papers' || s.papers) && !done && <DocsBlock bare who={item.name} carrier={oldCarrier || item.carrier} task={item.old_carrier ? undefined : item.id} kinds={item.old_carrier ? ['cancellation_request'] : undefined} />}
            </div>
          </li>
        ))}
      </ol>
      <Texts texts={texts} />
    </div>
  )
}

const money = v => (v || v === 0 ? `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0 })}` : 'Not given')
function Facts({ c, item }) {
  const rows = [['Email', c.email || 'Not given'], ['State', c.state], ['Policy', c.policy_number], ['Product', c.product_name], ['Face amount', money(c.face_amount)], ['Premium', `${money(c.monthly_premium)} a month`], ['Effective', c.effective || 'Not given'], ['Carrier', item.carrier]]
  return <dl className="cp-more">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
}

// The texts with this client, closed by default.
function Texts({ texts }) {
  const [open, setOpen] = useState(false)
  return (
    <section className={`cp-texts${open ? ' is-open' : ''}`}>
      <button type="button" className="cp-texts-h" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <MessageSquareText size={15} aria-hidden="true" /><b>Texts</b><span className="tp-num">{texts.length}</span><span className="tp-grow" /><ChevronDown size={16} aria-hidden="true" className="cp-chev" />
      </button>
      {open && (texts.length
        ? <ul className="cp-texts-l">{texts.map(m => <li key={m.id} className={`is-${m.from}`}><small>{m.from === 'them' ? 'They texted' : 'We texted'}</small><span>{m.text}</span></li>)}</ul>
        : <p className="cp-none">No texts with this client yet.</p>)}
    </section>
  )
}
