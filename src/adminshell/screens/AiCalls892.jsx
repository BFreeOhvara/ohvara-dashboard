import { useState } from 'react'
import { Bot, Clock3, PhoneOutgoing, ShieldAlert, PhoneOff, MessageSquareText } from 'lucide-react'
import { Chip, Switch, SampleTag, Empty, useNote } from '../../template/kit'
import { Dropdown, DField } from '../kit'
import { useAdmSettings, useAdmActions, useAdmAgents } from '../data'
import { usd } from '../../template/motion'
import {
  AI_RULES, PROVIDERS, providerOf, DRAFT_WORDS, SAMPLE_AI_CALLS, SAMPLE_AI_SETTINGS, SAMPLE_CENTS_PER_MIN, OUTCOME_WORD, OUTCOME_TONE,
  SAMPLE_BAD_LEADS, aiStats, beatsOf,
} from '../../lib/aiCaller'
import { FIRST_CALL_OUTCOMES, OUTCOME_LABEL, flowFor, planFlow, fillWords } from '../../lib/leadFlows'
import '../../template/ai892.css'

// P892 — AI speed to lead, admin only. Settings › AI caller holds the switch (ai_caller_live, off), which agents it
// calls for, the longest call, and the provider (an engine slot: nothing is connected or paid for). Leads › AI calls
// shows the numbers. Sample only until 858 wires admin_ai_caller_save / admin_ai_calls_view
// (supabase/migrations/244_ai_caller.sql). Agents never see any of this.
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
      <header className="fx-form-h"><h2>AI caller</h2><p>An AI calls every new form lead within {AI_RULES.firstCallSecs} seconds, says it{'’'}s Deedstone{'’'}s virtual assistant, asks the VA questions, then checks the agent or books. It never hands a new lead to a VA: if they want a person or ask about coverage or price, it says their agent will go over that, then checks the agent or books. Calls people make to us still ring a VA.</p></header>
      <div className="tp-row tp-wrap"><AiSlot provider={d.provider} /><SampleTag>Sample</SampleTag></div>
      <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>AI caller on</b><p className="tp-sub">Off: no AI calls go out. Turning it on is Brayden{'’'}s call, after the four items below. Also in Settings › Switches.</p></div>
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
        <DField label="Longest call" hint="The AI wraps up and books before this."><Dropdown label="Longest call" value={d.maxCallSecs} options={LENGTHS} onChange={v => setD({ ...d, maxCallSecs: v })} /></DField>
        <DField label="Provider" hint="Picked here, connected only once it's paid for."><Dropdown label="Provider" value={d.provider} onChange={v => setD({ ...d, provider: v })}
          options={[{ value: 'none', label: 'Not picked yet' }, ...PROVIDERS.map(p => ({ value: p.key, label: p.name, sub: p.recommended ? 'Recommended' : undefined }))]} /></DField>
      </div>
      {prov && <dl className="fx-facts ai-prov">{[['Cost', prov.perMin], ['Calls out', prov.outbound], ['Transfers', prov.transfer], ['Transcripts', prov.transcripts]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}

      <h3 className="fx-h3">What it says (drafts)</h3>
      <ul className="tp-list ai-words">{[['Opening', DRAFT_WORDS.opening], ['While checking the agent', DRAFT_WORDS.hold], ['Agent said Yes', DRAFT_WORDS.connecting], ['Agent said No or didn’t answer', DRAFT_WORDS.bounce], ['Asked for a person, coverage or price', DRAFT_WORDS.agentWill], ['No open time in 3 days', DRAFT_WORDS.noTimes]].map(([k, v]) => (
        <li key={k}><small className="tp-sub">{k}</small><p className="tp-mid">“{v}”</p></li>
      ))}</ul>
      <ul className="tp-list tp-sub">
        <li>Before every call: consent on file and covering AI calls, not opted out or on do-not-call, inside the state{'’'}s calling hours in the lead{'’'}s time zone, under the attempt cap. Otherwise a VA calls.</li>
        <li>No answer (or a call that fails): one more try {AI_RULES.retryAfterSecs / 60} minutes later, then the no-answer texts and call tasks.</li>
        <li>Every call ends in one result: booked, transferred, no answer, not now, hard no, wrong number or opted out. Only no answer and booked (a "not now" with a time counts as booked) start texts.</li>
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
    ['Not now', st.notNow], ['Wrong number', st.wrongNumber], ['To first call', st.avgSecs == null ? '–' : `${st.avgSecs} s`, 'average'], ['Minutes', st.minutes], ['Cost', st.costCents == null ? '–' : money(st.costCents / 100), `at ${SAMPLE_CENTS_PER_MIN}¢ a minute`],
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
      <p className="tp-sub"><Clock3 size={12} aria-hidden="true" /> Speed is from the form arriving to the first dial. Only no answer and booked start texts; the rest are recorded and sent to GoHighLevel.</p>
      <LeadFlows />
      <LeadQuality />
    </section>
  )
}

// P902: wrong numbers (AI or VA first call) close the lead as a bad lead and land here, per agent, for a spend check.
// Real rows: admin_lead_quality_view() (supabase/migrations/248_lead_outcomes.sql); sample until 904 applies it.
export function LeadQuality({ rows = SAMPLE_BAD_LEADS }) {
  const byAgent = rows.reduce((m, r) => ({ ...m, [r.agent]: (m[r.agent] || 0) + 1 }), {})
  return (
    <section className="ai-quality" aria-label="Lead quality">
      <div className="tp-row tp-wrap ai-view-h"><h2 className="fx-h3"><PhoneOff size={17} aria-hidden="true" />Lead quality · bad leads</h2><span className="tp-grow" /><SampleTag>Sample</SampleTag></div>
      <p className="tp-sub">Closed on the first call as a wrong number or never asked. Check the agent{'’'}s ad spend if these pile up: {Object.entries(byAgent).map(([a, n]) => `${a} ${n}`).join(' · ')}.</p>
      {rows.length === 0 ? <Empty title="No bad leads" sub="Wrong numbers from the first call show here." /> : (
        <ul className="tp-list ai-rows">{rows.map(r => (
          <li key={r.lead_id} className="fx-mrow">
            <PhoneOff size={15} aria-hidden="true" />
            <span className="tp-grow"><b>{r.name}</b><small>{r.state} · {r.agent} · {r.at} · {r.by}</small><small>{r.campaign}</small></span>
            <Chip tone="warn">{r.reason}</Chip>
          </li>
        ))}</ul>
      )}
    </section>
  )
}


// P902: what each first-call outcome starts. Only no answer and booked send texts (GoHighLevel sends them once it is
// connected); the rest are recorded and sent to GoHighLevel with no texts. Planned on sample times from the shared
// rules (src/lib/leadFlows.js), draft wording.
const FLOW_SAMPLE = { start: '2026-11-02T10:00', appt: '2026-11-05T15:00', now: '2026-11-02T10:00' }
const FLOW_WORDS = { first: 'Pat', agent: 'Dana', day: 'Thu, Nov 5', time: '3:00 PM', zone: 'CT', number: '(737) 555-0100', link: 'deedstone.com/b/sample' }
const flowWhen = at => {
  const d = new Date(`${at}:00`)
  const day = Math.round((d - new Date(`${FLOW_SAMPLE.start}:00`)) / 86400000)
  const hm = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${day <= 0 ? 'Day 0' : `Day ${day}`} · ${hm}`
}
const FLOW_NAME = { no_answer: 'No-answer texts', booked: 'Booking texts' }
export function LeadFlows() {
  const flows = ['no_answer', 'booked']
  return (
    <section className="ai-quality" aria-label="Texts after the first call">
      <div className="tp-row tp-wrap ai-view-h"><h2 className="fx-h3"><MessageSquareText size={17} aria-hidden="true" />Texts after the first call</h2><span className="tp-grow" /><SampleTag>Sample</SampleTag></div>
      <p className="tp-sub">{FIRST_CALL_OUTCOMES.map(o => `${OUTCOME_LABEL[o]}: ${flowFor(o) ? FLOW_NAME[flowFor(o)] : 'no texts'}`).join(' · ')} · Not now with a time: {FLOW_NAME.booked}. Anything they do (answer, reply, book, STOP) stops the current texts. GoHighLevel sends them; nothing is sent yet.</p>
      <div className="ai-flows">{flows.map(f => (
        <div key={f} className="ai-flow">
          <h3 className="fx-h3">{FLOW_NAME[f]}</h3>
          <ul className="tp-list ai-rows">{planFlow(f, FLOW_SAMPLE).map(st => (
            <li key={st.key} className="fx-mrow">
              <span className="tp-grow"><b>{st.label}</b><small>{flowWhen(st.at)}</small>{st.words ? <small>{fillWords(st.words, FLOW_WORDS)}</small> : null}</span>
              <Chip tone="outline">Planned</Chip>
            </li>
          ))}</ul>
        </div>
      ))}</div>
    </section>
  )
}
