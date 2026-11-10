import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { KeyRound, Webhook, Radio, Power, PackageCheck, BadgeDollarSign, AlertCircle, Loader2, RotateCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { invokeBilling } from '../../lib/billing'
import { adminCharges, liveCheck, setLiveCharging } from '../../lib/leadSpend'
import { deskAdminLabel, deskParts } from '../../lib/bookingDesk'
import { PRICES } from '../../lib/priceBook.js'
import { Chip, SampleTag, Switch, useNote } from '../../template/kit'
import { useAdmSource } from '../data'
import './billing933.css'

// P933 — Settings › Billing (admins only): the Stripe check (key mode from its prefix only, the webhook endpoint and its
// events, the last webhook received), the Live charging switch (off by default; on = real cards are charged), the
// Stripe catalog from price book v3 (dry run first, then create), and the $1 live check (charge + refund on the admin's
// own card). The server reads the key from its secrets; only the mode and the first 8 characters reach this page.
// Recent charges (Revenue › Charges) shows every charge with its parts, the booking desk labelled for admins.

const CardForm = lazy(() => import('../../components/agent/StripeForms').then(m => ({ default: m.CardForm })))
const cents = c => `$${((Number(c) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const when = t => (t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

function Row({ icon: Icon, title, sub, children }) {
  return (
    <li className="fx-form-row fx-form-sw">
      <div className="tp-grow"><b><Icon size={14} aria-hidden="true" /> {title}</b>{sub && <p className="tp-sub">{sub}</p>}</div>
      {children}
    </li>
  )
}

function StripeCheck({ check, busy, error, onRun }) {
  const ep = check?.endpoint
  return (
    <>
      <header className="fx-form-h b933-h"><span className="tp-grow"><h2>Stripe check</h2><p>Which Stripe mode billing runs in and whether Stripe can reach us. Nothing secret is shown.</p></span>
        <button type="button" className="tp-btn ov-ghost" onClick={onRun} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} aria-hidden="true" />} Check again</button>
      </header>
      {error && <p className="b933-err" role="alert"><AlertCircle size={15} aria-hidden="true" />{error}</p>}
      {check && (
        <ul className="tp-list" data-testid="stripe-check">
          <Row icon={KeyRound} title="Secret key" sub={check.mode ? `Starts ${check.key_prefix}… · publishable key ${check.publishable_mode || 'missing'}` : 'No Stripe key in the server secrets yet.'}>
            <Chip tone={check.mode === 'live' ? 'green' : check.mode ? 'teal' : 'warn'}>{check.mode === 'live' ? 'Live mode' : check.mode === 'test' ? 'Test mode' : 'Not set'}</Chip>
          </Row>
          <Row icon={Webhook} title="Webhook endpoint" sub={check.endpoint_error || (ep ? `${ep.events.includes('*') ? 'All events' : `${ep.events.length} events`}${ep.missing.length ? ` · missing ${ep.missing.join(', ')}` : ''}` : `None in ${check.mode || 'Stripe'} mode for ${check.webhook_url || 'our webhook address'}`)}>
            <Chip tone={ep && ep.status === 'enabled' && !ep.missing.length ? 'green' : 'warn'}>{ep ? (ep.status === 'enabled' ? (ep.missing.length ? 'Missing events' : 'Listening') : 'Turned off') : 'Missing'}</Chip>
          </Row>
          <Row icon={KeyRound} title="Webhook signing secret" sub="STRIPE_WEBHOOK_SECRET in Supabase, from the endpoint above">
            <Chip tone={check.webhook_secret_set ? 'green' : 'warn'}>{check.webhook_secret_set ? 'Set' : 'Missing'}</Chip>
          </Row>
          <Row icon={Radio} title="Last webhook received" sub={check.last_webhook ? `${check.last_webhook.type} · ${when(check.last_webhook.at)}` : 'None received yet'}>
            {check.last_webhook ? <Chip tone={check.last_webhook.live ? 'green' : 'teal'}>{check.last_webhook.live ? 'Live' : 'Test'}</Chip> : <Chip tone="warn">None</Chip>}
          </Row>
        </ul>
      )}
      {check?.todo?.length > 0 && (
        <div className="b933-todo" data-testid="stripe-todo">
          <b>What to add in Stripe and Supabase</b>
          <ol>{check.todo.map(t => <li key={t}>{t}</li>)}</ol>
        </div>
      )}
    </>
  )
}

// P934: Live charging sits in Settings › Go live with the other go-live switches. It reads the billing server itself.
export function LiveChargingRow() {
  const [check, setCheck] = useState(null)
  const load = useCallback(() => invokeBilling('stripe_check').then(setCheck).catch(() => setCheck(null)), [])
  useEffect(() => {
    let live = true
    invokeBilling('stripe_check').then(c => { if (live) setCheck(c) }).catch(() => {})
    return () => { live = false }
  }, [])
  return <LiveCharging check={check} onChanged={load} bare />
}

function LiveCharging({ check, onChanged, bare }) {
  const note = useNote()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const on = !!check?.live_charging
  const flip = async next => {
    setBusy(true)
    try { await setLiveCharging(supabase, next); note(next ? 'Live charging is on' : 'Live charging is off'); setAsking(false); onChanged() } catch (e) { note(e.message) }
    setBusy(false)
  }
  const rows = (
    <>
      <Row icon={Power} title="Live charging" sub={on ? `On since ${when(check.live_charging_at)}. Real cards are charged on the live key: sign-ups, plans and nightly lead spend.` : 'Turns on real card charges on the live key: sign-ups, plans and nightly lead spend. Test keys only charge test cards.'}>
        <Switch on={on} label="Live charging" onChange={v => (v ? setAsking(true) : flip(false))} />
      </Row>
      {asking && (
        <li className="fx-form-row b933-ask" role="alertdialog" aria-label="Turn on live charging">
          <span className="tp-grow"><b>Turn on live charging?</b><small>From now, real cards are charged: new sign-ups, monthly plans and tonight's lead spend. Test accounts never are.</small></span>
          <button type="button" className="tp-btn ov-ghost" onClick={() => setAsking(false)} disabled={busy}>Cancel</button>
          <button type="button" className="tp-primary fx-accent" onClick={() => flip(true)} disabled={busy}>{busy ? 'Turning on…' : 'Turn on'}</button>
        </li>
      )}
    </>
  )
  return bare ? rows : <ul className="tp-list">{rows}</ul>
}

function Catalog({ mode }) {
  const note = useNote()
  const [run, setRun] = useState(null)
  const [busy, setBusy] = useState(false)
  const go = async apply => {
    setBusy(true)
    try { const r = await invokeBilling('stripe_catalog', { apply }); setRun(r); if (apply) note(`Stripe catalog ready in ${r.mode} mode`) } catch (e) { note(e.message) }
    setBusy(false)
  }
  return (
    <>
      <h3 className="fx-h3">Stripe products and prices</h3>
      <p className="tp-sub">Made from price book v{run?.version ?? 3} only. Run the dry run first: it lists what would be made in {mode || 'this'} mode. Making them twice changes nothing.</p>
      <div className="tp-row tp-wrap b933-btns">
        <button type="button" className="tp-btn ov-ghost" onClick={() => go(false)} disabled={busy}><PackageCheck size={14} aria-hidden="true" /> Dry run</button>
        {run && !run.apply && run.to_create > 0 && <button type="button" className="tp-primary fx-accent" onClick={() => go(true)} disabled={busy}>Make {run.to_create} in {run.mode} mode</button>}
      </div>
      {run && (
        <table className="b933-tbl" data-testid="catalog">
          <thead><tr><th scope="col">Product</th><th scope="col">Price</th><th scope="col">{run.apply ? 'Done' : 'Would'}</th></tr></thead>
          <tbody>{run.items.map(i => (
            <tr key={i.product}><td>{i.name}</td><td className="tp-money">{i.cents == null ? (i.note || 'Varies') : `${cents(i.cents)}${i.interval ? ' / month' : ''}`}</td><td>{i.action === 'create' ? (run.apply ? 'Made' : 'Make') : i.action === 'exists' ? 'Already there' : i.action || '—'}</td></tr>
          ))}</tbody>
        </table>
      )}
    </>
  )
}

function DollarCheck({ mode }) {
  const [adding, setAdding] = useState(false)
  const [card, setCard] = useState('')
  const [state, setState] = useState({ busy: false, result: null, error: '' })
  const go = async () => {
    setState({ busy: true, result: null, error: '' })
    try { setState({ busy: false, result: await liveCheck(supabase), error: '' }) } catch (e) {
      if (e.code === 'no_card') setAdding(true)
      setState({ busy: false, result: null, error: e.message })
    }
  }
  const r = state.result
  return (
    <>
      <h3 className="fx-h3">$1 live check</h3>
      <p className="tp-sub">Charges $1 to your own card in {mode === 'live' ? 'live' : 'this'} mode and refunds it straight away. It shows in Revenue › Charges.</p>
      {adding ? (
        <Suspense fallback={<p className="tp-sub"><Loader2 size={14} className="animate-spin" /> Opening the card form…</p>}>
          <CardForm setupAction="admin_setup_card" saveAction="admin_set_card" onCancel={() => setAdding(false)} onSaved={d => { setAdding(false); setCard(d?.card || 'Card saved') }} />
        </Suspense>
      ) : (
        <div className="tp-row tp-wrap b933-btns">
          <button type="button" className="tp-btn ov-ghost" onClick={() => setAdding(true)}>{card ? `${card} · Change` : 'Your card'}</button>
          <button type="button" className="tp-primary fx-accent" onClick={go} disabled={state.busy}><BadgeDollarSign size={14} aria-hidden="true" /> {state.busy ? 'Charging $1…' : 'Charge $1 and refund'}</button>
        </div>
      )}
      {r && <p className="b933-ok" role="status">$1 {r.status === 'paid' ? 'charged' : r.status}{r.refunded ? ' and refunded' : ''}{r.mode === 'test' ? ' (test mode)' : ''}{r.failure ? ` · ${r.failure}` : ''}.</p>}
      {state.error && <p className="b933-err" role="alert"><AlertCircle size={15} aria-hidden="true" />{state.error}</p>}
    </>
  )
}

export function StripeBilling() {
  const src = useAdmSource()
  const [check, setCheck] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = useCallback(async () => {
    setBusy(true)
    try { setCheck(await invokeBilling('stripe_check')); setError('') } catch (e) { setError(e.message) }
    setBusy(false)
  }, [])
  useEffect(() => {
    let live = true
    invokeBilling('stripe_check').then(c => { if (live) setCheck(c) }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [])
  return (
    <div className="b933 adm-set-two">
      <div>
        {src !== 'real' && <p className="tp-sub"><SampleTag>Real</SampleTag> This tab always reads the real billing server.</p>}
        <StripeCheck check={check} busy={busy} error={error} onRun={run} />
        <p className="tp-sub">Live charging is in Settings › Go live with the other go-live switches.</p>
      </div>
      <div>
        <Catalog mode={check?.mode} />
        <DollarCheck mode={check?.mode} />
      </div>
    </div>
  )
}

// Revenue › Charges: the latest charges with their parts. The booking desk is labelled with its rate for admins.
const KIND = { nightly: 'Lead spend', signup: 'Sign-up', plan_month: 'Plan', plan_upgrade: 'Plan upgrade', live_check: '$1 live check' }
const TONE = { paid: 'green', failed: 'warn', due: 'teal', processing: 'teal', canceled: 'mute', refunded: 'mute' }
export function RecentCharges() {
  const src = useAdmSource()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (src !== 'real') return undefined
    let live = true
    adminCharges(supabase, 40).then(r => { if (live) setRows(r || []) }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [src])
  const desk = deskAdminLabel(PRICES.leadFee)
  const list = src === 'real' ? rows : SAMPLE
  return (
    <div className="b933-charges">
      <p className="tp-sub">Every charge, newest first. {desk} is Ohvara's; the ad money goes to the ads. {src !== 'real' && <SampleTag>Sample</SampleTag>}</p>
      {error && <p className="b933-err" role="alert"><AlertCircle size={15} aria-hidden="true" />{error}</p>}
      {!list ? <p className="tp-sub">Loading…</p> : list.length === 0 ? <p className="tp-sub">No charges yet.</p> : (
        <table className="b933-tbl" data-testid="recent-charges">
          <thead><tr>{['When', 'Agent', 'What', 'Ads', desk, 'Setup + plan', 'Total', ''].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{list.map(c => (
            <tr key={c.id}>
              <td>{when(c.at)}</td><td>{c.agent}</td><td title={c.note || ''}>{KIND[c.kind] || c.kind}{c.for_day ? ` · ${c.for_day}` : ''}</td>
              <td className="tp-money">{c.spend_cents ? cents(c.spend_cents) : '—'}</td><td className="tp-money">{c.fee_cents ? cents(c.fee_cents) : '—'}</td>
              <td className="tp-money">{(c.setup_cents || 0) + (c.plan_cents || 0) + (c.extra_cents || 0) ? cents((c.setup_cents || 0) + (c.plan_cents || 0) + (c.extra_cents || 0)) : '—'}</td>
              <td className="tp-money">{cents(c.cents)}{c.refunded_cents ? <small> · {cents(c.refunded_cents)} back</small> : null}</td>
              <td><Chip tone={TONE[c.status] || 'mute'}>{c.status}</Chip></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="tp-sub b933-foot">Agents see each lead charge as one total with “{deskParts(100, 12)}” under it.</p>
    </div>
  )
}

const SAMPLE = [
  { id: 's1', at: '2026-11-09T20:00:00', agent: 'Dana Ruiz', kind: 'nightly', for_day: '2026-11-11', cents: 11200, spend_cents: 10000, fee_cents: 1200, status: 'paid' },
  { id: 's2', at: '2026-11-09T14:12:00', agent: 'Marcus Lee', kind: 'signup', cents: 202200, spend_cents: 20000, fee_cents: 2400, setup_cents: 29900, plan_cents: 149900, status: 'paid' },
  { id: 's3', at: '2026-11-09T09:30:00', agent: 'Brayden', kind: 'live_check', cents: 100, refunded_cents: 100, status: 'paid' },
  { id: 's4', at: '2026-11-08T20:00:00', agent: 'Sam Patel', kind: 'nightly', for_day: '2026-11-10', cents: 5600, spend_cents: 5000, fee_cents: 600, status: 'failed' },
]
