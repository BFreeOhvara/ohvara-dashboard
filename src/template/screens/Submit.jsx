import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, Pencil, User, ShieldCheck, ClipboardCheck, PhoneCall, Wrench, Activity as ActivityIcon, Clock3, CalendarClock, UserPlus, Trash2 } from 'lucide-react'
import { useSampleActions, useSampleSettings, useSampleLeads, useSampleClients } from '../data'
import { Field, Pending, Seg, Chip, Switch, useNote, initials } from '../kit'
import { Select } from '../Select'
import { matchPeople, fillFromMatch } from '../leadLifecycle'
import { agentChip } from '../agentView'
import { US_STATES } from '../../lib/usStates'
import '../leads873.css'
import '../p878.css'
import { paths } from '../paths'
import { PhoneInput } from '../PhoneInput'
import { asPick } from '../licenceModel'
import { StateSelect } from '../StateSelect'
import { CarrierSelect } from '../CarrierSelect'
import { BookTime } from '../CallTime'
import { bookAfterSale, useAfterSalePreview, bookedText } from '../ful/data'
import { formatPhone } from '../phoneMask'
import { EMPTY_SUBMIT, EMPTY_SPOUSE, NEEDED, TIMES, DRAFT_DAYS, missingFields, buildSubmission, reachText, livesIn } from '../submitModel'
import { ordinal } from '../../lib/clientCheck.js'

// P843: Submit a policy, built out in the shell design. Three clear steps (the client, the policy, review) with a
// live summary beside them. P868: the phone formats itself and saves as E.164, the state is a dropdown, the carrier
// is the full carrier list, and reaching the client is the best time or a call booked right here (P854's rules: the
// client's clock, 30-minute slots, a VA on shift who is free). A booked call is saved with the policy.
// P907: one question, "When is the client easiest to reach?": Morning · Afternoon · Evening, or an exact time. The
// system books the hand-off call (always) at the next open time in that window on the client's clock with a free VA,
// and when the sale replaces a policy, the call to cancel the old one too (before its next draft, P899's gate).
const EMPTY = EMPTY_SUBMIT
const chipWords = l => agentChip(l)[1]
const money0 = v => (v ? `$${Number(String(v).replace(/[^\d.]/g, '')).toLocaleString('en-US')}` : 'Not given')
const WHEN = [...TIMES.map(x => ({ key: x, label: x })), { key: 'exact', label: 'Exact time', icon: CalendarClock }]
// P907: the hand-off call the system would book for this window, shown before Submit (sample; the server books it).
function AutoBooked({ state, city, window: win }) {
  const p = useAfterSalePreview({ state, city, window: win })
  return (
    <p className="tp-sub tp-row fx-sub-auto" role="status"><Clock3 size={14} aria-hidden="true" />
      {p ? `The hand-off call books itself: ${p.text}${p.inWindow === false ? ', the next open time' : ''}.` : `Add their city and state, and the hand-off call books itself in their ${win.toLowerCase()}.`}
    </p>
  )
}
const STEPS = [
  { key: 'client', label: 'The client', sub: 'Who you sold to', Icon: User, needs: ['name', 'phone', 'city', 'state', 'licence', 'booking'] },
  { key: 'policy', label: 'The policy', sub: 'Carrier and draft day', Icon: ShieldCheck, needs: ['carrier', 'draftDay', 'oldCarrier', 'oldDraftDay', 'spouse'] },
  { key: 'review', label: 'Review', sub: 'Check and submit', Icon: ClipboardCheck, needs: [] },
]
const NEXT = [
  [PhoneCall, 'Our team takes it from here', 'They set it up with the client and the carrier. It shows as Working.'],
  [ShieldCheck, 'Protected', 'Once it’s in force it turns green. Nothing needed from you.'],
  [ActivityIcon, 'Once a month: still on the books?', 'A few days after each draft we ask. One tap to confirm.'],
]

function Steps({ at, done, onPick }) {
  return (
    <ol className="fx-sub-steps" aria-label="Steps">
      {STEPS.map((s, i) => {
        const state = i === at ? 'is-on' : done(i) ? 'is-done' : ''
        const body = <><span className="fx-sub-dot">{done(i) && i !== at ? <Check size={14} aria-hidden="true" /> : i + 1}</span><span><b>{s.label}</b><small>{s.sub}</small></span></>
        return (
          <li key={s.key} className={state}>
            {i < at ? <button type="button" onClick={() => onPick(i)}>{body}</button> : <span aria-current={i === at ? 'step' : undefined}>{body}</span>}
          </li>
        )
      })}
    </ol>
  )
}

function Review({ f, onEdit }) {
  const rows = [
    ['client', 'The client', [['Name', f.name], ['Phone', formatPhone(f.phone)], ['Lives in', livesIn(f) || 'Not given'], [f.reach === 'book' ? 'Call booked' : 'Best time', f.reach === 'book' ? reachText(f) : f.best]]],
    ['policy', 'The policy', [['Carrier', f.carrier], ['Draft day', f.draftDay ? `The ${ordinal(Number(f.draftDay))} of each month` : 'Not given'], ['Monthly premium', money0(f.premium)], ['Notes', f.notes?.trim() || 'Not given'], ['Replaces', f.replacing ? `${f.oldCarrier || 'Not given'}${f.oldDraftDay ? `, drafts the ${ordinal(Number(f.oldDraftDay))}` : ''}` : 'Nothing'], ...(f.spouse ? [['Second insured', f.spouse.name || 'Not given']] : [])]],
  ]
  return (
    <div className="fx-sub-review">
      {rows.map(([key, title, list], i) => (
        <section key={key} className="fx-sub-rblk">
          <header><h3>{title}</h3><button type="button" className="fx-pillbtn" onClick={() => onEdit(i)}><Pencil size={13} aria-hidden="true" />Edit</button></header>
          <dl>{list.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </section>
      ))}
    </div>
  )
}

// P873 — Submit knows your leads: what the agent types in the name or phone shows their own leads and clients.
// Picking one fills the form and links the sale to that lead (it moves to Sold and becomes a client). No match means
// a new client: a lead they got somewhere else.
function Suggestions({ matches, active, onPick, query }) {
  if (!query) return null
  return (
    <div className="lc-sugg" role="listbox" id="submit-matches" aria-label="Your leads and clients">
      {matches.length ? <>
        <span className="lc-sugg-h">From your leads and clients</span>
        {matches.map((m, i) => (
          <button key={`${m.kind}-${m.id}`} type="button" role="option" id={`submit-match-${i}`} aria-selected={i === active} className={i === active ? 'is-on' : ''}
            onMouseDown={e => e.preventDefault()} onClick={() => onPick(m)}>
            <span className={`tp-av av-sky`} aria-hidden="true">{initials(m.name).toUpperCase()}</span>
            <span><b>{m.name}</b><small>{m.phone} · {m.state || 'No state'}</small></span>
            <Chip tone={m.kind === 'client' ? 'green' : 'blue'}>{m.kind === 'client' ? 'Client' : m.stage}</Chip>
          </button>
        ))}
      </> : <p className="lc-sugg-none">No match in your leads or clients. They{'’'}ll be a new client.</p>}
    </div>
  )
}

export default function Submit() {
  const { submitSale } = useSampleActions()
  const { data: settings } = useSampleSettings()
  const note = useNote()
  const [step, setStep] = useState(0)
  const { data: leads } = useSampleLeads()
  const { data: clients } = useSampleClients()
  const [params, setParams] = useSearchParams()
  // Opened from a sold lead (paths.submit(leadId)): the form starts filled in from that lead. P910: everything Ohvara
  // already has (name, phone, city, state, and the AI's notes: what they want and what they said), for live calls and
  // booked calls alike. The agent only adds the carrier, premium, draft date and when the client is easiest to reach.
  const [f, setF] = useState(() => {
    const l = leads.find(x => x.id === params.get('lead'))
    const notes = l ? [l.wants && `Wants: ${l.wants}`, l.note].filter(Boolean).join('\n') : ''
    return l ? { ...EMPTY, ...fillFromMatch({ kind: 'lead', id: l.id, name: `${l.first_name} ${l.last_name}`, phone: l.phone, city: l.city, state: l.state, stage: chipWords(l) }), notes } : EMPTY
  })
  useEffect(() => { if (params.get('lead')) setParams({}, { replace: true }) }, [params, setParams])
  const [tried, setTried] = useState(false)
  const [checked, setChecked] = useState([])
  const [done, setDone] = useState(null)
  const [typed, setTyped] = useState(null) // 'name' | 'phone': the field the matches follow
  const [active, setActive] = useState(0)
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const query = f.linked || !typed ? '' : typed === 'phone' ? f.phone : f.name
  const matches = query ? matchPeople(query, leads, clients, 6, chipWords) : []
  // P881: the states with a verified active life licence (not just the ones picked for leads).
  const licensed = settings.licence ? asPick(settings.licence).states : null // P848: the states the agent picked
  const opts = { policy: true, licensed }
  const stateName = code => US_STATES.find(x => x.code === code)?.name || code
  const setSpouse = patch => setF(x => ({ ...x, spouse: { ...x.spouse, ...patch } }))
  const shownQuery = matches.length || (typed === 'phone' ? f.phone.length >= 3 : f.name.trim().length >= 2) ? query : ''
  const pickMatch = m => { setF(x => ({ ...x, ...fillFromMatch(m) })); setTyped(null); setActive(0) }
  const onMatchKey = e => {
    if (!matches.length) { if (e.key === 'Escape') setTyped(null); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % matches.length) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + matches.length) % matches.length) }
    if (e.key === 'Enter') { e.preventDefault(); pickMatch(matches[Math.min(active, matches.length - 1)]) }
    if (e.key === 'Escape') setTyped(null)
  }
  const combo = shownQuery ? { role: 'combobox', 'aria-expanded': true, 'aria-controls': 'submit-matches', 'aria-autocomplete': 'list', 'aria-activedescendant': matches.length ? `submit-match-${Math.min(active, matches.length - 1)}` : undefined } : { 'aria-expanded': false }
  const missing = missingFields(f, opts)
  const bad = k => (tried || checked.includes(STEPS.findIndex(s => s.needs.includes(k)))) && missing.includes(k)
  const stepOk = i => STEPS[i].needs.every(k => !missing.includes(k))
  const next = () => {
    setChecked(c => [...new Set([...c, step])])
    if (stepOk(step)) setStep(step + 1)
  }
  const send = () => {
    setTried(true)
    if (missing.length) { setStep(STEPS.findIndex(s => s.needs.some(k => missing.includes(k)))); return }
    const sale = buildSubmission(f, 'agent', opts)
    if (!sale) return
    sale.linked = f.linked || null
    const got = bookAfterSale({ who: sale.name, phone: sale.phoneShown, state: sale.state || '', city: sale.city || '', carrier: sale.carrier, window: sale.bestTime,
      exact: sale.booking ? { iso: sale.booking.iso, tz: sale.booking.tz, vaId: sale.booking.vaId } : null,
      replaces: sale.replaces ? { carrier: sale.replaces.carrier, draftDay: sale.replaces.draftDay } : null })
    if (sale.booking) sale.booking.va = got.handoff?.va?.name || null
    sale.handoff = got.handoff ? { iso: got.handoff.iso, tz: got.handoff.tz, vaId: got.handoff.va?.id || null } : null
    submitSale(sale)
    setDone({ name: sale.name, call: got.handoff ? bookedText(got.handoff.iso, got.handoff.tz) : null, cancel: got.cancel ? bookedText(got.cancel.iso, got.cancel.tz) : null, spouse: sale.household[0]?.name || null })
    note('Sale submitted for servicing')
  }
  const restart = () => { setDone(null); setF(EMPTY); setTried(false); setChecked([]); setStep(0); setTyped(null) }

  if (done) {
    return (
      <div className="tp-page fx-page fx-sub is-done">
        <section className="fx-tile fx-sub-ok" style={{ '--i': 0 }}>
          <span className="fx-sub-okic"><Check size={26} aria-hidden="true" /></span>
          <h2>Submitted</h2>
          <p>{done.name}{done.spouse ? ` and ${done.spouse} are` : ' is'} on your books{done.spouse ? ', each with their own policy in one household' : ''}. {done.call ? `Their hand-off call is booked for ${done.call}.` : 'Our team takes it from here.'}{done.cancel ? ` The call to cancel the old policy is booked for ${done.cancel}.` : ''} It shows on Clients as Working until it{'’'}s Protected.</p>
          <ol className="fx-sub-next">{NEXT.map(([Icon, t, s]) => <li key={t}><span className="fx-sub-nic"><Icon size={16} aria-hidden="true" /></span><span><b>{t}</b><small>{s}</small></span></li>)}</ol>
          <div className="tp-row tp-wrap fx-sub-okacts">
            <Link to={paths.clients()} className="tp-primary fx-accent">See your clients</Link>
            <button type="button" className="tp-btn ov-ghost" onClick={restart}>Submit another</button>
          </div>
        </section>
      </div>
    )
  }

  const S = STEPS[step]
  return (
    <div className="tp-page fx-page fx-sub">
      <section className="fx-tile fx-sub-form" style={{ '--i': 0 }} aria-label="Submit a policy">
        <header className="fx-sub-h">
          <span className="fx-sub-ic"><S.Icon size={18} aria-hidden="true" /></span>
          <span className="tp-grow"><small>Step {step + 1} of {STEPS.length}</small><h2>{S.label}</h2></span>
        </header>
        <Steps at={step} done={i => checked.includes(i) && stepOk(i)} onPick={setStep} />

        <div className="fx-sub-body" key={S.key}>
          {S.key === 'client' && <>
            <p className="tp-sub">Name, phone, city and state. That’s all our team needs to reach them.</p>
            <div className="fx-form-grid">
              <Field label="Full name" hint="Type a name or number to find your lead."><input className={bad('name') ? 'tp-danger' : ''} value={f.name} onChange={e => { setF({ ...f, name: e.target.value, linked: null }); setTyped('name'); setActive(0) }} onKeyDown={onMatchKey} onBlur={() => setTyped(null)} placeholder="First and last name" autoComplete="off" {...(typed === 'name' ? combo : {})} /></Field>
              <Field label="Phone"><PhoneInput invalid={bad('phone')} value={f.phone} onChange={d => { setF({ ...f, phone: d, linked: null }); setTyped('phone'); setActive(0) }} onKeyDown={onMatchKey} onBlur={() => setTyped(null)} {...(typed === 'phone' ? combo : {})} /></Field>
            </div>
            <Suggestions matches={matches} active={Math.min(active, Math.max(matches.length - 1, 0))} onPick={pickMatch} query={shownQuery} />
            {f.linked && <p className="lc-linked"><Check size={15} aria-hidden="true" /><span>{f.linked.kind === 'lead' ? `Your lead · ${f.linked.stage}. Submitting makes them a client.` : 'Your client. This adds a policy to their record.'}</span><button type="button" onClick={() => setF({ ...f, linked: null })}>Not them</button></p>}
            <div className="fx-form-grid">
              <Field label="City"><input className={bad('city') ? 'tp-danger' : ''} value={f.city} onChange={set('city')} autoComplete="off" /></Field>
              <Field label="State"><StateSelect invalid={bad('licence') || bad('state')} value={f.state} onChange={v => setF({ ...f, state: v })} /></Field>
            </div>
            {missing.includes('licence') && <p className="fx-sub-err" role="alert">Your verified licence doesn{'’'}t cover {stateName(f.state)}. Only submit sales you wrote in a state you{'’'}re licensed in. Just licensed there? Check your licence again in Settings, Licence.</p>}
            <div className="fx-sub-field"><b>When is the client easiest to reach?</b><small>Their local time. We book the hand-off call for you.</small><Seg label="When is the client easiest to reach?" value={f.reach === 'book' ? 'exact' : f.best} onChange={v => setF(v === 'exact' ? { ...f, reach: 'book' } : { ...f, reach: 'best', best: v })} options={WHEN} /></div>
            {f.reach === 'best'
              ? <AutoBooked state={f.state} city={f.city} window={f.best} />
              : <div className={`fx-sub-field fx-sub-book${bad('booking') ? ' is-bad' : ''}`} key="book"><b>Exact time</b><small>Pick it together now. It lands on the Schedule of the VA on shift and is saved with the policy.</small>
                  <BookTime kind="service" value={f.booking} onChange={b => setF(x => ({ ...x, booking: b }))} state={f.state} city={f.city} viewerTz={settings.timeZone} />
                </div>}
          </>}

          {S.key === 'policy' && <>
            <p className="tp-sub">Who it’s with and when it drafts. Our team gets the rest from the carrier.</p>
            <div className="fx-form-grid">
              <Field label="Carrier" hint="Start typing: every US life carrier is listed. Not there? Type its name."><CarrierSelect invalid={bad('carrier')} value={f.carrier} onChange={v => setF({ ...f, carrier: v })} by="agent" /></Field>
              <Field label="Draft day" hint="The day of the month the premium comes out."><Select label="Draft day" invalid={bad('draftDay')} placeholder="Pick a day" value={f.draftDay} onChange={v => setF({ ...f, draftDay: v })} options={DRAFT_DAYS} /></Field>
              <Field label="Monthly premium, optional"><input value={f.premium} onChange={set('premium')} inputMode="decimal" placeholder="$86.40" /></Field>
              <Field label="Notes, optional"><textarea className="tp-input fx-ta" value={f.notes} onChange={set('notes')} placeholder="Anything the team should know" /></Field>
            </div>
            <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Replacing a policy?</b><p className="tp-sub">Most clients set the new one to draft on the old one{'’'}s draft day. We cancel the old one once the new one is issued, before its next draft, so they never pay twice.</p></div><Switch on={f.replacing} label="Replacing a policy" onChange={v => setF({ ...f, replacing: v })} /></div>
            {f.replacing && <div className="fx-form-grid">
              <Field label="Old carrier"><CarrierSelect label="Old carrier" invalid={bad('oldCarrier')} value={f.oldCarrier} onChange={v => setF({ ...f, oldCarrier: v })} by="agent" /></Field>
              <Field label="Old draft day" hint="When the old policy drafts. We cancel it before then."><Select label="Old draft day" invalid={bad('oldDraftDay')} placeholder="Pick a day" value={f.oldDraftDay} onChange={v => setF({ ...f, oldDraftDay: v })} options={DRAFT_DAYS} /></Field>
            </div>}
            {f.spouse ? <div className={`fx-sub-field${bad('spouse') ? ' is-bad' : ''}`}>
              <span className="tp-row tp-between"><b>Second insured</b><button type="button" className="tp-btn ov-ghost sm" onClick={() => setF({ ...f, spouse: null })}><Trash2 size={14} />Remove</button></span>
              <small>Their own client and policy, in the same household as {f.name.trim() || 'this client'}.</small>
              <div className="fx-form-grid">
                <Field label="Full name"><input value={f.spouse.name} onChange={e => setSpouse({ name: e.target.value })} autoComplete="off" /></Field>
                <Field label="Monthly premium, optional"><input value={f.spouse.premium} onChange={e => setSpouse({ premium: e.target.value })} inputMode="decimal" /></Field>
              </div>
            </div> : <button type="button" className="tp-btn ov-ghost fx-self" onClick={() => setF({ ...f, spouse: { ...EMPTY_SPOUSE } })}><UserPlus size={15} />Add a second insured (a spouse)</button>}
            <Pending>Texting consent wording pending</Pending>
          </>}

          {S.key === 'review' && <>
            <p className="tp-sub">Check it over. You can still change anything.</p>
            <Review f={f} onEdit={setStep} />
            {tried && missing.length > 0 && <p className="fx-sub-err">Fill in the {missing.map(k => NEEDED[k].toLowerCase()).join(', ')} first.</p>}
          </>}
        </div>

        <footer className="fx-sub-f">
          {step > 0 ? <button type="button" className="tp-btn ov-ghost" onClick={() => setStep(step - 1)}><ChevronLeft size={15} aria-hidden="true" />Back</button> : <span />}
          <span className="tp-grow" />
          {S.key !== 'review'
            ? <button type="button" className="tp-primary fx-accent" onClick={next}>Next<ChevronRight size={15} aria-hidden="true" /></button>
            : <button type="button" className="tp-primary fx-accent" onClick={send}><Check size={15} aria-hidden="true" />Submit policy</button>}
        </footer>
      </section>

      <aside className="fx-sub-side">
        <section className="fx-tile fx-sub-sum" style={{ '--i': 1 }} aria-label="Summary">
          <div className="fx-sub-who">
            <span className="tp-av av-sky" aria-hidden="true">{f.name.trim() ? initials(f.name.trim()).toUpperCase() : '?'}</span>
            <span className="tp-grow"><b>{f.name.trim() || 'New client'}</b><small>{f.phone ? formatPhone(f.phone) : 'No number yet'}</small></span>
          </div>
          <dl className="fx-sub-mini">
            <div><dt>Draft day</dt><dd>{f.draftDay ? `The ${ordinal(Number(f.draftDay))}` : 'Not picked'}</dd></div>
            <div><dt>Carrier</dt><dd>{f.carrier.trim() || 'Not picked'}</dd></div>
            <div><dt>{f.reach === 'book' ? 'Call' : 'Easiest time'}</dt><dd>{f.reach === 'book' ? (f.booking.iso ? reachText(f) : 'Not picked') : f.best}</dd></div>
          </dl>
          <ul className="fx-sub-check" aria-label="Needed to submit">
            {Object.entries(NEEDED).filter(([k]) => (k !== 'booking' || f.reach === 'book') && (!['oldCarrier', 'oldDraftDay'].includes(k) || f.replacing) && (k !== 'spouse' || f.spouse)).map(([k, label]) => <li key={k} className={missing.includes(k) ? '' : 'is-ok'}><span>{missing.includes(k) ? '' : <Check size={12} aria-hidden="true" />}</span>{label}</li>)}
          </ul>
        </section>
        <section className="fx-tile fx-sub-after" style={{ '--i': 2 }} aria-label="What happens next">
          <h3>What happens next</h3>
          <ol className="fx-sub-next">{NEXT.map(([Icon, t, s]) => <li key={t}><span className="fx-sub-nic"><Icon size={16} aria-hidden="true" /></span><span><b>{t}</b><small>{s}</small></span></li>)}</ol>
        </section>
        <Link to={paths.requestService()} className="fx-tile fx-sub-req" style={{ '--i': 3 }}>
          <span className="fx-sub-nic"><Wrench size={16} aria-hidden="true" /></span>
          <span className="tp-grow"><b>Request a service</b><small>Something to change on a client you already have</small></span>
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </aside>
    </div>
  )
}
