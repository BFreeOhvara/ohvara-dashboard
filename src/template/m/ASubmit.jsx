import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useSampleActions, useSampleSettings, useSampleLeads } from '../data'
import { Field, Seg, useNote } from '../kit'
import { Select } from '../Select'
import { fillFromMatch } from '../leadLifecycle'
import { agentChip } from '../agentView'
import { PhoneInput } from '../PhoneInput'
import { StateSelect } from '../StateSelect'
import { CarrierSelect } from '../CarrierSelect'
import { asPick } from '../licenceModel'
import { bookAfterSale, bookedText } from '../ful/data'
import { EMPTY_SUBMIT, NEEDED, TIMES, DRAFT_DAYS, missingFields, buildSubmission } from '../submitModel'
import Submit from '../screens/Submit'
import { useApp, SubPage, Toggle } from './AppKit'

// P967 — Submit a policy on the phone: one form (the client, the policy, "Replaces an old policy" as a switch that
// opens the old carrier, draft date and premium), then "Send to the team". Same rules and the same save as the
// portal's Submit (submitModel missingFields / buildSubmission, bookAfterSale books the hand-off call and the cancel
// call). A spouse or an exact call time opens the portal's full form (?full=1).
const BEST = TIMES.map(t => ({ key: t, label: t }))

export default function ASubmit({ root = false, nested }) {
  const [params] = useSearchParams()
  if (typeof nested === 'string' ? nested === 'full' : !root && params.get('full') === '1') return <SubPage title="Submit a policy" className="is-wide"><div className="ma-embed"><Submit /></div></SubPage>
  return <SubmitForm leadId={params.get('lead')} />
}

function SubmitForm({ leadId }) {
  const app = useApp()
  const { submitSale } = useSampleActions()
  const { data: settings } = useSampleSettings()
  const { data: leads } = useSampleLeads()
  const note = useNote()
  const [f, setF] = useState(() => {
    const l = leads.find(x => x.id === leadId)
    const base = { ...EMPTY_SUBMIT, replacing: false }
    if (!l) return base
    const notes = [l.wants && `Wants: ${l.wants}`, l.note].filter(Boolean).join('\n')
    return { ...base, ...fillFromMatch({ kind: 'lead', id: l.id, name: `${l.first_name} ${l.last_name}`, phone: l.phone, city: l.city, state: l.state, stage: agentChip(l)[1] }), notes }
  })
  const [tried, setTried] = useState(false)
  const [done, setDone] = useState(null)
  const licensed = settings.licence ? asPick(settings.licence).states : null
  const opts = { policy: true, licensed }
  const missing = missingFields(f, opts)
  const bad = k => tried && missing.includes(k)
  const set = k => e => setF({ ...f, [k]: e.target.value })

  const send = () => {
    setTried(true)
    if (missing.length) { note(`Still needed: ${missing.map(k => NEEDED[k]).join(', ')}`); return }
    const sale = buildSubmission(f, 'agent', opts)
    if (!sale) return
    sale.linked = f.linked || null
    const got = bookAfterSale({ who: sale.name, phone: sale.phoneShown, state: sale.state || '', city: sale.city || '', carrier: sale.carrier, window: sale.bestTime,
      exact: null, replaces: sale.replaces ? { carrier: sale.replaces.carrier, premium: sale.replaces.premium, draftDay: sale.replaces.draftDay } : null, note: sale.notes })
    sale.handoff = got.handoff ? { iso: got.handoff.iso, tz: got.handoff.tz, vaId: got.handoff.va?.id || null } : null
    submitSale(sale)
    setDone({ name: sale.name, call: got.handoff ? bookedText(got.handoff.iso, got.handoff.tz) : null, cancel: got.cancel ? bookedText(got.cancel.iso, got.cancel.tz) : null })
    note('Sale submitted for servicing')
  }

  if (done) {
    return (
      <SubPage title="Sent to the team" foot={<button type="button" className="ma-btn is-solid is-grow is-tall ma-press" onClick={app.back}>Done</button>}>
        <div className="ma-done ma-rise">
          <span className="ma-done-tick" aria-hidden="true"><Check size={30} /></span>
          <b>{done.name} is on your books</b>
          <p>{done.call ? `Their hand-off call is booked for ${done.call}.` : 'Our team takes it from here.'}{done.cancel ? ` The call to cancel the old policy is booked for ${done.cancel}.` : ''} It shows on Clients as Working until it’s Protected.</p>
        </div>
      </SubPage>
    )
  }

  const foot = <button type="button" className="ma-btn is-solid is-grow is-tall ma-press" onClick={send}>Send to the team</button>
  return (
    <SubPage title="Submit a policy" line="Our team sets it up with the client and the carrier" foot={foot}>
      <div className="ma-form">
        <p className="ma-cap">The client</p>
        <Field label="Client name"><input className={bad('name') ? 'is-bad' : ''} value={f.name} onChange={set('name')} autoComplete="off" /></Field>
        <Field label="Phone"><PhoneInput invalid={bad('phone')} value={f.phone} onChange={d => setF({ ...f, phone: d })} /></Field>
        <div className="ma-two">
          <Field label="City"><input className={bad('city') ? 'is-bad' : ''} value={f.city} onChange={set('city')} /></Field>
          <Field label="State"><StateSelect invalid={bad('state') || bad('licence')} value={f.state} onChange={v => setF({ ...f, state: v })} /></Field>
        </div>
        {missing.includes('licence') && <p className="ma-err" role="alert">Your verified licence doesn’t cover that state. Only submit sales you wrote in a state you’re licensed in.</p>}
        <Field label="Best time to reach them" hint="Their local time. We book the hand-off call for you."><Seg label="Best time to reach them" value={f.best} onChange={v => setF({ ...f, reach: 'best', best: v })} options={BEST} /></Field>

        <p className="ma-cap">The policy</p>
        <Field label="Carrier"><CarrierSelect invalid={bad('carrier')} value={f.carrier} onChange={v => setF({ ...f, carrier: v })} by="agent" /></Field>
        <div className="ma-two">
          <Field label="Draft day"><Select label="Draft day" invalid={bad('draftDay')} placeholder="Pick a day" value={f.draftDay} onChange={v => setF({ ...f, draftDay: v })} options={DRAFT_DAYS} /></Field>
          <Field label="Monthly premium"><input inputMode="decimal" className="tp-money" placeholder="$0" value={f.premium} onChange={set('premium')} /></Field>
        </div>

        <div className="ma-glass ma-list">
          <div className="ma-row"><span className="ma-grow"><b>Replaces an old policy</b><small>We cancel the old one once the new one is issued</small></span>
            <Toggle on={!!f.replacing} label="Replaces an old policy" onChange={v => setF({ ...f, replacing: v })} /></div>
        </div>
        {f.replacing && <>
          <Field label="Old carrier"><CarrierSelect label="Old carrier" invalid={bad('oldCarrier')} value={f.oldCarrier} onChange={v => setF({ ...f, oldCarrier: v })} by="agent" /></Field>
          <div className="ma-two">
            <Field label="Old draft date"><Select label="Old draft date" invalid={bad('oldDraftDay')} placeholder="Pick a day" value={f.oldDraftDay} onChange={v => setF({ ...f, oldDraftDay: v })} options={DRAFT_DAYS} /></Field>
            <Field label="Old premium"><input inputMode="decimal" className="tp-money" placeholder="Optional" value={f.oldPremium} onChange={set('oldPremium')} /></Field>
          </div>
        </>}

        <Field label="Anything our team should know?"><textarea rows={3} value={f.notes} onChange={set('notes')} /></Field>
        <button type="button" className="ma-link-btn" onClick={() => app.open(`${window.location.pathname}?full=1${leadId ? `&lead=${leadId}` : ''}`)}>Adding a spouse or an exact call time? Use the full form</button>
      </div>
    </SubPage>
  )
}
