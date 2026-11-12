import { useState, useEffect } from 'react'
import { Bot, Clock3, ShieldAlert, PhoneOff, MessageSquareText, ChevronRight, Power, Play, PhoneCall, Timer, Target, CheckCircle2, Wallet, MapPin, AudioLines } from 'lucide-react'
import { Chip, Switch, SampleTag, Empty, Drawer, useNote } from '../../template/kit'
import { Dropdown, DField } from '../kit'
import { useAdmSettings, useAdmAgents, useAdmSource } from '../data'
import { supabase } from '../../lib/supabase'
import { usd } from '../../template/motion'
import {
  AI_RULES, PROVIDERS, providerOf, DRAFT_WORDS, SAMPLE_AI_CALLS, SAMPLE_AI_SETTINGS, SAMPLE_CENTS_PER_MIN, OUTCOME_WORD,
  SAMPLE_BAD_LEADS, aiStats, beatsOf, voiceStats, voiceStatsFromView, CALLER_VOICES,
} from '../../lib/aiCaller'
import { FIRST_CALL_OUTCOMES, OUTCOME_LABEL, flowFor, planFlow, fillWords } from '../../lib/leadFlows'
import '../../template/ai892.css'
import '../ai942.css'

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
  const { data: agents } = useAdmAgents()
  const note = useNote()
  const [d, setD] = useState(saved)
  const live = !!s.switches.ai_caller_live
  const all = d.agents === 'all'
  const picked = id => all || d.agents.includes(id)
  const toggle = id => setD({ ...d, agents: all ? agents.map(a => a.id).filter(x => x !== id) : picked(id) ? d.agents.filter(x => x !== id) : [...d.agents, id] })
  const dirty = JSON.stringify(d) !== JSON.stringify(saved)
  const prov = providerOf(d.provider)
  const [words, setWords] = useState(false)
  return (
    <>
      <header className="fx-form-h"><h2>AI caller</h2><p>An AI calls every new form lead within {AI_RULES.firstCallSecs} seconds, says it{'’'}s Deedstone{'’'}s virtual assistant, then books it or checks the agent for a transfer. It never hands a new lead to a VA; calls people make to us still ring a VA.</p></header>
      {/* P950: no on/off switch in the portal (Ohvara turns it on with Brayden's yes); this section is how it calls. Two columns, no scroll:
          the wording and the call rules open in a slide-in. */}
      <div className="tp-row tp-wrap"><AiSlot provider={d.provider} /><SampleTag>Sample</SampleTag><span className="ai-golive"><Power size={14} aria-hidden="true" />The AI caller is {live ? 'on' : 'off'}. Ohvara turns it on with Brayden{'’'}s yes.</span></div>
      <div className="adm-set-two">
      <div>
      <div className="adm-warn ai-stops" role="note"><ShieldAlert size={15} aria-hidden="true" /><div><b>Before it goes on (Brayden{'’'}s yes)</b>
        <ul>{HARD_STOPS.map(([k, v]) => <li key={k}><b>{k}:</b> {v}</li>)}</ul></div></div>

      </div>
      <div>
      <h3 className="fx-h3">Which agents</h3>
      <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Every agent</b><p className="tp-sub">New agents are included too.</p></div>
        <Switch on={all} label="Every agent" onChange={v => setD({ ...d, agents: v ? 'all' : agents.map(a => a.id) })} /></div>
      {/* P934: the agents as colour pills (the agent side's FilterPills look, several can be on) so the section fits. */}
      <div className="fx-fpills ai-agent-pills" role="group" aria-label="Which agents the AI calls for">{agents.map(a => (
        <button key={a.id} type="button" className={`fx-fpill is-blue${picked(a.id) ? ' is-on' : ''}`} aria-pressed={picked(a.id)} title={`${a.active ? 'Appointments + live transfers' : 'Appointments only'} · licensed in ${a.states.join(', ')}`} onClick={() => toggle(a.id)}>{a.name}</button>
      ))}</div>
      <div className="fx-form-grid">
        <DField label="Longest call" hint="The AI wraps up and books before this."><Dropdown label="Longest call" value={d.maxCallSecs} options={LENGTHS} onChange={v => setD({ ...d, maxCallSecs: v })} /></DField>
        <DField label="Provider" hint="Picked here, connected only once it's paid for."><Dropdown label="Provider" value={d.provider} onChange={v => setD({ ...d, provider: v })}
          options={[{ value: 'none', label: 'Not picked yet' }, ...PROVIDERS.map(p => ({ value: p.key, label: p.name, sub: p.recommended ? 'Recommended' : undefined }))]} /></DField>
      </div>
      {prov && <dl className="fx-facts ai-prov">{[['Cost', prov.perMin], ['Calls out', prov.outbound], ['Transfers', prov.transfer], ['Transcripts', prov.transcripts]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        <button type="button" className="fx-mrow ai-words-open" onClick={() => setWords(true)}><MessageSquareText size={16} aria-hidden="true" /><span className="tp-grow"><b>What it says and its call rules</b><small>The six lines it says, and when a VA calls instead</small></span><ChevronRight size={15} aria-hidden="true" /></button>
      </div>
      </div>
      <Drawer open={words} onClose={() => setWords(false)} title="What the AI caller says" sub="Its lines, and the rules every call follows.">
            <ul className="tp-list ai-words">{[['Opening', DRAFT_WORDS.opening], ['While checking the agent', DRAFT_WORDS.hold], ['Agent said Yes', DRAFT_WORDS.connecting], ['Agent said No or didn’t answer', DRAFT_WORDS.bounce], ['Asked for a person, coverage or price', DRAFT_WORDS.agentWill], ['No open time in 3 days', DRAFT_WORDS.noTimes]].map(([k, v]) => (
        <li key={k}><small className="tp-sub">{k}</small><p className="tp-mid">“{v}”</p></li>
      ))}</ul>
      <ul className="tp-list tp-sub">
        <li>Before every call: consent on file and covering AI calls, not opted out or on do-not-call, inside the state{'’'}s calling hours in the lead{'’'}s time zone, under the attempt cap. Otherwise a VA calls.</li>
        <li>No answer (or a call that fails): one more try {AI_RULES.retryAfterSecs / 60} minutes later, then the no-answer texts and call tasks.</li>
        <li>Every call ends in one result: booked, transferred, no answer, not now, hard no, wrong number or opted out. Only no answer and booked (a "not now" with a time counts as booked) start texts.</li>
        <li>{'“'}Stop calling{'”'} is honoured at once, everywhere.</li>
      </ul>
      </Drawer>
      <footer className="fx-form-f">
        <button type="button" className="tp-btn ov-ghost" disabled={!dirty} onClick={() => setD(saved)}>Discard</button>
        <button type="button" className="tp-primary fx-accent" disabled={!dirty} onClick={() => { saved = { ...d }; setD(saved); note('AI caller settings saved (sample)') }}>Save</button>
      </footer>
    </>
  )
}

// P926: a real call row (admin_ai_calls_view, migration 263) in the sample rows' shape.
const when = iso => { try { return new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) } catch { return '' } }
const fromView = r => ({
  iso: r.at || null, summary: r.summary || '',
  id: r.id, lead_id: r.lead_id, name: r.name || 'Lead', state: r.state || '', agent: r.agent || '', at: when(r.at), attempt: r.attempt || 1,
  secs: r.secs ?? '–', duration: r.duration || 0, outcome: r.outcome, test: !!r.test, voice: r.voice || null, costCents: r.cost_cents == null ? null : Number(r.cost_cents),
  note: [r.summary, r.booked_for ? `Booked ${when(r.booked_for)}` : null, r.callback_at ? `Callback ${when(r.callback_at)}` : null].filter(Boolean).join(' · '),
})
function useRealAiCalls(on) {
  const [v, setV] = useState({ loading: on, error: '', data: null })
  useEffect(() => {
    if (!on) return undefined
    let live = true
    supabase.rpc('admin_ai_calls_view', {}).then(({ data, error }) => { if (live) setV({ loading: false, error: error?.message || '', data }) })
    return () => { live = false }
  }, [on])
  return v
}

// P942 — Leads › AI calls, redesigned: five colour stat cards (calls today, average time to first call, reached %,
// delivered %, cost today), then one card per call coloured by what happened: Delivered (booked or a live transfer,
// the Delivered blue), Not now, No answer, Not interested (also a wrong number or stop calling). Each card has the
// lead, state, when, length and cost, and a Transcript button that opens the call in a slide-in.
// Sample on /preview; the real last 7 days for a signed-in admin (P926).
const GROUP = { booked: 'delivered', transferred: 'delivered', not_now: 'not_now', no_answer: 'no_answer', hard_no: 'not_interested', wrong_number: 'not_interested', opt_out: 'not_interested' }
const GROUP_WORD = { delivered: 'Delivered', not_now: 'Not now', no_answer: 'No answer', not_interested: 'Not interested' }
const length = secs => (secs ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '0:00')
const isToday = (c, real) => (real ? !!c.iso && new Date(c.iso).toDateString() === new Date().toDateString() : String(c.at).startsWith('Today'))
const costOf = (c, centsPerMin) => (c.costCents != null ? c.costCents : c.duration ? Math.ceil(c.duration / 60) * centsPerMin : 0)

// The call, in a slide-in: what happened, the transfer beat by beat, and the transcript (sample: the AI's own lines).
function CallSheet({ c, real, onClose }) {
  const g = c ? GROUP[c.outcome] || 'no_answer' : 'no_answer'
  const lines = c && !real && c.duration ? [['AI', DRAFT_WORDS.opening], ['Lead', 'Yes, this is them.'], ...(c.note ? [['AI', `${c.note}.`]] : [])] : []
  const cost = c ? (c.costCents != null ? money(c.costCents / 100) : real ? '–' : money(costOf(c, SAMPLE_CENTS_PER_MIN) / 100)) : ''
  return (
    <Drawer open={!!c} onClose={onClose} title={c?.name || 'Call'} sub={c ? `${OUTCOME_WORD[c.outcome]} · ${c.at}` : ''}>
      {c && <>
        <div className={`ai942-sheet is-${g}`}><span className="ai942-out">{GROUP_WORD[g]}</span><b className="tp-num">{length(c.duration)}</b><small>{c.duration ? 'call length' : 'no answer'}</small></div>
        <dl className="fx-facts">{[['Lead', c.name], ['State', c.state || '–'], ['Agent', c.agent || '–'], ['When', c.at], ['To first call', c.secs === '–' ? '–' : `${c.secs} s`], ['Try', c.attempt], ['Cost', cost]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        {(c.summary || c.note) && <><h3 className="fx-h3">What happened</h3><p className="tp-mid">{c.summary || c.note}</p></>}
        {c.transfer && <><h3 className="fx-h3">The transfer</h3><ol className="ai-beats">{beatsOf(c).map(b => <li key={b}>{b}</li>)}</ol></>}
        <h3 className="fx-h3">Transcript</h3>
        {lines.length
          ? <ul className="tp-list ai942-script">{lines.map(([who, t], i) => <li key={i} className={who === 'AI' ? 'is-ai' : ''}><small>{who}</small><p>{t}</p></li>)}</ul>
          : <p className="tp-sub">{c.duration ? 'Retell keeps the transcript and the summary with the call; recording stays off until the notice wording is picked.' : 'No one answered, so there is nothing to read.'}</p>}
        {!real && <SampleTag>Sample</SampleTag>}
      </>}
    </Drawer>
  )
}

// P976 — the voice split: Hope and Mark alternate on outgoing calls; one card per voice with its booked rate (booked of
// answered), calls, answered, booked, minutes and cost. Real leads only (tests left out). The higher rate is marked
// once both voices have 10+ answered calls.
const VOICE_TONE = { hope: 'lilac', mark: 'sage' }
function VoiceSplit({ rows, real }) {
  const fair = rows.length > 1 && rows.every(v => v.answered >= 10)
  const best = fair ? Math.max(...rows.map(v => v.rate)) : null
  return (
    <section className="ai976" aria-label="Booked rate by voice">
      <div className="tp-row tp-wrap ai-view-h"><h2 className="fx-h3"><AudioLines size={17} aria-hidden="true" />By voice</h2><span className="tp-grow" />
        <small className="tp-sub">Hope and Mark take turns on every new call. Booked rate = booked of answered.</small></div>
      {rows.length === 0 ? <p className="tp-sub">No calls on the voice split yet{real ? ' (tests are left out).' : '.'}</p> : (
        <ul className="ai976-voices">{rows.map((v, i) => (
          <li key={v.voice} className={`is-${VOICE_TONE[v.voice] || 'stone'}`} style={{ '--i': i }}>
            <div className="ai976-top"><b>{v.label}</b><small>ElevenLabs</small>{best != null && v.rate === best ? <Chip tone="outline">Ahead</Chip> : null}</div>
            <p className="ai976-rate"><b className="tp-num">{v.rate}%</b><span>booked rate</span></p>
            <dl className="ai942-facts ai976-facts">{[['Calls', v.calls], ['Answered', v.answered], ['Booked', v.booked + (v.transferred ? ` +${v.transferred} live` : '')], ['Minutes', v.minutes],
              ['Cost', v.costCents == null ? '–' : money(v.costCents / 100)]].map(([k, val]) => <div key={k}><dt>{k}</dt><dd className={k === 'Cost' ? 'tp-money' : 'tp-num'}>{val}</dd></div>)}</dl>
          </li>
        ))}</ul>
      )}
    </section>
  )
}

export function AiCallsView() {
  const real = useAdmSource() === 'real'
  const r = useRealAiCalls(real)
  const calls = real ? (r.data?.rows || []).map(fromView) : SAMPLE_AI_CALLS
  const [open, setOpen] = useState(null)
  const st = aiStats(calls, SAMPLE_CENTS_PER_MIN)
  const today = calls.filter(c => isToday(c, real))
  const leads = new Set(calls.map(c => c.lead_id)).size
  const delivered = new Set(calls.filter(c => GROUP[c.outcome] === 'delivered').map(c => c.lead_id)).size
  const costToday = today.reduce((t, c) => t + costOf(c, SAMPLE_CENTS_PER_MIN), 0)
  const costKnown = !real || today.some(c => c.costCents != null) || today.length === 0
  const tiles = [
    ['sky', PhoneCall, 'Calls today', today.length, `${calls.length} ${real ? 'in the last 7 days' : 'in all'}`],
    ['lilac', Timer, 'To first call', st.avgSecs == null ? '–' : `${st.avgSecs} s`, 'average, form to first dial'],
    ['butter', Target, 'Reached', `${st.reachedPct}%`, `${st.reached} of ${st.leads} leads`],
    ['sage', CheckCircle2, 'Delivered', `${leads ? Math.round((delivered / leads) * 100) : 0}%`, `${delivered} booked or transferred`],
    ['stone', Wallet, 'Cost today', costKnown ? money(costToday / 100) : '–', real ? 'from Retell' : `at ${SAMPLE_CENTS_PER_MIN}¢ a minute`],
  ]
  return (
    <section className="ai-view ai942" aria-label="AI calls">
      <div className="tp-row tp-wrap ai-view-h"><h2 className="fx-h3"><Bot size={17} aria-hidden="true" />AI calls · {real ? 'last 7 days' : 'today'}</h2><span className="tp-grow" />{real ? null : <><AiSlot /><SampleTag>Sample</SampleTag></>}</div>
      {real && r.error ? <p className="adm-warn" role="alert">Couldn{'’'}t load AI calls: {r.error}</p> : null}
      <ul className="ai942-stats" aria-label="AI call numbers">{tiles.map(([tone, Icon, k, v, sub], i) => (
        <li key={k} className={`is-${tone}`} style={{ '--i': i }}><span className="ai942-ic" aria-hidden="true"><Icon size={16} /></span><small>{k}</small><b className="tp-num">{v}</b><span>{sub}</span></li>
      ))}</ul>
      <VoiceSplit rows={real ? voiceStatsFromView(r.data?.by_voice || []) : voiceStats(calls, SAMPLE_CENTS_PER_MIN)} real={real} />
      {real && r.loading ? <p className="tp-sub">Loading…</p> : calls.length === 0 ? <Empty title="No AI calls yet" sub="They show here once the AI caller is on." /> : (
        <ul className="ai942-calls">{calls.map((c, i) => {
          const g = GROUP[c.outcome] || 'no_answer'
          const cost = c.costCents != null ? money(c.costCents / 100) : real ? null : money(costOf(c, SAMPLE_CENTS_PER_MIN) / 100)
          return (
            <li key={c.id} className={`ai942-call is-${g}`} style={{ '--i': i }}>
              <div className="ai942-call-top"><span className="ai942-out">{GROUP_WORD[g]}</span><small>{OUTCOME_WORD[c.outcome]}{c.attempt > 1 ? ` · try ${c.attempt}` : ''}{c.voice ? ` · ${CALLER_VOICES[c.voice]?.label || c.voice}` : ''}</small>{c.test ? <Chip tone="outline">Test</Chip> : null}</div>
              <h3>{c.name}</h3>
              <p className="ai942-where"><MapPin size={12} aria-hidden="true" />{[c.state, c.agent].filter(Boolean).join(' · ')}</p>
              <dl className="ai942-facts">{[['When', String(c.at).replace('Today, ', '')], ['Length', c.duration ? length(c.duration) : 'No answer'], ['Cost', cost ?? '–']].map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={k === 'Cost' ? 'tp-money' : 'tp-num'}>{v}</dd></div>)}</dl>
              <button type="button" className="fx-pillbtn ai942-open" onClick={() => setOpen(c)} aria-label={`Open the call with ${c.name}`}><Play size={13} aria-hidden="true" />Transcript</button>
            </li>
          )
        })}</ul>
      )}
      <CallSheet c={open} real={real} onClose={() => setOpen(null)} />
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
