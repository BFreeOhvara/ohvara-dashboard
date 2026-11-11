import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Unplug, ArrowRight, Send, BadgeCheck, Check, CircleDashed, MapPin, Megaphone, MessageSquareText, ShieldCheck,
  PhoneForwarded, Globe, Link2, Copy, Workflow, Plug, History, Hourglass, ExternalLink, RotateCw, Lock, Power, CircleX, CircleCheck, PhoneOutgoing, PauseCircle,
} from 'lucide-react'
import { useAdmSetup, useAdmActions, useAdmConnect, useAdmAgents, useAdmSource, PLANS, PLAYBOOK, TRACKING } from '../data'
import { Chip, Empty, SampleTag, Switch, useNote } from '../../template/kit'
import { RecordDrawer, Block } from '../../template/Record'
import { usd } from '../../template/motion'
import { Tile, EngineSlot, Dropdown } from '../kit'
import { engineState } from '../engine'
import { useGhlRow } from '../useGhlRow'
import { ap } from '../paths'
import { CAMPAIGN_WORD } from '../words'
import { OWNERS, SETUP_STAGES, CAMPAIGN_REQ, readiness, signupOf } from '../setup'
import '../p941.css'

// P866 — Setup (a top tab). P906: Setup = one ticket per agent who has PAID (setup fee + first days of lead spend).
// No adding agents or clients by hand: agents sign up and pay themselves, and appear here once they've paid. Each
// ticket is the agent's finished sign-up (P941: plan, spend, paid on, states, hours, transfers, read-only at the top),
// then a short checklist: Meta campaign created from the template with their agent ID ("Create campaign" sends the
// request through the GoHighLevel engine slot; its status comes back to the ticket) → every launch check passes (P913,
// in plain words since P941) → Turn campaign on → done. Meta Ads Manager and GoHighLevel refuse to be shown inside other
// sites, so anything done there opens in a new tab from a button on the ticket. Below: is the system ready?
const money = usd()
const cents = usd(true)
const ICON = { ghl: Plug, a2p: MessageSquareText, workflows: Workflow, account: Megaphone, tracking: PhoneForwarded, form: Globe }
const LEAD_WORD = { live: 'Appointments + live transfers', appointment: 'Appointments only' }
const planLine = c => [c.states.length ? c.states.join(', ') : 'States not set', c.plan ? PLANS[c.plan].label : 'No plan', c.spend ? `${money(c.spend)} a day` : null].filter(Boolean).join(' · ')
// Opened in a new tab: both refuse to be framed inside another site.
const EXTERNAL = [
  { key: 'meta', label: 'Open Meta Ads Manager', href: 'https://adsmanager.facebook.com/adsmanager/manage/campaigns' },
  { key: 'ghl', label: 'Open GoHighLevel', href: 'https://app.gohighlevel.com/' },
]
const copyText = (text, note, what) => { try { navigator.clipboard?.writeText(text) } catch { /* no clipboard: the toast still says it */ } note(`${what} copied`) }

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

// B. One ticket on the board.
function SetupCard({ c, i }) {
  const stage = SETUP_STAGES.find(s => s.key === c.stage)
  const owner = c.owner && OWNERS[c.owner]
  return (
    <article className={`fx-card adm-scard is-${stage.tone}`} style={{ '--i': i }}>
      <Link to={ap('setup', c.id)} className="fx-cover" aria-label={`Open ${c.name}'s ticket`} />
      <h3>{c.name}</h3>
      <p>{planLine(c)}</p>
      <div className="adm-scard-bar"><span className="fx-meter" aria-hidden="true"><i style={{ '--w': c.pct / 100 }} /></span><b className="adm-scard-pct tp-num" aria-label={`${c.pct}% done`}>{c.pct}%</b></div>
      <small className={`adm-scard-wait${c.warn ? ' is-warn' : ''}`}>{c.blocker ? <><Hourglass size={12} aria-hidden="true" />{c.blocker}</> : <><Check size={12} aria-hidden="true" />Every step done</>}</small>
      <footer className="adm-scard-f">{owner ? <>Next<Chip tone={owner.tone}>{owner.label}</Chip></> : <><BadgeCheck size={13} aria-hidden="true" />Done {c.liveOn}</>}</footer>
    </article>
  )
}

// The "Create campaign" step: send the request through the engine slot; its answer comes back here.
function CampaignRequest({ c, row }) {
  const { requestCampaign } = useAdmActions()
  const note = useNote()
  const [tone, word] = CAMPAIGN_REQ[c.req]
  const send = () => {
    if (!requestCampaign) { note('Create campaign goes through GoHighLevel once it is connected'); return }
    requestCampaign(c.id)
    note(`Create campaign sent for ${c.name} (sample: GoHighLevel answers in a moment, nothing is sent)`)
  }
  return (
    <div className="adm-req">
      <Megaphone size={16} aria-hidden="true" />
      <span className="tp-grow"><b>{c.campaignReq?.name || `Deedstone · ${c.name} · ${c.agentRef}`}</b>
        <small>{c.req === 'none' ? 'From the template, with their agent ID in the ad link' : `${word}${c.campaignReq?.at ? ` · ${c.campaignReq.at}` : ''}`}</small></span>
      <Chip tone={tone}>{word}</Chip>
      {['none', 'failed'].includes(c.req) && <button type="button" className="tp-primary fx-accent" onClick={send}>{c.req === 'failed' ? <RotateCw size={15} /> : <Send size={15} />}{c.req === 'failed' ? 'Try again' : 'Create campaign'}</button>}
      <EngineSlot settings={row} />
    </div>
  )
}

// P913 — the seatbelt. Every launch check is a tick with what's wrong when it fails; Turn campaign on stays locked until
// all pass. No skip button. A check that breaks after launch pauses the campaign and reopens the ticket here.
function LaunchChecks({ c }) {
  const { turnCampaignOn, placeTestCall } = useAdmActions()
  const note = useNote()
  const { list, ok, passed } = c.checks
  const on = c.done.includes('on') && ok
  const first = c.name.split(' ')[0]
  // P915: on real data the server checks every launch check again before it turns anything on (and says which fails).
  const turnOn = async () => {
    if (!turnCampaignOn) { note('Turning a campaign on goes through GoHighLevel once it is connected'); return }
    const r = await turnCampaignOn(c.id)
    if (!c.real) note(`${c.name}'s campaign is on (sample: nothing is sent)`)
    else if (r) note(`${c.name}'s campaign is on. GoHighLevel gets it within a minute.`)
  }
  // Real: the VAs are asked to call the test lead now (it rings the agent's own phone); the tick passes once it's logged.
  const testCall = async () => {
    const r = await placeTestCall?.(c.id)
    if (!c.real) note(`AI test call placed to ${c.name}'s own number (sample)`)
    else if (r) note(r.data?.already ? 'The test call is already logged' : `Asked ${r.data?.asked ?? 0} VA${r.data?.asked === 1 ? '' : 's'} to call ${first}'s test lead now`)
  }
  return (
    <Block title="Launch checks" sub={<span className="adm-checks-n">{passed} of {list.length} pass</span>}>
      {c.paused && <p className="adm-paused"><PauseCircle size={15} aria-hidden="true" /><span className="tp-grow"><b>Campaign paused, ticket reopened.</b> {c.checks.failed[0].why} It turns back on only once every check passes again.</span></p>}
      <ul className="adm-checks" aria-label="Launch checks">{list.map(x => (
        <li key={x.key} className={x.ok ? 'is-ok' : 'is-bad'}>
          {x.ok ? <CircleCheck size={16} aria-label="Passes" /> : <CircleX size={16} aria-label="Fails" />}
          <span className="tp-grow"><b>{x.label}</b><small>{x.text}{x.key === 'testCall' && !x.ok && c.launch?.testCallAsked ? ` VAs asked ${c.launch.testCallAsked}.` : ''}</small></span>
          {x.key === 'testCall' && !x.ok && c.launch?.testLead && <button type="button" className="fx-pillbtn" onClick={testCall}><PhoneOutgoing size={13} />Place test call</button>}
        </li>
      ))}</ul>
      {on
        ? <p className="adm-launch-lock"><Power size={14} aria-hidden="true" />Campaign on. It pauses by itself if a check breaks.</p>
        : <div className="tp-row tp-wrap">
          <button type="button" className="tp-primary fx-accent" disabled={!c.canLaunch} aria-disabled={!c.canLaunch} onClick={turnOn}>
            {c.canLaunch ? <Power size={16} /> : <Lock size={16} />}Turn campaign on
          </button>
          {!c.canLaunch && <span className="adm-launch-lock"><Lock size={13} aria-hidden="true" />{ok ? 'Create their campaign first.' : `Locked until all ${list.length} checks pass. Admins can't skip one.`}</span>}
        </div>}
    </Block>
  )
}

// P941 — the agent's finished sign-up, read-only at the top of the ticket.
// P955: with the products they picked; a ticket exists only with Leads (setup.js hasTicket).
function SignupBlock({ c }) {
  const s = signupOf(c, { plans: PLANS })
  return (
    <Block title="Their sign-up" sub="What they picked and paid for. Read-only.">
      <dl className="adm-su" data-testid="adm-signup">
        <div><dt>Agent</dt><dd>{c.name}</dd></div>
        <div className="is-wide"><dt>Products</dt><dd className="adm-su-chips" data-testid="adm-signup-products">{s.products.map(x => <Chip key={x.key} tone={x.tone}>{x.label}</Chip>)}<small>Leads paid: {s.via}</small></dd></div>
        <div><dt>Plan</dt><dd>{s.plan}</dd></div>
        <div><dt>Daily spend</dt><dd><span className="tp-money">{money(s.daily)}</span> a day</dd></div>
        <div><dt>Paid</dt><dd>{s.paid ? <>On {s.paid.short} · <span className="tp-money">{cents(s.paid.total)}</span><small>Setup <span className="tp-money">{money(s.paid.setup)}</span> · first month <span className="tp-money">{money(s.paid.plan)}</span> · first 2 days of leads <span className="tp-money">{cents(s.paid.leads)}</span></small></> : s.paidOn ? `On ${s.paidOn}` : 'Not yet'}</dd></div>
        <div className="is-wide"><dt>Licensed states</dt><dd className="adm-su-chips">{s.states.length ? s.states.map(x => <Chip key={x} tone="blue">{x}</Chip>) : 'None picked'}</dd></div>
        <div><dt>Hours</dt><dd>{s.hours || 'Not set'}</dd></div>
        <div><dt>Time zone</dt><dd>{s.tz || 'Not set'}</dd></div>
        <div><dt>Live transfers</dt><dd>{s.live ? 'Yes' : 'No, appointments only'}</dd></div>
      </dl>
    </Block>
  )
}

// C. The ticket: their sign-up, the checklist, the tools that open in a new tab, and the history.
function SetupDrawer({ id, onClose, row }) {
  const { data: list } = useAdmSetup()
  const { markLive } = useAdmActions()
  const note = useNote()
  const c = list.find(x => x.id === id)
  if (!c) return <RecordDrawer label="Not found" kicker="Setup" onClose={onClose} hero={<h2>No ticket here</h2>}><p className="fx-calm">There's no Setup ticket for this agent. Agents show here once they've paid.</p></RecordDrawer>
  const stage = SETUP_STAGES.find(s => s.key === c.stage)
  const paidOn = c.signup?.paidShort || c.paid?.short || c.paid?.on || c.since
  return (
    <RecordDrawer label={c.name} kicker={`Setup ticket · paid ${paidOn}`} tone={stage.tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><BadgeCheck size={13} aria-hidden="true" />{stage.label}</span><Chip tone={c.owner ? OWNERS[c.owner].tone : 'green'}>{c.owner ? `Next: ${OWNERS[c.owner].label}` : 'Done'}</Chip></div>
        <h2>{c.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{c.city ? `${c.city}, ${c.state} · ` : ''}{planLine(c)} · {LEAD_WORD[c.lead] || LEAD_WORD.appointment}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big tp-num">{c.count} of {c.total} steps</b><span className="adm-pctbig tp-num">{c.pct}%</span></div>
      </>}
      actions={<>
        {c.next?.key === 'campaign' && c.req === 'none' && <CampaignButton c={c} />}
        <button type="button" className="tp-primary fx-accent" disabled={!c.canLive} title={c.canLive ? undefined : 'Every other step first'} onClick={() => { markLive(c.id); note(`${c.name}'s ticket is done`) }}><BadgeCheck size={16} />Mark done</button>
      </>}>
      <SignupBlock c={c} />
      {c.blocker && <p className={`adm-blocker${c.warn ? ' is-warn' : ''}`}><Hourglass size={14} aria-hidden="true" /><span className="tp-grow">{c.blocker}</span><Chip tone={OWNERS[c.owner].tone}>{OWNERS[c.owner].label}</Chip></p>}
      <Block title="Checklist" sub={`${c.steps.filter(s => s.done).length} of ${c.steps.length} done`}>
        <ul className="adm-steps">{c.steps.map(s => (
          <li key={s.key} className={s.done ? 'is-done' : ''}>
            {s.done ? <Check size={15} aria-hidden="true" /> : <CircleDashed size={15} aria-hidden="true" />}
            <span className="tp-grow">{s.label}{!s.done && c.next?.key === s.key && <small>Next step</small>}
              {s.key === 'signup' && s.done && <small>Paid {paidOn}</small>}</span>
          </li>
        ))}</ul>
        <CampaignRequest c={c} row={row} />
      </Block>
      {c.done.includes('campaign') && <LaunchChecks c={c} />}
      {c.push?.length > 0 && <Block title="Campaign on/off in GoHighLevel" sub="The last send of each side. A failed send retries by itself.">
        <ul className="adm-log">{c.push.map(p => <li key={p.side}><b>{p.side}: {p.what}</b><small><Chip tone={p.tone}>{p.tone === 'green' ? 'Sent' : p.tone === 'warn' ? 'Failing' : 'Waiting'}</Chip> {p.text}</small></li>)}</ul>
      </Block>}
      <Block title="How their leads find them" sub="The agent ID rides hidden in the ad link; the Meta campaign ID is the backup. Either one matches a lead to them.">
        <p className="adm-ticket-id">Agent ID <b className="tp-num">{c.agentRef}</b><button type="button" className="fx-pillbtn" onClick={() => copyText(c.agentRef, note, 'Agent ID')}><Copy size={13} />Copy</button></p>
        <p className="adm-ticket-id">Meta campaign ID <b className="tp-num">{c.launch?.campaignId || 'Not saved yet'}</b>{c.launch?.campaignId && <button type="button" className="fx-pillbtn" onClick={() => copyText(c.launch.campaignId, note, 'Campaign ID')}><Copy size={13} />Copy</button>}</p>
      </Block>
      <Block title="Open in a new tab" sub="Meta Ads Manager and GoHighLevel don't open inside other sites.">
        <div className="adm-ext">{EXTERNAL.map(x => <a key={x.key} className="tp-btn ov-ghost" href={x.href} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />{x.label}</a>)}</div>
      </Block>
      <Block title="History" aside={<History size={15} aria-hidden="true" />}>
        <ul className="adm-log">{c.log.map((l, i) => <li key={`${l.at}-${i}`}><b>{l.what}</b><small>{l.at} · {l.who}</small></li>)}{c.log.length === 0 && <li className="tp-sub">No changes yet.</li>}</ul>
      </Block>
    </RecordDrawer>
  )
}

function CampaignButton({ c }) {
  const { requestCampaign } = useAdmActions()
  const note = useNote()
  return <button type="button" className="tp-btn ov-ghost" onClick={() => { if (!requestCampaign) { note('Create campaign goes through GoHighLevel once it is connected'); return } requestCampaign(c.id); note(`Create campaign sent for ${c.name} (sample)`) }}><Send size={15} />Create campaign</button>
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
  const on = engineState(row).on
  let card = 0
  return (
    <div className="tp-page fx-page adm-setup">
      {/* P867: the ticket board first (it fills the window, data-fold) so System readiness peeks below it */}
      <div className="adm-setup-top" data-fold>
      <div className="adm-setup-tools">
        <span className="adm-setup-h"><h2 className="adm-sec-h">Paid agents to live</h2><small className="tp-sub">{list.filter(c => c.stage !== 'live').length} open tickets · {list.filter(c => c.stage === 'live').length} done this week · agents show here once they've paid</small></span>
      </div>
      <div className="fx-board adm-board4" role="region" aria-label="Setup tickets by step">
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

      {id && <SetupDrawer id={id} row={row} onClose={() => navigate(ap('setup'))} />}
    </div>
  )
}
