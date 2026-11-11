import { lazy, Suspense, useEffect, useState } from 'react'
import { Check, CreditCard, Loader2, Lock, AlertCircle, PhoneIncoming, Users, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { cardCheck, signupPay, signupQuote } from '../../lib/leadSpend'
import { BOOK, pricesOf, bandText } from '../../lib/priceBook'
import { deskParts, monthlyEstimate } from '../../lib/bookingDesk'
import { DeskInfo } from './DeskInfo'
import { SignupDetails } from './SignupDetails'
import { emptyDetails, fromSaved, detailsMissing, loadSignupDetails, saveSignupDetails, NOT_TAKING } from '../../lib/signupDetails'
import { PRODUCTS, ORDER, norm, signupNeeds } from '../../lib/products'
import { REACT_PRICE_LINE } from '../../lib/reactivation'
import './signupCheckout.css'

// P933 — sign-up on the final prices (replaces the weekly Embedded Checkout). Pick a plan (Starter / Growth / Pro by
// daily spend band, or Servicing only), add a card (Stripe's own fields), then one charge: setup + the first month of
// the plan + the first 2 days of lead spend + the booking desk. Statement: OHVARA LEADS. The amounts on the summary
// come from the server (billing_signup_quote, price book v3); the picker's bands and prices come from the same book's
// mirror (src/lib/priceBook.js, checked number for number against the database). Paid: the portal opens.
// P941: a lead plan also asks for everything the campaign needs before the card is charged (SignupDetails: 3 to 10
// licensed states + the tick, time zone and hours, live transfers yes/no). Pay saves them first
// (save_signup_details), then charges; the server refuses the charge while one is missing. Servicing only skips them.
// P955: sign-up starts with "What do you need?": Leads, Servicing, Reactivation, tick one or more. The rest asks only
// what the picks need (Leads: plan + spend + details; Servicing: clients are added right after paying; Reactivation:
// nothing more until the first list). Leads and/or Servicing = one charge (one setup, each plan's first month);
// Reactivation only = no charge, a card on file and the portal opens. Card on file always.

const CardForm = lazy(() => import('./StripeForms').then(m => ({ default: m.CardForm })))

const P = pricesOf(BOOK)
const money = n => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`
const cents = c => money((Number(c) || 0) / 100)

export { DeskInfo }

const PLANS = P.tiers.map(t => ({ key: t.key, label: t.label, monthly: t.monthly, from: t.from, to: t.to, band: bandText(t) }))
const ICONS = { leads: PhoneIncoming, servicing: Users, reactivation: RotateCcw }

// "What do you need?": tick one or more. At least one stays ticked.
function ProductPicker({ picked, onPick }) {
  const toggle = k => {
    const next = picked.includes(k) ? picked.filter(x => x !== k) : norm([...picked, k])
    if (next.length) onPick(next)
  }
  return (
    <div className="sc-prods" role="group" aria-label="What do you need?" data-testid="sc-products">
      {ORDER.map(k => {
        const p = PRODUCTS[k]; const on = picked.includes(k); const Icon = ICONS[k]
        return (
          <label key={k} className={`ov-card sc-prod${on ? ' is-on' : ''}`} data-product={k}>
            <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(k)} />
            <span className="sc-prod-top">
              <span className="sc-dtile" aria-hidden="true"><Icon size={17} strokeWidth={2} /></span>
              <b>{p.label}</b>
              <span className={`sc-box${on ? ' is-on' : ''}`} aria-hidden="true">{on && <Check size={13} strokeWidth={3} />}</span>
            </span>
            <small className="sc-prod-line">{p.line}</small>
            <span className="sc-prod-price"><span className="lk-money">{p.price}</span><small>{p.sub}</small></span>
          </label>
        )
      })}
    </div>
  )
}

function PlanPicker({ plan, onPlan, daily, onDaily, rate }) {
  const t = PLANS.find(x => x.key === plan)
  const lo = Math.max(t.from, P.paidMinDaily)
  const hi = t.to
  const est = monthlyEstimate(daily, rate)
  return (
    <div className="sc-plans">
      <div className="sc-grid sc-grid3" role="radiogroup" aria-label="Leads plan">
        {PLANS.map(x => (
          <label key={x.key} className={`ov-card lk-pl sc-pl${x.key === plan ? ' is-on' : ''}`}>
            <input type="radio" name="sc-plan" className="sr-only" checked={x.key === plan} onChange={() => onPlan(x.key)} />
            <span className="lk-rad" aria-hidden="true" />
            <span className="lk-pl-main"><b>{x.label}</b><small>{x.band}</small></span>
            <span className="lk-pl-price"><span className="lk-money">{money(x.monthly)}</span><small>a month</small></span>
          </label>
        ))}
      </div>
      {(
        <div className="ov-card sc-spend">
          <label className="sc-spend-top" htmlFor="sc-daily">
            <span>Daily lead spend</span>
            <b className="lk-money" data-testid="sc-daily">{money(daily)}<small> a day</small></b>
          </label>
          <input id="sc-daily" type="range" min={lo} max={hi} step={1} value={daily} onChange={e => onDaily(Number(e.target.value))}
            aria-valuetext={`${money(daily)} a day`} />
          <div className="sc-spend-ends"><span>{money(lo)}</span><span>{money(hi)}</span></div>
          <p className="sc-est" data-testid="sc-estimate">{est.text}</p>
          <p className="sc-sub">Charged each night for the next day. Change it any time in Billing. <DeskInfo rate={rate} /></p>
        </div>
      )}
    </div>
  )
}

function Summary({ quote, rate, picked }) {
  if (!quote) return <div className="sc-sum" aria-busy="true"><span className="pv-skel" style={{ height: 14, width: '70%' }} /><span className="pv-skel" style={{ height: 14, width: '50%' }} /></div>
  const days = quote.days?.length || 0
  if (quote.free) {
    return (
      <div className="sc-sum" data-testid="sc-summary">
        <div className="lk-sum sc-total"><span>Charged today</span><span className="lk-money" data-testid="sc-total">$0</span></div>
        <p className="sc-sub">No monthly plan and no setup fee. {REACT_PRICE_LINE}</p>
      </div>
    )
  }
  const lines = Array.isArray(quote.lines) && quote.lines.length ? quote.lines
    : [{ key: 'plan', label: `${quote.label} plan, first month`, cents: quote.plan_cents }]
  return (
    <div className="sc-sum" data-testid="sc-summary">
      <div className="lk-sum"><span>Setup (one time)</span><span className="lk-money">{cents(quote.setup_cents)}</span></div>
      {lines.map(l => <div key={l.key} className="lk-sum"><span>{l.label}</span><span className="lk-money">{cents(l.cents)}</span></div>)}
      {days > 0 && (
        <div className="lk-sum sc-lead">
          <span>First {days} days of leads<small>{deskParts(quote.spend_cents / 100, quote.fee_cents / 100)}</small></span>
          <span className="lk-money">{cents(quote.spend_cents + quote.fee_cents)}</span>
        </div>
      )}
      <div className="lk-sum sc-total"><span>Charged today</span><span className="lk-money" data-testid="sc-total">{cents(quote.total_cents)}</span></div>
      {days > 0 && <p className="sc-sub"><DeskInfo rate={rate} /></p>}
      {picked.includes('reactivation') && <p className="sc-sub">Reactivation: nothing today. {REACT_PRICE_LINE}</p>}
      {quote.founding_left > 0 && <p className="sc-sub sc-found"><Check size={14} strokeWidth={2.6} aria-hidden="true" />Founding price: the first agents keep these prices for 12 months. {quote.founding_left} {quote.founding_left === 1 ? 'place' : 'places'} left.</p>}
    </div>
  )
}

const FAIL_WORDS = {
  test_account: 'This is a test account. Test accounts are never charged.',
  already_paid: 'You’ve already signed up. Check again to open your portal.',
  no_card: 'Add your card first.',
  details_missing: 'Finish your details above first. Nothing was charged.',
}

export function SignupCheckout({ portal, sectionRef }) {
  const [picked, setPicked] = useState(['leads'])
  const needs = signupNeeds(picked)
  const [plan, setPlan] = useState('growth')
  const [daily, setDaily] = useState(100)
  // The quote belongs to one plan + spend; a stale one reads as loading.
  const [quoted, setQuoted] = useState({ key: '', q: null, err: '' })
  const qKey = `${picked.join('+')}:${needs.plan ? `${plan}:${daily}` : ''}`
  const quote = quoted.key === qKey ? quoted.q : null
  const quoteErr = quoted.key === qKey ? quoted.err : ''
  const [card, setCard] = useState(null) // 'Visa ending 4242'
  const [adding, setAdding] = useState(false)
  const [state, setState] = useState({ busy: false, error: '', result: null })
  const rate = P.leadFee
  const [details, setDetails] = useState(() => emptyDetails())
  const [notTaking, setNotTaking] = useState(NOT_TAKING)
  const lead = needs.plan
  const missing = lead ? detailsMissing(details, notTaking) : []

  // What they already saved (back after a decline, or a reload) fills the form back in.
  useEffect(() => {
    let live = true
    loadSignupDetails(supabase).then(d => {
      if (!live || !d) return
      if (Array.isArray(d.notTaking)) setNotTaking(d.notTaking)
      setDetails(cur => fromSaved(d, cur))
    }).catch(() => {})
    return () => { live = false }
  }, [])

  // Keep the daily spend inside the picked plan's band.
  const pickPlan = key => {
    setPlan(key)
    const t = PLANS.find(x => x.key === key)
    setDaily(d => Math.min(t.to, Math.max(Math.max(t.from, P.paidMinDaily), d)))
  }

  // The server's quote (authoritative amounts), a moment after the slider stops.
  useEffect(() => {
    let live = true
    const id = setTimeout(() => {
      signupQuote(supabase, { tier: lead ? plan : 'servicing', daily: lead ? daily : null, products: picked })
        .then(q => { if (live) setQuoted({ key: qKey, q, err: '' }) })
        .catch(e => { if (live) setQuoted({ key: qKey, q: null, err: e.message || 'Couldn’t work out the total' }) })
    }, 250)
    return () => { live = false; clearTimeout(id) }
  }, [plan, daily, qKey, lead, picked])

  // A card already saved (back after a decline, or a reload).
  useEffect(() => {
    let live = true
    cardCheck(supabase).then(r => { if (live && r?.card) setCard(r.card) }).catch(() => {})
    return () => { live = false }
  }, [])

  const canPay = !!card && !!quote && !state.busy && !quoteErr && missing.length === 0
  async function pay() {
    if (!canPay) return
    setState({ busy: true, error: '', result: null })
    try {
      if (lead) await saveSignupDetails(supabase, details)
      const r = await signupPay(supabase, { tier: lead ? plan : 'servicing', daily: lead ? daily : null, products: picked })
      if (r.status === 'paid') {
        setState({ busy: false, error: '', result: 'paid' })
        await portal.unlock()
      } else if (r.status === 'failed') {
        setState({ busy: false, error: r.failure || 'Your card was declined. Nothing was charged. Try another card.', result: 'failed' })
        setCard(null)
      } else {
        setState({ busy: false, error: r.skipped ? 'Payments aren’t switched on yet. Nothing was charged.' : '', result: r.status })
      }
    } catch (e) {
      setState({ busy: false, error: FAIL_WORDS[e.code] || e.message || 'Something went wrong. Nothing was charged.', result: null })
    }
  }

  return (
    <section className="lk-sec sc" ref={sectionRef} aria-label="Sign up">
      <h3 className="lk-big">What do you need?</h3>
      <p className="lk-subline">Pick one or more. The portal comes with all of them. Add or remove one any time in Billing.</p>
      <ProductPicker picked={picked} onPick={setPicked} />
      <div className="lk-buy sc-buy">
        <div className="sc-left">
          {lead && <>
            <h4 className="sc-h">Your Leads plan</h4>
            <PlanPicker plan={plan} onPlan={pickPlan} daily={daily} onDaily={setDaily} rate={rate} />
            <SignupDetails value={details} onChange={setDetails} notTaking={notTaking} missing={missing} />
          </>}
          {needs.clientsAfter && <p className="ov-card sc-next"><Users size={16} aria-hidden="true" /><span><b>Servicing:</b> you’ll add your clients right after you pay (import a list or add them one by one). The first {P.servicingBase} are included.</span></p>}
          {picked.includes('reactivation') && <p className="ov-card sc-next"><RotateCcw size={16} aria-hidden="true" /><span><b>Reactivation:</b> upload your first list any time from Leads. {REACT_PRICE_LINE} We check your card first, and you confirm you’re allowed to have them called.</span></p>}
        </div>
        <section className="ov-card lk-co sc-co" aria-label="Checkout">
          <div className="lk-co-top"><h3>{needs.charge ? 'Pay and open your portal' : 'Open your portal'}</h3></div>
          <Summary quote={quote} rate={rate} picked={picked} />
          {quoteErr && <p className="sc-err" role="alert"><AlertCircle size={15} aria-hidden="true" />{quoteErr}</p>}
          <div className="sc-card">
            {card && !adding ? (
              <div className="lk-sum"><span><CreditCard size={15} aria-hidden="true" /> {card}</span><button type="button" className="ov-ghost lk-btn sc-small" onClick={() => setAdding(true)}>Change</button></div>
            ) : adding ? (
              <Suspense fallback={<p className="sc-sub"><Loader2 size={15} className="animate-spin" /> Opening the secure card form…</p>}>
                <CardForm
                  onCancel={() => setAdding(false)}
                  onSaved={async () => {
                    setAdding(false)
                    try { const r = await cardCheck(supabase); setCard(r?.card || 'Card saved') } catch { setCard('Card saved') }
                  }}
                />
              </Suspense>
            ) : (
              <button type="button" className="ov-ghost lk-btn lk-wide" onClick={() => setAdding(true)}><CreditCard size={16} aria-hidden="true" />Add your card</button>
            )}
          </div>
          {missing.length > 0 && (
            <div className="sc-miss" data-testid="sc-missing">
              <b>Before you pay</b>
              <ul>{missing.map(m => <li key={m.key + m.text}>{m.text}</li>)}</ul>
            </div>
          )}
          {state.error && <p className="sc-err" role="alert"><AlertCircle size={15} aria-hidden="true" />{state.error}</p>}
          <button type="button" className="ov-hero-btn sc-pay" disabled={!canPay} onClick={pay} data-testid="sc-pay">
            {state.busy ? <><Loader2 size={16} className="animate-spin" /> {needs.charge ? 'Paying…' : 'Opening…'}</>
              : !needs.charge ? 'Open my portal' : quote ? `Pay ${cents(quote.total_cents)} and start` : 'Pay and start'}
          </button>
          <div className="lk-fine">
            <Lock size={14} strokeWidth={2} aria-hidden="true" />
            <span>{needs.charge ? 'Your card goes straight to Stripe. Shows on your statement as OHVARA LEADS. The setup fee isn’t refunded.'
              : 'Your card goes straight to Stripe. Nothing is charged today; each list you upload shows as OHVARA LEADS.'}</span>
          </div>
        </section>
      </div>
    </section>
  )
}
