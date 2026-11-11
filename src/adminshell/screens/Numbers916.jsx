import { useCallback, useEffect, useState } from 'react'
import { Plus, AlertTriangle, Smartphone, Link2, ListChecks, Users, SlidersHorizontal } from 'lucide-react'
import { Avatar, Chip, Drawer, Switch, SampleTag, Empty, Field, Seg, useNote } from '../../template/kit'
import Chart from '../../template/Chart'
import { HoldLineSettings } from './Playbook932'
import { PhoneInput } from '../../template/PhoneInput'
import { useAdmSource, useAdmVas } from '../data'
import { SAMPLE_POOL, CALLER_NAME, DEFAULT_LIMIT, DEFAULT_ESTIMATE, isHot, isFull, poolWarning, shownPhone, barOf, BRANDING_STEPS } from '../../lib/deedstonePool'
import { loadPool, saveNumber, savePoolSettings, loadPods, savePod, VOICE_URL } from '../../hooks/deedstoneAdmin'
import { POD_MIN, POD_MAX } from '../../lib/clientLine'
import './numbers916.css'

// P916 — Lines & pods (Deedstone numbers) (admins only; agents never see any of this). Every call a client gets shows
// "Deedstone Insurance": the AI's first call, the live transfer, VA calls and the agent's own calls all go out from
// the agent's Deedstone number. Each agent is quietly given one and keeps it; a number fills up to the daily limit,
// then the next agent gets the next number. Calls per number per day, and a warning when one runs hot.
let sample = structuredClone(SAMPLE_POOL)   // this visit's sample pool
const DN_SERIES = [{ key: 'calls', label: 'Calls', color: 'var(--ox-1)' }]

export function DeedstoneNumbers() {
  const src = useAdmSource()
  const note = useNote()
  const [pool, setPool] = useState(src === 'real' ? null : sample)
  const [limit, setLimit] = useState(String(pool?.limit ?? DEFAULT_LIMIT))
  const [estimate, setEstimate] = useState(String(pool?.estimate ?? DEFAULT_ESTIMATE))
  const [add, setAdd] = useState({ phone: '', label: '', provider: '', pool: 'main' })
  const [busy, setBusy] = useState(false)
  const vas = useAdmVas().data || []
  const [pods, setPods] = useState({})
  const [editing, setEditing] = useState(null)   // { id, pick: [va ids] }
  const [openId, setOpenId] = useState(null)      // P936: the number open in the slide-in
  const [panel, setPanel] = useState(null)        // 'add' | 'limits'
  useEffect(() => {
    if (src !== 'real') return undefined
    let alive = true
    loadPods().then(p => { if (alive) setPods(p) })
    return () => { alive = false }
  }, [src])
  const podOf = n => (src === 'real' ? pods[n.id] : n.pod) || []
  const vaName = id => vas.find(v => v.id === id)?.name || 'A VA'

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
      sample = { ...sample, numbers: [...sample.numbers, { id: `n${Date.now()}`, phone, label: add.label || null, caller_name: CALLER_NAME, active: true, pool: add.pool, provider_number_id: add.provider || null, agents: 0, load: 0, today: 0, days: sample.numbers[0]?.days.map(d => ({ ...d, calls: 0 })) ?? [] }] }
    } else {
      await saveNumber({ phone: add.phone, label: add.label || null, provider_number_id: add.provider || null, pool: add.pool })
    }
    setAdd({ phone: '', label: '', provider: '', pool: 'main' })
  }, src === 'real' ? 'Number added' : 'Number added (sample)')
  const setActive = (n, active) => run(async () => {
    if (src !== 'real') sample = { ...sample, numbers: sample.numbers.map(x => (x.id === n.id ? { ...x, active } : x)) }
    else await saveNumber({ id: n.id, phone: n.phone, label: n.label, caller_name: n.caller_name, provider_number_id: n.provider_number_id, active, pool: n.pool || 'main' })
  }, `${shownPhone(n.phone)} ${active ? 'on' : 'off'}${src === 'real' ? '' : ' (sample)'}`)
  // P924: 2 or 3 VAs answer the clients who call or text each number.
  const savePodPick = n => run(async () => {
    const pick = editing.pick
    if (pick.length < POD_MIN || pick.length > POD_MAX) throw new Error('Pick 2 or 3 VAs.')
    if (src !== 'real') sample = { ...sample, numbers: sample.numbers.map(x => (x.id === n.id ? { ...x, pod: pick } : x)) }
    else { await savePod(n.id, pick); setPods(await loadPods()) }
    setEditing(null)
  }, src === 'real' ? 'VAs saved' : 'VAs saved (sample)')
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

  const openN = pool.numbers.find(x => x.id === openId) || null
  const dayName = d => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
  const podPicker = n => (
    <div className="dn-pod-edit">
      <span className="dn-pod-pick" role="group" aria-label={`VAs on ${shownPhone(n.phone)}`}>{vas.map(v => {
        const on = editing.pick.includes(v.id)
        return <button key={v.id} type="button" aria-pressed={on} className={`fx-chip${on ? ' is-on' : ''}`} disabled={!on && editing.pick.length >= POD_MAX} onClick={() => setEditing({ ...editing, pick: on ? editing.pick.filter(x => x !== v.id) : [...editing.pick, v.id] })}><b>{v.name}</b></button>
      })}</span>
      <small className="tp-sub">Pick {POD_MIN} or {POD_MAX} VAs.</small>
      <div className="tp-row dn-pod-acts">
        <button type="button" className="tp-btn" onClick={() => setEditing(null)}>Cancel</button>
        <button type="button" className="tp-primary fx-accent" disabled={busy || editing.pick.length < POD_MIN} onClick={() => savePodPick(n)}>Save VAs</button>
      </div>
    </div>
  )
  const stateOf = n => (!n.active ? ['mute', 'Off'] : isHot(n, pool.limit) ? ['warn', 'Running hot'] : isFull(n, pool.limit, pool.estimate) ? ['blue', 'Full: no new agents'] : ['green', 'Taking agents'])

  // P936: one card per number (the number, its VAs, calls today, Change VAs) and nothing else; the rest of each
  // number sits in its slide-in. Limits, adding a number and the hold line each open in their own slide-in, so the page
  // fits the screen with no inner scroll.
  return (
    <>
      <Head sample={src !== 'real'}>
        <button type="button" className="tp-btn" onClick={() => setPanel('limits')}><SlidersHorizontal size={15} aria-hidden="true" />Limits and hold line</button>
        <button type="button" className="tp-primary fx-accent" onClick={() => setPanel('add')}><Plus size={16} aria-hidden="true" />Add a number</button>
      </Head>
      {warn && <p className="adm-warn" role="status"><AlertTriangle size={15} aria-hidden="true" />{warn.text}</p>}

      {pool.numbers.length === 0 ? <Empty title="No numbers yet" sub="Add Ohvara’s Twilio numbers with Add a number. Each shows as Deedstone Insurance." /> : (
        <ul className="dn-grid" aria-label="Deedstone numbers">{pool.numbers.map((n, i) => {
          const pod = podOf(n)
          const hot = isHot(n, pool.limit)
          return (
            <li key={n.id} className={`dn-card${n.active ? '' : ' is-off'}${hot ? ' is-hot' : ''}`} style={{ '--i': i }}>
              <button type="button" className="dn-card-open" aria-label={`${shownPhone(n.phone)}: details`} onClick={() => { setEditing(null); setOpenId(n.id) }} />
              <span className="dn-numrow"><b className="tp-num dn-num">{shownPhone(n.phone)}</b>{n.pool === 'reactivation' && <small className="dn-pooltag">Reactivation</small>}</span>
              <span className="dn-avs">
                {pod.length ? pod.map(id => <Avatar key={id} name={vaName(id)} />) : <span className="dn-av-none" aria-hidden="true"><Users size={15} /></span>}
                <small>{pod.length ? pod.map(id => vaName(id).split(' ')[0]).join(', ') : 'No VAs picked'}</small>
              </span>
              <span className="dn-card-foot">
                <span className="dn-today-n"><b className="tp-num">{n.today}</b><small>{n.active ? (hot ? 'calls today · running hot' : 'calls today') : 'calls today · off'}</small></span>
                <button type="button" className="tp-btn dn-change" onClick={() => { setEditing({ id: n.id, pick: pod }); setOpenId(n.id) }}>Change VAs</button>
              </span>
            </li>
          )
        })}</ul>
      )}

      <Drawer open={!!openN} onClose={() => { setOpenId(null); setEditing(null) }} title={openN ? shownPhone(openN.phone) : ''}
        sub={openN ? `${openN.label || 'No label'} · shows ${openN.caller_name} · ${openN.agents} ${openN.agents === 1 ? 'agent' : 'agents'}` : ''}>
        {openN && (
          <div className="dn-detail">
            <div className="tp-row dn-detail-state"><Chip tone={stateOf(openN)[0]}>{stateOf(openN)[1]}</Chip><span className="tp-grow" /><Switch on={openN.active} label={`${shownPhone(openN.phone)} on`} onChange={v => setActive(openN, v)} /></div>
            <div className="dn-today">
              <span className="dn-meter" aria-hidden="true"><i style={{ width: `${barOf(openN.today, pool.limit) * 100}%` }} className={isHot(openN, pool.limit) ? 'is-hot' : ''} /></span>
              <small><b className="tp-num">{openN.today}</b> of <span className="tp-num">{pool.limit}</span> calls today</small>
            </div>
            <h3 className="fx-h3">Calls this week</h3>
            <Chart compact height={130} legend={false} series={DN_SERIES}
              label={`${shownPhone(openN.phone)}, calls per day this week: ${(openN.days || []).map(d => `${dayName(d.day)} ${d.calls}`).join(', ')}`}
              data={(openN.days || []).map((d, k, all) => ({ name: dayName(d.day), today: k === all.length - 1, calls: d.calls }))} />
            <h3 className="fx-h3"><Users size={15} aria-hidden="true" />VAs on this number</h3>
            {editing?.id === openN.id ? podPicker(openN) : (
              <>
                <p className="tp-sub">Clients who call or text it reach these VAs first.</p>
                <ul className="tp-list dn-pod-list">{podOf(openN).length ? podOf(openN).map(id => <li key={id}><Avatar name={vaName(id)} /><b>{vaName(id)}</b></li>) : <li><small>Any free VA (no VAs picked)</small></li>}</ul>
                <button type="button" className="tp-btn fx-self" onClick={() => setEditing({ id: openN.id, pick: podOf(openN) })}>Change VAs</button>
              </>
            )}
          </div>
        )}
      </Drawer>

      <Drawer open={panel === 'add'} onClose={() => setPanel(null)} title="Add a number" sub="An Ohvara Twilio number. It shows as Deedstone Insurance.">
        <div className="dn-detail">
          <div className="dn-add">
            <Field label="Twilio number"><PhoneInput value={add.phone} onChange={d => setAdd({ ...add, phone: d })} /></Field>
            <Field label="Label"><input value={add.label} placeholder="Dallas 3" maxLength={60} onChange={e => setAdd({ ...add, label: e.target.value })} /></Field>
            {/* P952: reactivation numbers call only old-lead lists, so a complaint there never touches the agents' numbers */}
            <div className="tp-field"><span>Used for</span><Seg label="Used for" value={add.pool} onChange={v => setAdd({ ...add, pool: v })} options={[{ key: 'main', label: 'Agents and new leads' }, { key: 'reactivation', label: 'Reactivation calls' }]} /></div>
            <Field label="AI caller number id" hint="Only if the AI caller runs on Vapi"><input value={add.provider} maxLength={120} onChange={e => setAdd({ ...add, provider: e.target.value })} /></Field>
            <button type="button" className="tp-primary fx-accent" disabled={add.phone.length !== 10 || busy} onClick={addNumber}><Plus size={16} aria-hidden="true" />Add number</button>
          </div>
          {pool.agents_without_phone > 0 && <p className="dn-info"><Smartphone size={15} aria-hidden="true" /><span><b className="tp-num">{pool.agents_without_phone}</b> {pool.agents_without_phone === 1 ? 'agent hasn’t' : 'agents haven’t'} connected a phone yet, so they can’t Call through Deedstone.</span></p>}
          <p className="dn-info"><Link2 size={15} aria-hidden="true" /><span>In Twilio, set each number’s Voice URL (POST) to <code>{VOICE_URL}</code>. Calls in ring the VA who last talked with the caller, then this number’s VAs, then any free VA; if nobody can take it, a callback is booked. Clients reach our team, not the agent.</span></p>
          <h3 className="fx-h3 dn-h"><ListChecks size={16} aria-hidden="true" />So the name shows: Brayden and Jordan</h3>
          <ol className="dn-steps">{BRANDING_STEPS.map(([t, s2]) => <li key={t}><b>{t}</b><small>{s2}</small></li>)}</ol>
        </div>
      </Drawer>

      <Drawer open={panel === 'limits'} onClose={() => setPanel(null)} title="Limits and hold line" sub="How full a number gets, and what callers hear while every VA is busy">
        <div className="dn-detail">
          <div className="dn-limits">
            <Field label="Calls a day per number" hint="When a number would pass this, the next agent gets the next number"><input className="tp-num" inputMode="numeric" value={limit} onChange={e => setLimit(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="Calls a day, new agent" hint="Used until an agent has a week of calls"><input className="tp-num" inputMode="numeric" value={estimate} onChange={e => setEstimate(e.target.value.replace(/\D/g, ''))} /></Field>
            <button type="button" className="tp-primary fx-accent" disabled={!dirtyLimits || busy} onClick={saveLimits}>Save limits</button>
          </div>
          <HoldLineSettings />
        </div>
      </Drawer>
    </>
  )
}

function Head({ sample = false, children = null }) {
  return (
    <header className="fx-form-h dn-head">
      <div className="tp-row tp-wrap"><h2>Deedstone numbers</h2>{sample && <SampleTag>Sample</SampleTag>}{children && <span className="dn-head-acts">{children}</span>}</div>
      <p>Every call a client gets shows Deedstone Insurance. Each agent keeps one of these numbers, and 2 or 3 VAs answer each one. Click a number for its details. Agents never see this page.</p>
    </header>
  )
}
