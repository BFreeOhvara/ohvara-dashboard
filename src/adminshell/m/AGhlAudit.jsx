import { useMemo, useState } from 'react'
import { Megaphone, Copy, Search } from 'lucide-react'
import { useAdmActions, useAdmConnect, useAdmAgents, useAdmSource, useAdmAudit, PLAYBOOK, TRACKING } from '../data'
import { useNote } from '../../template/kit'
import { usd } from '../../template/motion'
import { engineState } from '../engine'
import { CAMPAIGN_WORD } from '../words'
import { SubPage, Toggle, rise } from '../../template/m/AppKit'

// P1008 — the two admin-phone gaps P1002 left, the desktop's words and data: "What GoHighLevel set up" (the panels under
// the pipeline on screens/Setup.jsx) and the Audit log (Settings > Audit log on screens/Settings.jsx). Same hooks, the
// phone's own look.
const money = usd()
const TAG = { green: 'sage', blue: 'sky', warn: 'coral', mute: 'stone' }

const Group = ({ title, sub, i = 0, children }) => (
  <section className="ma-rise" style={rise(i)}>
    <div className="ma-h2"><h2>{title}</h2></div>
    {sub && <p className="ma-hint">{sub}</p>}
    <div className="ma-glass ma-list">{children}</div>
  </section>
)

// The real campaign → agent map (ghl_campaign_agents): one campaign per agent, the agent named in it suggested.
function CampaignMapM({ campaigns, agents, spent }) {
  const { mapCampaign } = useAdmActions()
  const note = useNote()
  const pick = (k, agentId) => { if (!mapCampaign) return; mapCampaign(k.id, agentId || null, k.lead_type); note(agentId ? `${k.name} → ${agents.find(a => a.id === agentId)?.name}. Logged.` : `${k.name} unmapped. Logged.`) }
  return (
    <Group title="Campaigns and their agents" sub={`One campaign per agent · ${money(spent)} spent this week`} i={1}>
      {campaigns.length === 0 && <p className="ma-empty">No campaigns yet. They show here after the first ad spend pull from GoHighLevel.</p>}
      {campaigns.map(k => (
        <div key={k.id} className="ma-row am-camp">
          <span className="ma-sym is-sky"><Megaphone size={16} aria-hidden="true" /></span>
          <span className="ma-grow"><b>{k.name}</b><small>{k.agent_id ? 'Mapped' : k.suggested ? `Suggested: ${agents.find(a => a.id === k.suggested)?.name}` : 'Not mapped yet'}{k.seen ? ` · seen ${k.seen}` : ''}</small>
            <select className="am-sel" aria-label={`Agent for ${k.name}`} value={k.agent_id || ''} onChange={e => pick(k, e.target.value)}>
              <option value="">{k.suggested ? 'Pick (see suggestion)' : 'No agent'}</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.id === k.suggested ? ' (suggested)' : ''}</option>)}
            </select>
          </span>
        </div>
      ))}
    </Group>
  )
}

export function AGhlDetails({ row, sample }) {
  const { data: c } = useAdmConnect()
  const { data: agents } = useAdmAgents()
  const note = useNote()
  const real = useAdmSource() === 'real'
  const [wfOn, setWfOn] = useState(() => Object.fromEntries(PLAYBOOK.map(w => [w.code, w.on])))
  const spent = c.ads.reduce((t, a) => t + a.spent, 0)
  // One campaign per agent, so spend per agent = spend per campaign; this week's spend shared by budget.
  const campaigns = useMemo(() => {
    const list = agents.filter(a => a.access !== false)
    const weight = list.reduce((t, a) => t + a.spend, 0) || 1
    const shares = list.map(a => Math.round((spent * a.spend) / weight))
    const extra = spent - shares.reduce((t, n) => t + n, 0)
    return list.map((a, i) => ({ id: a.id, agent: a.name, name: `Deedstone · ${a.name}`, spend: shares[i] + (i === list.length - 1 ? extra : 0) }))
  }, [agents, spent])
  const st = engineState(row)
  const [bw, bt] = CAMPAIGN_WORD[c.texting.brand]
  const [cw, ct] = CAMPAIGN_WORD[c.texting.campaign]
  const copy = text => { try { navigator.clipboard?.writeText(text) } catch { /* no clipboard: the toast still says what to copy */ } note('Link copied') }
  return (
    <section className="am-ghl" aria-label="What GoHighLevel set up">
      <div className="ma-h2 ma-rise" style={rise(5)}><h2>What GoHighLevel set up</h2>{sample && <span>Sample</span>}</div>
      <Group title="Workflows" sub={`${Object.values(wfOn).filter(Boolean).length} of ${PLAYBOOK.length} on · from the playbook`} i={0}>
        {PLAYBOOK.map(w => (
          <div key={w.code} className="ma-row">
            <span className="ma-grow"><b>{w.code} {w.name}</b><small>{wfOn[w.code] ? `Last ran ${w.last}` : 'Off'}</small></span>
            <Toggle on={wfOn[w.code]} label={`${w.code} ${w.name}`} onChange={v => { setWfOn({ ...wfOn, [w.code]: v }); note(`${w.code} ${v ? 'on' : 'off'} (sample: switches it in GoHighLevel once wired)`) }} />
          </div>
        ))}
      </Group>
      {real ? <CampaignMapM campaigns={c.campaigns || []} agents={agents} spent={spent} /> : (
        <Group title="Campaigns and their agents" sub={`One campaign per agent · ${money(spent)} spent this week`} i={1}>
          {campaigns.map(k => (
            <div key={k.id} className="ma-row"><span className="ma-sym is-sky"><Megaphone size={16} aria-hidden="true" /></span><span className="ma-grow"><b>{k.name}</b><small>Leads go to {k.agent}</small></span><b>{money(k.spend)}</b></div>
          ))}
        </Group>
      )}
      <Group title="Connection" sub={st.on ? st.line : 'Sample'} i={2}>
        <div className="ma-row"><span className="ma-grow"><b>Location</b><small>GoHighLevel sub-account</small></span><span className="am-val">{row?.location_id || c.ghl.locationId}</span></div>
        <div className="ma-row"><span className="ma-grow"><b>Ad account</b><small>{c.ads.filter(a => a.account).length} of {c.ads.length} set</small></span><span className="am-val">{c.ads.find(a => a.account)?.account || '–'}</span></div>
      </Group>
      <Group title="Texting (A2P)" sub="The number every text comes from" i={3}>
        <div className="ma-row"><span className="ma-grow"><b>Sender number</b><small>{c.texting.sender}</small></span><span className="am-val">{c.texting.number}</span></div>
        <div className="ma-row"><span className="ma-grow"><b>Brand</b></span><span className={`ma-tag is-${TAG[bt] || 'stone'}`}>{bw}</span></div>
        <div className="ma-row"><span className="ma-grow"><b>Campaign</b></span><span className={`ma-tag is-${TAG[ct] || 'stone'}`}>{cw}</span></div>
      </Group>
      <Group title="Tracking numbers" sub="Where each one forwards · calls this week" i={4}>
        {TRACKING.map(t => (
          <div key={t.id} className="ma-row"><span className="ma-grow"><b className="am-val">{t.number}</b><small>{t.label} · to {t.to}</small></span><b>{t.calls}</b></div>
        ))}
      </Group>
      <Group title="Lead form and landing page" sub="The agent ID rides hidden in each campaign's link" i={5}>
        <div className="ma-row"><span className="ma-grow"><b>Landing page</b><small>{c.sources.domain}</small></span>
          <button type="button" className="ma-btn is-soft ma-press" onClick={() => copy(`https://${c.sources.domain}`)}><Copy size={14} aria-hidden="true" /> Copy</button></div>
        {c.sources.forms.filter(f => f.on).map(f => <div key={f.id} className="ma-row"><span className="ma-grow"><b>{f.name}</b><small>{f.fields} fields · {f.leads} leads this week</small></span></div>)}
      </Group>
    </section>
  )
}

// Every admin action, newest first. Append-only: nobody can change or remove a row.
export function AAudit() {
  const { data: rows } = useAdmAudit()
  const [q, setQ] = useState('')
  const n = q.trim().toLowerCase()
  const list = rows.filter(r => !n || `${r.what} ${r.target} ${r.who}`.toLowerCase().includes(n))
  return (
    <SubPage title="Audit log" line="Every admin action, newest first" big>
      <label className="va-find ma-rise" style={rise(0)}><Search size={18} aria-hidden="true" /><input type="search" inputMode="search" enterKeyHint="search" placeholder="Search actions or people" aria-label="Search the log" value={q} onChange={e => setQ(e.target.value)} /></label>
      <p className="ma-hint">Append-only: nobody can change or remove a row. {rows.length} {rows.length === 1 ? 'entry' : 'entries'}.</p>
      <div className="ma-glass ma-list ma-rise" style={rise(1)}>
        {list.length === 0 && <p className="ma-empty">Nothing matches that.</p>}
        {list.map(r => (
          <div key={r.id} className="ma-row am-aud"><span className="ma-grow"><b>{r.what}</b><small>{r.target}</small><small>{r.at} · {r.who}</small></span></div>
        ))}
      </div>
    </SubPage>
  )
}
