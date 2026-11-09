import { useCallback, useEffect, useState } from 'react'
import { Phone, Plus, AlertTriangle, Smartphone, Link2, ListChecks } from 'lucide-react'
import { Chip, Switch, SampleTag, Empty, Field, useNote } from '../../template/kit'
import { PhoneInput } from '../../template/PhoneInput'
import { useAdmSource } from '../data'
import { SAMPLE_POOL, CALLER_NAME, DEFAULT_LIMIT, DEFAULT_ESTIMATE, isHot, isFull, poolWarning, shownPhone, barOf, BRANDING_STEPS } from '../../lib/deedstonePool'
import { loadPool, saveNumber, savePoolSettings, VOICE_URL } from '../../hooks/deedstoneAdmin'
import './numbers916.css'

// P916 — Settings → Deedstone numbers (admins only; agents never see any of this). Every call a client gets shows
// "Deedstone Insurance": the AI's first call, the live transfer, VA calls and the agent's own calls all go out from
// the agent's Deedstone number. Each agent is quietly given one and keeps it; a number fills up to the daily limit,
// then the next agent gets the next number. Calls per number per day, and a warning when one runs hot.
let sample = structuredClone(SAMPLE_POOL)   // this visit's sample pool

export function DeedstoneNumbers() {
  const src = useAdmSource()
  const note = useNote()
  const [pool, setPool] = useState(src === 'real' ? null : sample)
  const [limit, setLimit] = useState(String(pool?.limit ?? DEFAULT_LIMIT))
  const [estimate, setEstimate] = useState(String(pool?.estimate ?? DEFAULT_ESTIMATE))
  const [add, setAdd] = useState({ phone: '', label: '', provider: '' })
  const [busy, setBusy] = useState(false)

  const took = useCallback(p => {
    setPool(p)
    if (!p?.missing) { setLimit(String(p.limit)); setEstimate(String(p.estimate)) }
  }, [])
  const refresh = useCallback(async () => took(src === 'real' ? await loadPool() : { ...sample }), [src, took])
  useEffect(() => {
    if (src !== 'real') return undefined
    let alive = true
    loadPool().then(p => { if (alive) took(p) })
    return () => { alive = false }
  }, [src, took])

  const run = async (fn, ok) => {
    setBusy(true)
    try { await fn(); await refresh(); note(ok) } catch (e) { note(e.message) }
    setBusy(false)
  }
  const addNumber = () => run(async () => {
    if (src !== 'real') {
      const phone = `+1${add.phone}`
      if (sample.numbers.some(n => n.phone === phone)) throw new Error('That number is already in the pool.')
      sample = { ...sample, numbers: [...sample.numbers, { id: `n${Date.now()}`, phone, label: add.label || null, caller_name: CALLER_NAME, active: true, provider_number_id: add.provider || null, agents: 0, load: 0, today: 0, days: sample.numbers[0]?.days.map(d => ({ ...d, calls: 0 })) ?? [] }] }
    } else {
      await saveNumber({ phone: add.phone, label: add.label || null, provider_number_id: add.provider || null })
    }
    setAdd({ phone: '', label: '', provider: '' })
  }, src === 'real' ? 'Number added' : 'Number added (sample)')
  const setActive = (n, active) => run(async () => {
    if (src !== 'real') sample = { ...sample, numbers: sample.numbers.map(x => (x.id === n.id ? { ...x, active } : x)) }
    else await saveNumber({ id: n.id, phone: n.phone, label: n.label, caller_name: n.caller_name, provider_number_id: n.provider_number_id, active })
  }, `${shownPhone(n.phone)} ${active ? 'on' : 'off'}${src === 'real' ? '' : ' (sample)'}`)
  const saveLimits = () => run(async () => {
    const l = Math.round(Number(limit)); const e = Math.round(Number(estimate))
    if (!(l >= 10 && l <= 2000) || !(e >= 1 && e <= 500)) throw new Error('Limit 10 to 2,000 calls; a new agent 1 to 500.')
    if (src !== 'real') sample = { ...sample, limit: l, estimate: e }
    else await savePoolSettings(l, e)
  }, src === 'real' ? 'Limits saved' : 'Limits saved (sample)')

  if (src === 'real' && !pool) return <><Head /><p className="tp-sub">Loading…</p></>
  if (pool?.missing) {
    return <><Head /><Empty title="Not set up yet" sub="The Deedstone numbers start once migration 255 is applied. Until then calls go out from the old single number." /></>
  }
  const warn = poolWarning(pool)
  const dirtyLimits = String(pool.limit) !== limit || String(pool.estimate) !== estimate

  return (
    <>
      <Head sample={src !== 'real'} />
      {warn && <p className="adm-warn" role="status"><AlertTriangle size={15} aria-hidden="true" />{warn.text}</p>}
      {pool.agents_without_phone > 0 && <p className="dn-info"><Smartphone size={15} aria-hidden="true" /><span><b className="tp-num">{pool.agents_without_phone}</b> {pool.agents_without_phone === 1 ? 'agent hasn’t' : 'agents haven’t'} connected a phone yet, so they can’t Call through Deedstone.</span></p>}

      <div className="dn-limits">
        <Field label="Calls a day per number" hint="When a number would pass this, the next agent gets the next number"><input className="tp-num" inputMode="numeric" value={limit} onChange={e => setLimit(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="Calls a day, new agent" hint="Used until an agent has a week of calls"><input className="tp-num" inputMode="numeric" value={estimate} onChange={e => setEstimate(e.target.value.replace(/\D/g, ''))} /></Field>
        <button type="button" className="tp-primary fx-accent" disabled={!dirtyLimits || busy} onClick={saveLimits}>Save limits</button>
      </div>

      {pool.numbers.length === 0 ? <Empty title="No numbers yet" sub="Add Ohvara’s Twilio numbers below. Each shows as Deedstone Insurance." /> : (
        <ul className="tp-list dn-list" aria-label="Deedstone numbers">{pool.numbers.map(n => {
          const hot = isHot(n, pool.limit)
          const full = n.active && isFull(n, pool.limit, pool.estimate)
          return (
            <li key={n.id} className={`dn-row${n.active ? '' : ' is-off'}`}>
              <div className="dn-main">
                <Phone size={16} aria-hidden="true" />
                <span className="tp-grow"><b className="tp-num">{shownPhone(n.phone)}</b><small>{n.label || 'No label'} · shows <b>{n.caller_name}</b> · {n.agents} {n.agents === 1 ? 'agent' : 'agents'}</small></span>
                {!n.active ? <Chip tone="mute">Off</Chip> : hot ? <Chip tone="warn">Running hot</Chip> : full ? <Chip tone="blue">Full: no new agents</Chip> : <Chip tone="green">Taking agents</Chip>}
                <Switch on={n.active} label={`${shownPhone(n.phone)} on`} onChange={v => setActive(n, v)} />
              </div>
              <div className="dn-today">
                <span className="dn-meter" aria-hidden="true"><i style={{ width: `${barOf(n.today, pool.limit) * 100}%` }} className={hot ? 'is-hot' : ''} /></span>
                <small><b className="tp-num">{n.today}</b> of <span className="tp-num">{pool.limit}</span> calls today</small>
              </div>
              <ol className="dn-week" aria-label={`${shownPhone(n.phone)}, calls per day this week`}>
                {(n.days || []).map(d => (
                  <li key={d.day} title={`${d.day}: ${d.calls} calls`}>
                    <i style={{ height: `${Math.max(4, barOf(d.calls, pool.limit) * 100)}%` }} className={d.calls >= Math.ceil(pool.limit * 0.9) ? 'is-hot' : ''} />
                    <small>{new Date(`${d.day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'narrow' })}</small>
                    <span className="tp-num">{d.calls}</span>
                  </li>
                ))}
              </ol>
            </li>
          )
        })}</ul>
      )}

      <h3 className="fx-h3 dn-h"><Plus size={16} aria-hidden="true" />Add a number</h3>
      <div className="dn-add">
        <Field label="Twilio number"><PhoneInput value={add.phone} onChange={d => setAdd({ ...add, phone: d })} /></Field>
        <Field label="Label"><input value={add.label} placeholder="Dallas 3" maxLength={60} onChange={e => setAdd({ ...add, label: e.target.value })} /></Field>
        <Field label="AI caller number id" hint="Only if the AI caller runs on Vapi"><input value={add.provider} maxLength={120} onChange={e => setAdd({ ...add, provider: e.target.value })} /></Field>
        <button type="button" className="tp-primary fx-accent" disabled={add.phone.length !== 10 || busy} onClick={addNumber}><Plus size={16} aria-hidden="true" />Add number</button>
      </div>
      <p className="dn-info"><Link2 size={15} aria-hidden="true" /><span>In Twilio, set each number’s Voice URL (POST) to <code>{VOICE_URL}</code>. Calls in then ring the caller’s own agent first, then a VA.</span></p>

      <h3 className="fx-h3 dn-h"><ListChecks size={16} aria-hidden="true" />So the name shows: Brayden and Jordan</h3>
      <ol className="dn-steps">{BRANDING_STEPS.map(([t, s]) => <li key={t}><b>{t}</b><small>{s}</small></li>)}</ol>
    </>
  )
}

function Head({ sample = false }) {
  return (
    <header className="fx-form-h dn-head">
      <div className="tp-row tp-wrap"><h2>Deedstone numbers</h2>{sample && <SampleTag>Sample</SampleTag>}</div>
      <p>Every call a client gets shows Deedstone Insurance. Each agent is quietly given one of these numbers and keeps it, so a client always sees the same number from their agent. Agents never see this page.</p>
    </header>
  )
}
