import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  AlertCircle, Check, CalendarPlus, Clock, CreditCard, Info, Lock, Phone, RefreshCw, ShieldCheck, Users,
} from 'lucide-react'
import { useBillingTiers, useWeeklyUsage } from '../../hooks/useBillingTiers'
import { capState, formatWeekly } from '../../lib/billing'
import { isNativeApp } from '../../lib/native'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { NativeBillingNote } from '../native/NativeBillingNote'
import './lockedWelcome.css'

// What a self-signup agent sees until they pay, and the moment it opens. Approved
// mockup: ohvara/mockups/locked-welcome-page-and-per-product-acce.html in the vault.
//   LockedWelcome     the welcome, the two products and Servicing's checkout
//   ConfirmPayment    back from Stripe: polls until the portal opens
//   UnlockedMoment    "You're in", one time
//   AddServicingCard  a Leads-only payer on Submit or Clients
// Leads is shown but can't be bought: weekly Leads billing doesn't exist yet. In
// the phone app there are no prices and no pay buttons (P775). The database is
// the real lock; all of this only decides what to render.

const CheckoutEmbed = lazy(() => import('./StripeForms').then(m => ({ default: m.CheckoutEmbed })))

const COVERS = [
  'Packet check: we confirm your client got the policy packet',
  'Review call within the free-look window',
  'Old-policy cancellation when the sale replaced one',
  '12-month chargeback watch, with lapse saves',
]
const POLL_MS = 2000
const POLL_FOR_MS = 60000
// Stripe's return is a full page load, so what they were buying rides along.
const CHECKOUT_KEY = 'ohvara-portal-checkout'
const firstName = profile => (profile?.full_name || '').trim().split(/\s+/)[0] || ''
const welcomeLine = profile => (firstName(profile) ? `Welcome, ${firstName(profile)}.` : 'Welcome.')
const capLine = cap => (cap == null ? 'No weekly cap' : `${cap} submissions a week`)
const capShort = cap => (cap == null ? 'no weekly cap' : `${cap} a week`)
const Money = ({ cents }) => <span className="lk-money">{formatWeekly(cents)}</span>

function rememberCheckout(value) {
  try { sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify(value)) } catch { /* private mode */ }
}
function recallCheckout() {
  try { return JSON.parse(sessionStorage.getItem(CHECKOUT_KEY)) || {} } catch { return {} }
}

const Bullet = ({ children }) => <li><Check size={16} strokeWidth={2.6} aria-hidden="true" /><span>{children}</span></li>

function Hero({ chip, title, line, children }) {
  return (
    <section className="ov-hero lk-hero">
      <span className="ov-hero-chip"><i />{chip}</span>
      <h2>{title}</h2>
      <p>{line}</p>
      {children && <div className="lk-row">{children}</div>}
    </section>
  )
}

function ProductCards({ tiers, onPlans }) {
  const from = tiers?.length ? Math.min(...tiers.map(t => t.weekly_cents)) : null
  return (
    <div className="lk-prod">
      <section className="ov-card lk-pc" aria-label="Servicing">
        <div className="lk-pc-top">
          <span className="lk-tile"><ShieldCheck size={22} strokeWidth={2} aria-hidden="true" /></span>
          <h3>Servicing</h3>
          <span className="pv-pill pv-p-sold">Available now</span>
        </div>
        <p>Submit each deal you close and we keep it on the books.</p>
        <ul>{COVERS.map(c => <Bullet key={c}>{c}</Bullet>)}</ul>
        <div className="lk-pc-foot">
          {from != null && <><span>From</span><span className="lk-money lk-pc-price">{formatWeekly(from)}</span><span>a week</span></>}
          <span className="lk-gap" />
          <button type="button" className="ov-ghost lk-btn" onClick={onPlans}>See plans</button>
        </div>
      </section>
      <section className="ov-card lk-pc lk-soon" aria-label="Leads">
        <div className="lk-pc-top">
          <span className="lk-tile"><Phone size={22} strokeWidth={2} aria-hidden="true" /></span>
          <h3>Leads</h3>
          <span className="pv-pill pv-p-quiet">Opens soon</span>
        </div>
        <p>Set a weekly spend and we bring you people to sell to.</p>
        <ul>
          <Bullet><b>Live calls:</b> people who need policy help now, transferred to you</Bullet>
          <Bullet><b>Appointments:</b> homeowners asking about mortgage protection, booked on your calendar</Bullet>
        </ul>
        <div className="lk-pc-foot">
          <span className="lk-soonbar" aria-disabled="true"><Clock size={16} strokeWidth={2} aria-hidden="true" />Opens soon · not available to buy yet</span>
        </div>
      </section>
    </div>
  )
}

function HowItWorks() {
  const steps = [
    ['Pick a plan', 'Choose how many submissions you want each week.'],
    ['Pay on this page', 'Checkout is right here. Your portal opens as soon as the payment is confirmed.'],
    ['Submit your first deal', 'We take it from there: packet check, review call, chargeback watch.'],
  ]
  return (
    <section className="ov-card lk-steps" aria-label="How it works">
      {steps.map(([title, line], i) => (
        <div className="lk-step" key={title}>
          <i>{i + 1}</i>
          <span><b>{title}</b><span>{line}</span></span>
        </div>
      ))}
    </section>
  )
}

const Opening = () => (
  <div className="lk-opening" role="status"><span className="lk-spin" /><span className="pv-sub">Opening secure checkout…</span></div>
)

function PlanRow({ tier, on, onPick }) {
  return (
    <label className={`ov-card lk-pl${on ? ' is-on' : ''}`}>
      <input type="radio" name="lk-plan" className="sr-only" checked={on} onChange={onPick} />
      <span className="lk-rad" aria-hidden="true" />
      <span className="lk-pl-main"><b>{capLine(tier.weekly_cap)}</b><small>{tier.name}</small></span>
      <span className="lk-pl-price"><Money cents={tier.weekly_cents} /><small>a week</small></span>
    </label>
  )
}

function CheckoutProblem({ failure, onRetry, onRecheck }) {
  const [busy, setBusy] = useState(false)
  if (failure.code === 'already_subscribed') {
    const open = async () => { setBusy(true); await onRecheck(); setBusy(false) }
    return (
      <div className="lk-problem">
        <span className="lk-tile"><ShieldCheck size={22} strokeWidth={2} aria-hidden="true" /></span>
        <h4>You already have a subscription</h4>
        <p>You don’t need to pay again. Your portal may just need a moment to catch up.</p>
        <div className="lk-row">
          <button type="button" className="ov-solid lk-btn" onClick={open} disabled={busy}>{busy ? 'Checking…' : 'Open my portal'}</button>
          <Link to="/agent/billing?manage=1" className="ov-ghost lk-btn">Manage billing</Link>
        </div>
      </div>
    )
  }
  return (
    <div className="lk-problem" role="alert">
      <span className="lk-tile is-grey"><AlertCircle size={22} strokeWidth={2} aria-hidden="true" /></span>
      <h4>Checkout couldn’t open</h4>
      <p>Nothing was charged. This is usually quick to clear.</p>
      <div className="lk-row">
        <button type="button" className="ov-ghost lk-btn" onClick={onRetry}><RefreshCw size={16} strokeWidth={2} aria-hidden="true" />Try again</button>
      </div>
    </div>
  )
}

function PlanSection({ tiersQuery, armed, onArm, sectionRef, onRecheck }) {
  const { data: tiers, isPending, isError, refetch } = tiersQuery
  const [picked, setPicked] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [failure, setFailure] = useState(null)
  const [test, setTest] = useState(false)
  const tier = tiers?.find(t => t.key === picked) || tiers?.[0] || null

  function pick(key) {
    setPicked(key)
    setFailure(null)
    onArm()
  }

  const head = (
    <>
      <h3 className="lk-big">Choose your Servicing plan</h3>
      <p className="lk-subline">Billed weekly. Pay here and your portal opens right away.</p>
    </>
  )

  if (isPending) {
    return (
      <section className="lk-sec" ref={sectionRef}>
        {head}
        <div className="lk-buy" aria-busy="true">
          <div className="lk-pls">
            {[80, 70].map(w => (
              <div className="ov-card lk-pl" key={w}>
                <span className="lk-rad" aria-hidden="true" />
                <span className="lk-pl-main">
                  <span className="pv-skel" style={{ height: 18, width: `${w}%` }} />
                  <span className="pv-skel" style={{ height: 12, width: '40%', marginTop: 8 }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    )
  }
  if (isError || !tier) {
    return (
      <section className="lk-sec" ref={sectionRef}>
        {head}
        <div className="ov-card lk-co lk-sec-gap"><CheckoutProblem failure={{}} onRetry={() => refetch()} /></div>
      </section>
    )
  }

  return (
    <section className="lk-sec" ref={sectionRef}>
      {head}
      <div className="lk-buy">
        <div className="lk-pls" role="radiogroup" aria-label="Servicing plan">
          {tiers.map(t => <PlanRow key={t.key} tier={t} on={t.key === tier.key} onPick={() => pick(t.key)} />)}
          <div className="ov-card lk-note-card">
            <Info size={18} strokeWidth={2} aria-hidden="true" />
            <span>The plan is how many deals you can submit each week. You can change it any time in Billing.</span>
          </div>
        </div>
        <section className="ov-card lk-co" aria-label="Checkout">
          <div className="lk-co-top">
            <h3>Pay and open your portal</h3>
            {test && <span className="pv-pill pv-p-quiet">Test mode</span>}
          </div>
          <div className="lk-sum">
            <span>Servicing · {capShort(tier.weekly_cap)}</span>
            <span><Money cents={tier.weekly_cents} /> <small>a week</small></span>
          </div>
          {failure ? (
            <div className="lk-embed">
              <CheckoutProblem failure={failure} onRetry={() => { setFailure(null); setAttempt(a => a + 1) }} onRecheck={onRecheck} />
            </div>
          ) : (
            <div className="lk-embed">
              {armed ? (
                <Suspense fallback={<Opening />}>
                  {/* A new plan is a new Stripe session, so the box starts over. */}
                  <CheckoutEmbed
                    key={`${tier.key}-${attempt}`}
                    tier={tier.key}
                    returnUrl={`${window.location.origin}/agent`}
                    waiting={<Opening />}
                    onError={setFailure}
                    onSession={d => {
                      const isTest = String(d.publishable_key || '').startsWith('pk_test')
                      setTest(isTest)
                      rememberCheckout({ tier: tier.key, test: isTest })
                    }}
                  />
                </Suspense>
              ) : <Opening />}
            </div>
          )}
          <div className="lk-fine">
            <Lock size={14} strokeWidth={2} aria-hidden="true" />
            <span>Secure checkout by Stripe, on this page. Billed weekly until you change it in Billing.{test ? ' Test mode: no real card is charged.' : ''}</span>
          </div>
        </section>
      </div>
    </section>
  )
}

function CheckAgainButton({ onCheck, className = 'ov-ghost lk-btn', ...rest }) {
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    await onCheck()
    setBusy(false)
  }
  return (
    <button type="button" className={className} onClick={run} disabled={busy} {...rest}>
      <RefreshCw size={16} strokeWidth={2} aria-hidden="true" />{busy ? 'Checking…' : 'Check again'}
    </button>
  )
}

// One look. If it's open now, pick up the new profile and the gate moves on.
const lookAgain = portal => async () => {
  const access = await portal.check()
  if (access?.unlocked) await portal.refreshAll()
}

function NativeLocked({ portal }) {
  return (
    <div className="lk">
      <Hero chip="Account not active yet" title={welcomeLine(portal.profile)} line="Your account isn’t active yet. Once it is, check again and the app opens." />
      <NativeBillingNote />
      <CheckAgainButton onCheck={lookAgain(portal)} className="ov-ghost lk-btn lk-wide" />
      <section className="ov-card lk-prodlist">
        <div>
          <span className="lk-tile"><ShieldCheck size={20} strokeWidth={2} aria-hidden="true" /></span>
          <span className="lk-prodlist-t"><b>Servicing</b><span className="pv-sub">We keep every policy you submit on the books.</span></span>
        </div>
        <div>
          <span className="lk-tile is-grey"><Phone size={20} strokeWidth={2} aria-hidden="true" /></span>
          <span className="lk-prodlist-t"><b>Leads</b><span className="pv-sub">People to sell to, brought to you.</span></span>
          <span className="pv-pill pv-p-quiet">Opens soon</span>
        </div>
      </section>
    </div>
  )
}

export function LockedWelcome({ portal }) {
  const tiersQuery = useBillingTiers()
  const native = isNativeApp()
  const [armed, setArmed] = useState(false)
  const sectionRef = useRef(null)
  const { hash } = useLocation()

  // The checkout session opens when the plans come near the screen or a plan is
  // tapped, not on page load.
  useEffect(() => {
    const el = sectionRef.current
    if (native || armed || !el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setArmed(true) }, { rootMargin: '100px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [native, armed, tiersQuery.isPending])

  const toPlans = () => {
    setArmed(true)
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  useEffect(() => {
    if (hash === '#plans') sectionRef.current?.scrollIntoView({ block: 'start' })
  }, [hash])

  if (native) return <div className="lk-cq"><NativeLocked portal={portal} /></div>

  return (
    <div className="lk-cq">
      <div className="lk">
        {portal.unknown && (
          <div className="lk-note" role="status">
            <Info size={18} strokeWidth={2} aria-hidden="true" />
            <span className="lk-note-t"><b>We couldn’t check your account just now.</b>If you’ve already paid, you don’t need to pay again.</span>
            <CheckAgainButton onCheck={lookAgain(portal)} />
          </div>
        )}
        <Hero chip="Your portal is waiting" title={welcomeLine(portal.profile)} line="Pick a plan and your portal opens right away. Nothing else to set up first.">
          <button type="button" className="ov-hero-btn" onClick={toPlans}>Choose a plan</button>
        </Hero>
        <ProductCards tiers={tiersQuery.data} onPlans={toPlans} />
        <HowItWorks />
        <PlanSection
          tiersQuery={tiersQuery}
          armed={armed}
          onArm={() => setArmed(true)}
          sectionRef={sectionRef}
          onRecheck={lookAgain(portal)}
        />
      </div>
    </div>
  )
}

function PaidRow() {
  const { data: tiers } = useBillingTiers()
  const { tier: key, test } = recallCheckout()
  const tier = tiers?.find(t => t.key === key)
  if (!tier) return null
  return (
    <section className="ov-card lk-sumrow">
      <span><b>Servicing · {capShort(tier.weekly_cap)}</b><span className="pv-sub">Billed weekly</span></span>
      <span className="lk-sumrow-r">
        {test && <span className="pv-pill pv-p-quiet">Test mode</span>}
        <Money cents={tier.weekly_cents} />
      </span>
    </section>
  )
}

export function ConfirmPayment({ portal }) {
  const [still, setStill] = useState(false)
  const [lastAt, setLastAt] = useState(null)
  const portalRef = useRef(portal)
  useEffect(() => { portalRef.current = portal })

  // Every 2 seconds for a minute (each look finishes before the next starts).
  useEffect(() => {
    let stopped = false
    let timer
    const started = Date.now()
    async function look() {
      const access = await portalRef.current.check()
      if (stopped) return
      setLastAt(new Date())
      if (access?.unlocked) { portalRef.current.unlock(); return }
      if (Date.now() - started >= POLL_FOR_MS) { setStill(true); return }
      timer = setTimeout(look, POLL_MS)
    }
    look()
    return () => { stopped = true; clearTimeout(timer) }
  }, [])

  async function checkAgain() {
    const access = await portal.check()
    setLastAt(new Date())
    if (access?.unlocked) portal.unlock()
  }

  if (still) {
    return (
      <div className="lk-cq">
        <div className="lk">
          <Hero chip="Still confirming" title="This is taking a little longer." line="You don’t need to pay again. Your portal opens as soon as Stripe confirms it, even if you leave this page.">
            <CheckAgainButton onCheck={checkAgain} className="ov-hero-btn" />
            <Link to="/agent/billing" className="ov-ghost">See Billing</Link>
          </Hero>
          <PaidRow />
          <p className="pv-sub">
            {lastAt && <>Last checked {lastAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. </>}
            Stuck for more than a few minutes? Write to support@ohvara.com.
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="lk-cq">
      <div className="lk">
        <section className="ov-hero lk-hero">
          <div className="lk-ring" role="status" aria-label="Confirming" />
          <h2 style={{ marginTop: 20 }}>Confirming your payment…</h2>
          <p>This usually takes a few seconds. Your portal opens by itself, so you don’t need to refresh.</p>
          <ul className="lk-list">
            <li><span className="lk-d is-ok"><Check size={14} strokeWidth={3} aria-hidden="true" /></span>Checkout finished</li>
            <li><span className="lk-d"><span className="lk-mini" /></span>Confirming with Stripe</li>
            <li className="is-todo"><span className="lk-d" />Opening your portal</li>
          </ul>
        </section>
        <PaidRow />
      </div>
    </div>
  )
}

export function UnlockedMoment({ portal }) {
  const { data: usage } = useWeeklyUsage(portal.profile?.id)
  const { data: tiers } = useBillingTiers()
  const bought = tiers?.find(t => t.key === recallCheckout().tier)
  const left = capState(usage)?.left ?? bought?.weekly_cap ?? null
  const line = left == null
    ? 'Your portal is open.'
    : `Your portal is open. You have ${left} ${left === 1 ? 'submission' : 'submissions'} this week.`
  const next = [
    ['/agent/submit', CalendarPlus, 'Submit a deal', 'A deal you just closed, or a client you already have.'],
    ['/agent/clients', Users, 'See your clients', 'Each step we take shows up on the client and in Activity.'],
    ['/agent/billing', CreditCard, 'Check Billing', 'Your plan, next charge and history in one place.'],
  ]
  return (
    <div className="lk-cq">
      <div className="lk">
        <Hero chip="Servicing is on" title={`You’re in${firstName(portal.profile) ? `, ${firstName(portal.profile)}` : ''}.`} line={line}>
          <Link to="/agent/submit" className="ov-hero-btn">Submit your first deal</Link>
          <button type="button" className="ov-ghost" onClick={() => portal.setMoment(false)}>Look around</button>
        </Hero>
        <div className="lk-next">
          {next.map(([to, Icon, title, text]) => (
            <Link key={to} to={to} className="ov-card ov-link lk-nx">
              <span className="lk-tile"><Icon size={22} strokeWidth={2} aria-hidden="true" /></span>
              <b>{title}</b>
              <span>{text}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

const SERVICING_COPY = {
  '/agent/submit': { title: 'Submit', text: 'You’re getting Leads. To submit the deals you close and have us service them, add a Servicing plan.' },
  '/agent/clients': { title: 'Clients', text: 'Clients you submit for Servicing show up here. Add a plan to start submitting.' },
}

export function AddServicingCard() {
  const { pathname } = useLocation()
  const phone = usePhoneLayout()
  const { title, text } = SERVICING_COPY[pathname] || SERVICING_COPY['/agent/submit']
  const tile = <span className="lk-tile"><ShieldCheck size={24} strokeWidth={2} aria-hidden="true" /></span>
  return (
    <div className="lk-cq">
      <div className="lk">
        {phone && <h2 className="ph-h1">{title}</h2>}
        {isNativeApp() ? (
          <>
            <section className="ov-card lk-add">
              {tile}
              <div className="lk-add-t">
                <h3>Servicing isn’t on your account</h3>
                <p>You’re getting Leads. With Servicing, we take over after you close, so your book stays on the books.</p>
              </div>
            </section>
            <NativeBillingNote />
          </>
        ) : (
          <section className="ov-card lk-add">
            {tile}
            <div className="lk-add-t">
              <h3>Add a Servicing plan to submit deals</h3>
              <p>{text}</p>
              <Link to="/agent/billing" className="ov-solid lk-btn">Add a Servicing plan</Link>
            </div>
            <div className="lk-add-covers">
              <b>What Servicing covers</b>
              <ul className="lk-covers">{COVERS.map(c => <Bullet key={c}>{c}</Bullet>)}</ul>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
