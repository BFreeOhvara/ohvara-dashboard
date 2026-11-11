import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Check, CalendarPlus, CreditCard, Info, Phone, RefreshCw, ShieldCheck, Users,
} from 'lucide-react'
import { useBillingTiers } from '../../hooks/useBillingTiers'
import { BOOK, pricesOf } from '../../lib/priceBook'
import { SignupCheckout } from './SignupCheckout'
import { formatWeekly } from '../../lib/billing'
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
// P933: the weekly Servicing checkout is gone. The welcome now sells the final
// products (P955: Leads, Servicing, Reactivation, any mix) through
// SignupCheckout: plan, card, one charge (setup + first month + first 2 days of
// leads + booking desk). In the phone app there are no prices and no pay buttons
// (P775). The database is the real lock; all of this only decides what to render.

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
const capShort = cap => (cap == null ? 'no weekly cap' : `${cap} a week`)
const Money = ({ cents }) => <span className="lk-money">{formatWeekly(cents)}</span>

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

const PB = pricesOf(BOOK)
const usd = n => `$${Number(n).toLocaleString('en-US')}`

function HowItWorks() {
  const steps = [
    ['Pick what you need', 'Leads, Servicing, Reactivation, or any mix. The portal comes with all of them.'],
    ['Add your card', `Leads or Servicing: setup (${usd(PB.setupFee)} once) and your first month, plus your first days of leads. Reactivation only: nothing today.`],
    ['Your portal opens', 'Straight away. Add or remove a product any time in Billing.'],
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
  const native = isNativeApp()
  const sectionRef = useRef(null)
  const { hash } = useLocation()

  const toPlans = () => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
        <Hero chip="Your portal is waiting" title={welcomeLine(portal.profile)} line="Pick what you need, add your card and your portal opens right away.">
          <button type="button" className="ov-hero-btn" onClick={toPlans}>Pick what you need</button>
        </Hero>
        <HowItWorks />
        <SignupCheckout portal={portal} sectionRef={sectionRef} />
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

// P933: after the sign-up charge (plan + first days of leads), not the old weekly submissions count.
export function UnlockedMoment({ portal }) {
  const leads = portal.leads !== false
  const line = leads ? 'You’re paid up. Your first leads start tomorrow, and every one gets a call in seconds.' : 'You’re paid up. Your portal is open.'
  const next = [
    ['/agent/submit', CalendarPlus, 'Submit a deal', 'A deal you just closed, or a client you already have.'],
    ['/agent/clients', Users, 'See your clients', 'Each step we take shows up on the client and in Activity.'],
    ['/agent/billing', CreditCard, 'Check Billing', 'Your plan, next charge and history in one place.'],
  ]
  return (
    <div className="lk-cq">
      <div className="lk">
        <Hero chip={leads ? 'Leads and servicing are on' : 'Servicing is on'} title={`You’re in${firstName(portal.profile) ? `, ${firstName(portal.profile)}` : ''}.`} line={line}>
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
