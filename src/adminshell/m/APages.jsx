import { useCallback, useEffect, useState } from 'react'
import { Plus, Copy, Send, RotateCw, Power, Lock, ExternalLink, PhoneOutgoing, Check, CircleCheck, CircleX, CircleDashed, ShieldAlert, PauseCircle } from 'lucide-react'
import { useAdmSetup, useAdmActions, useAdmConnect, useAdmSource, useAdmVas, PLANS, PLAYBOOK, TRACKING } from '../data'
import { useNote } from '../../template/kit'
import { usd } from '../../template/motion'
import { useApp, SubPage, BottomSheet, Ini, Toggle, rise } from '../../template/m/AppKit'
import { PhoneInput } from '../../template/PhoneInput'
import { engineState } from '../engine'
import { useGhlRow } from '../useGhlRow'
import { CAMPAIGN_REQ, OWNERS, SETUP_STAGES, readiness, signupOf } from '../setup'
import { AGhlDetails } from './AGhlAudit'
import { DNC, INCIDENTS, COMPLAINTS, LEGAL, DATA_REQUESTS, DR_KEPT, daysLeft } from '../p879'
import { SAMPLE_POOL, CALLER_NAME, DEFAULT_LIMIT, DEFAULT_ESTIMATE, isHot, isFull, poolWarning, shownPhone, barOf, BRANDING_STEPS } from '../../lib/deedstonePool'
import { loadPool, saveNumber, savePoolSettings, loadPods, savePod, VOICE_URL } from '../../hooks/deedstoneAdmin'
import { POD_MIN, POD_MAX } from '../../lib/clientLine'

// P1002 — three desktop pages on the admin phone, the desktop's words and data: Deedstone numbers (screens/Numbers916),
// Compliance (screens/Compliance879) and the Setup tickets (screens/Setup.jsx). Same hooks and data helpers as the
// desktop; the phone's own look. The hold line (its music and the AI front desk)
// stays on the desktop; P1008 added the "What GoHighLevel set up" panels (AGhlAudit.jsx); Connect (view only) is the phone's page for what is plugged in.
const money = usd()
const cents = usd(true)
const first = n => String(n || '').split(' ')[0]
const Sym = ({ tone, Icon }) => <span className={`ma-sym is-${tone}`}><Icon size={16} aria-hidden="true" /></span>

// ── Deedstone numbers ───────────────────────────────────────────────────────────────────────────────────────────
// Every call a client gets shows Deedstone Insurance. Each agent keeps one of these numbers and 2 or 3 VAs answer each.
let samplePool = structuredClone(SAMPLE_POOL) // this visit's sample pool
const dayAbbr = d => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })

export function ADeedstone() {
  const src = useAdmSource()
  const note = useNote()
  const { data: vas = [] } = useAdmVas()
  const [pool, setPool] = useState(src === 'real' ? null : samplePool)
  const [limit, setLimit] = useState(String(pool?.limit ?? DEFAULT_LIMIT))
  const [estimate, setEstimate] = useState(String(pool?.estimate ?? DEFAULT_ESTIMATE))
  const [add, setAdd] = useState({ phone: '', label: '', provider: '', pool: 'main' })
  const [busy, setBusy] = useState(false)
  const [pods, setPods] = useState({})
  const [editing, setEditing] = useState(null) // { id, pick: [va ids] }
  const [openId, setOpenId] = useState(null)
  const [panel, setPanel] = useState(null) // 'add' | 'limits'
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
  const refresh = useCallback(async () => took(src === 'real' ? await loadPool() : { ...samplePool }), [src, took])
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
      if (samplePool.numbers.some(n => n.phone === phone)) throw new Error('That number is already in the pool.')
      samplePool = { ...samplePool, numbers: [...samplePool.numbers, { id: `n${Date.now()}`, phone, label: add.label || null, caller_name: CALLER_NAME, active: true, pool: add.pool, provider_number_id: add.provider || null, agents: 0, load: 0, today: 0, days: samplePool.numbers[0]?.days.map(d => ({ ...d, calls: 0 })) ?? [] }] }
    } else {
      await saveNumber({ phone: add.phone, label: add.label || null, provider_number_id: add.provider || null, pool: add.pool })
    }
    setAdd({ phone: '', label: '', provider: '', pool: 'main' })
    setPanel(null)
  }, src === 'real' ? 'Number added' : 'Number added (sample)')
  const setActive = (n, active) => run(async () => {
    if (src !== 'real') samplePool = { ...samplePool, numbers: samplePool.numbers.map(x => (x.id === n.id ? { ...x, active } : x)) }
    else await saveNumber({ id: n.id, phone: n.phone, label: n.label, caller_name: n.caller_name, provider_number_id: n.provider_number_id, active, pool: n.pool || 'main' })
  }, `${shownPhone(n.phone)} ${active ? 'on' : 'off'}${src === 'real' ? '' : ' (sample)'}`)
  const savePodPick = n => run(async () => {
    const pick = editing.pick
    if (pick.length < POD_MIN || pick.length > POD_MAX) throw new Error('Pick 2 or 3 VAs.')
    if (src !== 'real') samplePool = { ...samplePool, numbers: samplePool.numbers.map(x => (x.id === n.id ? { ...x, pod: pick } : x)) }
    else { await savePod(n.id, pick); setPods(await loadPods()) }
    setEditing(null)
  }, src === 'real' ? 'VAs saved' : 'VAs saved (sample)')
  const saveLimits = () => run(async () => {
    const l = Math.round(Number(limit)); const e = Math.round(Number(estimate))
    if (!(l >= 10 && l <= 2000) || !(e >= 1 && e <= 500)) throw new Error('Limit 10 to 2,000 calls; a new agent 1 to 500.')
    if (src !== 'real') samplePool = { ...samplePool, limit: l, estimate: e }
    else await savePoolSettings(l, e)
    setPanel(null)
  }, src === 'real' ? 'Limits saved' : 'Limits saved (sample)')

  const head = (
    <>
      <p className="ma-hint">Every call a client gets shows Deedstone Insurance. Each agent keeps one of these numbers, and 2 or 3 VAs answer each one. Agents never see this page.</p>
    </>
  )
  if (src === 'real' && !pool) return <SubPage title="Deedstone numbers" line="Loading…" big>{head}</SubPage>
  if (pool?.missing) {
    return <SubPage title="Deedstone numbers" big>{head}<p className="ma-empty is-glass">Not set up yet. The Deedstone numbers start once migration 255 is applied. Until then calls go out from the old single number.</p></SubPage>
  }
  const warn = poolWarning(pool)
  const dirtyLimits = String(pool.limit) !== limit || String(pool.estimate) !== estimate
  const openN = pool.numbers.find(x => x.id === openId) || null
  const stateOf = n => (!n.active ? ['stone', 'Off'] : isHot(n, pool.limit) ? ['apricot', 'Running hot'] : isFull(n, pool.limit, pool.estimate) ? ['sky', 'Full: no new agents'] : ['sage', 'Taking agents'])
  const close = () => { setOpenId(null); setEditing(null) }
  return (
    <SubPage title="Deedstone numbers" line={src !== 'real' ? 'Sample' : `${pool.numbers.length} numbers`} big>
      {head}
      <div className="am-twobtn ma-rise">
        <button type="button" className="ma-btn is-soft is-tall ma-press" onClick={() => setPanel('limits')}>Limits</button>
        <button type="button" className="ma-btn is-solid is-tall ma-press" onClick={() => setPanel('add')}><Plus size={18} aria-hidden="true" />Add a number</button>
      </div>
      {warn && <div className="ma-need is-apricot am-flag ma-rise" role="status"><div className="ma-need-top"><span className="ma-need-ic" aria-hidden="true"><ShieldAlert size={19} /></span><span className="ma-grow"><b>{warn.text}</b></span></div></div>}
      <div className="ma-glass ma-list ma-rise" style={rise(1)} aria-label="Deedstone numbers">
        {pool.numbers.map(n => {
          const pod = podOf(n)
          const [tone, word] = stateOf(n)
          return (
            <button key={n.id} type="button" className="ma-row am-numrow" onClick={() => { setEditing(null); setOpenId(n.id) }} aria-label={`${shownPhone(n.phone)}: details`}>
              <span className="ma-grow">
                <b className="tp-num">{shownPhone(n.phone)}</b>
                <small>{n.label || 'No label'}{n.pool === 'reactivation' ? ' · Reactivation' : ''}</small>
                <small>{pod.length ? pod.map(id => first(vaName(id))).join(', ') : 'No VAs picked'}</small>
              </span>
              <span className="am-numend"><span className={`ma-tag is-${tone}`}>{word}</span><small><b className="tp-num">{n.today}</b> calls today</small></span>
            </button>
          )
        })}
        {!pool.numbers.length && <p className="ma-empty">No numbers yet. Add Ohvara’s Twilio numbers with Add a number. Each shows as Deedstone Insurance.</p>}
      </div>

      <BottomSheet open={!!openN} onClose={close} label={openN ? shownPhone(openN.phone) : 'Number'} tall>
        {openN && (
          <>
            <p className="ma-sheet-t tp-num">{shownPhone(openN.phone)}</p>
            <p className="ma-sheet-s">{openN.label || 'No label'} · shows {openN.caller_name} · {openN.agents} {openN.agents === 1 ? 'agent' : 'agents'}</p>
            <div className="ma-glass ma-list am-sheetgap">
              <div className="ma-row"><span className="ma-grow"><b>{openN.active ? 'On' : 'Off'}</b><small>{stateOf(openN)[1]}</small></span><Toggle on={openN.active} label={`${shownPhone(openN.phone)} on`} onChange={v => setActive(openN, v)} disabled={busy} /></div>
            </div>
            <div className="ma-glass ma-pad am-sheetgap">
              <span className="va-bar am-vabar" aria-hidden="true"><i style={{ width: `${barOf(openN.today, pool.limit) * 100}%` }} /></span>
              <small className="am-meter"><b className="tp-num">{openN.today}</b> of <span className="tp-num">{pool.limit}</span> calls today</small>
            </div>
            <p className="ma-cap is-out">Calls this week</p>
            <div className="ma-glass ma-pad am-weekbars" role="img" aria-label={`${shownPhone(openN.phone)}, calls per day this week: ${(openN.days || []).map(d => `${dayAbbr(d.day)} ${d.calls}`).join(', ')}`}>
              {(openN.days || []).map((d, k, all) => (
                <span key={d.day}><i style={{ height: `${Math.max(6, barOf(d.calls, pool.limit) * 100)}%` }} className={k === all.length - 1 ? 'is-now' : ''} /><small>{dayAbbr(d.day)}</small></span>
              ))}
            </div>
            <p className="ma-cap is-out">VAs on this number</p>
            {editing?.id === openN.id ? (
              <>
                <div className="ma-glass ma-list">
                  {vas.map(v => {
                    const on = editing.pick.includes(v.id)
                    return (
                      <button key={v.id} type="button" className={`ma-row ma-pick${on ? ' is-on' : ''}`} aria-pressed={on} disabled={!on && editing.pick.length >= POD_MAX}
                        onClick={() => setEditing({ ...editing, pick: on ? editing.pick.filter(x => x !== v.id) : [...editing.pick, v.id] })}>
                        <Ini person name={v.name} size={40} /><span className="ma-grow"><b>{v.name}</b></span><span className={`am-tick${on ? ' is-on' : ''}`} aria-hidden="true">{on ? '✓' : ''}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="ma-hint">Pick {POD_MIN} or {POD_MAX} VAs.</p>
                <div className="am-twobtn">
                  <button type="button" className="ma-btn is-soft is-tall ma-press" onClick={() => setEditing(null)}>Cancel</button>
                  <button type="button" className="ma-btn is-solid is-tall ma-press" disabled={busy || editing.pick.length < POD_MIN} onClick={() => savePodPick(openN)}>Save VAs</button>
                </div>
              </>
            ) : (
              <>
                <p className="ma-hint">Clients who call or text it reach these VAs first.</p>
                <div className="ma-glass ma-list">
                  {podOf(openN).map(id => <div key={id} className="ma-row"><Ini person name={vaName(id)} size={40} /><span className="ma-grow"><b>{vaName(id)}</b></span></div>)}
                  {!podOf(openN).length && <p className="ma-empty">Any free VA (no VAs picked)</p>}
                </div>
                <button type="button" className="ma-btn is-soft is-tall ma-press am-wide" onClick={() => setEditing({ id: openN.id, pick: podOf(openN) })}>Change VAs</button>
              </>
            )}
          </>
        )}
      </BottomSheet>

      <BottomSheet open={panel === 'add'} onClose={() => setPanel(null)} label="Add a number" tall>
        <p className="ma-sheet-t">Add a number</p>
        <p className="ma-sheet-s">An Ohvara Twilio number. It shows as Deedstone Insurance.</p>
        <label className="va-field"><span>Twilio number</span><PhoneInput value={add.phone} onChange={d => setAdd({ ...add, phone: d })} /></label>
        <label className="va-field"><span>Label</span><input value={add.label} placeholder="Dallas 3" maxLength={60} onChange={e => setAdd({ ...add, label: e.target.value })} /></label>
        <p className="ma-cap is-out">Used for</p>
        <div className="ma-seg am-seg" role="radiogroup" aria-label="Used for">
          {[['main', 'Agents and new leads'], ['reactivation', 'Reactivation calls']].map(([k, w]) => <button key={k} type="button" role="radio" aria-checked={add.pool === k} className={`is-sky${add.pool === k ? ' is-on' : ''}`} onClick={() => setAdd({ ...add, pool: k })}>{w}</button>)}
        </div>
        <label className="va-field"><span>AI caller number id (only if the AI caller runs on Vapi)</span><input value={add.provider} maxLength={120} onChange={e => setAdd({ ...add, provider: e.target.value })} /></label>
        <button type="button" className="ma-btn is-solid is-tall ma-press am-wide" disabled={add.phone.length !== 10 || busy} onClick={addNumber}><Plus size={18} aria-hidden="true" />Add number</button>
        {pool.agents_without_phone > 0 && <p className="ma-hint"><b className="tp-num">{pool.agents_without_phone}</b> {pool.agents_without_phone === 1 ? 'agent hasn’t' : 'agents haven’t'} connected a phone yet, so they can’t Call through Deedstone.</p>}
        <p className="ma-hint">In Twilio, set each number’s Voice URL (POST) to <code>{VOICE_URL}</code>. Calls in ring the VA who last talked with the caller, then this number’s VAs, then any free VA; if nobody can take it, a callback is booked. Clients reach our team, not the agent.</p>
        <p className="ma-cap is-out">So the name shows: Brayden and Jordan</p>
        <ol className="am-steps">{BRANDING_STEPS.map(([t, s2]) => <li key={t}><b>{t}</b><small>{s2}</small></li>)}</ol>
      </BottomSheet>

      <BottomSheet open={panel === 'limits'} onClose={() => setPanel(null)} label="Limits" tall>
        <p className="ma-sheet-t">Limits</p>
        <p className="ma-sheet-s">How full a number gets. The hold line (what callers hear while every VA is busy) is on the desktop.</p>
        <label className="va-field"><span>Calls a day per number</span><input className="tp-num" inputMode="numeric" value={limit} onChange={e => setLimit(e.target.value.replace(/\D/g, ''))} /></label>
        <p className="ma-hint">When a number would pass this, the next agent gets the next number</p>
        <label className="va-field"><span>Calls a day, new agent</span><input className="tp-num" inputMode="numeric" value={estimate} onChange={e => setEstimate(e.target.value.replace(/\D/g, ''))} /></label>
        <p className="ma-hint">Used until an agent has a week of calls</p>
        <button type="button" className="ma-btn is-solid is-tall ma-press am-wide" disabled={!dirtyLimits || busy} onClick={saveLimits}>Save limits</button>
      </BottomSheet>
    </SubPage>
  )
}

// ── Compliance ──────────────────────────────────────────────────────────────────────────────────────────────────
// Kept 5 years, admins only: the do-not-call list, the licensed line, complaints, legal holds and data requests.
function DoNotCall() {
  return (
    <>
      <div className="ma-glass ma-list ma-rise">
        {DNC.map(d => (
          <div key={d.id} className="ma-row am-reqrow"><span className="ma-grow"><b className="tp-num">{d.phone} · {d.name}</b><small>{d.how} · {d.by} · {d.at} · kept to {d.keepUntil}</small></span><span className="ma-tag">Every agent and queue</span></div>
        ))}
      </div>
      <p className="ma-note">Numbers on this list are never called or texted. If they call in, the VA still answers.</p>
    </>
  )
}
function Incidents() {
  const note = useNote()
  const [rows, setRows] = useState(INCIDENTS)
  return (
    <div className="ma-glass ma-list ma-rise">
      {rows.map(r => (
        <div key={r.id} className="ma-row am-reqrow">
          <span className="ma-grow"><b>{r.call} · {r.va}</b><small>{r.when} · said: {r.said}</small><small>Fix: {r.fix}</small></span>
          {r.callback ? <span className="ma-tag is-sage">Agent called back</span> : <button type="button" className="ma-nb ma-press am-nb" onClick={() => { setRows(x => x.map(y => (y.id === r.id ? { ...y, callback: true } : y))); note('Marked: the agent called back') }}>Agent called back</button>}
        </div>
      ))}
    </div>
  )
}
function Complaints() {
  const causes = COMPLAINTS.reduce((m, c) => ({ ...m, [c.cause]: (m[c.cause] || 0) + 1 }), {})
  return (
    <>
      <div className="ma-glass ma-list ma-rise">
        {COMPLAINTS.map(c => (
          <div key={c.id} className="ma-row am-reqrow">
            <span className="ma-grow"><b>{c.who} · {c.channel}</b><small>{c.summary} · owner {c.owner} · due {c.due}</small><small>Cause: {c.cause}{c.resolution ? ` · ${c.resolution}` : ''}</small></span>
            <span className={`ma-tag is-${c.status === 'open' ? 'apricot' : 'sage'}`}>{c.status === 'open' ? 'Open' : 'Resolved'}</span>
          </div>
        ))}
      </div>
      <p className="ma-note">Causes this month: {Object.entries(causes).map(([k, n]) => `${k} (${n})`).join(' · ')}</p>
    </>
  )
}
function Legal() {
  const note = useNote()
  return (
    <div className="ma-glass ma-list ma-rise">
      {LEGAL.map(l => (
        <div key={l.id} className="ma-row am-reqrow">
          <span className="ma-grow"><b>{l.who}</b><small>{l.what} · opened {l.opened} · {l.items} items</small>{l.hold && <small className="am-warn">Legal hold: nothing on this person can be deleted</small>}</span>
          <button type="button" className="ma-nb ma-press am-nb" onClick={() => note('Sample: the export (calls, texts, consent proof, timeline) is built when the backend is wired')}>Export evidence</button>
        </div>
      ))}
    </div>
  )
}
function DataRequests() {
  const note = useNote()
  const [rows, setRows] = useState(DATA_REQUESTS)
  const set = (id, o) => setRows(x => x.map(y => (y.id === id ? { ...y, ...o } : y)))
  return (
    <>
      <div className="ma-glass ma-list ma-rise">
        {rows.map(r => {
          const left = daysLeft(r.due)
          return (
            <div key={r.id} className="ma-row am-reqrow">
              <span className="ma-grow"><b>{r.who} · {r.kind === 'delete' ? 'Delete my data' : 'Send me my data'}</b><small>Asked {r.asked} · due {r.due}{left != null ? ` · ${left} days left` : ''}</small>
                <small>{r.verified ? 'Identity checked by calling back the number on file' : 'Call back the number on file to check who they are'}{r.outcome ? ` · ${r.outcome}` : ''}</small></span>
              {!r.verified && <button type="button" className="ma-nb ma-press am-nb" onClick={() => { set(r.id, { verified: true }); note('Identity checked and logged') }}>Checked by call-back</button>}
              {r.verified && !r.outcome && <button type="button" className="ma-nb ma-press am-nb is-solidnb" onClick={() => { set(r.id, { outcome: r.kind === 'delete' ? 'Deleted, except what the law keeps' : 'Sent' }); note('Done and logged') }}>{r.kind === 'delete' ? 'Delete' : 'Send'}</button>}
              {r.outcome && <span className="ma-tag is-sage">Done</span>}
            </div>
          )
        })}
      </div>
      <p className="ma-note">A delete keeps: {DR_KEPT.join(', ')}. Anything under a legal hold waits until the hold ends.</p>
    </>
  )
}
const PARTS = [['dnc', 'Do not call', DoNotCall], ['incidents', 'Licensed line', Incidents], ['complaints', 'Complaints', Complaints], ['legal', 'Legal holds', Legal], ['data', 'Data requests', DataRequests]]
export function ACompliance() {
  const [part, setPart] = useState('dnc')
  const real = useAdmSource() === 'real' // P1017: every list below is sample (p879.js); real has none logged yet
  const P = PARTS.find(p => p[0] === part)[2]
  return (
    <SubPage title="Compliance" line="Kept 5 years. Admins only." big>
      <div className="ma-chips am-tabs ma-rise" role="tablist" aria-label="Compliance">
        {PARTS.map(([k, w]) => <button key={k} type="button" role="tab" aria-selected={part === k} className={`ma-fchip am-fchip${part === k ? ' is-on' : ''}`} onClick={() => setPart(k)}>{w}</button>)}
      </div>
      {real
        ? <div className="ma-glass ma-list ma-rise"><p className="ma-empty">Nothing logged yet. Do-not-call numbers, licensed-line notes, complaints, legal holds and data requests show here once they're logged.</p></div>
        : <P key={part} />}
    </SubPage>
  )
}

// ── Setup tickets ───────────────────────────────────────────────────────────────────────────────────────────────
// One ticket per agent who has paid (setup fee + first days of lead spend): Meta campaign from the template with their
// agent ID, every launch check passes, Turn campaign on, done. Ads Manager and GoHighLevel open in a new tab.
const STAGE_TONE = { mute: 'stone', blue: 'sky', teal: 'butter', green: 'sage' }
const OWNER_TONE = { mute: 'stone', blue: 'sky', teal: 'butter', green: 'sage' }
const LEAD_WORD = { live: 'Appointments + live transfers', appointment: 'Appointments only' }
const planLine = c => [c.states.length ? c.states.join(', ') : 'States not set', c.plan ? PLANS[c.plan].label : 'No plan', c.spend ? `${money(c.spend)} a day` : null].filter(Boolean).join(' · ')
const EXTERNAL = [
  { key: 'meta', label: 'Open Meta Ads Manager', href: 'https://adsmanager.facebook.com/adsmanager/manage/campaigns' },
  { key: 'ghl', label: 'Open GoHighLevel', href: 'https://app.gohighlevel.com/' },
]
const copyText = (text, note, what) => { try { navigator.clipboard?.writeText(text) } catch { /* no clipboard: the toast still says it */ } note(`${what} copied`) }

function Readiness() {
  const app = useApp()
  const row = useGhlRow()
  const { data: c } = useAdmConnect()
  const [peek, setPeek] = useState(false)
  const st = engineState(row)
  const on = st.on || peek
  const sync = st.on ? st.line.replace(/^Connected · last sync /, '') : '5 min ago'
  const items = readiness(c, { on, sync, workflows: PLAYBOOK, tracking: TRACKING })
  const ready = items.filter(x => x.tone === 'green').length
  return (
    <>
      <div className="ma-h2 ma-rise" style={rise(5)}><h2>System readiness</h2><span>{on ? `${ready} of ${items.length} ready` : ''}</span></div>
      <p className="ma-hint">{on ? 'What GoHighLevel runs for every client' : 'What GoHighLevel runs for every client. Nothing connected yet: Jordan connects GoHighLevel on Connect. Once it is on, each line below turns green with its last sync.'}</p>
      {!on && (
        <div className="am-twobtn">
          <button type="button" className="ma-btn is-solid is-tall ma-press" onClick={() => app.openSub('setup')}>Go to Connect</button>
          <button type="button" className="ma-btn is-soft is-tall ma-press" onClick={() => setPeek(true)}>See a sample</button>
        </div>
      )}
      <div className="ma-glass ma-list ma-rise" style={rise(5)}>
        {items.map(x => (
          <div key={x.key} className="ma-row"><span className="ma-grow"><b>{x.label}</b><small>{x.sub}</small></span><span className={`ma-tag is-${x.tone === 'green' ? 'sage' : x.tone === 'blue' ? 'sky' : 'stone'}`}>{x.word}</span></div>
        ))}
      </div>
      {peek && !st.on && <button type="button" className="ma-textbtn am-wide" onClick={() => setPeek(false)}>Back to the real state</button>}
      {on && <AGhlDetails row={row} sample={!st.on} />}
    </>
  )
}

export function ATickets() {
  const app = useApp()
  const { data: list } = useAdmSetup()
  return (
    <SubPage title="Setup" line="Paid agents to live" big>
      <p className="ma-hint">{list.filter(c => c.stage !== 'live').length} open tickets · {list.filter(c => c.stage === 'live').length} done this week · agents show here once they've paid</p>
      {SETUP_STAGES.map((b, i) => {
        const rows = list.filter(c => c.stage === b.key)
        return (
          <section key={b.key} className="ma-rise" style={rise(i)} aria-label={`${b.label}, ${rows.length}`}>
            <div className="ma-h2"><h2>{b.label}</h2><span>{rows.length}</span></div>
            <div className="ma-glass ma-list">
              {rows.map(c => {
                const owner = c.owner && OWNERS[c.owner]
                return (
                  <button key={c.id} type="button" className="ma-row am-tkrow" onClick={() => app.openSub('ticket', { t: c.id })} aria-label={`Open ${c.name}'s ticket`}>
                    <Ini person name={c.name} size={40} />
                    <span className="ma-grow">
                      <b>{c.name}</b><small>{planLine(c)}</small>
                      <span className={`va-bar am-tkbar is-${STAGE_TONE[b.tone]}`} aria-hidden="true"><i style={{ width: `${c.pct}%` }} /></span>
                      <small className={c.warn ? 'am-warn' : ''}>{c.blocker || 'Every step done'} · {c.pct}%</small>
                    </span>
                    <span className={`ma-tag is-${owner ? OWNER_TONE[owner.tone] : 'sage'}`}>{owner ? owner.label : 'Done'}</span>
                  </button>
                )
              })}
              {!rows.length && <p className="ma-empty">{b.empty}</p>}
            </div>
          </section>
        )
      })}
      <Readiness />
    </SubPage>
  )
}

// A ticket: their sign-up (read-only), the checklist, the launch checks and what's sent to GoHighLevel, how their leads
// find them, the tools that open in a new tab, and the history.
function CampaignRequest({ c }) {
  const { requestCampaign } = useAdmActions()
  const note = useNote()
  const [tone, word] = CAMPAIGN_REQ[c.req]
  const send = () => {
    if (!requestCampaign) { note('Create campaign goes through GoHighLevel once it is connected'); return }
    requestCampaign(c.id)
    note(`Create campaign sent for ${c.name} (sample: GoHighLevel answers in a moment, nothing is sent)`)
  }
  return (
    <div className="ma-row am-reqrow">
      <span className="ma-grow"><b>{c.campaignReq?.name || `Deedstone · ${c.name} · ${c.agentRef}`}</b>
        <small>{c.req === 'none' ? 'From the template, with their agent ID in the ad link' : `${word}${c.campaignReq?.at ? ` · ${c.campaignReq.at}` : ''}`}</small></span>
      {['none', 'failed'].includes(c.req)
        ? <button type="button" className="ma-nb ma-press am-nb is-solidnb" onClick={send}>{c.req === 'failed' ? <RotateCw size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}{c.req === 'failed' ? 'Try again' : 'Create campaign'}</button>
        : <span className={`ma-tag is-${OWNER_TONE[tone] || 'stone'}`}>{word}</span>}
    </div>
  )
}

function LaunchChecks({ c }) {
  const { turnCampaignOn, placeTestCall } = useAdmActions()
  const note = useNote()
  const { list, ok, passed } = c.checks
  const on = c.done.includes('on') && ok
  const name = first(c.name)
  const turnOn = async () => {
    if (!turnCampaignOn) { note('Turning a campaign on goes through GoHighLevel once it is connected'); return }
    const r = await turnCampaignOn(c.id)
    if (!c.real) note(`${c.name}'s campaign is on (sample: nothing is sent)`)
    else if (r) note(`${c.name}'s campaign is on. GoHighLevel gets it within a minute.`)
  }
  const testCall = async () => {
    const r = await placeTestCall?.(c.id)
    if (!c.real) note(`AI test call placed to ${c.name}'s own number (sample)`)
    else if (r) note(r.data?.already ? 'The test call is already logged' : `Asked ${r.data?.asked ?? 0} VA${r.data?.asked === 1 ? '' : 's'} to call ${name}'s test lead now`)
  }
  return (
    <>
      <div className="ma-h2 ma-rise" style={rise(3)}><h2>Launch checks</h2><span>{passed} of {list.length} pass</span></div>
      {c.paused && <div className="ma-need is-apricot am-flag"><div className="ma-need-top"><span className="ma-need-ic" aria-hidden="true"><PauseCircle size={19} /></span><span className="ma-grow"><b>Campaign paused, ticket reopened.</b><small>{c.checks.failed[0].why} It turns back on only once every check passes again.</small></span></div></div>}
      <div className="ma-glass ma-list ma-rise" style={rise(3)} aria-label="Launch checks">
        {list.map(x => (
          <div key={x.key} className="ma-row am-reqrow">
            {x.ok ? <CircleCheck size={20} className="am-okic" aria-label="Passes" /> : <CircleX size={20} className="am-badic" aria-label="Fails" />}
            <span className="ma-grow"><b>{x.label}</b><small>{x.text}{x.key === 'testCall' && !x.ok && c.launch?.testCallAsked ? ` VAs asked ${c.launch.testCallAsked}.` : ''}</small></span>
            {x.key === 'testCall' && !x.ok && c.launch?.testLead && <button type="button" className="ma-nb ma-press am-nb" onClick={testCall}><PhoneOutgoing size={15} aria-hidden="true" />Place test call</button>}
          </div>
        ))}
      </div>
      {on
        ? <p className="ma-note"><Power size={14} aria-hidden="true" /> Campaign on. It pauses by itself if a check breaks.</p>
        : (
          <>
            <button type="button" className="ma-btn is-solid is-tall ma-press am-wide" disabled={!c.canLaunch} aria-disabled={!c.canLaunch} onClick={turnOn}>{c.canLaunch ? <Power size={18} aria-hidden="true" /> : <Lock size={18} aria-hidden="true" />}Turn campaign on</button>
            {!c.canLaunch && <p className="ma-hint"><Lock size={13} aria-hidden="true" /> {ok ? 'Create their campaign first.' : `Locked until all ${list.length} checks pass. Admins can't skip one.`}</p>}
          </>
        )}
    </>
  )
}

export function ATicket({ id }) {
  const { data: list } = useAdmSetup()
  const { markLive } = useAdmActions()
  const note = useNote()
  const c = list.find(x => x.id === id)
  if (!c) return <SubPage title="Setup ticket"><p className="ma-empty">There's no Setup ticket for this agent. Agents show here once they've paid.</p></SubPage>
  const stage = SETUP_STAGES.find(s => s.key === c.stage)
  const owner = c.owner ? OWNERS[c.owner] : null
  const s = signupOf(c, { plans: PLANS })
  const paidOn = c.signup?.paidShort || c.paid?.short || c.paid?.on || c.since
  const foot = <button type="button" className="ma-btn is-solid is-grow is-tall ma-press" disabled={!c.canLive} onClick={() => { markLive(c.id); note(`${c.name}'s ticket is done`) }}><Check size={18} aria-hidden="true" />Mark done</button>
  return (
    <SubPage title={c.name} line={`Setup ticket · paid ${paidOn}`} foot={foot} big>
      <div className={`ma-hero is-${STAGE_TONE[stage.tone]} ma-rise`}>
        <div className="ma-hero-top"><span>{stage.label}</span><span className="ma-tag">{owner ? `Next: ${owner.label}` : 'Done'}</span></div>
        <b>{c.count} of {c.total} steps</b>
        <span className="ma-hero-place">{c.city ? `${c.city}, ${c.state} · ` : ''}{planLine(c)} · {LEAD_WORD[c.lead] || LEAD_WORD.appointment}</span>
      </div>
      {c.blocker && <div className={`ma-need is-${c.warn ? 'apricot' : 'butter'} am-flag ma-rise`} style={rise(1)}><div className="ma-need-top"><span className="ma-grow"><b>{c.blocker}</b></span>{owner && <span className="ma-tag">{owner.label}</span>}</div></div>}

      <div className="ma-h2 ma-rise" style={rise(1)}><h2>Their sign-up</h2></div>
      <p className="ma-hint">What they picked and paid for. Read-only.</p>
      <div className="ma-glass ma-pad va-facts is-glass ma-rise" style={rise(1)} data-testid="adm-signup">
        <span><small>Agent</small><b>{c.name}</b></span>
        <span><small>Plan</small><b>{s.plan}</b></span>
        <span className="is-wide"><small>Products</small><b>{s.products.map(x => x.label).join(' · ')} · Leads paid: {s.via}</b></span>
        <span><small>Daily spend</small><b><span className="tp-money">{money(s.daily)}</span> a day</b></span>
        <span><small>Paid</small><b>{s.paid ? <>On {s.paid.short} · <span className="tp-money">{cents(s.paid.total)}</span></> : s.paidOn ? `On ${s.paidOn}` : 'Not yet'}</b></span>
        {s.paid && <span className="is-wide"><small>What was paid</small><b>Setup <span className="tp-money">{money(s.paid.setup)}</span> · first month <span className="tp-money">{money(s.paid.plan)}</span> · first 2 days of leads <span className="tp-money">{cents(s.paid.leads)}</span></b></span>}
        <span className="is-wide"><small>Licensed states</small><b>{s.states.length ? s.states.join(', ') : 'None picked'}</b></span>
        <span><small>Hours</small><b>{s.hours || 'Not set'}</b></span>
        <span><small>Time zone</small><b>{s.tz || 'Not set'}</b></span>
        <span><small>Live transfers</small><b>{s.live ? 'Yes' : 'No, appointments only'}</b></span>
      </div>

      <div className="ma-h2 ma-rise" style={rise(2)}><h2>Checklist</h2><span>{c.steps.filter(x => x.done).length} of {c.steps.length} done</span></div>
      <div className="ma-glass ma-list ma-rise" style={rise(2)}>
        {c.steps.map(x => (
          <div key={x.key} className="ma-row">
            {x.done ? <Check size={18} className="am-okic" aria-hidden="true" /> : <CircleDashed size={18} aria-hidden="true" />}
            <span className="ma-grow"><b>{x.label}</b>{!x.done && c.next?.key === x.key && <small>Next step</small>}{x.key === 'signup' && x.done && <small>Paid {paidOn}</small>}</span>
          </div>
        ))}
        <CampaignRequest c={c} />
      </div>

      {c.done.includes('campaign') && <LaunchChecks c={c} />}

      {c.push?.length > 0 && (
        <>
          <div className="ma-h2 ma-rise" style={rise(3)}><h2>Campaign on/off in GoHighLevel</h2></div>
          <p className="ma-hint">The last send of each side. A failed send retries by itself.</p>
          <div className="ma-glass ma-list ma-rise" style={rise(3)}>
            {c.push.map(p => <div key={p.side} className="ma-row"><span className="ma-grow"><b>{p.side}: {p.what}</b><small>{p.text}</small></span><span className={`ma-tag is-${p.tone === 'green' ? 'sage' : p.tone === 'warn' ? 'apricot' : 'sky'}`}>{p.tone === 'green' ? 'Sent' : p.tone === 'warn' ? 'Failing' : 'Waiting'}</span></div>)}
          </div>
        </>
      )}

      <div className="ma-h2 ma-rise" style={rise(4)}><h2>How their leads find them</h2></div>
      <p className="ma-hint">The agent ID rides hidden in the ad link; the Meta campaign ID is the backup. Either one matches a lead to them.</p>
      <div className="ma-glass ma-list ma-rise" style={rise(4)}>
        <div className="ma-row"><span className="ma-grow"><small>Agent ID</small><b className="tp-num">{c.agentRef}</b></span><button type="button" className="ma-nb ma-press am-nb" onClick={() => copyText(c.agentRef, note, 'Agent ID')}><Copy size={15} aria-hidden="true" />Copy</button></div>
        <div className="ma-row"><span className="ma-grow"><small>Meta campaign ID</small><b className="tp-num">{c.launch?.campaignId || 'Not saved yet'}</b></span>{c.launch?.campaignId && <button type="button" className="ma-nb ma-press am-nb" onClick={() => copyText(c.launch.campaignId, note, 'Campaign ID')}><Copy size={15} aria-hidden="true" />Copy</button>}</div>
      </div>

      <div className="ma-h2 ma-rise" style={rise(4)}><h2>Open in a new tab</h2></div>
      <p className="ma-hint">Meta Ads Manager and GoHighLevel don't open inside other sites.</p>
      <div className="ma-glass ma-list ma-rise" style={rise(4)}>
        {EXTERNAL.map(x => <a key={x.key} className="ma-row" href={x.href} target="_blank" rel="noopener noreferrer"><Sym tone="stone" Icon={ExternalLink} /><span className="ma-grow"><b>{x.label}</b></span></a>)}
      </div>

      <div className="ma-h2 ma-rise" style={rise(5)}><h2>History</h2></div>
      <div className="ma-glass ma-list ma-rise" style={rise(5)}>
        {c.log.map((l, i) => <div key={`${l.at}-${i}`} className="ma-row"><span className="ma-grow"><b>{l.what}</b><small>{l.at} · {l.who}</small></span></div>)}
        {!c.log.length && <p className="ma-empty">No changes yet.</p>}
      </div>
    </SubPage>
  )
}
