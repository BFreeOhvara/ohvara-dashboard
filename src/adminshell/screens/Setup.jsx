import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Unplug, ArrowRight, UserPlus, Send, Rocket, BadgeCheck, Check, CircleDashed, MapPin, Megaphone, MessageSquareText, ShieldCheck,
  PhoneForwarded, Globe, Link2, Copy, Workflow, Plug, History, Hourglass,
} from 'lucide-react'
import { useAdmSetup, useAdmActions, useAdmConnect, useAdmAgents, useAdmSource, PLANS, PLAYBOOK, TRACKING } from '../data'
import { Chip, Empty, SampleTag, Switch, useNote } from '../../template/kit'
import { RecordDrawer, Block } from '../../template/Record'
import { usd } from '../../template/motion'
import { Tile, EngineSlot, Dropdown } from '../kit'
import { AddSomeone } from '../AdminFrame'
import { engineState } from '../engine'
import { useGhlRow } from '../useGhlRow'
import { ap } from '../paths'
import { CAMPAIGN_WORD } from '../words'
import { OWNERS, SETUP_STAGES, readiness } from '../setup'

// P866 — Setup (a top tab): everything it takes to get a new client live, from "an agent signs with us" to "their
// leads are flowing". Top: is the system ready (GoHighLevel and what it runs)? Main: every agent not live yet, in
// columns by stage, with the blocker and who owns the next step. A card opens the full checklist. Sample until P858.
const money = usd()
const ICON = { ghl: Plug, a2p: MessageSquareText, workflows: Workflow, account: Megaphone, tracking: PhoneForwarded, form: Globe }
const planLine = c => [c.states.length ? c.states.join(', ') : 'States not set yet', c.plan ? PLANS[c.plan].label : 'No plan yet'].join(' · ')

// A. Is the system ready? One line per piece GoHighLevel runs. Until it is connected: the Go to Connect state.
function Readiness({ row, peek, setPeek }) {
  const navigate = useNavigate()
  const { data: c } = useAdmConnect()
  const st = engineState(row)
  const on = st.on || peek
  const sync = st.on ? st.line.replace(/^Connected · last sync /, '') : '5 min ago'
  const items = readiness(c, { on, sync, workflows: PLAYBOOK, tracking: TRACKING })
  const ready = items.filter(x => x.tone === 'green').length
  return (
    <section className="fx-tile adm-ready" style={{ '--i': 0 }} aria-label="System readiness">
      <header className="fx-tile-h">
        <span className="tp-grow"><h2>System readiness</h2><p>{on ? `${ready} of ${items.length} ready` : 'What GoHighLevel runs for every client'}</p></span>
        {peek && !st.on ? <SampleTag>Sample</SampleTag> : <EngineSlot settings={row} />}
      </header>
      {!on && (
        <div className="adm-ready-empty">
          <span className="adm-empty-ic"><Unplug size={22} aria-hidden="true" /></span>
          <span className="tp-grow"><b>Nothing connected yet</b><small>Jordan connects GoHighLevel on Connect. Once it is on, each line below turns green with its last sync.</small></span>
          <span className="tp-row tp-wrap adm-ready-go">
            <button type="button" className="tp-primary fx-accent" onClick={() => navigate(ap('connect'))}>Go to Connect<ArrowRight size={15} /></button>
            <button type="button" className="tp-btn ov-ghost" onClick={() => setPeek(true)}>See a sample</button>
          </span>
        </div>
      )}
      <ul className="adm-ready-list">{items.map(x => {
        const Icon = ICON[x.key]
        return (
          <li key={x.key} className={`is-${x.tone}`}>
            <Icon size={15} aria-hidden="true" />
            <span className="tp-grow"><b>{x.label}</b><small>{x.sub}</small></span>
            <Chip tone={x.tone}>{x.word}</Chip>
          </li>
        )
      })}</ul>
      {peek && !st.on && <button type="button" className="tp-link adm-ready-back" onClick={() => setPeek(false)}>Back to the real state</button>}
    </section>
  )
}

// B. One client on the pipeline.
function SetupCard({ c, i }) {
  const stage = SETUP_STAGES.find(s => s.key === c.stage)
  const owner = c.owner && OWNERS[c.owner]
  return (
    <article className={`fx-card adm-scard is-${stage.tone}`} style={{ '--i': i }}>
      <Link to={ap('setup', c.id)} className="fx-cover" aria-label={`Open ${c.name}'s setup`} />
      <h3>{c.name}</h3>
      <p>{planLine(c)}</p>
      <div className="adm-scard-bar"><span className="fx-meter" aria-hidden="true"><i style={{ '--w': c.pct / 100 }} /></span><b className="adm-scard-pct tp-num" aria-label={`${c.pct}% done`}>{c.pct}%</b></div>
      <small className={`adm-scard-wait${c.note && c.noteOn === c.next?.key ? ' is-warn' : ''}`}>{c.blocker ? <><Hourglass size={12} aria-hidden="true" />{c.blocker}</> : <><Check size={12} aria-hidden="true" />Every step done</>}</small>
      <footer className="adm-scard-f">{owner ? <>Next<Chip tone={owner.tone}>{owner.label}</Chip></> : <><BadgeCheck size={13} aria-hidden="true" />Live {c.liveOn}</>}</footer>
    </article>
  )
}

// C. The checklist drawer: every step, ticked or open, with who does it.
function SetupDrawer({ id, onClose, row }) {
  const { data: list } = useAdmSetup()
  const { tickSetup, markLaunched, markLive, resendInvite, resendSetupInvite } = useAdmActions()
  const note = useNote()
  const c = list.find(x => x.id === id)
  if (!c) return <RecordDrawer label="Not found" kicker="Setup" onClose={onClose} hero={<h2>No client here</h2>}><p className="fx-calm">This client is not in setup any more.</p></RecordDrawer>
  const stage = SETUP_STAGES.find(s => s.key === c.stage)
  const invited = !!c.invite
  const jordanOpen = c.steps.some(s => s.who === 'jordan' && !s.done)
  const resend = () => { (invited ? resendInvite : resendSetupInvite)(c.id); note(`Invite sent again to ${c.name} (sample: nothing was sent)`) }
  const groups = ['agent', 'jordan', 'ohvara'].map(who => ({ who, steps: c.steps.filter(s => s.who === who) }))
  return (
    <RecordDrawer label={c.name} kicker={`Setup · started ${c.since}`} tone={stage.tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><Rocket size={13} aria-hidden="true" />{stage.label}</span><Chip tone={c.owner ? OWNERS[c.owner].tone : 'green'}>{c.owner ? `Next: ${OWNERS[c.owner].label}` : 'Live'}</Chip></div>
        <h2>{c.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{c.city ? `${c.city}, ${c.state} · ` : ''}{planLine(c)}{c.spend ? ` · ${money(c.spend)} a week on leads` : ''}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big tp-num">{c.count} of {c.total} steps</b><span className="adm-pctbig tp-num">{c.pct}%</span></div>
      </>}
      actions={<>
        <button type="button" className="tp-btn ov-ghost" disabled={!invited && c.done.includes('invite')} title={!invited ? 'They already accepted' : undefined} onClick={resend}><Send size={15} />Send invite again</button>
        <button type="button" className="tp-btn ov-ghost" disabled={invited || !jordanOpen || c.stage === 'live'} onClick={() => { markLaunched(c.id); note(`${c.name} marked launched (sample)`) }}><Rocket size={15} />Mark launched (Jordan)</button>
        <button type="button" className="tp-primary fx-accent" disabled={!c.canLive} title={c.canLive ? undefined : 'Every other step first'} onClick={() => { markLive(c.id); note(`${c.name} is live`) }}><BadgeCheck size={16} />Mark live</button>
      </>}>
      {c.blocker && <p className={`adm-blocker${c.note && c.noteOn === c.next?.key ? ' is-warn' : ''}`}><Hourglass size={14} aria-hidden="true" /><span className="tp-grow">{c.blocker}</span><Chip tone={OWNERS[c.owner].tone}>{OWNERS[c.owner].label}</Chip></p>}
      {groups.map(g => (
        <Block key={g.who} title={`${OWNERS[g.who].label} · ${OWNERS[g.who].where}`} sub={`${g.steps.filter(s => s.done).length} of ${g.steps.length} done`} aside={g.who === 'jordan' ? <EngineSlot settings={row} /> : null}>
          <ul className="adm-steps">{g.steps.map(s => {
            const canTick = !invited && g.who !== 'agent' && s.key !== 'live'
            return (
              <li key={s.key} className={s.done ? 'is-done' : ''}>
                {s.done ? <Check size={15} aria-hidden="true" /> : <CircleDashed size={15} aria-hidden="true" />}
                <span className="tp-grow">{s.label}{!s.done && c.next?.key === s.key && <small>Next step</small>}</span>
                {canTick && <Switch on={s.done} label={s.label} onChange={v => { tickSetup(c.id, s.key, v); note(`${v ? 'Ticked' : 'Unticked'} ${s.label.toLowerCase()}`) }} />}
              </li>
            )
          })}</ul>
          {g.who === 'agent' && <small className="adm-note">The agent ticks these in their own portal.</small>}
        </Block>
      ))}
      <Block title="History" aside={<History size={15} aria-hidden="true" />}>
        <ul className="adm-log">{c.log.map((l, i) => <li key={`${l.at}-${i}`}><b>{l.what}</b><small>{l.at} · {l.who}</small></li>)}{c.log.length === 0 && <li className="tp-sub">No changes yet.</li>}</ul>
      </Block>
    </RecordDrawer>
  )
}

// P858: the real campaign → agent map (ghl_campaign_agents, migration 232). Campaigns arrive with the daily ad spend
// pull; each one is mapped to the agent it buys leads for (one per agent), with the agent named in it suggested.
function CampaignMap({ campaigns, agents, spent }) {
  const { mapCampaign } = useAdmActions()
  const note = useNote()
  const pick = (k, agentId) => { if (!mapCampaign) return; mapCampaign(k.id, agentId || null, k.lead_type); note(agentId ? `${k.name} → ${agents.find(a => a.id === agentId)?.name}. Logged.` : `${k.name} unmapped. Logged.`) }
  return (
    <Tile i={1} title="Campaigns and their agents" sub={`One campaign per agent · ${money(spent)} spent this week`}>
      {campaigns.length === 0 && <Empty title="No campaigns yet" sub="They show here after the first ad spend pull from GoHighLevel." />}
      <ul className="tp-list adm-rows">{campaigns.map(k => (
        <li key={k.id} className="fx-mrow"><Megaphone size={16} aria-hidden="true" />
          <span className="tp-grow"><b>{k.name}</b><small>{k.agent_id ? 'Mapped' : k.suggested ? `Suggested: ${agents.find(a => a.id === k.suggested)?.name}` : 'Not mapped yet'}{k.seen ? ` · seen ${k.seen}` : ''}</small></span>
          <Dropdown label={`Agent for ${k.name}`} value={k.agent_id || ''} placeholder={k.suggested ? 'Pick (see suggestion)' : 'No agent'} onChange={v => pick(k, v)}
            options={[{ value: '', label: 'No agent' }, ...agents.map(a => ({ value: a.id, label: a.name, sub: a.id === k.suggested ? 'Suggested' : undefined }))]} />
        </li>
      ))}</ul>
    </Tile>
  )
}

// What GoHighLevel set up (P864's Connect > Setup view), shown under the pipeline once it is connected or sampled.
function GhlDetails({ row, sample }) {
  const { data: c } = useAdmConnect()
  const { data: agents } = useAdmAgents()
  const note = useNote()
  const real = useAdmSource() === 'real'
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
    <section className="adm-ghl" aria-label="What GoHighLevel set up">
      <h2 className="adm-sec-h">What GoHighLevel set up</h2>
      <div className="fx-ovl">
        <div className="fx-ovl-main adm-stack">
          <Tile i={0} title="Workflows" sub={`${Object.values(wfOn).filter(Boolean).length} of ${PLAYBOOK.length} on · from the playbook`} aside={sample && <SampleTag>Sample</SampleTag>}>
            <ul className="tp-list adm-wfl">{PLAYBOOK.map(w => (
              <li key={w.code} className="fx-mrow"><b className="adm-code tp-num">{w.code}</b><span className="tp-grow"><b>{w.name}</b><small>{wfOn[w.code] ? `Last ran ${w.last}` : 'Off'}</small></span>
                <Switch on={wfOn[w.code]} label={`${w.code} ${w.name}`} onChange={v => { setWfOn({ ...wfOn, [w.code]: v }); note(`${w.code} ${v ? 'on' : 'off'} (sample: switches it in GoHighLevel once wired)`) }} /></li>
            ))}</ul>
          </Tile>
          {real ? <CampaignMap campaigns={c.campaigns || []} agents={agents} spent={spent} /> : (
          <Tile i={1} title="Campaigns and their agents" sub={`One campaign per agent · ${money(spent)} spent this week`} aside={sample && <SampleTag>Sample</SampleTag>}>
            <ul className="tp-list adm-rows">{campaigns.map(k => (
              <li key={k.id} className="fx-mrow"><Megaphone size={16} aria-hidden="true" /><span className="tp-grow"><b>{k.name}</b><small>Leads go to {k.agent}</small></span><b className="tp-money">{money(k.spend)}</b></li>
            ))}</ul>
          </Tile>)}
        </div>
        <div className="fx-ovl-side adm-side">
          <Tile className="is-deep" i={2} title="Connection" sub={st.on ? st.line : 'Sample'} aside={<Chip tone={st.on ? 'green' : 'mute'}>{st.on ? 'Connected' : 'Sample'}</Chip>}>
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
    </section>
  )
}

export default function Setup() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: list } = useAdmSetup()
  const row = useGhlRow()
  const [peek, setPeek] = useState(false)
  const [adding, setAdding] = useState(false)
  const on = engineState(row).on
  let card = 0
  return (
    <div className="tp-page fx-page adm-setup">
      {/* P867: the new-clients board first (it fills the window, data-fold) so System readiness peeks below it */}
      <div className="adm-setup-top" data-fold>
      <div className="adm-setup-tools">
        <span className="adm-setup-h"><h2 className="adm-sec-h">New clients</h2><small className="tp-sub">{list.filter(c => c.stage !== 'live').length} getting set up · {list.filter(c => c.stage === 'live').length} live this week</small></span>
        <button type="button" className="tp-primary fx-accent" onClick={() => setAdding(true)}><UserPlus size={16} />Add a new client</button>
      </div>
      <div className="fx-board adm-board7" role="region" aria-label="New clients by stage">
        {SETUP_STAGES.map((b, li) => {
          const rows = list.filter(c => c.stage === b.key)
          return (
            <section key={b.key} className={`fx-lane is-${b.tone}`} style={{ '--i': li }} aria-label={`${b.label}, ${rows.length}`}>
              <header className="fx-lane-h"><i aria-hidden="true" /><b>{b.label}</b><span>{rows.length}</span></header>
              <div className="fx-lane-b">
                {rows.map(c => <SetupCard key={c.id} c={c} i={card++} />)}
                {rows.length === 0 && <Empty title="Nobody here" sub={b.empty} />}
              </div>
            </section>
          )
        })}
      </div>
      </div>

      <Readiness row={row} peek={peek} setPeek={setPeek} />

      {(on || peek) && <GhlDetails row={row} sample={!on} />}

      <AddSomeone open={adding} onClose={() => setAdding(false)} />
      {id && <SetupDrawer id={id} row={row} onClose={() => navigate(ap('setup'))} />}
    </div>
  )
}
