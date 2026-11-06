import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { KeyRound, MapPin, Workflow, MessageSquareText, Megaphone, Globe, Plus, Check, CircleDashed, Plug, ShieldCheck, Eye, EyeOff, Info, PhoneForwarded, Link2, Copy, ArrowRight, Unplug } from 'lucide-react'
import { useAdmConnect, useAdmActions, useAdmViewAs, useAdmAgents, GHL_WORKFLOWS, PLAYBOOK, TRACKING, plugged } from '../data'
import { Chip, Field, PillTabs, SampleTag, Switch, useNote, useAccount } from '../../template/kit'
import { GHL_EVENTS } from '../../lib/ghlStatus'
import { formFromSettings, checkForm, sameForm, testConnection, connectStatus, ghlPlugged } from '../../lib/ghlConnect'
import { useGhlConnect } from '../../lib/ghlConnectHooks'
import { usd } from '../../template/motion'
import { Dropdown, DField, Tile, EngineSlot } from '../kit'
import { engineState } from '../engine'
import { AD_WORD, CAMPAIGN_WORD } from '../words'

// P864 — Connect left the top tabs for the rail (like Messages) and has two tabs: Setup (what GoHighLevel set up for us,
// at a glance; a clean empty state until it is connected) and Connect (the form below: key, location, workflow IDs).
// P849 — Connect: where Jordan (the partner login) plugs in what Ohvara doesn't have: GoHighLevel (API key, location,
// which workflow runs for a new lead, a reminder, a no-show), the texting number and its campaign status, the ad
// account and weekly budget for each lead type, and the lead sources (his mortgage-protection domain and forms).
// UI only: saving keeps it in the page and says it connects when the bridge is live (P850). A key field is
// write-only: once saved the page keeps only "saved" and the last four, and never shows the key back.
const money = usd()
const WAIT = 'Saved. It will connect when the bridge is live (P850).'
const NONE = { value: '', label: 'No workflow' }

// Live (signed in as an admin): the real settings row, the key sent to the secret store, the bridge's status.
// Test connection waits until the bridge has run once; it then re-reads the last run (nothing goes to GoHighLevel).
function GhlLiveTile({ ghl }) {
  const note = useNote()
  const { settings: sq, keySaved: kq, save, recheck } = ghl
  const row = sq.data
  const loading = sq.isLoading
  const unavailable = !loading && row === null
  const base = formFromSettings(row)
  const [form, setForm] = useState(null)
  const [key, setKey] = useState('')
  const [peek, setPeek] = useState(false)
  const [busy, setBusy] = useState(false)
  const cur = form ?? base
  const errors = checkForm(cur)
  const idsChanged = !sameForm(cur, base)
  const dirty = idsChanged || !!key.trim()
  const status = loading ? { label: 'Checking…', tone: 'mute', line: '' } : unavailable ? { label: 'Not connected yet', tone: 'mute', line: 'Goes live with the GHL switch-on' } : connectStatus(row)
  const test = testConnection(row, kq.data)
  const keySaved = kq.data === true
  const put = patch => setForm({ ...cur, ...patch })
  const canSave = dirty && !busy && !unavailable && !loading && (!idsChanged || Object.keys(errors).length === 0) && (idsChanged || !!key.trim())
  const doSave = async () => {
    setBusy(true)
    const typed = key
    setKey(''); setPeek(false) // the key leaves the form the moment Save is pressed
    const r = await save({ form: cur, key: typed })
    setBusy(false)
    if (r.settings && !r.settings.ok) { note(r.settings.error); if (typed.trim()) note('The key was not sent. Type it again after fixing this.'); return }
    if (r.key && !r.key.ok) { note(`${r.key.error} The settings were saved.`); setForm(null); return }
    setForm(null)
    note(r.key ? 'Saved. The key is stored and will not be shown again.' : 'Saved the GoHighLevel settings')
  }
  const doTest = async () => {
    setBusy(true)
    const next = await recheck()
    setBusy(false)
    if (!next) return note('Could not read the bridge status.')
    const s = connectStatus(next)
    note(s.key === 'connected' ? `Connected. ${s.line}.` : `${s.label}. ${s.line}`)
  }
  return (
    <Tile className="adm-con" i={0} title="GoHighLevel" sub={loading ? 'Loading…' : status.line || 'Not set up yet'} aside={<Chip tone={status.tone}>{status.label}</Chip>}>
      {unavailable && <p className="adm-note">Saving is off until then.</p>}
      <div className="tp-field"><span>API key</span>
        {keySaved && !key && <p className="adm-saved"><ShieldCheck size={14} aria-hidden="true" />A key is saved. It is never shown again. Type a new one to replace it.</p>}
        <div className="adm-keyrow">
          <input type={peek ? 'text' : 'password'} autoComplete="off" spellCheck={false} aria-label="API key" placeholder={keySaved ? 'Paste a new key to replace it' : 'Paste the location API key'} value={key} disabled={unavailable || busy} onChange={e => setKey(e.target.value)} />
          <button type="button" className="fx-ib" aria-label={peek ? 'Hide what you typed' : 'Show what you typed'} disabled={!key} onClick={() => setPeek(x => !x)}>{peek ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>
        <small>Write-only: it goes to the secret store and is never shown back.</small>
      </div>
      <Field label="Location ID" hint={form && errors.locationId ? errors.locationId : undefined}><input value={cur.locationId} disabled={unavailable || busy} spellCheck={false} onChange={e => put({ locationId: e.target.value })} placeholder="Paste the location ID" /></Field>
      <div className="adm-wfs" role="group" aria-label="Workflows">
        {GHL_EVENTS.map(e => (
          <div key={e.key}>
            <Field label={e.label}>
              <input value={cur.workflows[e.key]} disabled={unavailable || busy} spellCheck={false} aria-label={`Workflow ID for ${e.label.toLowerCase()}`} aria-invalid={!!errors[e.key]} onChange={ev => put({ workflows: { ...cur.workflows, [e.key]: ev.target.value } })} placeholder="Workflow ID (optional)" />
            </Field>
            {errors[e.key] && <small className="adm-err">{errors[e.key]}</small>}
          </div>
        ))}
      </div>
      <small className="adm-note" id="ghl-test-note">{test.note}</small>
      <footer className="fx-form-f">
        <button type="button" className="tp-btn ov-ghost" disabled={!test.enabled || busy} aria-describedby="ghl-test-note" onClick={doTest}><Plug size={15} />Test connection</button>
        <button type="button" className="tp-btn ov-ghost" disabled={!dirty || busy} onClick={() => { setKey(''); setPeek(false); setForm(null) }}>Discard</button>
        <button type="button" className="tp-primary fx-accent" disabled={!canSave} onClick={doSave}><KeyRound size={15} />Save</button>
      </footer>
    </Tile>
  )
}

function GhlTile() {
  const { data: c } = useAdmConnect()
  const { saveConnect } = useAdmActions()
  const note = useNote()
  const [key, setKey] = useState('')
  const [peek, setPeek] = useState(false)
  const [loc, setLoc] = useState(c.ghl.locationId)
  const [wf, setWf] = useState(c.ghl.workflows)
  const dirty = key.trim() || loc !== c.ghl.locationId || JSON.stringify(wf) !== JSON.stringify(c.ghl.workflows)
  const save = () => {
    const k = key.trim()
    // Only "saved" and the last four leave this form; the key itself is dropped here.
    saveConnect('ghl', { locationId: loc.trim(), workflows: wf, saved: 'Just now', ...(k ? { keySaved: true, keyEnd: k.slice(-4), syncedAt: new Date().toISOString() } : {}) }, k ? 'Saved the GoHighLevel key' : 'Saved GoHighLevel settings')
    setKey(''); setPeek(false)
    note(WAIT)
  }
  const opts = [NONE, ...GHL_WORKFLOWS.map(w => ({ value: w, label: w }))]
  return (
    <Tile className="adm-con" i={0} title="GoHighLevel" sub={c.ghl.saved ? `Last saved ${c.ghl.saved}` : 'Not set up yet'} aside={<Chip tone="blue">Waits for the bridge</Chip>}>
      <div className="tp-field"><span>API key</span>
        {c.ghl.keySaved && !key && <p className="adm-saved"><ShieldCheck size={14} aria-hidden="true" />A key is saved, ending in {c.ghl.keyEnd}. It is never shown again. Type a new one to replace it.</p>}
        <div className="adm-keyrow">
          <input type={peek ? 'text' : 'password'} autoComplete="off" spellCheck={false} aria-label="API key" placeholder={c.ghl.keySaved ? 'Paste a new key to replace it' : 'Paste the location API key'} value={key} onChange={e => setKey(e.target.value)} />
          <button type="button" className="fx-ib" aria-label={peek ? 'Hide what you typed' : 'Show what you typed'} disabled={!key} onClick={() => setPeek(x => !x)}>{peek ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>
        <small>Write-only: after Save only the last four are kept here.</small>
      </div>
      <Field label="Location ID"><input value={loc} onChange={e => setLoc(e.target.value)} placeholder="loc_..." /></Field>
      <div className="adm-wfs" role="group" aria-label="Workflows">
        <DField label="New lead"><Dropdown label="Workflow for a new lead" value={wf.newLead} options={opts} onChange={v => setWf({ ...wf, newLead: v })} /></DField>
        <DField label="Reminder"><Dropdown label="Workflow for a reminder" value={wf.reminder} options={opts} onChange={v => setWf({ ...wf, reminder: v })} /></DField>
        <DField label="No-show"><Dropdown label="Workflow for a no-show" value={wf.noShow} options={opts} onChange={v => setWf({ ...wf, noShow: v })} /></DField>
      </div>
      <footer className="fx-form-f"><button type="button" className="tp-btn ov-ghost" disabled={!dirty} onClick={() => { setKey(''); setLoc(c.ghl.locationId); setWf(c.ghl.workflows) }}>Discard</button><button type="button" className="tp-primary fx-accent" disabled={!dirty} onClick={save}><KeyRound size={15} />Save</button></footer>
    </Tile>
  )
}

function TextTile() {
  const { data: c } = useAdmConnect()
  const { saveConnect } = useAdmActions()
  const note = useNote()
  const [d, setD] = useState(c.texting)
  const [bw, bt] = CAMPAIGN_WORD[c.texting.brand]
  const [cw, ct] = CAMPAIGN_WORD[c.texting.campaign]
  const dirty = JSON.stringify(d) !== JSON.stringify(c.texting)
  return (
    <Tile className="adm-con" i={1} title="Texting" sub="The number clients get texts from">
      <Field label="Texting number"><input className="tp-num" value={d.number} onChange={e => setD({ ...d, number: e.target.value })} /></Field>
      <Field label="Sender name" hint="Shown in the first text"><input value={d.sender} onChange={e => setD({ ...d, sender: e.target.value })} /></Field>
      <ul className="adm-sum">
        <li><ShieldCheck size={14} aria-hidden="true" /><span className="tp-grow">Brand<small>Who is sending</small></span><Chip tone={bt}>{bw}</Chip></li>
        <li><MessageSquareText size={14} aria-hidden="true" /><span className="tp-grow">Campaign<small>The texts the carrier approved</small></span><Chip tone={ct}>{cw}</Chip></li>
      </ul>
      <small className="adm-note">Texts stay off until the campaign is approved and texting is switched on.</small>
      <footer className="fx-form-f"><button type="button" className="tp-btn ov-ghost" disabled={!dirty} onClick={() => setD(c.texting)}>Discard</button><button type="button" className="tp-primary fx-accent" disabled={!dirty} onClick={() => { saveConnect('texting', d, 'Saved the texting number'); note(WAIT) }}>Save</button></footer>
    </Tile>
  )
}

function AdsTile() {
  const { data: c } = useAdmConnect()
  const { saveConnect } = useAdmActions()
  const note = useNote()
  const [d, setD] = useState(c.ads)
  const put = (kind, patch) => setD(d.map(a => (a.kind === kind ? { ...a, ...patch } : a)))
  const dirty = JSON.stringify(d) !== JSON.stringify(c.ads)
  return (
    <Tile className="adm-con" i={2} title="Ad accounts" sub="One per lead type, with its weekly budget">
      {d.map(a => {
        const [w, t] = AD_WORD[a.account ? (a.status === 'not_set' ? 'waiting' : a.status) : 'not_set']
        return (
          <div key={a.kind} className="adm-acct">
            <header><Megaphone size={15} aria-hidden="true" /><b className="tp-grow">{a.label}</b><Chip tone={t}>{w}</Chip></header>
            <div className="fx-form-grid">
              <Field label="Ad account ID"><input className="tp-num" value={a.account} placeholder="000-000-0000" onChange={e => put(a.kind, { account: e.target.value })} /></Field>
              <Field label="Weekly budget ($)"><input className="tp-money" inputMode="numeric" value={a.budget} onChange={e => put(a.kind, { budget: Math.max(0, Number(e.target.value.replace(/[^0-9]/g, '')) || 0) })} /></Field>
            </div>
            <div className="fx-meter" role="img" aria-label={`${money(a.spent)} of ${money(a.budget)} spent`}><i style={{ '--w': a.budget ? Math.min(1, a.spent / a.budget) : 0 }} /></div>
            <small className="adm-note">{money(a.spent)} of {money(a.budget)} this week</small>
          </div>
        )
      })}
      <footer className="fx-form-f"><button type="button" className="tp-btn ov-ghost" disabled={!dirty} onClick={() => setD(c.ads)}>Discard</button><button type="button" className="tp-primary fx-accent" disabled={!dirty} onClick={() => { saveConnect('ads', d.map(a => ({ ...a, status: a.account ? 'waiting' : 'not_set' })), 'Saved the ad accounts'); note(WAIT) }}>Save</button></footer>
    </Tile>
  )
}

function SourcesTile() {
  const { data: c } = useAdmConnect()
  const { saveConnect } = useAdmActions()
  const note = useNote()
  const [d, setD] = useState(c.sources)
  const [add, setAdd] = useState('')
  const dirty = JSON.stringify(d) !== JSON.stringify(c.sources)
  const addForm = () => { if (!add.trim()) return; setD({ ...d, forms: [...d.forms, { id: `fm-${Date.now()}`, name: add.trim(), fields: 0, on: false, leads: 0 }] }); setAdd('') }
  return (
    <Tile className="adm-con" i={3} title="Lead sources" sub="Where leads come from besides the ads">
      <Field label="Mortgage-protection domain"><span className="adm-prefix"><Globe size={15} aria-hidden="true" /><input value={d.domain} onChange={e => setD({ ...d, domain: e.target.value.trim() })} /></span></Field>
      <div className="tp-field"><span>Forms on the site</span>
        <ul className="tp-list">{d.forms.map(f => (
          <li key={f.id} className="fx-mrow"><span className="tp-grow"><b>{f.name}</b><small>{f.fields ? `${f.fields} fields · ` : ''}{f.leads} leads this week</small></span>
            <Switch on={f.on} label={`${f.name} sends leads`} onChange={v => setD({ ...d, forms: d.forms.map(x => (x.id === f.id ? { ...x, on: v } : x)) })} /></li>
        ))}</ul>
      </div>
      <div className="adm-keyrow"><input aria-label="New form name" placeholder="Add a form by name" value={add} onChange={e => setAdd(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addForm() } }} /><button type="button" className="fx-pillbtn" disabled={!add.trim()} onClick={addForm}><Plus size={13} />Add</button></div>
      <footer className="fx-form-f"><button type="button" className="tp-btn ov-ghost" disabled={!dirty} onClick={() => setD(c.sources)}>Discard</button><button type="button" className="tp-primary fx-accent" disabled={!dirty} onClick={() => { saveConnect('sources', d, 'Saved the lead sources'); note(WAIT) }}>Save</button></footer>
    </Tile>
  )
}

// P864 — Setup: everything GoHighLevel set up for us, at a glance. Sample until P858 wires the real reads.
function SetupView({ row, sample }) {
  const { data: c } = useAdmConnect()
  const { data: agents } = useAdmAgents()
  const note = useNote()
  const [wfOn, setWfOn] = useState(() => Object.fromEntries(PLAYBOOK.map(w => [w.code, w.on])))
  const spent = c.ads.reduce((t, a) => t + a.spent, 0)
  // One campaign per agent (Playbook Q3), so spend per agent = spend per campaign; this week's spend shared by budget.
  const campaigns = useMemo(() => {
    const list = agents.filter(a => a.access !== false)
    const weight = list.reduce((t, a) => t + a.spend, 0) || 1
    const shares = list.map(a => Math.round((spent * a.spend) / weight))
    const extra = spent - shares.reduce((t, n) => t + n, 0) // rounding lands on the last campaign so the list adds up
    return list.map((a, i) => ({ id: a.id, agent: a.name, name: `Deedstone · ${a.name}`, spend: shares[i] + (i === list.length - 1 ? extra : 0) }))
  }, [agents, spent])
  const st = engineState(row)
  const [bw, bt] = CAMPAIGN_WORD[c.texting.brand]
  const [cw, ct] = CAMPAIGN_WORD[c.texting.campaign]
  const copy = text => { try { navigator.clipboard?.writeText(text) } catch { /* no clipboard: the toast still says what to copy */ } note('Link copied') }
  return (
    <div className="fx-ovl">
      <div className="fx-ovl-main adm-stack">
        <Tile i={0} title="Workflows" sub={`${Object.values(wfOn).filter(Boolean).length} of ${PLAYBOOK.length} on · from the playbook`} aside={sample && <SampleTag>Sample</SampleTag>}>
          <ul className="tp-list adm-wfl">{PLAYBOOK.map(w => (
            <li key={w.code} className="fx-mrow"><b className="adm-code tp-num">{w.code}</b><span className="tp-grow"><b>{w.name}</b><small>{wfOn[w.code] ? `Last ran ${w.last}` : 'Off'}</small></span>
              <Switch on={wfOn[w.code]} label={`${w.code} ${w.name}`} onChange={v => { setWfOn({ ...wfOn, [w.code]: v }); note(`${w.code} ${v ? 'on' : 'off'} (sample: switches it in GoHighLevel once wired)`) }} /></li>
          ))}</ul>
        </Tile>
        <Tile i={1} title="Campaigns and their agents" sub={`One campaign per agent · ${money(spent)} spent this week`} aside={sample && <SampleTag>Sample</SampleTag>}>
          <ul className="tp-list adm-rows">{campaigns.map(k => (
            <li key={k.id} className="fx-mrow"><Megaphone size={16} aria-hidden="true" /><span className="tp-grow"><b>{k.name}</b><small>Leads go to {k.agent}</small></span><b className="tp-money">{money(k.spend)}</b></li>
          ))}</ul>
        </Tile>
      </div>
      <div className="fx-ovl-side adm-side">
        <Tile className="is-deep" i={2} title="Connection" sub={st.line} aside={<Chip tone={st.on ? 'green' : 'mute'}>{st.on ? 'Connected' : 'Not connected'}</Chip>}>
          <ul className="adm-sum">
            <li><MapPin size={14} aria-hidden="true" /><span className="tp-grow">Location<small>GoHighLevel sub-account</small></span><b className="tp-num">{row?.location_id || c.ghl.locationId}</b></li>
            <li><Megaphone size={14} aria-hidden="true" /><span className="tp-grow">Ad account<small>{c.ads.filter(a => a.account).length} of {c.ads.length} set</small></span><b className="tp-num">{c.ads.find(a => a.account)?.account || '–'}</b></li>
          </ul>
        </Tile>
        <Tile i={3} title="Texting (A2P)" sub="The number every text comes from">
          <ul className="adm-sum">
            <li><MessageSquareText size={14} aria-hidden="true" /><span className="tp-grow">Sender number<small>{c.texting.sender}</small></span><b className="tp-num">{c.texting.number}</b></li>
            <li><ShieldCheck size={14} aria-hidden="true" /><span className="tp-grow">Brand</span><Chip tone={bt}>{bw}</Chip></li>
            <li><MessageSquareText size={14} aria-hidden="true" /><span className="tp-grow">Campaign</span><Chip tone={ct}>{cw}</Chip></li>
          </ul>
        </Tile>
        <Tile i={4} title="Tracking numbers" sub="Where each one forwards" aside={sample && <SampleTag>Sample</SampleTag>}>
          <ul className="adm-sum">{TRACKING.map(t => (
            <li key={t.id}><PhoneForwarded size={14} aria-hidden="true" /><span className="tp-grow"><span className="tp-num">{t.number}</span><small>{t.label} · to {t.to}</small></span><b className="tp-num">{t.calls}</b></li>
          ))}</ul>
          <small className="adm-note">Calls this week</small>
        </Tile>
        <Tile i={5} title="Lead form and landing page" sub="The agent ID rides hidden in each campaign's link">
          <ul className="adm-sum">
            <li><Globe size={14} aria-hidden="true" /><span className="tp-grow">Landing page<small>{c.sources.domain}</small></span><button type="button" className="fx-pillbtn" onClick={() => copy(`https://${c.sources.domain}`)}><Copy size={13} />Copy</button></li>
            {c.sources.forms.filter(f => f.on).map(f => <li key={f.id}><Link2 size={14} aria-hidden="true" /><span className="tp-grow">{f.name}<small>{f.fields} fields · {f.leads} leads this week</small></span></li>)}
          </ul>
        </Tile>
      </div>
    </div>
  )
}

// Before GoHighLevel is connected: a clean empty state that points to the Connect tab.
function SetupEmpty({ toConnect, onPreview }) {
  return (
    <section className="fx-tile adm-empty" style={{ '--i': 0 }} aria-label="Nothing connected yet">
      <span className="adm-empty-ic"><Unplug size={26} aria-hidden="true" /></span>
      <h2>Nothing connected yet</h2>
      <p className="tp-sub">Jordan connects GoHighLevel here. Once it is on, this shows the texting number, the tracking numbers, the workflows, the ad account, each campaign's agent and the lead form.</p>
      <EngineSlot />
      <div className="tp-row tp-wrap adm-empty-go">
        <button type="button" className="tp-primary fx-accent" onClick={toConnect}>Go to Connect<ArrowRight size={15} /></button>
        <button type="button" className="tp-btn ov-ghost" onClick={onPreview}>See a sample</button>
      </div>
    </section>
  )
}

export default function Connect() {
  const { data: c } = useAdmConnect()
  const { data: viewAs } = useAdmViewAs()
  const { live } = useAccount() || {}
  const [sp, setSp] = useSearchParams()
  const [peek, setPeek] = useState(false)
  // P855: when the settings table can't be read (its database step is not applied), ask once and keep that answer:
  // no 60-second re-read, no error, the tile just says it is not connected yet.
  const [gaveUp, setGaveUp] = useState(false)
  const ghl = useGhlConnect({ enabled: !!live && !gaveUp })
  const unread = !!live && ghl.settings.data === null
  if (unread && !gaveUp) setGaveUp(true)
  const done = plugged(c)
  if (live && ghl.settings.data !== undefined) {
    const [key, loc] = ghlPlugged(ghl.settings.data, ghl.keySaved.data)
    done[0] = key
    done[1] = loc
  }
  const checks = [
    [Workflow, 'GoHighLevel key'], [MapPin, 'GoHighLevel location and workflows'], [MessageSquareText, 'Texting campaign approved'],
    [Megaphone, 'An ad account for each lead type'], [Globe, 'Lead site and forms'],
  ].map((x, i) => [...x, done[i]])
  const sampleRow = c.ghl.keySaved && c.ghl.locationId ? { location_id: c.ghl.locationId, enabled: true, last_sync_status: 'ok', last_sync_at: c.ghl.syncedAt || null } : null
  const row = live ? ghl.settings.data || null : sampleRow
  const connected = engineState(row).on
  const raw = sp.get('tab')
  const tab = raw === 'setup' || raw === 'connect' ? raw : connected ? 'setup' : 'connect'
  const go = t => { setPeek(false); setSp(t === (connected ? 'setup' : 'connect') ? {} : { tab: t }, { replace: true }) }
  return (
    <div className="tp-page fx-page adm-connect">
      <PillTabs label="Connect" className="fx-ptabs adm-pagetabs" itemClass="fx-ptab" value={tab} onChange={go}
        items={[{ key: 'setup', label: 'Setup' }, { key: 'connect', label: 'Connect' }]} />
      <div className="adm-tabpane" key={tab} role="tabpanel">
        {tab === 'setup' && (connected || peek ? <SetupView row={row} sample /> : <SetupEmpty toConnect={() => go('connect')} onPreview={() => setPeek(true)} />)}
        {tab === 'connect' && (
          <div className="fx-ovl">
            <div className="fx-ovl-main">
              <div className="adm-congrid">
                {live ? <GhlLiveTile ghl={ghl} /> : <GhlTile />}
                <TextTile />
                <AdsTile />
                <SourcesTile />
              </div>
            </div>
            <div className="fx-ovl-side adm-side">
              <section className="fx-tile is-deep adm-constatus" style={{ '--i': 4 }} aria-label="What is plugged in">
                <header className="fx-tile-h"><span className="tp-grow"><h2>What is plugged in</h2><p>{checks.filter(x => x[2]).length} of {checks.length}</p></span><Plug size={18} aria-hidden="true" /></header>
                <ul className="adm-checks">{checks.map(([Icon, label, done]) => <li key={label} className={done ? 'is-done' : ''}>{done ? <Check size={15} aria-hidden="true" /> : <CircleDashed size={15} aria-hidden="true" />}<span className="tp-grow">{label}</span><Icon size={14} aria-hidden="true" /></li>)}</ul>
              </section>
              <Tile i={5} title="The bridge" sub={live ? 'GoHighLevel' : 'Prompt 850'}>
                <p className="tp-mid"><Info size={14} aria-hidden="true" /> {live
                  ? 'The GoHighLevel settings and key save for real. Nothing is sent to GoHighLevel until the bridge is deployed and switched on. Texting, ads and lead sources still save in this page only.'
                  : 'Everything here saves now and waits. Nothing talks to GoHighLevel, the ad accounts or the texting service until the bridge is built and switched on.'}</p>
                <p className="tp-sub">{viewAs === 'partner' ? 'You see Connect, Leads and Messages.' : "Jordan's login sees Connect, Leads and Messages. A partner login needs its own role (a database change)."}</p>
              </Tile>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
