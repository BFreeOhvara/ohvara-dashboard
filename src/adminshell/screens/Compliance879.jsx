import { useState } from 'react'
import { Check, PhoneOff, ShieldAlert, MessageSquareWarning, Gavel, FileLock2, Download, Lock, FileSearch, ShieldCheck } from 'lucide-react'
import { Chip, Seg, SampleTag, Avatar, useNote } from '../../template/kit'
import { Block } from '../../template/Record'
import { EngineSlot } from '../kit'
import { DNC, INCIDENTS, COMPLAINTS, LEGAL, DATA_REQUESTS, DR_KEPT, daysLeft, consentOf, SOURCE_AD, assignable } from '../p879'
import '../p879.css'

// P879 — Settings › Compliance (sample): the internal do-not-call list, licensed-task incidents, complaints, legal
// holds and data requests. Plus two Leads drawer blocks: the consent proof, and Unassigned routing.

// N-J-15: one tap on any call adds a number; it holds for every agent and queue at once; kept 5 years; inbound
// calls from it are still answered.
function DoNotCall() {
  return (
    <ul className="tp-list">{DNC.map(d => (
      <li key={d.id} className="adm-req"><PhoneOff size={16} aria-hidden="true" />
        <span className="tp-grow"><b className="tp-num">{d.phone} · {d.name}</b><small>{d.how} · {d.by} · {d.at} · kept to {d.keepUntil}</small></span>
        <Chip tone="mute">Every agent and queue</Chip></li>
    ))}
      <li className="tp-sub">Numbers on this list are never called or texted. If they call in, the VA still answers.</li></ul>
  )
}

// N-J-27: a VA crossed the licensed line: the call, who, what was said, the fix, and the agent's callback.
function Incidents() {
  const note = useNote()
  const [rows, setRows] = useState(INCIDENTS)
  return (
    <ul className="tp-list">{rows.map(r => (
      <li key={r.id} className="adm-req"><ShieldAlert size={16} aria-hidden="true" className="p879-warn" />
        <span className="tp-grow"><b>{r.call} · {r.va}</b><small>{r.when} · said: {r.said}</small><small>Fix: {r.fix}</small></span>
        {r.callback ? <Chip tone="green">Agent called back</Chip> : <button type="button" className="tp-btn sm ov-ghost" onClick={() => { setRows(x => x.map(y => (y.id === r.id ? { ...y, callback: true } : y))); note('Marked: the agent called back') }}><Check size={14} />Agent called back</button>}
      </li>
    ))}</ul>
  )
}

// N-J-34: who, channel, summary, owner, due, status, resolution and cause, with the cause trend.
function Complaints() {
  const causes = COMPLAINTS.reduce((m, c) => ({ ...m, [c.cause]: (m[c.cause] || 0) + 1 }), {})
  return (<>
    <ul className="tp-list">{COMPLAINTS.map(c => (
      <li key={c.id} className="adm-req"><MessageSquareWarning size={16} aria-hidden="true" />
        <span className="tp-grow"><b>{c.who} · {c.channel}</b><small>{c.summary} · owner {c.owner} · due {c.due}</small><small>Cause: {c.cause}{c.resolution ? ` · ${c.resolution}` : ''}</small></span>
        <Chip tone={c.status === 'open' ? 'warn' : 'green'}>{c.status === 'open' ? 'Open' : 'Resolved'}</Chip></li>
    ))}</ul>
    <p className="tp-sub">Causes this month: {Object.entries(causes).map(([k, n]) => `${k} (${n})`).join(' · ')}</p>
  </>)
}

// N-J-35: a legal hold freezes deletion for everything on the person; one click exports the evidence.
function Legal() {
  const note = useNote()
  return (
    <ul className="tp-list">{LEGAL.map(l => (
      <li key={l.id} className="adm-req"><Gavel size={16} aria-hidden="true" />
        <span className="tp-grow"><b>{l.who}</b><small>{l.what} · opened {l.opened} · {l.items} items</small>{l.hold && <small className="adm-warn-t"><Lock size={12} aria-hidden="true" />Legal hold: nothing on this person can be deleted</small>}</span>
        <button type="button" className="tp-btn sm ov-ghost" onClick={() => note('Sample: the export (calls, texts, consent proof, timeline) is built when the backend is wired')}><Download size={14} />Export evidence</button></li>
    ))}</ul>
  )
}

// N-J-36: access or delete requests with the deadline, identity checked by calling back, delete except what the law
// keeps, outcome logged.
function DataRequests() {
  const note = useNote()
  const [rows, setRows] = useState(DATA_REQUESTS)
  const set = (id, o) => setRows(x => x.map(y => (y.id === id ? { ...y, ...o } : y)))
  return (<>
    <ul className="tp-list">{rows.map(r => {
      const left = daysLeft(r.due)
      return (
        <li key={r.id} className="adm-req"><FileSearch size={16} aria-hidden="true" />
          <span className="tp-grow"><b>{r.who} · {r.kind === 'delete' ? 'Delete my data' : 'Send me my data'}</b><small>Asked {r.asked} · due {r.due}{left != null ? ` · ${left} days left` : ''}</small>
            <small>{r.verified ? 'Identity checked by calling back the number on file' : 'Call back the number on file to check who they are'}{r.outcome ? ` · ${r.outcome}` : ''}</small></span>
          {!r.verified && <button type="button" className="tp-btn sm ov-ghost" onClick={() => { set(r.id, { verified: true }); note('Identity checked and logged') }}><ShieldCheck size={14} />Checked by call-back</button>}
          {r.verified && !r.outcome && <button type="button" className="tp-primary sm fx-accent" onClick={() => { set(r.id, { outcome: r.kind === 'delete' ? 'Deleted, except what the law keeps' : 'Sent' }); note('Done and logged') }}><Check size={14} />{r.kind === 'delete' ? 'Delete' : 'Send'}</button>}
          {r.outcome && <Chip tone="green">Done</Chip>}
        </li>
      )
    })}</ul>
    <p className="tp-sub">A delete keeps: {DR_KEPT.join(', ')}. Anything under a legal hold waits until the hold ends.</p>
  </>)
}

const PARTS = [['dnc', 'Do not call', DoNotCall], ['incidents', 'Licensed line', Incidents], ['complaints', 'Complaints', Complaints], ['legal', 'Legal holds', Legal], ['data', 'Data requests', DataRequests]]
export function Compliance() {
  const [part, setPart] = useState('dnc')
  const P = PARTS.find(p => p[0] === part)[2]
  return (<>
    <div className="fx-form-row"><span className="tp-grow"><b>Compliance</b><p className="tp-sub">Kept 5 years. Admins only.</p></span><SampleTag>Sample</SampleTag></div>
    <Seg className="p879-seg" label="Compliance" value={part} onChange={setPart} options={PARTS.map(([key, label]) => ({ key, label }))} />
    <P />
  </>)
}

// N-A-19, N-B-02: the consent proof for any lead in one step (time, wording version, page, IP, certificate ID),
// kept for the retention period. The certificate comes from the engine.
export function ConsentProof({ lead }) {
  const note = useNote()
  const c = consentOf(lead)
  return (
    <Block title="Consent proof" sub={`Kept until ${c.keepUntil}`} aside={<EngineSlot />}>
      <dl className="fx-facts">{[['Agreed', c.at], ['Wording', c.wording], ['Page', c.landing], ['Address', c.page], ['IP', c.ip], ['Certificate', c.cert]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={k === 'IP' || k === 'Certificate' ? 'tp-num' : ''}>{v}</dd></div>)}</dl>
      <button type="button" className="tp-btn sm ov-ghost" onClick={() => note('Sample: the proof file downloads once the backend is wired')}><FileLock2 size={14} />Download the proof</button>
    </Block>
  )
}

// N-A-11, N-B-21, N-J-12: no agent ID → Unassigned with the source ad; the picker lists only agents licensed in the
// state with that lead type on; none → "No agent for state"; assigning is logged.
export function UnassignedBlock({ lead, agents, onAssign }) {
  const fits = assignable(agents, lead)
  return (
    <Block title="Unassigned" sub="The ad link had no agent ID. Admins were pushed the moment it came in." aside={<EngineSlot />}>
      <dl className="fx-facts">{[['Campaign', SOURCE_AD.campaign], ['Ad set', SOURCE_AD.adset], ['Ad', SOURCE_AD.ad], ['Agent ID', 'Missing']].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {fits.length ? (
        <ul className="tp-list">{fits.map(a => (
          <li key={a.id}><button type="button" className="fx-mrow" onClick={() => onAssign(a)}><Avatar name={a.name} /><span className="tp-grow"><b>{a.name}</b><small>Licensed in {a.states.join(', ')} · {lead.kind === 'live' ? 'takes live calls' : 'takes appointments'}</small></span><Chip tone="blue">Assign</Chip></button></li>
        ))}</ul>
      ) : <p className="adm-warn-t"><ShieldAlert size={13} aria-hidden="true" />No agent for {lead.state}. Nobody licensed there has this lead type on.</p>}
    </Block>
  )
}
