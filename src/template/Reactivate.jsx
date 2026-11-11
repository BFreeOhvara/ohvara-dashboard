import { useMemo, useRef, useState } from 'react'
import { Upload, ClipboardPaste, TriangleAlert, CircleCheck, RotateCcw, CreditCard, Trash2 } from 'lucide-react'
import { Drawer, Field, Chip, useNote } from './kit'
import { useReactivation, useDataSource, useSampleLeads, useSampleClients } from './data'
import { SAMPLE_DNC } from './reactivation.js'
import {
  parseCsv, looksLikeHeader, guessMapping, mappingMissing, cleanList, priceFor, usd0,
  REACT_FIELDS, REMOVED_ORDER, REMOVED_LABEL, REACT_ATTEST, LIST_STATUS, normalizePhone,
} from '../lib/reactivation.js'
import { isNativeApp } from '../lib/native'
import { NATIVE_BILLING_TEXT } from '../components/native/NativeBillingNote'
import './p891.css'
import './react952.css'

// P952 — Leads → Reactivate old leads. The agent brings a list of their own old leads (a CSV or a paste), says which
// column is which, sees what we take off (bad numbers, duplicates, people already theirs, states they aren't licensed
// in, our do-not-call list) and the price, ticks that the list is theirs to call, and pays. Our side cleans it again
// (that's the count charged), checks it against the national Do Not Call and litigator lists, then our AI calls each
// person (calls only, no texts). Booked and transferred people land on the board tagged Reactivated.
// Lists show as progress cards above the board (ReactivationCards).

const FIELD_LABEL = Object.fromEntries(REACT_FIELDS.map(f => [f.key, f.label]))
const OPTIONAL = new Set(['age', 'mortgage', 'lead_date', 'source'])
const WHY = {
  attest: 'Tick the line about the list first.',
  below_min: null, // the server's own words say how many are left
  empty: 'The list is empty.',
  too_many: 'Up to 5,000 people per list. Split it in two.',
  reactivation_off: 'Reactivation opens soon. Nothing was charged.',
}

function useExisting() {
  const { data: leads = [] } = useSampleLeads()
  const { data: clients = [] } = useSampleClients()
  return useMemo(() => [...leads, ...clients].map(x => normalizePhone(x.rawPhone || x.phone)).filter(Boolean), [leads, clients])
}

export function ReactivateDrawer({ open, onClose }) {
  const rx = useReactivation()
  const source = useDataSource()
  const terms = rx.useTerms()
  const existing = useExisting()
  const note = useNote()
  const file = useRef(null)
  const [name, setName] = useState('')
  const [paste, setPaste] = useState('')
  const [read, setRead] = useState(null) // { rows, from, error }
  const [head, setHead] = useState(true)
  const [map, setMap] = useState({})
  const [attest, setAttest] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [draft, setDraft] = useState(null) // the server's count once checked
  const [done, setDone] = useState(null)

  const reset = () => { setName(''); setPaste(''); setRead(null); setHead(true); setMap({}); setAttest(false); setErr(null); setDraft(null); setDone(null); if (file.current) file.current.value = '' }
  const close = () => {
    // A list checked but not paid is thrown away, so nothing is left half-made.
    if (draft && !done) rx.discard(draft.list_id).catch(() => {})
    reset(); onClose()
  }
  const take = (text, from) => {
    const rows = parseCsv(text)
    if (!rows.length) { setRead({ rows: [], from, error: 'We couldn’t read any rows. Check it has a header row and one person per line.' }); return }
    const h = looksLikeHeader(rows[0])
    setHead(h)
    setMap(h ? guessMapping(rows[0]) : {})
    setRead({ rows, from })
    setDraft(null); setErr(null)
  }
  const pick = async e => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 3_000_000) { setRead({ rows: [], error: 'That file is over 3 MB. Split it in two.', from: f.name }); return }
    if (!name) setName(f.name.replace(/\.(csv|txt)$/i, ''))
    take(await f.text(), f.name)
  }

  const header = read?.rows?.length ? (head ? read.rows[0] : read.rows[0].map((_, i) => `Column ${i + 1}`)) : []
  const body = useMemo(() => (read?.rows ? (head ? read.rows.slice(1) : read.rows) : []), [read, head])
  const missing = read ? mappingMissing(map) : []
  const clean = useMemo(() => (body.length && !missing.length
    ? cleanList(body, map, { licensed: terms.licensed || [], existing, dnc: source === 'sample' ? SAMPLE_DNC : [] })
    : null), [body, map, missing.length, terms.licensed, existing, source])
  const price = priceFor(draft ? draft.callable : clean?.callable || 0, { priceCents: terms.price_cents, minLeads: terms.min_leads })
  const removed = draft ? draft.removed : clean?.counts
  const tooMany = body.length > 5000
  // Real accounts: closed until Ohvara turns calling on (reactivation_live). Sample always lets you try it.
  const closed = terms.unavailable || (source === 'real' && !terms.loading && !terms.live)
  const canPay = !!clean && !price.belowMin && attest && !busy && !tooMany && !closed && !terms.loading

  const pay = async () => {
    setBusy(true); setErr(null)
    try {
      let d = draft
      if (!d) {
        const rows = (clean.kept.concat(clean.removed)).map(c => ({ first: c.first, last: c.last, phone: c.phone || c.rawPhone, state: c.state || c.rawState,
          age: c.age, mortgage_cents: c.mortgage_cents, lead_date: c.lead_date, source: c.source }))
        d = await rx.create(name.trim() || 'Old leads', rows, attest, existing)
        setDraft(d)
        // Our check took more off than the preview (our do-not-call list): show the new price, pay on the next tap.
        if (d.amount_cents !== clean.callable * terms.price_cents) { setBusy(false); return }
      }
      const r = await rx.pay(d.list_id)
      if (r?.status === 'failed') { setErr(r.failure || 'The card was declined. Update it on Billing, then try again.'); setBusy(false); return }
      setDone({ ...d, status: r?.status })
      note(source === 'sample' ? 'List paid. Sample only, nothing was charged' : `Paid ${usd0(d.amount_cents)}. We’re checking the list now`)
    } catch (e) {
      setErr(WHY[e.code] || e.message || 'Something went wrong. Nothing was charged.')
    } finally { setBusy(false) }
  }

  const footer = done
    ? <button type="button" className="tp-primary fx-accent" onClick={close}>Done</button>
    // P956: no payments inside the phone app (P775 rule); the list is paid for on the website.
    : read && !read.error && clean && isNativeApp() ? <small className="rx-fine">{NATIVE_BILLING_TEXT} Pay for this list there.</small>
    : read && !read.error && clean ? <>
      <label className="tp-check rx-attest"><input type="checkbox" checked={attest} onChange={e => setAttest(e.target.checked)} /><span>{REACT_ATTEST}</span></label>
      <button type="button" className="tp-primary fx-accent" disabled={!canPay} onClick={pay}>
        <CreditCard size={16} aria-hidden="true" />{busy ? 'Paying…' : price.belowMin ? `At least ${price.min} people needed` : `Pay ${usd0(price.cents)}`}
      </button>
      <small className="rx-fine">Charged now on your card on file. Shows as OHVARA LEADS. Numbers we take off are free.</small>
    </> : null

  return (
    <Drawer open={open} onClose={close} title="Reactivate old leads" sub="Old leads you bought or collected. Our AI calls each one, books them on your calendar or rings you live." footer={footer}>
      {done ? (
        <div className="rx-done" role="status">
          <CircleCheck size={28} aria-hidden="true" />
          <b>Paid {usd0(done.amount_cents)} for {done.callable} people</b>
          <p>We check every number against the national Do Not Call and litigator lists first. Anyone taken off there is refunded. Calls start after that, from 8 AM to 8 PM in each person’s time zone.</p>
        </div>
      ) : <>
        {closed && <p className="bi-err" role="status"><TriangleAlert size={15} aria-hidden="true" />Reactivation opens soon. You can’t send a list yet.</p>}
        <Field label="List name"><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 2024 mortgage leads" maxLength={120} /></Field>
        <div className="bi-import">
          <div className="bi-ways">
            <button type="button" className="bi-way" onClick={() => file.current?.click()}><Upload size={18} aria-hidden="true" /><b>Upload a CSV</b><small>Up to 5,000 people</small></button>
            <input ref={file} type="file" accept=".csv,text/csv,.txt" className="bi-file" aria-label="CSV file" onChange={pick} />
          </div>
          <Field label="Or paste from a sheet" hint="Copy the rows with the header row on top, then paste here.">
            <textarea value={paste} onChange={e => setPaste(e.target.value)} placeholder={'Name\tPhone\tState\tAge\tMortgage\n…'} />
          </Field>
          {paste.trim() && <button type="button" className="tp-btn ov-ghost fx-self" onClick={() => take(paste, 'your paste')}><ClipboardPaste size={15} />Read the paste</button>}
          {read?.error && <p className="bi-err" role="alert"><TriangleAlert size={15} aria-hidden="true" />{read.error}</p>}
        </div>

        {read && !read.error && <>
          <section className="rx-map" aria-label="Which column is which">
            <header><b>Which column is which</b><small>Read {body.length} row{body.length === 1 ? '' : 's'} from {read.from}</small></header>
            <label className="tp-check rx-head"><input type="checkbox" checked={head} onChange={e => { setHead(e.target.checked); setMap(e.target.checked ? guessMapping(read.rows[0]) : {}); setDraft(null) }} /><span>The first row is the column names</span></label>
            <div className="rx-fields">
              {REACT_FIELDS.map(f => (
                <label key={f.key} className="tp-field">
                  <span>{f.label}{OPTIONAL.has(f.key) ? ', optional' : ''}</span>
                  <select value={map[f.key] ?? ''} onChange={e => { setDraft(null); setMap(m => { const n = { ...m }; if (e.target.value === '') delete n[f.key]; else n[f.key] = Number(e.target.value); return n }) }}>
                    <option value="">Not in the list</option>
                    {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {missing.length > 0 && <p className="bi-err" role="alert"><TriangleAlert size={15} aria-hidden="true" />Pick the column for {missing.map(k => (k === 'name' ? 'the name' : FIELD_LABEL[k].toLowerCase())).join(' and ')}.</p>}
            {tooMany && <p className="bi-err" role="alert"><TriangleAlert size={15} aria-hidden="true" />Up to 5,000 people per list. Split it in two.</p>}
          </section>

          {clean && (
            <section className="rx-preview" aria-label="What we’ll call">
              <div className="rx-row is-total"><span>People in the list</span><b className="tp-money">{(draft?.uploaded ?? clean.total).toLocaleString('en-US')}</b></div>
              {REMOVED_ORDER.filter(k => removed?.[k]).map(k => (
                <div key={k} className="rx-row is-off"><span>{REMOVED_LABEL[k]}</span><b className="tp-money">−{removed[k].toLocaleString('en-US')}</b></div>
              ))}
              <div className="rx-row is-left"><span>We’ll call</span><b className="tp-money">{price.n.toLocaleString('en-US')}</b></div>
              <div className="rx-row is-price"><span>{usd0(price.each)} each</span><b className="tp-money">{usd0(price.cents)}</b></div>
              {draft && draft.amount_cents !== clean.callable * terms.price_cents && <p className="rx-note" role="status">Our check took a few more off. The price above is the new total.</p>}
              {price.belowMin && <p className="bi-err" role="alert"><TriangleAlert size={15} aria-hidden="true" />A list needs at least {price.min} people we can call. Add {price.short} more.</p>}
              <p className="rx-note">Before any call, every number is checked against the national Do Not Call and litigator lists. Anyone taken off there is refunded.</p>
            </section>
          )}
        </>}
        {err && <p className="bi-err" role="alert"><TriangleAlert size={15} aria-hidden="true" />{err}</p>}
      </>}
    </Drawer>
  )
}

const HOVER = {
  waiting_scrub: 'Checking every number against the Do Not Call lists. Calls start after that.',
  paused: 'Paused by our team while we look at it.',
}

// One card per list: worked / reached / booked / transferred / remaining.
export function ReactivationCards() {
  const rx = useReactivation()
  const { lists = [] } = rx.useLists()
  const shown = lists.filter(l => l.status !== 'cancelled')
  if (!shown.length) return null
  return (
    <div className="rx-cards" role="region" aria-label="Your old-lead lists">
      {shown.map(l => <ListCard key={l.id} l={l} rx={rx} />)}
    </div>
  )
}

function ListCard({ l, rx }) {
  const note = useNote()
  const [busy, setBusy] = useState(false)
  const p = l.progress || {}
  const [tone, word] = LIST_STATUS[l.status] || ['mute', l.status]
  const total = p.total || l.callable || 0
  const pct = total ? Math.round(((p.worked || 0) / total) * 100) : 0
  const unpaid = l.status === 'draft' || l.status === 'payment_failed'
  const pay = async () => {
    setBusy(true)
    try {
      const r = await rx.pay(l.id)
      note(r?.status === 'failed' ? (r.failure || 'The card was declined') : 'Paid. We’re checking the list now')
    } catch (e) { note(WHY[e.code] || e.message) } finally { setBusy(false) }
  }
  const drop = async () => { setBusy(true); try { await rx.discard(l.id) } catch (e) { note(e.message) } finally { setBusy(false) } }
  const N = [['Worked', p.worked], ['Reached', p.reached], ['Booked', p.booked], ['Transferred', p.transferred], ['Remaining', p.remaining]]
  return (
    <article className="fx-card rx-card">
      <header title={HOVER[l.status] || undefined}><RotateCcw size={14} aria-hidden="true" /><b title={l.name}>{l.name}</b><Chip tone={tone}>{word}</Chip></header>
      {unpaid ? (
        <div className="rx-unpaid">
          <span>{l.callable} people · <b className="tp-money">{usd0(l.amount_cents)}</b></span>
          <span className="rx-acts">
            <button type="button" className="tp-primary fx-accent" disabled={busy} onClick={pay}><CreditCard size={14} aria-hidden="true" />Pay</button>
            <button type="button" className="tp-btn ov-ghost" disabled={busy} onClick={drop} aria-label={`Remove ${l.name}`}><Trash2 size={14} aria-hidden="true" /></button>
          </span>
        </div>
      ) : <>
        <dl className="rx-n">{N.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="tp-money">{(v || 0).toLocaleString('en-US')}</dd></div>)}</dl>
        <div className="rx-bar" role="progressbar" aria-label={`${pct}% worked`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
      </>}
    </article>
  )
}
