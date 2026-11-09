import { splitStore } from '../splitStore'
import { useState } from 'react'
import { ArrowRightLeft, Clock3 } from 'lucide-react'
import { Chip, Field, Switch, SampleTag, useNote } from '../../template/kit'
import { Block } from '../../template/Record'
import { usd } from '../../template/motion'
import { Dropdown, DField, EngineSlot } from '../kit'
import { SPLIT_REASON, LEAD_MODES, effectiveSplit, nextSplit, liveHoursText, DEFAULT_LIVE_HOURS } from '../../lib/leadSplit'

// P889 — the split behind one lead product, admin only (agents never see it). Settings › Lead split holds the splitStore.rules;
// the agent drawer shows each transfer agent's split (form ads vs call ads), what runs today, next Monday's move with
// the numbers behind it, a lock, and the change log. Sample only until 858 wires admin_lead_split_view /
// admin_lead_split_lock / admin_lead_split_rules_save (supabase/migrations/241_one_lead_product.sql).
// P901 (Meta only at launch): Settings › Lead split has the Call ads (Google) switch, off by default. While it's off
// every agent runs all form ads, the Monday move waits, and the agent block says so (p901_price_book_v2.sql).
const money = usd()
// this visit's saved rules (sample) live in splitStore, shared with Settings › Switches (P906)
const splits = {} // this visit's lock/split changes, by agent
const logs = {}

// Sample look-back numbers (4 weeks) per agent: form ads vs call ads. Spend in dollars.
const SAMPLE_STATS = {
  'ag-dana': { form: { spent: 1680, sales: 4, shows: 9, transfers: 3 }, call: { spent: 720, sales: 3, shows: 0, transfers: 8 } },
  'ag-priya': { form: { spent: 2100, sales: 2, shows: 7, transfers: 2 }, call: { spent: 900, sales: 1, shows: 0, transfers: 4 } },
  'ag-james': { form: { spent: 980, sales: 1, shows: 4, transfers: 1 }, call: { spent: 420, sales: 0, shows: 0, transfers: 1 } },
}
const SAMPLE_LOG = {
  'ag-dana': [{ at: 'Mon, Nov 2', who: 'Weekly move', from: 80, to: 70, why: 'call_cheaper', line: 'Cost per sale: form $560, call $300 (7 sales)' }],
  'ag-priya': [{ at: 'Mon, Nov 2', who: 'Weekly move', from: 70, to: 70, why: 'even', line: 'Cost per show or transfer: form $233, call $225 (3 sales)' }],
}
const modeOf = a => (a.active ? 'both' : 'appts')
const splitOf = a => splits[a.id] || { formPct: a.id === 'ag-dana' ? 70 : splitStore.rules.startFormPct, locked: false, note: '' }
const costLine = n => {
  const f = v => (v == null ? 'no spend' : v === Infinity ? 'none yet' : money(Math.round(v)))
  return `${n.metric === 'sale' ? 'Cost per sale' : 'Cost per show or transfer'}: form ${f(n.form.cost)}, call ${f(n.call.cost)} (${n.sales} sale${n.sales === 1 ? '' : 's'})`
}

// The agent drawer block. agent = an admin agent (P906: spend is the daily spend there).
export function SplitBlock({ agent }) {
  const note = useNote()
  const [sp, setSp] = useState(() => splitOf(agent))
  const [log, setLog] = useState(() => logs[agent.id] || SAMPLE_LOG[agent.id] || [])
  const mode = modeOf(agent)
  const daily = agent.spend
  const now = effectiveSplit({ daily, mode, formPct: sp.formPct }, splitStore.rules)
  const stats = SAMPLE_STATS[agent.id] || { form: { spent: daily * 20, sales: 0, shows: 0, transfers: 0 }, call: { spent: daily * 8, sales: 0, shows: 0, transfers: 0 } }
  const next = nextSplit({ formPct: sp.formPct, locked: sp.locked, ...stats }, splitStore.rules)
  const save = (patch, line) => {
    const n = { ...sp, ...patch }; splits[agent.id] = n; setSp(n)
    const l = [{ at: 'Just now', who: 'Brayden', from: sp.formPct, to: n.formPct, why: n.locked ? 'locked' : 'unlocked', line }, ...log]; logs[agent.id] = l; setLog(l)
  }
  const pctOpts = Array.from({ length: (100 - 2 * splitStore.rules.floorPct) / 5 + 1 }, (_, i) => splitStore.rules.floorPct + i * 5).map(p => ({ value: p, label: `${p}% form / ${100 - p}% call` }))
  return (
    <Block title="Lead split" sub="Form ads vs call ads. Admin only: the agent sees one daily spend." aside={<SampleTag>Sample</SampleTag>}>
      <dl className="fx-facts">{[
        ['How they take leads', LEAD_MODES.find(m => m.key === mode).label],
        ['Live-call hours', mode === 'both' ? liveHoursText(DEFAULT_LIVE_HOURS) : 'None'],
        ['Daily spend', `${money(daily)} a day`],
        ['Today', mode === 'both' && now.reason === 'split' ? `${money(now.form)} form · ${money(now.call)} call (${now.formPct}/${100 - now.formPct})` : `${money(now.form)} form · ${SPLIT_REASON[now.reason]}`],
      ].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {mode === 'both' && !splitStore.rules.callAdsOn && <p className="tp-sub">Call ads (Google) are off, so all of this agent{'’'}s spend goes to form ads and the Monday move waits. Live transfers still come from form leads (Check agent). The split starts when call ads are turned on in Settings › Lead split.</p>}
      {mode === 'both' && splitStore.rules.callAdsOn && <>
        {now.reason === 'call_min' && <p className="adm-warn-t">Call ads need at least {money(splitStore.rules.callMinDaily)} a day. At {sp.formPct}/{100 - sp.formPct} the call side gets {money(Math.round(daily * (100 - sp.formPct) / 100))}, so it all goes to form ads.</p>}
        <div className="fx-form-row"><ArrowRightLeft size={16} aria-hidden="true" /><span className="tp-grow"><b>{next.moved ? `Next Monday: ${sp.formPct} → ${next.formPct}% form` : `Next Monday: stays ${sp.formPct}% form`}</b><small className="tp-sub">{SPLIT_REASON[next.reason]} · {costLine(next.numbers)} · last {splitStore.rules.lookbackWeeks} weeks</small></span><Chip tone={next.moved ? 'blue' : 'mute'}>{next.moved ? `${next.moved > 0 ? '+' : ''}${next.moved} pts` : 'Hold'}</Chip></div>
        <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>{sp.locked ? `Locked at ${sp.formPct}% form` : 'Moves every Monday'}</b><p className="tp-sub">Lock to stop the weekly move for this agent. Logged with before and after.</p></div>
          <Switch on={sp.locked} label="Lock the split" onChange={v => { save({ locked: v }, v ? `Locked at ${sp.formPct}/${100 - sp.formPct}` : 'Unlocked: weekly move back on'); note(v ? 'Split locked' : 'Split unlocked') }} /></div>
        {sp.locked && <DField label="Locked split" hint={`Neither side under ${splitStore.rules.floorPct}%.`}><Dropdown label="Locked split" value={sp.formPct} options={pctOpts} onChange={v => { save({ formPct: v }, `Locked split set to ${v}/${100 - v}`); note(`Split set to ${v}% form`) }} /></DField>}
      </>}
      {log.length > 0 && <ul className="tp-list p879-log">{log.map((l, i) => <li key={i} className="tp-sub">{l.at} · {l.who} · {l.from} → {l.to}% form · {SPLIT_REASON[l.why] || l.why}{l.line ? ` · ${l.line}` : ''}</li>)}</ul>}
      <p className="tp-sub"><Clock3 size={12} aria-hidden="true" /> Call ads run only inside the agent{'’'}s live-call hours. Jordan{'’'}s engine reads form and call budgets per agent from the split.</p>
    </Block>
  )
}

// Settings › Lead split: the splitStore.rules every transfer agent's split follows.
export function SplitRules() {
  const note = useNote()
  const [d, setD] = useState(splitStore.rules)
  const [, bump] = useState(0)
  const num = (k, max = 100) => e => setD({ ...d, [k]: Math.min(max, Math.max(0, Number(e.target.value.replace(/[^0-9]/g, '')) || 0)) })
  const bad = d.floorPct * 2 > 100 || d.startFormPct < d.floorPct || d.startFormPct > 100 - d.floorPct || d.maxStep < 1
  const dirty = JSON.stringify(d) !== JSON.stringify(splitStore.rules)
  return (
    <>
      <header className="fx-form-h"><h2>Lead split</h2><p>Agents set one daily spend. Once call ads are on, a transfer agent{'’'}s spend is split between form ads and call ads, and moved every Monday toward the side with the lower cost per sale. Agents never see this.</p></header>
      <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Call ads (Google): {d.callAdsOn ? 'on' : 'off'}</b><p className="tp-sub">{d.callAdsOn ? 'Transfer agents start at the split below and move every Monday.' : 'Off at launch: Meta form ads only. All spend goes to form ads and the Monday move waits. Live transfers still come from form leads.'}</p></div>
        <Switch on={!!d.callAdsOn} label="Call ads (Google)" onChange={v => setD({ ...d, callAdsOn: v })} /></div>
      <div className="fx-form-grid">
        <Field label="Start (% form ads)" hint={`New transfer agents start ${d.startFormPct}/${100 - d.startFormPct}`}><input className="tp-num" inputMode="numeric" value={d.startFormPct} onChange={num('startFormPct')} /></Field>
        <Field label="Most it moves a week (points)"><input className="tp-num" inputMode="numeric" value={d.maxStep} onChange={num('maxStep', 50)} /></Field>
        <Field label="Floor for each side (%)" hint="Neither side goes under this"><input className="tp-num" inputMode="numeric" value={d.floorPct} onChange={num('floorPct', 50)} /></Field>
        <Field label="Sales before cost per sale is used" hint="Under this, compare cost per show or transfer"><input className="tp-num" inputMode="numeric" value={d.minSales} onChange={num('minSales', 50)} /></Field>
        <Field label="Call ads minimum ($ a day)" hint="Under this, all spend goes to form ads"><input className="tp-money" inputMode="numeric" value={d.callMinDaily} onChange={num('callMinDaily', 500)} /></Field>
        <Field label="Look back (weeks)" hint="The numbers behind each Monday move"><input className="tp-num" inputMode="numeric" value={d.lookbackWeeks} onChange={num('lookbackWeeks', 12)} /></Field>
      </div>
      {bad && <p className="adm-warn-t" role="alert">The start has to sit between the floors, and the step has to be at least 1.</p>}
      <ul className="tp-list tp-sub">
        <li>Call ads run only inside each agent{'’'}s live-call hours.</li>
        <li>Costs within {Math.round(d.holdWithin * 100)}% of each other: the split holds that week.</li>
        <li>Lock a split for one agent from their page. Every change is logged with the numbers behind it.</li>
        <li>The weekly move runs Monday morning, before the weekly charge.</li>
      </ul>
      <div className="tp-row tp-wrap"><EngineSlot /><span className="tp-sub">Jordan{'’'}s engine reads each agent{'’'}s form and call budgets and the live-call hours.</span></div>
      <footer className="fx-form-f">
        <button type="button" className="tp-btn ov-ghost" disabled={!dirty} onClick={() => setD(splitStore.rules)}>Discard</button>
        <button type="button" className="tp-primary fx-accent" disabled={!dirty || bad} onClick={() => { splitStore.rules = { ...d }; bump(x => x + 1); note('Lead split splitStore.rules saved (sample)') }}>Save splitStore.rules</button>
      </footer>
    </>
  )
}
