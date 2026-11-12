import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSampleBilling, useSampleActions } from '../data'
import { useNote } from '../kit'
import { dailyTotal, planOf, bandOf, expected, deliveredRange, rangeWords, SLIDER } from '../spendPlan'
import { usd } from '../motion'
import { isNativeApp } from '../../lib/native'
import { NATIVE_BILLING_TEXT, NativeBillingNote } from '../../components/native/NativeBillingNote'
import { useProducts } from '../useProducts'
import { label as productsLabel } from '../../lib/products.js'
import Billing from '../screens/Billing'
import { CreditCard, Receipt, Wallet } from 'lucide-react'
import { useApp, SubPage, Row } from './AppKit'

// P967 — Billing on the phone: the daily lead spend as one big number with a slider and what it buys a week, the plan,
// the card, and recent charges. Everything else Billing does (change plan, products, pause, cancel, fix card) is on
// "Plan, products and card", the portal's full Billing page. No payments inside the phone app (P775): there the
// slider is read-only and Billing says it's managed on the website.
export default function ABilling({ root = false }) {
  const app = useApp()
  const [params] = useSearchParams()
  const native = isNativeApp()
  if (!root && params.get('full') === '1') {
    return <SubPage title="Plan, products and card" className="is-wide">{native ? <NativeBillingNote /> : <div className="ma-embed"><Billing /></div>}</SubPage>
  }
  return <BillingSummary app={app} native={native} />
}

function BillingSummary({ app, native }) {
  const { data: b } = useSampleBilling()
  const { setSpend } = useSampleActions()
  const { has, picked } = useProducts()
  const note = useNote()
  const money = usd()
  const cents = usd(true)
  const saved = dailyTotal(b.spend)
  const [daily, setDaily] = useState(saved)
  const tier = planOf(b)
  const { lo, hi } = bandOf(tier)
  const est = rangeWords(deliveredRange(expected({ daily }, b.take?.mode)))
  const leads = has('leads')
  const changed = daily !== saved
  const save = () => { setSpend({ daily }); note('Lead spend saved. It starts with the next day not yet paid') }
  const foot = changed && !native ? <><button type="button" className="ma-btn is-soft is-grow is-tall ma-press" onClick={() => setDaily(saved)}>Undo</button><button type="button" className="ma-btn is-solid is-grow is-tall ma-press" onClick={save}>Save {money(daily)} a day</button></> : null
  return (
    <SubPage big title="Billing" line={leads ? `${tier.label} plan` : productsLabel(picked)} foot={foot}>
      <div className={`ma-paybar ma-rise${b.payment?.failed ? ' is-bad' : ''}`}>
        <span className={`ma-sym ${b.payment?.failed ? 'is-coral' : 'is-sage'}`}><CreditCard size={16} aria-hidden="true" /></span>
        <span className="ma-grow"><b>{b.payment?.failed ? 'Card declined' : 'Paid up'}</b><small>{b.payment?.failed ? 'Fix it to keep leads coming' : `Next charge ${String(b.next_charge || b.nextBill || '').toLowerCase()}`}</small></span>
        {b.payment?.failed && !native && <button type="button" className="ma-pillbtn is-tone is-coral is-sm ma-press" onClick={() => app.open(`${window.location.pathname}?full=1`)}>Fix</button>}
      </div>
      {leads && (
        <div className="ma-spend ma-rise">
          <div className="ma-spend-top"><span>Lead spend</span><small>charged each night</small></div>
          <b className="ma-spend-big"><span className="tp-money">{money(daily)}</span><em> a day</em></b>
          <input className="ma-range" type="range" min={Math.min(lo, saved)} max={Math.max(hi, saved)} step={SLIDER.step} value={daily} disabled={native}
            onChange={e => setDaily(Number(e.target.value))} aria-label="Daily lead spend" style={{ '--p': `${((daily - Math.min(lo, saved)) / Math.max(1, Math.max(hi, saved) - Math.min(lo, saved))) * 100}%` }} />
          <span className="ma-spend-est">About {est} appointments or live calls a week</span>
          {native && <small className="ma-spend-fine">{NATIVE_BILLING_TEXT}</small>}
          {!native && <small className="ma-spend-fine">Your {tier.label} plan runs {money(lo)} to {money(hi)} a day. Need more? Change your plan below.</small>}
        </div>
      )}
      {native && !leads && <NativeBillingNote />}

      <p className="ma-cap is-out">Your plan</p>
      <div className="ma-glass ma-list">
        <div className="ma-row"><span className="ma-sym is-butter"><Wallet size={16} aria-hidden="true" /></span><span className="ma-grow"><b>Plan</b><small>{leads ? `Up to ${money(hi)} a day in lead spend` : 'What you bought'}</small></span><span className="ma-val">{leads ? tier.label : productsLabel(picked)}</span></div>
        <div className="ma-row"><span className="ma-sym is-sky"><CreditCard size={16} aria-hidden="true" /></span><span className="ma-grow"><b>Card</b><small>{b.payment?.failed ? 'Declined. Fix it to keep leads coming' : `Next charge ${String(b.next_charge || b.nextBill || '').toLowerCase()}`}</small></span><span className={`ma-val${b.payment?.failed ? ' is-bad' : ''}`}>{b.card?.onFile === false ? 'No card' : `${b.card?.brand || 'Card'} ${b.card?.last4 || ''}`.trim()}</span></div>
      </div>

      {(b.charges || []).length > 0 && <>
        <p className="ma-cap is-out">Recent charges</p>
        <div className="ma-glass ma-list">
          {b.charges.slice(0, 5).map(c => (
            <div key={c.id} className="ma-row"><span className="ma-sym is-stone"><Receipt size={16} aria-hidden="true" /></span><span className="ma-grow"><b>{c.label}</b><small>{c.at}{c.status === 'declined' ? ' · declined' : ''}</small></span><span className={`ma-val tp-money${c.status === 'declined' ? ' is-bad' : ''}`}>{cents(c.amount)}</span></div>
          ))}
        </div>
      </>}

      <p className="ma-cap is-out">Change something</p>
      <div className="ma-glass ma-list">
        <Row onClick={() => app.open(`${window.location.pathname}?full=1`)} title="Plan, products and card" sub={native ? NATIVE_BILLING_TEXT : 'Change plan, add products, card, receipts, pause'} />
      </div>
    </SubPage>
  )
}
