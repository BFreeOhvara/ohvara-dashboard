import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Eye, EyeOff, ChevronDown, Sparkles, Plug, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { readGhlSettings, readSecretNames, sendSecret, saveGhlColumn, readGhlHeard, testGhlConnection, connectStatus, ghlKeys } from '../lib/ghlConnect.js'
import { CONNECT_STEPS, SECRET, checkValue, makePassword, doneOf, progressOf, heardAnswer } from './connectSteps'
import './connect1018.css'

// P1018 — Admin → Connect: one numbered checklist in the order Jordan does it (./connectSteps.js holds the words and
// the rules). Each step: what it is, what it does for Ohvara, where it is in GoHighLevel, Show me how, the box to paste
// into (or what to copy), a Test button that answers in plain words, and a green tick when it's done.
// Live (signed in): ghl_settings, the saved-secret names (never values) and admin_ghl_heard(). Sample: kept in the
// page only, nothing saved anywhere. Secrets are write-only: pasted once, stored encrypted, never shown back.

const NAMES = ['ghl-connect', 'names']
const HEARD = ['ghl-connect', 'heard']

function useLiveState(enabled) {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ghlKeys.settings, enabled, refetchInterval: 60e3, queryFn: () => readGhlSettings(supabase) })
  const names = useQuery({ queryKey: NAMES, enabled, queryFn: () => readSecretNames(supabase) })
  const heard = useQuery({ queryKey: HEARD, enabled, refetchInterval: 60e3, queryFn: () => readGhlHeard(supabase) })
  const state = { settings: settings.data || {}, secrets: new Set(names.data || []), heard: heard.data || {} }
  const loading = settings.isLoading || names.isLoading
  async function save(step, value) {
    const r = step.field.kind === 'secret'
      ? await sendSecret(supabase, step.field.secret, value, `${step.title} (Connect page)`)
      : await saveGhlColumn(supabase, step.field.column, value)
    await Promise.all([qc.invalidateQueries({ queryKey: ghlKeys.settings }), qc.invalidateQueries({ queryKey: NAMES }), qc.invalidateQueries({ queryKey: ghlKeys.key })])
    return r
  }
  async function test(step) {
    if (step.test === 'ghl') {
      if (!state.settings.location_id) return { ok: false, message: 'Save the location ID (step 1) first.' }
      if (!state.secrets.has(SECRET.key)) return { ok: step.key === 'location', message: step.key === 'location' ? 'Saved. The full check runs once your GoHighLevel key (step 2) is saved: press Test there.' : 'Save the key first, then test.' }
      return testGhlConnection(supabase)
    }
    if (step.test === 'leads' || step.test === 'campaigns' || step.test === 'replies') {
      const h = await readGhlHeard(supabase)
      qc.setQueryData(HEARD, h)
      if (!h) return { ok: false, message: 'Could not check right now. Try again in a minute.' }
      return heardAnswer(step, h)
    }
    return savedAnswer(step, state)
  }
  return { state, loading, save, test, status: connectStatus(settings.data || null, undefined, names.data ? state.secrets.has(SECRET.key) : null) }
}

// Sample: everything stays in this page. Tests answer as if GoHighLevel had sent something.
function useSampleState() {
  const [settings, setSettings] = useState({})
  const [secrets, setSecrets] = useState(() => new Set())
  const [heard, setHeard] = useState({})
  const state = { settings, secrets, heard }
  async function save(step, value) {
    if (step.field.kind === 'secret') setSecrets(s => new Set([...s, step.field.secret]))
    else setSettings(s => ({ ...s, [step.field.column]: value.trim() }))
    return { ok: true, sample: true }
  }
  async function test(step) {
    const now = new Date().toISOString()
    if (step.test === 'ghl') {
      if (!settings.location_id) return { ok: false, message: 'Save the location ID (step 1) first.' }
      if (!secrets.has(SECRET.key)) return { ok: step.key === 'location', message: step.key === 'location' ? 'Saved. The full check runs once your GoHighLevel key (step 2) is saved: press Test there.' : 'Save the key first, then test.' }
      return { ok: true, message: 'Sample: GoHighLevel answered. The key works and the sub-account was found.' }
    }
    const fake = { leads: { leads: 1, lead_at: now, test_lead_at: now }, campaigns: { campaigns: 1, campaign_at: now }, replies: { reply_at: now, opt_out_at: now } }[step.test]
    if (fake) { const h = { ...heard, ...fake, bridge_on: true }; setHeard(h); return { ...heardAnswer(step, h), message: `Sample: ${heardAnswer(step, h).message}` } }
    return savedAnswer(step, state)
  }
  return { state, loading: false, save, test, status: { label: 'Sample', tone: 'mute', line: 'Sample info: nothing here is saved' } }
}

function savedAnswer(step, state) {
  const done = doneOf(step, state)
  if (!done) return { ok: false, message: 'Nothing is saved here yet. Paste it and press Save.' }
  if (step.key === 'hook') return { ok: true, message: 'Saved. Ohvara accepts a message from GoHighLevel only when it carries this password.' }
  if (step.key === 'control') return { ok: true, message: 'Saved, and the address is the right kind. Ohvara sends to it once Brayden turns the connection on.' }
  if (step.key === 'reminder') return { ok: true, message: 'Saved, and the ID is the right shape. Ohvara adds booked appointments to this workflow once texts are switched on.' }
  return { ok: true, message: 'Saved, and the ID is the right shape. Ohvara adds leads to this workflow once texts are switched on.' }
}

export default function ConnectChecklist({ live, phone = false }) {
  const liveState = useLiveState(!!live)
  const sample = useSampleState()
  const s = live ? liveState : sample
  const p = progressOf(s.state)
  return (
    <div className={`cn-list${phone ? ' is-phone' : ''}`}>
      <section className="cn-top" aria-label="Progress">
        <div className="cn-top-row">
          <span className="cn-grow"><h2>{p.done} of {p.total} done</h2><p>{p.done === p.total ? 'Everything is connected. Tell Brayden, and he turns the GoHighLevel connection on.' : 'Connect GoHighLevel to Ohvara, one step at a time, top to bottom.'}</p></span>
          <span className={`cn-pill is-${s.status.tone || 'mute'}`}><Plug size={13} aria-hidden="true" />{s.status.label}</span>
        </div>
        <div className="cn-bar" role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done} aria-label={`${p.done} of ${p.total} steps done`}><i style={{ '--w': p.done / p.total }} /></div>
        <p className="cn-mute">Each step says what it is, what it does for Ohvara and where to find it. Stuck? Open Show me how. Nothing goes to a real lead until every step is done and Brayden turns it on.</p>
      </section>
      <ol className="cn-steps">
        {CONNECT_STEPS.map((step, i) => <StepCard key={step.key} n={i + 1} step={step} s={s} done={doneOf(step, s.state)} next={p.next === step.key} live={live} />)}
      </ol>
    </div>
  )
}

function StepCard({ n, step, s, done, next, live }) {
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const doTest = async () => { setBusy(true); const r = await s.test(step); setBusy(false); setResult(r) }
  return (
    <li className={`cn-step${done ? ' is-done' : ''}${next ? ' is-next' : ''}`} aria-label={`Step ${n}: ${step.title}${done ? ', done' : ''}`}>
      <header className="cn-step-h">
        <span className="cn-num" aria-hidden="true">{done ? <Check size={16} strokeWidth={3} /> : n}</span>
        <span className="cn-grow"><h3>{step.title}</h3><p>{step.what}</p></span>
        <span className={`cn-state${done ? ' is-done' : ''}`}>{done ? 'Done' : next ? 'Next' : 'To do'}</span>
      </header>
      <div className="cn-body">
        <p className="cn-why"><b>What it does for Ohvara</b>{step.why}</p>
        <p className="cn-where"><b>Where in GoHighLevel</b><span>{step.where}</span></p>
        <details className="cn-how">
          <summary><ChevronDown size={15} aria-hidden="true" />Show me how</summary>
          <ol>{step.how.map((h, i) => <li key={i}>{h}</li>)}</ol>
        </details>
        {step.copy && <CopyRows rows={step.copy} />}
        {step.field && <FieldRow step={step} s={s} done={done} live={live} onSaved={() => setResult(null)} />}
        <div className="cn-test">
          <button type="button" className="cn-btn" disabled={busy || s.loading} onClick={doTest}>{busy ? 'Testing…' : 'Test'}</button>
          {result && <p role="status" className={`cn-result${result.ok ? ' is-ok' : ' is-bad'}`}>{result.ok && <Check size={14} aria-hidden="true" />}{result.message}</p>}
        </div>
      </div>
    </li>
  )
}

function CopyRows({ rows }) {
  const [copied, setCopied] = useState('')
  const copy = async (label, v) => { try { await navigator.clipboard.writeText(v); setCopied(label) } catch { setCopied('') } }
  return (
    <ul className="cn-copy" aria-label="Copy these into GoHighLevel">
      {rows.map(r => (
        <li key={r.label}><small>{r.label}</small><code>{r.value}</code>
          <button type="button" className="cn-ib" aria-label={`Copy ${r.label}`} onClick={() => copy(r.label, r.value)}>{copied === r.label ? <Check size={14} /> : <Copy size={14} />}</button></li>
      ))}
    </ul>
  )
}

function FieldRow({ step, s, done, live, onSaved }) {
  const f = step.field
  const secret = f.kind === 'secret'
  const current = secret ? '' : (s.state.settings[f.column] || '')
  const [v, setV] = useState(null)
  const [peek, setPeek] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const val = v ?? current
  const dirty = secret ? !!val.trim() : val.trim() !== current
  const id = `cn-f-${step.key}`
  const save = async () => {
    const bad = checkValue(step, val)
    if (bad) { setErr(bad); return }
    setBusy(true); setErr(''); setMsg('')
    const typed = val
    if (secret) { setV(''); setPeek(false) } // a secret leaves the box the moment Save is pressed
    const r = await s.save(step, typed)
    setBusy(false)
    if (!r.ok) { setErr(r.error || 'Could not save it.'); return }
    setV(null); onSaved()
    setMsg(r.sample ? 'Sample: kept on this page only.' : secret ? 'Saved. It is stored encrypted and never shown again.' : 'Saved.')
  }
  const copyIt = async () => { try { await navigator.clipboard.writeText(val); setMsg('Copied. Keep it for steps 4, 5 and 6, then press Save.') } catch { setMsg('Copy didn\'t work: select the text and copy it.') } }
  return (
    <div className="cn-field">
      <label htmlFor={id}>{f.label}</label>
      {secret && done && !val && <p className="cn-saved"><ShieldCheck size={14} aria-hidden="true" />Saved{live ? '' : ' (sample)'}. It is never shown again. Paste a new one to replace it.</p>}
      <div className="cn-row">
        <input id={id} type={secret && !peek && !f.make ? 'password' : 'text'} autoComplete="off" spellCheck={false} placeholder={f.placeholder} value={val} disabled={busy}
          aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined}
          onChange={e => { setV(e.target.value); setErr(''); setMsg('') }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (dirty) save() } }} />
        {secret && !f.make && <button type="button" className="cn-ib" aria-label={peek ? 'Hide what you typed' : 'Show what you typed'} disabled={!val} onClick={() => setPeek(x => !x)}>{peek ? <EyeOff size={15} /> : <Eye size={15} />}</button>}
        {f.make && <button type="button" className="cn-btn is-ghost" disabled={busy} onClick={() => { setV(makePassword()); setErr(''); setMsg('') }}><Sparkles size={14} aria-hidden="true" />Make one</button>}
        {f.make && <button type="button" className="cn-btn is-ghost" disabled={!val} onClick={copyIt}><Copy size={14} aria-hidden="true" />Copy</button>}
        <button type="button" className="cn-btn is-solid" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      {err && <small id={`${id}-err`} className="cn-err">{err}</small>}
      {msg && <small className="cn-ok" role="status">{msg}</small>}
    </div>
  )
}
