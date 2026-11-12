import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PhoneIncoming, ShieldCheck, RotateCcw, Loader2, CircleAlert, ArrowRight } from 'lucide-react'
import { useSampleActions, useDataSource } from './data'
import { Drawer, Seg, useNote } from './kit'
import { paths } from './paths'
import { useProducts } from './useProducts'
import { PRODUCTS } from '../lib/products.js'
import { PRICES, bandText } from '../lib/priceBook.js'
import { deskParts } from '../lib/bookingDesk'
import { DeskInfo } from '../components/agent/DeskInfo'
import { SignupDetails } from '../components/agent/SignupDetails'
import { emptyDetails, fromSaved, detailsMissing, NOT_TAKING } from '../lib/signupDetails'
import { stateOf, costOf, canRemove, removeWords, quoteLines, cents, dayWords, bandRange, clampDaily, failWords, addResultWords } from './productsView'
import '../components/agent/signupCheckout.css'
import './bill910.css'
import './products955.css'

// P955 — Billing → Your products: Leads, Servicing, Reactivation, in any mix. Each shows its one-liner, its price and
// its state: On (what it costs), Not added (Add) or Ends <date> (Keep). Remove is a quiet text button with a confirm:
// Leads and Servicing end on the next bill date, Reactivation at once (lists already paid keep calling). Adding
// Servicing or Leads opens a drawer with the server's quote (productsView.js quoteLines) and Pay; Leads also asks the
// sign-up details (states, hours, live transfers) and saves them first. Reactivation is free to add and takes them to
// Leads → Import leads. Sample: nothing is charged (?pay=declined previews a declined card).

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

// P969 — products live inside the Billing plan card (no separate box). The rows show what this agent has (Servicing, Your
// own leads); Change opens ManageDrawer (Remove / Keep, the same confirm words as before); Add opens the drawers above.
// Leads itself is the plan card's hero (Change plan). Nothing here changes a rule: billing, card checks and limits are
// the server's, through the same actions.

// Remove (with its confirm words) or Keep (undo a removal) for one product, in a drawer opened from the plan card.
export function ManageDrawer({ product, open, onClose }) {
  const { b, picked } = useProducts()
  const { removeProduct, keepProduct } = useSampleActions()
  const note = useNote()
  const src = useDataSource()
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState(product)
  if (product && product !== last) setLast(product)
  const key = product || last
  if (!key) return null
  const p = PRODUCTS[key]
  const s = stateOf(b, key)
  const cost = costOf(b, key)
  const words = removeWords(b, key)
  const only = picked.length === 1
  const remove = async () => {
    setBusy(true)
    try {
      const r = await removeProduct(key)
      if (key === 'reactivation') note(`Your own leads removed. Lists already started keep calling.${sampleWords(src)}`)
      else note(`${p.label} ends on ${dayWords(r?.ends)}. You keep it until then.${src === 'sample' ? ' Sample only' : ''}`)
      onClose()
    } catch (e) { note(failWords(e).replace(' Nothing was charged.', '')) }
    setBusy(false)
  }
  const keep = async () => {
    setBusy(true)
    try { await keepProduct(key); note(`You keep ${p.label}. Nothing changes.`); onClose() } catch (e) { note(failWords(e).replace(' Nothing was charged.', '')) }
    setBusy(false)
  }
  return (
    <Drawer open={open} onClose={onClose} title={p.label} sub={p.line}
      footer={<>
        {s.kind === 'ending' && <button type="button" className="tp-primary fx-accent" disabled={busy} onClick={keep} data-keep={key}>Keep {p.label}</button>}
        {s.kind === 'on' && canRemove(b, key) && <button type="button" className="tp-btn ov-ghost tp-danger" disabled={busy} onClick={remove} data-confirm-remove={key}>{words.button}</button>}
        <button type="button" className="tp-btn ov-ghost" onClick={onClose}>Close</button>
      </>}>
      <ul className="pr-facts">
        <li><span className="tp-money">{cost.big}</span>. {cost.sub}.</li>
        {s.kind === 'ending' && <li>Ends {dayWords(s.on)}. You keep it until then.</li>}
        {s.kind === 'on' && !canRemove(b, key) && <li>{only ? 'It’s your only product. Add another first.' : 'It can’t be removed right now.'}</li>}
      </ul>
      {s.kind === 'on' && canRemove(b, key) && (
        <div className="pr-confirm" role="group" aria-label={words.title}>
          <b>{words.title}</b>
          {words.lines.map(l => <p key={l}>{l}</p>)}
        </div>
      )}
    </Drawer>
  )
}

// The plan card's product lines: only what this agent has (or is about to have). Leads is the card's hero.
export function PlanProductRows({ onManage, charged = '' }) {
  const { b } = useProducts()
  const [listBusy, startList] = useStartList()
  const sv = stateOf(b, 'servicing')
  const rx = stateOf(b, 'reactivation')
  const ld = stateOf(b, 'leads')
  const cs = costOf(b, 'servicing')
  const cr = costOf(b, 'reactivation')
  return (
    <>
      {ld.kind === 'ending' && (
        <div data-row="leads-ending"><dt>Leads</dt><dd><b>Ends {dayWords(ld.on)}</b><small>You keep it until then</small>
          <button type="button" className="tp-btn ov-ghost bl-undo" onClick={() => onManage('leads')} data-keep="leads">Keep Leads</button></dd></div>
      )}
      {sv.kind !== 'off' && (
        <div data-row="servicing" data-state={sv.kind}><dt>Servicing</dt><dd>
          <b className="tp-money">{sv.kind === 'starting' ? `From ${dayWords(sv.on)}` : cs.big}</b>
          <small>{sv.kind === 'ending' ? `Ends ${dayWords(sv.on)} · ${cs.sub}` : cs.sub}</small>
          <button type="button" className="tp-btn ov-ghost bl-undo" onClick={() => onManage('servicing')} data-manage="servicing">{sv.kind === 'ending' ? 'Keep' : 'Change'}</button></dd></div>
      )}
      {rx.kind !== 'off' && (
        <div data-row="own" data-state={rx.kind}><dt>Your own leads</dt><dd>
          <b className="tp-money">{rx.kind === 'starting' ? `From ${dayWords(rx.on)}` : `${cr.big} or live call`}</b>
          <small>Nothing monthly. Free to upload{rx.kind === 'starting' ? '' : charged}</small>
          <span className="tp-row tp-wrap">
            <button type="button" className="tp-btn ov-ghost bl-undo" disabled={listBusy} onClick={startList} data-import="own">Import leads</button>
            {rx.kind === 'on' && canRemove(b, 'reactivation') && <button type="button" className="tp-btn ov-ghost bl-undo" onClick={() => onManage('reactivation')} data-manage="reactivation">Change</button>}
          </span></dd></div>
      )}
    </>
  )
}

// The plan card's quiet adds and the one removal that has no other home: Add servicing, Import leads, Remove Leads.
export function PlanProductActions({ onAdd, onManage }) {
  const { b, picked } = useProducts()
  const [listBusy, startList] = useStartList()
  const sv = stateOf(b, 'servicing')
  const rx = stateOf(b, 'reactivation')
  const ld = stateOf(b, 'leads')
  return (
    <>
      {sv.kind === 'off' && <button type="button" className="tp-btn ov-ghost" onClick={() => onAdd('servicing')} data-add="servicing"><ShieldCheck size={15} aria-hidden="true" />Add servicing</button>}
      {rx.kind === 'off' && <button type="button" className="tp-btn ov-ghost" disabled={listBusy} onClick={startList} data-import="own"><RotateCcw size={15} aria-hidden="true" />Import leads</button>}
      {ld.kind === 'on' && picked.length > 1 && canRemove(b, 'leads') && <button type="button" className="pr-quiet" onClick={() => onManage('leads')} data-manage="leads">Remove Leads</button>}
    </>
  )
}

// The drawers Billing opens for products. panel: 'leads' | 'servicing' (add) or 'manage-<product>'.
export function ProductDrawers({ panel, close }) {
  const manage = typeof panel === 'string' && panel.startsWith('manage-') ? panel.slice(7) : null
  return (
    <>
      <LeadsDrawer open={panel === 'leads'} onClose={close} />
      <ServicingDrawer open={panel === 'servicing'} onClose={close} />
      <ManageDrawer product={manage} open={!!manage} onClose={close} />
    </>
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
