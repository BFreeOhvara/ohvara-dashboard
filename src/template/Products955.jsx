import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { PhoneIncoming, ShieldCheck, RotateCcw, Plus, Loader2, CircleAlert, ArrowRight } from 'lucide-react'
import { useSampleActions, useDataSource } from './data'
import { Chip, Drawer, SampleTag, Seg, useNote } from './kit'
import { paths } from './paths'
import { useProducts } from './useProducts'
import { PRODUCTS } from '../lib/products.js'
import { PRICES, bandText } from '../lib/priceBook.js'
import { deskParts } from '../lib/bookingDesk'
import { DeskInfo } from '../components/agent/DeskInfo'
import { SignupDetails } from '../components/agent/SignupDetails'
import { emptyDetails, fromSaved, detailsMissing, NOT_TAKING } from '../lib/signupDetails'
import { productRows, costOf, canRemove, removeWords, quoteLines, cents, dayWords, bandRange, clampDaily, failWords, addResultWords } from './productsView'
import '../components/agent/signupCheckout.css'
import './bill910.css'
import './products955.css'

// P955 — Billing → Your products: Leads, Servicing, Reactivation, in any mix. Each shows its one-liner, its price and
// its state: On (what it costs), Not added (Add) or Ends <date> (Keep). Remove is a quiet text button with a confirm:
// Leads and Servicing end on the next bill date, Reactivation at once (lists already paid keep calling). Adding
// Servicing or Leads opens a drawer with the server's quote (productsView.js quoteLines) and Pay; Leads also asks the
// sign-up details (states, hours, live transfers) and saves them first. Reactivation is free to add and takes them to
// Leads → Import leads. Sample: nothing is charged (?pay=declined previews a declined card).

const ICON = { leads: PhoneIncoming, servicing: ShieldCheck, reactivation: RotateCcw }
const sampleWords = src => (src === 'sample' ? ' Sample only, nothing was charged.' : '')

// The quote as rows; the last is the total.
function QuoteRows({ q, err }) {
  if (err) return <p className="pr-err" role="alert"><CircleAlert size={15} aria-hidden="true" />{err}</p>
  if (!q) return <div className="pr-quote" aria-busy="true"><span className="pr-skel" style={{ height: 14, width: '70%' }} /><span className="pr-skel" style={{ height: 14, width: '50%' }} /></div>
  return (
    <dl className="pr-quote" data-testid="pr-quote">
      {quoteLines(q).map(r => (
        <div key={r.key} className={`pr-q${r.key === 'total' ? ' is-total' : ''}`} data-line={r.key}>
          <dt>{r.label}{r.sub && <small>{r.sub}</small>}{r.desk && <small>{deskParts(q.spend_cents / 100, q.fee_cents / 100)}</small>}</dt>
          <dd className="tp-money">{cents(r.cents)}</dd>
        </div>
      ))}
    </dl>
  )
}

// The server's quote for what's picked, a moment after it stops changing. A stale one reads as loading.
function useQuote(open, args) {
  const { quoteProduct } = useSampleActions()
  const key = open ? JSON.stringify(args) : ''
  const [got, setGot] = useState({ key: '', q: null, err: '' })
  useEffect(() => {
    if (!key) return undefined
    let live = true
    const id = setTimeout(() => {
      Promise.resolve(quoteProduct(JSON.parse(key)))
        .then(q => { if (live) setGot({ key, q, err: '' }) })
        .catch(e => { if (live) setGot({ key, q: null, err: failWords(e).replace(' Nothing was charged.', '') }) })
    }, 250)
    return () => { live = false; clearTimeout(id) }
  }, [key, quoteProduct])
  return got.key === key ? got : { q: null, err: '' }
}

// Pay: busy, the error words, and the note when it went through.
function usePay(label, onDone) {
  const { addProduct } = useSampleActions()
  const note = useNote()
  const src = useDataSource()
  const [st, setSt] = useState({ busy: false, err: '' })
  const pay = async (args, before) => {
    setSt({ busy: true, err: '' })
    try {
      if (before) await before()
      const r = await addProduct(args)
      const w = addResultWords(r, label)
      if (!w.ok) { setSt({ busy: false, err: w.text }); return }
      setSt({ busy: false, err: '' })
      note(`${w.text}${sampleWords(src)}`)
      onDone()
    } catch (e) {
      setSt({ busy: false, err: failWords(e) })
    }
  }
  return [st, pay, () => setSt({ busy: false, err: '' })]
}

function PayButton({ busy, q, ok, onPay, word = 'add' }) {
  return (
    <button type="button" className="tp-primary fx-accent" disabled={!ok || busy || !q} onClick={onPay} data-testid="pr-pay">
      {busy ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" />Paying…</> : q ? `Pay ${cents(q.total_cents)} and ${word}` : 'Pay'}
    </button>
  )
}

const NoCard = () => <p className="pr-err" role="alert"><CircleAlert size={15} aria-hidden="true" />Add a card first, in Payment method. Nothing is charged until you pay.</p>

export function ServicingDrawer({ open, onClose }) {
  const { b } = useProducts()
  const quote = useQuote(open, { product: 'servicing' })
  const [st, pay, reset] = usePay('Servicing', onClose)
  const [was, setWas] = useState(open)
  if (open !== was) { setWas(open); if (open) reset() }
  const noCard = b.card && !b.card.onFile
  return (
    <Drawer open={open} onClose={onClose} title="Add Servicing" sub={PRODUCTS.servicing.line}
      footer={<><PayButton busy={st.busy} q={quote.q} ok={!noCard} onPay={() => pay({ product: 'servicing' })} /><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      <ul className="pr-facts">
        <li>{PRODUCTS.servicing.price}, up to {PRICES.servicingBase} clients. Then <span className="tp-money">${PRICES.servicingStepPrice}</span> a month for each {PRICES.servicingStep} more.</li>
        <li>Payments, changes and cancellations: our team calls your clients and keeps their policies on the books.</li>
        <li>Month to month. Remove it any time; it ends on your next bill date.</li>
      </ul>
      <QuoteRows q={quote.q} err={quote.err} />
      {noCard && <NoCard />}
      {st.err && <p className="pr-err" role="alert"><CircleAlert size={15} aria-hidden="true" />{st.err}</p>}
    </Drawer>
  )
}

// Add Leads: the plan band and daily spend (SignupCheckout's PlanPicker pattern), the sign-up details, the quote, Pay.
export function LeadsDrawer({ open, onClose }) {
  const { b } = useProducts()
  const { loadDetails, saveDetails } = useSampleActions()
  const [tier, setTier] = useState('growth')
  const [daily, setDaily] = useState(100)
  const [details, setDetails] = useState(() => emptyDetails())
  const [notTaking, setNotTaking] = useState(NOT_TAKING)
  const [st, pay, reset] = usePay('Leads', onClose)
  const [was, setWas] = useState(open)
  if (open !== was) { setWas(open); if (open) reset() }
  const t = PRICES.tiers.find(x => x.key === tier)
  const { lo, hi } = bandRange(t)
  const v = clampDaily(t, daily)
  const quote = useQuote(open, { product: 'leads', tier, daily: v })
  const missing = detailsMissing(details, notTaking)
  const noCard = b.card && !b.card.onFile

  // What they already saved fills the form back in.
  useEffect(() => {
    if (!open) return undefined
    let live = true
    Promise.resolve(loadDetails?.()).then(d => {
      if (!live || !d) return
      if (Array.isArray(d.notTaking)) setNotTaking(d.notTaking)
      setDetails(cur => fromSaved(d, cur))
    }).catch(() => {})
    return () => { live = false }
  }, [open, loadDetails])

  const pick = k => { setTier(k); setDaily(d => clampDaily(PRICES.tiers.find(x => x.key === k), d)) }
  return (
    <Drawer open={open} onClose={onClose} title="Add Leads" sub={PRODUCTS.leads.line}
      footer={<><PayButton busy={st.busy} q={quote.q} ok={missing.length === 0 && !noCard} onPay={() => pay({ product: 'leads', tier, daily: v }, () => saveDetails(details))} /><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      <div className="bl910 pr-leads">
        <div className="pr-tiers">
          <b className="pr-h">Your plan</b>
          <Seg role="radiogroup" label="Plan" value={tier} onChange={pick} options={PRICES.tiers.map(x => ({ key: x.key, label: x.label }))} />
          <p className="pr-tier-l"><span>{t.label}: {bandText(t)}</span><b className="tp-money">${t.monthly.toLocaleString('en-US')}<small> a month</small></b></p>
        </div>
        <div className="bl-spend">
          <div className="bl-spend-h">
            <label htmlFor="pr-daily">Daily lead spend</label>
            <b className="tp-money" aria-live="polite">${v}<small> / day</small></b>
          </div>
          <input id="pr-daily" className="pb-range bl-range" type="range" min={lo} max={hi} step={5} value={v}
            style={{ '--w': hi > lo ? (v - lo) / (hi - lo) : 0 }} aria-valuetext={`$${v} a day, ${t.label} plan`} onChange={e => setDaily(Number(e.target.value))} />
          <div className="bl-spend-scale" aria-hidden="true"><small>${lo}</small><small>${hi}</small></div>
          <p className="pb-note">Charged each night for the next day. Change it any time in Billing. <DeskInfo rate={PRICES.leadFee} /></p>
        </div>
      </div>
      <SignupDetails value={details} onChange={setDetails} notTaking={notTaking} missing={missing} />
      <QuoteRows q={quote.q} err={quote.err} />
      {missing.length > 0 && (
        <div className="sc-miss" data-testid="pr-missing"><b>Before you pay</b><ul>{missing.map(m => <li key={m.key + m.text}>{m.text}</li>)}</ul></div>
      )}
      {noCard && <NoCard />}
      {st.err && <p className="pr-err" role="alert"><CircleAlert size={15} aria-hidden="true" />{st.err}</p>}
    </Drawer>
  )
}

// Import leads: adds Your own leads (no charge) when it isn't on, then opens Leads → Import leads.
function useStartList() {
  const { addProduct } = useSampleActions()
  const { has } = useProducts()
  const navigate = useNavigate()
  const note = useNote()
  const [busy, setBusy] = useState(false)
  const go = () => navigate(`${paths.leads()}?react=1`)
  const start = async () => {
    if (has('reactivation')) return go()
    setBusy(true)
    try {
      const r = await addProduct({ product: 'reactivation' })
      const w = addResultWords(r, 'Your own leads')
      setBusy(false)
      if (!w.ok) return note(w.text)
      note('Your own leads added. Free to upload: you pay per appointment or live call we deliver')
      go()
    } catch (e) { setBusy(false); note(failWords(e)) }
  }
  return [busy, start]
}

function ProductRow({ p, b, onAdd, i }) {
  const { removeProduct, keepProduct } = useSampleActions()
  const note = useNote()
  const src = useDataSource()
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [listBusy, startList] = useStartList()
  const Icon = ICON[p.key]
  const s = p.state
  const cost = costOf(b, p.key)
  const words = removeWords(b, p.key)
  const remove = async () => {
    setBusy(true)
    try {
      const r = await removeProduct(p.key)
      setAsk(false)
      if (p.key === 'reactivation') note(`Your own leads removed. Lists already started keep calling.${sampleWords(src)}`)
      else note(`${p.label} ends on ${dayWords(r?.ends)}. You keep it until then.${src === 'sample' ? ' Sample only' : ''}`)
    } catch (e) { note(failWords(e).replace(' Nothing was charged.', '')) }
    setBusy(false)
  }
  const keep = async () => {
    setBusy(true)
    try { await keepProduct(p.key); note(`You keep ${p.label}. Nothing changes.`) } catch (e) { note(failWords(e).replace(' Nothing was charged.', '')) }
    setBusy(false)
  }
  return (
    <li className={`pr-row is-${s.kind}`} data-product={p.key} data-state={s.kind} style={{ '--i': i }}>
      <span className={`pr-ic is-${p.key}`}><Icon size={17} aria-hidden="true" /></span>
      <span className="pr-main">
        <b>{p.label}</b>
        <p>{p.line}</p>
        <small><span className="tp-money">{p.price}</span> · {p.sub}</small>
      </span>
      <span className="pr-side">
        {s.kind === 'on' && <>
          <Chip tone="green">On</Chip>
          <b className="tp-money pr-cost">{cost.big}</b><small>{cost.sub}</small>
          <span className="pr-acts">
            {p.key === 'reactivation' && <button type="button" className="tp-btn ov-ghost" disabled={listBusy} onClick={startList}>Import leads</button>}
            {canRemove(b, p.key) && !ask && <button type="button" className="pr-quiet" onClick={() => setAsk(true)}>Remove</button>}
          </span>
        </>}
        {s.kind === 'off' && <>
          <Chip tone="mute">Not added</Chip>
          {p.key === 'reactivation'
            ? <button type="button" className="tp-primary fx-accent" disabled={listBusy} onClick={startList}>{listBusy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />}Import leads</button>
            : <button type="button" className="tp-primary fx-accent" onClick={() => onAdd(p.key)} data-add={p.key}><Plus size={15} aria-hidden="true" />Add</button>}
        </>}
        {s.kind === 'ending' && <>
          <Chip tone="warn">Ends {dayWords(s.on)}</Chip>
          <small>You keep it until then</small>
          <button type="button" className="tp-primary fx-accent" disabled={busy} onClick={keep} data-keep={p.key}>Keep {p.label}</button>
        </>}
        {s.kind === 'starting' && <>
          <Chip tone="blue">From {dayWords(s.on)}</Chip>
          <small>Nothing monthly. Free to upload, $20 per appointment or live call</small>
        </>}
      </span>
      {ask && (
        <div className="pr-confirm" role="alertdialog" aria-label={words.title}>
          <b>{words.title}</b>
          {words.lines.map(l => <p key={l}>{l}</p>)}
          <span className="pr-acts">
            <button type="button" className="tp-btn ov-ghost" onClick={() => setAsk(false)}>Keep {p.label}</button>
            <button type="button" className="tp-btn ov-ghost tp-danger" disabled={busy} onClick={remove} data-confirm-remove={p.key}>{words.button}</button>
          </span>
        </div>
      )}
    </li>
  )
}

// The products card on Billing. ?add=leads or ?add=servicing opens that drawer (the "Add Leads" cards link here).
export function ProductsCard({ i = 0 }) {
  const { b, picked } = useProducts()
  const [params, setParams] = useSearchParams()
  const want = params.get('add')
  const [panel, setPanel] = useState(() => (['leads', 'servicing'].includes(want) && !picked.includes(want) ? want : null))
  const close = () => { setPanel(null); if (want) { const p = new URLSearchParams(params); p.delete('add'); setParams(p, { replace: true }) } }
  const rows = productRows(b)
  const ending = rows.find(r => r.state.kind === 'ending')
  const onlyRx = Array.isArray(b.next) && !b.next.some(k => k === 'leads' || k === 'servicing')
  return (
    <section className="fx-tile fx-s12 pr955" style={{ '--i': i }} aria-label="Your products" id="products">
      <header className="fx-tile-h"><span className="tp-grow"><h2>Your products</h2><p>Pick what you need, in any mix. Your portal is always included.</p></span><SampleTag /></header>
      {ending && onlyRx && <p className="pr-after" data-row="after">From {dayWords(b.nextFrom)} nothing is charged monthly. You keep your portal and Your own leads: free to upload, you pay per appointment or live call we deliver.</p>}
      <ul className="pr-list">{rows.map((p, k) => <ProductRow key={p.key} p={p} b={b} i={k} onAdd={setPanel} />)}</ul>
      <LeadsDrawer open={panel === 'leads'} onClose={close} />
      <ServicingDrawer open={panel === 'servicing'} onClose={close} />
    </section>
  )
}

// The one small "Add Leads" card (not pushy): Overview for accounts without Leads. compact = the line on Leads.
// P959: Your own leads only: sold leads stay on Leads → Sold. One quiet line, only once something is sold; no Submit, no Clients.
export function AddServicingCard({ leads = [], className = '' }) {
  const { serve } = useProducts()
  if (serve || !leads.some(l => l.stage === 'sold')) return null
  return <p className={`pr-suggest-line ${className}`.trim()} data-suggest="servicing">Want us to keep these on the books? <Link to={`${paths.billing()}?add=servicing`} className="tp-link">Add Servicing<ArrowRight size={14} aria-hidden="true" /></Link></p>
}

export function AddLeadsCard({ compact = false, className = '' }) {
  const { suggest } = useProducts()
  if (suggest !== 'leads') return null
  const to = `${paths.billing()}?add=leads`
  if (compact) {
    return <p className={`pr-suggest-line ${className}`.trim()} data-suggest="leads">Want new people too? <Link to={to} className="tp-link">Add Leads<ArrowRight size={14} aria-hidden="true" /></Link></p>
  }
  return (
    <section className={`fx-tile pr-suggest ${className}`.trim()} aria-label="Add Leads" data-suggest="leads">
      <span className="pr-ic is-leads"><PhoneIncoming size={17} aria-hidden="true" /></span>
      <span className="tp-grow"><b>Add Leads</b><small>{PRODUCTS.leads.line} <span className="tp-money">{PRODUCTS.leads.price}</span>.</small></span>
      <Link to={to} className="tp-btn ov-ghost">See Leads</Link>
    </section>
  )
}
