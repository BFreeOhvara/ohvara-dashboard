import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Play, Pause, Captions, Signal, BellRing, Smartphone, MessageCircleQuestion, CreditCard } from 'lucide-react'
import { useSampleSetup, useSampleSettings, useSampleBilling, useSampleActions, DEFAULT_WEEK } from '../data'
import { Field, Pending, Seg, Switch, useNote } from '../kit'
import { Select } from '../Select'
import { paths } from '../paths'
import { LicenceForm } from '../Licence'
import { pickReady, asPick, EMPTY_PICK } from '../licenceModel'
import { HoursEditor, CalendarConnect } from '../Hours'
import { SpendSliders, SpendSummary, TakeLeads } from '../PlanBuilder'
import { DEFAULT_LIVE_HOURS, PITCH, takeOk } from '../../lib/leadSplit'
import { TalkDrawer } from '../Talk'
import { ForwardSetup } from '../PaymentIntake'
import '../p885.css'
import { openSlotsPerWeek, slotsNeeded, spendOk, dailyTotal, nightlyFor, feeWords, SETUP_FEE } from '../spendPlan'
import { usd } from '../motion'
import { zoneAbbr, ZONE_CHOICES } from '../../lib/callSlots'
import '../p878.css'

// P878 — setup (N-H-03, 05, 11, 13, 14, 19, 20, 38): a short video they can't skip (progress saved, captions, a low-data
// version), their licence, what they want (leads, servicing, or both), calendar and hours in their own time zone, lead
// spend (pilot: any amount; paid: $50 a day minimum; up to $500; appointments stay off until the calendar has room), a card
// on file (P909: required before leads start; lead spend is charged nightly as OHVARA LEADS), the phone app
// with a test notification, and the terms. No approval step: when the steps are done, the portal opens. Progress is
// kept, so they can stop and come back. Sample only: nothing is charged or sent.
const VIDEO_SECONDS = 360
const money = usd()
const ZONES = ZONE_CHOICES.map(z => ({ value: z.value, label: `${z.label} (${zoneAbbr(z.value)})` }))
const KEY = 'ov-setup-878'
const load = () => { try { return JSON.parse(window.localStorage.getItem(KEY) || 'null') } catch { return null } }
const keep = v => { try { window.localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* private window: progress stays for this visit */ } }
const clock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

function VideoStep({ s, up }) {
  const [playing, setPlaying] = useState(false)
  const done = s.watched >= VIDEO_SECONDS
  useEffect(() => {
    if (!playing || done) return undefined
    // Sample: the 6-minute video plays at 60x so the step can be tried.
    const t = setInterval(() => up(x => ({ ...x, watched: Math.min(VIDEO_SECONDS, x.watched + 60) })), 1000)
    return () => clearInterval(t)
  }, [playing, done, up])
  return (
    <>
      <header className="fx-form-h"><h2>How Ohvara works</h2><p>Six minutes on what our team does, what you do, and how you get paid. Watch it to the end to go on.</p></header>
      <div className="wz-video">
        <button type="button" className="tp-primary fx-accent" onClick={() => setPlaying(!playing)} disabled={done}>
          {done ? <><Check size={16} />Watched</> : playing ? <><Pause size={16} />Pause</> : <><Play size={16} />{s.watched ? `Keep watching from ${clock(s.watched)}` : 'Play'}</>}
        </button>
        {s.captions && s.watched > 0 && <p className="wz-cap">{s.watched < 120 ? 'Every lead is called right away by our team.' : s.watched < 240 ? 'You get booked appointments and live calls.' : 'Our team services every policy you sell.'}</p>}
        <span className="wz-bar" role="progressbar" aria-label="Watched" aria-valuemin={0} aria-valuemax={VIDEO_SECONDS} aria-valuenow={s.watched}><i style={{ '--w': s.watched / VIDEO_SECONDS }} /></span>
      </div>
      <div className="fx-form-row fx-form-sw"><Captions size={16} aria-hidden="true" /><b className="tp-grow">Captions</b><Switch on={s.captions} label="Captions" onChange={v => up(x => ({ ...x, captions: v }))} /></div>
      <div className="fx-form-row fx-form-sw"><Signal size={16} aria-hidden="true" /><span className="tp-grow"><b>Low-data version</b><p className="tp-sub">Smaller video for a slow connection. Same length.</p></span><Switch on={s.lowData} label="Low-data version" onChange={v => up(x => ({ ...x, lowData: v }))} /></div>
      <p className="wz-saved">{clock(s.watched)} of {clock(VIDEO_SECONDS)} watched. Your place is saved.</p>
    </>
  )
}

function PushStep({ s, up }) {
  const note = useNote()
  return (
    <>
      <header className="fx-form-h"><h2>Get the phone app</h2><p>Live calls and new appointments reach you as notifications. Get the app, sign in, then send yourself a test.</p></header>
      <div className="wz-code">
        <button type="button" className="tp-btn ov-ghost" onClick={() => note('Sample: the app link is texted to your phone')}><Smartphone size={15} />Text me the app link</button>
        <button type="button" className="tp-primary fx-accent" onClick={() => { up(x => ({ ...x, push: 'sent' })); note('Sample: a test notification was sent') }}><BellRing size={15} />Send a test notification</button>
      </div>
      {s.push && s.push !== 'yes' && (
        <div className="lc-q" role="group" aria-label="Did it arrive?"><b>Did it arrive?</b>
          <Seg label="Did it arrive?" value={s.push === 'no' ? 'no' : null} onChange={v => up(x => ({ ...x, push: v }))} options={[{ key: 'yes', label: 'Yes, it came' }, { key: 'no', label: 'No' }]} />
        </div>
      )}
      {s.push === 'no' && <div className="wz-stop"><b>Let{'’'}s fix it</b><p className="tp-sub">Open the app and allow notifications when it asks. On iPhone: Settings, Ohvara, Notifications, Allow. Then send another test.</p></div>}
      {s.push === 'yes' && <p className="wz-saved"><Check size={14} /> Notifications work on this phone.</p>}
    </>
  )
}

export default function Welcome() {
  const { data: saved } = useSampleSetup()
  const { data: settings } = useSampleSettings()
  const { data: bill } = useSampleBilling()
  const { saveSetup } = useSampleActions()
  const [talk, setTalk] = useState(false)
  const note = useNote()
  const [s, setS] = useState(() => saved || load() || {
    step: 'video', watched: 0, captions: true, lowData: false,
    licence: EMPTY_PICK,
    products: 'both', calendar: { provider: null }, tz: settings.timeZone || 'America/Chicago', tzOk: false,
    week: DEFAULT_WEEK, spend: { daily: 60 }, take: { mode: 'both', hours: DEFAULT_LIVE_HOURS }, push: null, terms: false,
  })
  const stable = setS
  useEffect(() => { keep(s) }, [s])

  const plan = bill.plan
  const servicingOnly = s.products === 'servicing'
  const openSlots = openSlotsPerWeek(s.week)
  // P889: one daily spend + how they take leads. An older saved setup ({ appts, live }) reads as its total.
  const spend = { daily: dailyTotal(s.spend) }
  const take = { mode: 'both', hours: DEFAULT_LIVE_HOURS, ...s.take, tz: s.tz }
  const roomy = spend.daily === 0 || openSlots >= slotsNeeded(spend, take.mode)
  const STEPS = [
    { key: 'video', label: 'Watch the intro', done: s.watched >= VIDEO_SECONDS },
    // P848: pick 3 to 10 states and tick the box; no review wait (the NIPR gate is off for launch).
    { key: 'licence', label: 'Your licence', done: pickReady(asPick(s.licence)) },
    { key: 'products', label: 'What you want', done: true },
    { key: 'calendar', label: 'Calendar and hours', done: s.tzOk && openSlots > 0 },
    ...(servicingOnly ? [] : [{ key: 'spend', label: 'Lead spend', done: spendOk(plan, spend) && spend.daily > 0 && roomy && takeOk(take) }]),
    // P909: a card on file before leads start (lead spend is charged nightly, the plan monthly).
    { key: 'card', label: 'Your card', done: !!s.card },
    // P890: forward carrier emails (missed payments) to the agent's address. Servicing only; skippable.
    ...(s.products === 'leads' ? [] : [{ key: 'forward', label: 'Carrier emails', done: !!(s.forward?.tested || s.forward?.later) }]),
    { key: 'app', label: 'Phone app', done: s.push === 'yes' },
    { key: 'terms', label: 'Terms', done: s.terms },
  ]
  const at = Math.max(0, STEPS.findIndex(x => x.key === s.step))
  const cur = STEPS[at]
  const go = key => { const n = { ...s, step: key }; setS(n); saveSetup(n) }
  const passed = x => x.ok ?? x.done
  const allDone = STEPS.every(passed)

  return (
    <div className="tp tp-solo">
      <div className="tp-solo-in tp-solo-wide">
        <div className="tp-brand"><span className="tp-logo">O</span>Ohvara</div>
        <section className="ov-card tp-card wz">
          <ol className="wz-steps" aria-label="Setup steps">
            {STEPS.map((x, i) => (
              <li key={x.key}><button type="button" className={`${i === at ? 'is-on' : ''}${x.done ? ' is-done' : ''}`} aria-current={i === at ? 'step' : undefined}
                disabled={i > at && !STEPS.slice(0, i).every(passed)} onClick={() => go(x.key)}>
                <i>{x.done ? <Check size={13} /> : i + 1}</i><span>{x.label}</span></button></li>
            ))}
          </ol>
          <div className="wz-body">
            {cur.key === 'video' && <VideoStep s={s} up={stable} />}
            {cur.key === 'licence' && <>
              <header className="fx-form-h"><h2>Your licence</h2><p>Leads only come from the states you pick.</p></header>
              <LicenceForm value={s.licence} onChange={v => stable(x => ({ ...x, licence: v }))} />
            </>}
            {cur.key === 'products' && <>
              <header className="fx-form-h"><h2>What do you want from us?</h2><p>You can change this later in Billing.</p></header>
              <Seg role="radiogroup" label="What you want" value={s.products} onChange={v => stable(x => ({ ...x, products: v }))}
                options={[{ key: 'both', label: 'Leads and servicing' }, { key: 'leads', label: 'Leads only' }, { key: 'servicing', label: 'Servicing only' }]} />
              <p className="tp-sub">{s.products === 'servicing' ? 'Our team keeps your policies on the books: payments, changes, cancellations. No lead spend.' : s.products === 'leads' ? 'Booked appointments and live calls. You service your own policies.' : 'Booked appointments and live calls, and our team keeps every policy you sell on the books.'}</p>
            </>}
            {cur.key === 'calendar' && <>
              <header className="fx-form-h"><h2>Calendar and hours</h2><p>Appointments are only booked inside your hours, in your time zone.</p></header>
              <Field label="Your time zone"><Select label="Your time zone" value={s.tz} onChange={v => stable(x => ({ ...x, tz: v, tzOk: true }))} options={ZONES} /></Field>
              {!s.tzOk && <div className="fx-form-row fx-form-sw"><b className="tp-grow">Is {ZONES.find(z => z.value === s.tz)?.label} right?</b><button type="button" className="tp-btn ov-ghost sm" onClick={() => stable(x => ({ ...x, tzOk: true }))}>Yes, that{'’'}s mine</button></div>}
              <HoursEditor week={s.week} onChange={w => stable(x => ({ ...x, week: w }))} tz={s.tz} />
              <CalendarConnect value={s.calendar} onPick={p => stable(x => ({ ...x, calendar: { provider: p } }))} />
            </>}
            {cur.key === 'spend' && <>
              <header className="fx-form-h"><h2>Your lead spend</h2><p>{PITCH} {plan === 'pilot' ? 'During the pilot you pay only your lead spend, charged each night for the next day.' : `Your plan follows your daily spend. Each night your card is charged the next day’s spend plus ${feeWords}.`}</p></header>
              <SpendSliders spend={spend} onSpend={v => stable(x => ({ ...x, spend: v }))} plan={plan} mode={take.mode} id="wz-sp" openSlots={openSlots} />
              <TakeLeads take={take} onTake={({ mode, hours }) => stable(x => ({ ...x, take: { mode, hours } }))} id="wz-take" />
              <SpendSummary spend={spend} plan={plan} products={s.products} setup><p className="pb-note">Leads start at 12:00 AM your time, the day after you finish setup.</p></SpendSummary>
            </>}
            {cur.key === 'card' && <>
              <header className="fx-form-h"><h2>Your card</h2><p>{servicingOnly ? 'Your plan is charged to it each month.' : 'Your leads start once a card is on file. Lead spend is charged to it each night for the next day, and your plan each month.'}</p></header>
              {s.card
                ? <div className="fx-form-row fx-form-sw"><CreditCard size={16} aria-hidden="true" /><b className="tp-grow">{s.card}</b><button type="button" className="tp-btn ov-ghost sm" onClick={() => stable(x => ({ ...x, card: null }))}>Change</button></div>
                : <button type="button" className="tp-primary fx-accent fx-self" onClick={() => { stable(x => ({ ...x, card: 'Visa ending 4242' })); note('Sample: no card was saved') }}><CreditCard size={15} />Add a card</button>}
              {!servicingOnly && <div className="wz-stop"><b>It{'’'}s a daily charge</b><p className="tp-sub">You{'’'}ll see one charge a night on your statement as OHVARA LEADS, about {money(nightlyFor(plan, spend.daily).total)} at {money(spend.daily)} a day. Tell your bank if it asks, so it doesn{'’'}t flag them. No bank transfers: cards only.</p></div>}
              {plan !== 'pilot' && <p className="tp-sub">Setup is {money(SETUP_FEE)} once, charged when you finish. It isn{'’'}t refunded.</p>}
            </>}
            {cur.key === 'forward' && <>
              <header className="fx-form-h"><h2>Carrier emails</h2><p>When a carrier emails you about a missed or returned payment, forward it to us and the team calls the client the same day.</p></header>
              <code className="pi-code" aria-label="Your forwarding address">{settings.paymentIntake?.address}</code>
              <ForwardSetup value={s.forward} address={settings.paymentIntake?.address} onChange={f => stable(x => ({ ...x, forward: { ...f, later: false } }))} />
              {!s.forward?.tested && <button type="button" className="tp-btn ov-ghost fx-self" onClick={() => stable(x => ({ ...x, forward: { ...x.forward, later: true } }))}>{s.forward?.later ? 'Skipped: set it up later in Settings' : 'I’ll do this later in Settings'}</button>}
            </>}
            {cur.key === 'app' && <PushStep s={s} up={stable} />}
            {cur.key === 'terms' && <>
              <header className="fx-form-h"><h2>Terms</h2><p>Read and agree to finish.</p></header>
              <Pending>Agent agreement and terms wording pending</Pending>
              <label className="tp-check"><input type="checkbox" checked={s.terms} onChange={e => stable(x => ({ ...x, terms: e.target.checked }))} /><span>I agree to the agent terms (wording pending)</span></label>
            </>}
            <footer className="fx-form-f">
              {at > 0 && <button type="button" className="tp-btn ov-ghost" onClick={() => go(STEPS[at - 1].key)}>Back</button>}
              <span className="tp-grow" />
              {at < STEPS.length - 1
                ? <button type="button" className="tp-primary fx-accent" disabled={!passed(cur)} onClick={() => go(STEPS[at + 1].key)}>Next</button>
                : <Link to={paths.home()} className={`tp-primary fx-accent${allDone ? '' : ' wz-off'}`} aria-disabled={!allDone} onClick={e => { if (!allDone) e.preventDefault() }}>Open my portal</Link>}
            </footer>
            <p className="wz-saved">Your progress is saved. {allDone ? 'All set: your portal opens now, no approval needed.' : `${STEPS.filter(x => x.done).length} of ${STEPS.length} done.`} <button type="button" className="tp-link" onClick={() => setTalk(true)}><MessageCircleQuestion size={13} /> Talk to someone</button></p>
          </div>
        </section>
        <p className="tp-sub" style={{ textAlign: 'center' }}><Link to={paths.signup()} className="tp-link">Back to sign-up</Link></p>
      </div>
      <TalkDrawer open={talk} onClose={() => setTalk(false)} topic="Setting up" />
    </div>
  )
}
