import { useState } from 'react'
import { Bot, Clock3, PhoneOutgoing, ShieldAlert } from 'lucide-react'
import { Chip, Switch, SampleTag, Empty, useNote } from '../../template/kit'
import { Dropdown, DField } from '../kit'
import { useAdmSettings, useAdmActions, useAdmAgents } from '../data'
import { usd } from '../../template/motion'
import {
  AI_RULES, PROVIDERS, providerOf, DRAFT_WORDS, SAMPLE_AI_CALLS, SAMPLE_AI_SETTINGS, SAMPLE_CENTS_PER_MIN, OUTCOME_WORD, OUTCOME_TONE,
  HANDOFF_REASONS, aiStats, beatsOf,
} from '../../lib/aiCaller'
import '../../template/ai892.css'

// P892 — AI speed to lead, admin only. Settings › AI caller holds the switch (ai_caller_live, off), which agents it
// calls for, the longest call, and the provider (an engine slot: nothing is connected or paid for). Leads › AI calls
// shows the numbers. Sample only until 858 wires admin_ai_caller_save / admin_ai_calls_view
// (supabase/migrations/p892_ai_caller.sql). Agents never see any of this.
const money = usd(true)
let saved = { ...SAMPLE_AI_SETTINGS } // this visit's saved settings (sample)

// The engine-slot pill for the AI caller (same look as EngineSlot).
export const AiSlot = ({ provider = 'none' }) => <span className="adm-engine"><i aria-hidden="true" />{provider === 'none' ? 'AI caller · not connected yet' : `AI caller · ${providerOf(provider)?.name} picked, not connected yet`}</span>

const LENGTHS = [120, 180, 300, 480, 600].map(s => ({ value: s, label: `${s / 60} minutes` }))
const HARD_STOPS = [
  ['Consent wording', DRAFT_WORDS.consent],
  ['Opening line', DRAFT_WORDS.opening],
  ['Recording and transcripts', DRAFT_WORDS.recording],
  ['Provider', 'Pick and pay for one (Retell is recommended). Nothing is signed up for.'],
]

export function AiCallerSettings() {
  const { data: s } = useAdmSettings()
  const { setSwitch } = useAdmActions()
  const { data: agents } = useAdmAgents()
  const note = useNote()
  const [d, setD] = useState(saved)
  const live = !!s.switches.ai_caller_live
  const all = d.agents === 'all'
  const picked = id => all || d.agents.includes(id)
  const toggle = id => setD({ ...d, agents: all ? agents.map(a => a.id).filter(x => x !== id) : picked(id) ? d.agents.filter(x => x !== id) : [...d.agents, id] })
  const dirty = JSON.stringify(d) !== JSON.stringify(saved)
  const prov = providerOf(d.provider)
  return (
    <>
      <header className="fx-form-h"><h2>AI caller</h2><p>An AI calls every new form lead within {AI_RULES.firstCallSecs} seconds, says it{'’'}s Deedstone{'’'}s virtual assistant, asks the VA questions, then checks the agent or books. It hands to a VA when the lead wants a person, asks about coverage or price, or is confused or upset. Calls people make to us still ring a VA.</p></header>
      <div className="tp-row tp-wrap"><AiSlot provider={d.provider} /><SampleTag>Sample</SampleTag></div>
      <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>AI caller on</b><p className="tp-sub">Off: every form lead goes to a VA, exactly as today. Turning it on is Brayden{'’'}s call, after the four items below.</p></div>
        <Switch on={live} label="AI caller on" onChange={v => { setSwitch('ai_caller_live', v); note(`AI caller ${v ? 'on' : 'off'} (sample)`) }} /></div>
      <div className="adm-warn ai-stops" role="note"><ShieldAlert size={15} aria-hidden="true" /><div><b>Before it goes on (Brayden{'’'}s yes)</b>
        <ul>{HARD_STOPS.map(([k, v]) => <li key={k}><b>{k}:</b> {v} <SampleTag>Draft</SampleTag></li>)}</ul></div></div>

      <h3 className="fx-h3">Which agents</h3>
      <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Every agent</b><p className="tp-sub">New agents are included too.</p></div>
        <Switch on={all} label="Every agent" onChange={v => setD({ ...d, agents: v ? 'all' : agents.map(a => a.id) })} /></div>
      <ul className="tp-list ai-agents">{agents.map(a => (
        <li key={a.id} className="fx-form-row fx-form-sw"><div className="tp-grow"><b>{a.name}</b><p className="tp-sub">{a.active ? 'Appointments + live transfers' : 'Appointments only'} · licensed in {a.states.join(', ')}</p></div>
          <Switch on={picked(a.id)} label={`AI calls ${a.name}'s leads`} onChange={() => toggle(a.id)} /></li>
      ))}</ul>

      <div className="fx-form-grid">
        <DField label="Longest call" hint="The AI wraps up and books, or hands to a VA, before this."><Dropdown label="Longest call" value={d.maxCallSecs} options={LENGTHS} onChange={v => setD({ ...d, maxCallSecs: v })} /></DField>
        <DField label="Provider" hint="Picked here, connected only once it's paid for."><Dropdown label="Provider" value={d.provider} onChange={v => setD({ ...d, provider: v })}
          options={[{ value: 'none', label: 'Not picked yet' }, ...PROVIDERS.map(p => ({ value: p.key, label: p.name, sub: p.recommended ? 'Recommended' : undefined }))]} /></DField>
      </div>
      {prov && <dl className="fx-facts ai-prov">{[['Cost', prov.perMin], ['Calls out', prov.outbound], ['Transfers', prov.transfer], ['Transcripts', prov.transcripts]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}

      <h3 className="fx-h3">What it says (drafts)</h3>
      <ul className="tp-list ai-words">{[['Opening', DRAFT_WORDS.opening], ['While checking the agent', DRAFT_WORDS.hold], ['Agent said Yes', DRAFT_WORDS.connecting], ['Agent said No or didn’t answer', DRAFT_WORDS.bounce], ['Handing to a VA', DRAFT_WORDS.toPerson], ['No VA free in 60 s', DRAFT_WORDS.noPerson]].map(([k, v]) => (
        <li key={k}><small className="tp-sub">{k}</small><p className="tp-mid">“{v}”</p></li>
      ))}</ul>
      <ul className="tp-list tp-sub">
        <li>Before every call: consent on file and covering AI calls, not opted out or on do-not-call, inside the state{'’'}s calling hours in the lead{'’'}s time zone, under the attempt cap. Otherwise a VA calls.</li>
        <li>No answer: one more try {AI_RULES.retryAfterSecs / 60} minutes later, then the usual no-answer texts and VA call tasks.</li>
        <li>{'“'}Stop calling{'”'} is honoured at once, everywhere.</li>
      </ul>
      <footer className="fx-form-f">
        <button type="button" className="tp-btn ov-ghost" disabled={!dirty} onClick={() => setD(saved)}>Discard</button>
        <button type="button" className="tp-primary fx-accent" disabled={!dirty} onClick={() => { saved = { ...d }; setD(saved); note('AI caller settings saved (sample)') }}>Save</button>
      </footer>
    </>
  )
}

// Leads › AI calls: the numbers and every call.
export function AiCallsView() {
  const calls = SAMPLE_AI_CALLS
  const st = aiStats(calls, SAMPLE_CENTS_PER_MIN)
  const tiles = [
    ['Calls', st.calls, `${st.leads} leads`], ['Reached', `${st.reachedPct}%`, `${st.reached} of ${st.leads}`], ['Booked', st.booked], ['Transferred', st.transferred],
    ['Handed to VA', st.handed], ['To first call', st.avgSecs == null ? '–' : `${st.avgSecs} s`, 'average'], ['Minutes', st.minutes], ['Cost', st.costCents == null ? '–' : money(st.costCents / 100), `at ${SAMPLE_CENTS_PER_MIN}¢ a minute`],
  ]
  return (
    <section className="ai-view" aria-label="AI calls">
      <div className="tp-row tp-wrap ai-view-h"><h2 className="fx-h3"><Bot size={17} aria-hidden="true" />AI calls · today</h2><span className="tp-grow" /><AiSlot /><SampleTag>Sample</SampleTag></div>
      <div className="ai-tiles">{tiles.map(([k, v, sub]) => <div key={k}><small>{k}</small><b className="tp-num">{v}</b>{sub != null && <span>{sub}</span>}</div>)}</div>
      {calls.length === 0 ? <Empty title="No AI calls yet" sub="They show here once the AI caller is on." /> : (
        <ul className="tp-list ai-rows">{calls.map(c => (
          <li key={c.id} className="fx-mrow">
            <PhoneOutgoing size={15} aria-hidden="true" />
            <span className="tp-grow"><b>{c.name}{c.attempt > 1 ? ` · try ${c.attempt}` : ''}</b><small>{c.state} · {c.agent} · {c.at} · {c.secs} s to call · {c.duration ? `${Math.floor(c.duration / 60)}:${String(c.duration % 60).padStart(2, '0')}` : 'no answer'}</small><small>{c.note}</small>
              {c.transfer && <ol className="ai-beats" aria-label={`${c.name}: the transfer, beat by beat`}>{beatsOf(c).map(b => <li key={b}>{b}</li>)}</ol>}</span>
            <Chip tone={OUTCOME_TONE[c.outcome]}>{OUTCOME_WORD[c.outcome]}</Chip>
          </li>
        ))}</ul>
      )}
      <p className="tp-sub"><Clock3 size={12} aria-hidden="true" /> Speed is from the form arriving to the first dial. Hand-off reasons: {Object.values(HANDOFF_REASONS).join(', ').toLowerCase()}.</p>
    </section>
  )
}

