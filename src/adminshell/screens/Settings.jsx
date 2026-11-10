import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  User, Users, ToggleRight, Wallet, History, Bug, SlidersHorizontal, LogOut, Mail, UserPlus, ArrowUpRight, Search, ShieldCheck,
  ShieldOff, Image as ImageIcon, Check, Lock, GraduationCap, Scale, ArrowRightLeft, Bot, PhoneCall, MessageSquareText, CreditCard, BookOpen, Music,
} from 'lucide-react'
import { useAdmSettings, useAdmActions, useAdmAgents, useAdmVas, useAdmInvites, useAdmAudit, useAdmBugs, useAdmDay, useAdmSource, SWITCHES, ME } from '../data'
import { useThemePref, previewTheme } from '../../hooks/useTheme'
import { Field, Seg, Switch, Chip, PillTabs, Avatar, Empty, useNote, useAccount, initials } from '../../template/kit'
import { CountUp } from '../../template/motion'
import { WordingToApprove } from './Wording924'
import '../../template/settings929.css'
import { avatarHue } from '../../template/avatarHue'
import { Dropdown, DField } from '../kit'
import { AddSomeone } from '../AdminFrame'
import { ap } from '../paths'
import { PhoneInput } from '../../template/PhoneInput'
import { ZONES } from '../words'
import TrainingAdmin from './TrainingAdmin'
import { BUG_STATUS } from '../../template/bugReport'
import '../../template/reportbug.css'
import { Compliance } from './Compliance879'
import { LaunchSwitches } from './Launch906'
import { SplitRules } from './Split889'
import { AiCallerSettings } from './AiCalls892'
import { CarrierPlaybookAdmin, HoldLineSettings } from './Playbook932'
import { DeedstoneNumbers } from './Numbers916'
import { StripeBilling } from './Billing933'
import { useCallOpenMin, saveCallOpenMin } from '../../hooks/useCallOpen'

// P849 — admin Settings on the agent page's shape: the profile card and Sign out on the left, one panel whose stretch
// tabs switch sections. Sections: Profile, People & access (everyone with a login, as Users does today), Switches,
// Pay rules, Audit log (append-only, every admin action), Bug reports, Preferences. Sample only: the
// real switches stay on today's /settings page until the backend step, and this page says so.
const TABS = [['profile', 'Profile', User], ['people', 'People & access', Users], ['switches', 'Switches', ToggleRight], ['pay', 'Pay rules', Wallet], ['billing', 'Billing', CreditCard], ['split', 'Lead split', ArrowRightLeft], ['ai', 'AI caller', Bot],
  ['numbers', 'Deedstone numbers', PhoneCall], ['hold', 'Hold line', Music], ['playbook', 'Carrier playbook', BookOpen], ['wording', 'Wording to approve', MessageSquareText], ['training', 'Training', GraduationCap], ['audit', 'Audit log', History], ['bugs', 'Bug reports', Bug], ['compliance', 'Compliance', Scale], ['prefs', 'Preferences', SlidersHorizontal]]
const THEME_NAME = { light: 'Light', dark: 'Dark', system: 'System (follows your device)' }

function FormFoot({ dirty, onDiscard, onSave, label = 'Save changes' }) {
  return (
    <footer className="fx-form-f">
      <button type="button" className="tp-btn ov-ghost" disabled={!dirty} onClick={onDiscard}>Discard</button>
      <button type="button" className="tp-primary fx-accent" disabled={!dirty} onClick={onSave}>{label}</button>
    </footer>
  )
}
const Head = ({ title, sub }) => <header className="fx-form-h"><h2>{title}</h2><p>{sub}</p></header>

// P918: when a booked call's Start call turns on for the VA (minutes before its time). Calls that come in always ring.
function CallOpenSetting() {
  const real = useAdmSource() === 'real'
  const note = useNote()
  const cur = useCallOpenMin(real)
  const [draft, setV] = useState(null) // null = not edited: shows the saved number
  const v = draft ?? String(cur)
  const n = Math.min(60, Math.max(0, Number(v) || 0))
  const save = async () => { try { await saveCallOpenMin(n, real); setV(null); note(real ? 'Start call setting saved' : 'Start call setting saved (sample)') } catch (e) { note(e.message) } }
  return (
    <>
      <Head title="Booked calls" sub="A VA's Start call turns on this many minutes before the booked time and stays on until the call is done or moved. Calls that come in always ring." />
      <div className="fx-form-grid">
        <Field label="Start call opens (minutes before)" hint="0 to 60 · default 5"><input className="tp-num" inputMode="numeric" value={v} onChange={e => setV(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} /></Field>
      </div>
      <FormFoot dirty={n !== cur} onDiscard={() => setV(null)} onSave={save} />
    </>
  )
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function ProfileCard({ name, email }) {
  const { data: day } = useAdmDay()
  const stats = [[day.needs, 'Need you'], [day.payingAgents, 'Paying'], [day.onShift.length, 'On shift']]
  return (
    <aside className="fx-tile fx-prof" aria-label="Your profile">
      <div className={`fx-prof-av av-${avatarHue(name)}`} aria-hidden="true">{initials(name).toUpperCase()}<i className="on" /></div>
      <h2>{name}</h2>
      <p>Admin · owner</p>
      <span className="fx-prof-mail"><Mail size={13} aria-hidden="true" />{email}</span>
      <ul className="fx-pstats">{stats.map(([n, label]) => <li key={label}><small>{label}</small><b className="tp-num"><CountUp value={n} /></b></li>)}</ul>
      <Link to={ap('overview')} className="fx-pnext"><i aria-hidden="true" /><span className="tp-grow"><small>Overview</small><b>{day.needs} things need you</b><small>Leads, desk, days off, money</small></span><ArrowUpRight size={16} aria-hidden="true" /></Link>
    </aside>
  )
}

function People() {
  const { data: agents } = useAdmAgents()
  const { data: vas } = useAdmVas()
  const { data: invites } = useAdmInvites()
  const { setAccess, resendInvite, cancelInvite } = useAdmActions()
  const note = useNote()
  const [who, setWho] = useState('agent')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const n = q.trim().toLowerCase()
  const people = who === 'agent' ? agents : who === 'fulfillment' ? vas : []
  const rows = people.filter(p => !n || `${p.name} ${p.email} ${p.phone}`.toLowerCase().includes(n))
  const out = invites.filter(i => (who === 'invites' || i.role === who) && (!n || i.name.toLowerCase().includes(n)))
  return (
    <>
      <Head title="People & access" sub="Everyone with a login. Open someone for their role, access and the rest." />
      <div className="fx-form-row">
        <label className="fx-find adm-find-sm"><Search size={15} aria-hidden="true" /><input aria-label="Find someone" placeholder="Name, email or phone" value={q} onChange={e => setQ(e.target.value)} /></label>
        <span className="tp-grow" />
        <button type="button" className="tp-primary sm fx-accent" onClick={() => setAdding(true)}><UserPlus size={14} />Add someone</button>
      </div>
      <Seg label="Who" value={who} onChange={setWho} options={[{ key: 'agent', label: 'Agents', count: agents.length }, { key: 'fulfillment', label: 'Fulfillment', count: vas.length }, { key: 'admin', label: 'Admins', count: 1 }, { key: 'invites', label: 'Invites', count: invites.length }]} />
      <ul className="tp-list adm-people">
        {who === 'admin' && <li className="fx-mrow"><Avatar name={ME.name} /><span className="tp-grow"><b>{ME.name}</b><small>Admin · {ME.email}</small></span><Chip tone="teal">Owner</Chip><Lock size={14} aria-hidden="true" /></li>}
        {rows.map(p => (
          <li key={p.id} className="fx-mrow">
            <Avatar name={p.name} />
            <span className="tp-grow"><b>{p.name}</b><small>{p.email} · on {p.lastOn}</small></span>
            <Chip tone={p.access ? 'green' : 'mute'}>{p.access ? 'Access on' : 'Access off'}</Chip>
            <button type="button" className="fx-pillbtn" onClick={() => { setAccess(p.id, !p.access); note(p.access ? `${p.name} can't sign in now` : `${p.name} can sign in again`) }}>{p.access ? <><ShieldOff size={13} />Turn off</> : <><ShieldCheck size={13} />Turn on</>}</button>
            <Link to={ap(who === 'agent' ? 'agents' : 'team', p.id)} className="fx-pillbtn">Open<ArrowUpRight size={13} /></Link>
          </li>
        ))}
        {out.map(i => (
          <li key={i.id} className="fx-mrow"><Mail size={17} aria-hidden="true" /><span className="tp-grow"><b>{i.name}</b><small>Invite · {i.role === 'agent' ? 'Agent' : 'Fulfillment'} · {i.to} · sent {i.sent}</small></span>
            <button type="button" className="fx-pillbtn" onClick={() => { resendInvite(i.id); note('Invite sent again (sample)') }}>Resend</button>
            <button type="button" className="fx-pillbtn" onClick={() => { cancelInvite(i.id); note('Invite cancelled') }}>Cancel</button>
          </li>
        ))}
        {who === 'admin' && <li className="tp-sub">Admins are added or removed by another admin outside the portal. An admin can't delete their own account here.</li>}
        {who !== 'admin' && rows.length === 0 && out.length === 0 && <li><Empty title="No one" sub="Nobody matches that." /></li>}
      </ul>
      <AddSomeone open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

function Switches({ live }) {
  const { data: s } = useAdmSettings()
  const { setSwitch } = useAdmActions()
  const src = useAdmSource()
  const note = useNote()
  const rest = SWITCHES.filter(x => x.key !== 'ai_caller_live') // P906: the AI caller sits in Tonight's switches
  const groups = [...new Set(rest.map(x => x.group))]
  return (
    <>
      <Head title="Switches" sub="Company-wide on and off. Each says what it does." />
      <LaunchSwitches live={live} />
      {src === 'real'
        ? <p className="adm-warn">These are the real company switches: each flip is saved right away.</p>
        : <p className="adm-warn">Sample only: flipping these changes nothing real.{live && <> The real switches are on the <a href="/settings" className="tp-link">current Settings page</a> until the backend step.</>}</p>}
      {groups.map(g => (
        <div key={g} className="adm-swgroup">
          <h3 className="fx-h3">{g}</h3>
          <ul className="tp-list">{rest.filter(x => x.group === g).map(x => (
            <li key={x.key} className="fx-form-row fx-form-sw"><div className="tp-grow"><b>{x.label}</b><p className="tp-sub">{x.sub}</p></div>
              <Switch on={s.switches[x.key]} label={x.label} onChange={v => { setSwitch(x.key, v); note(`${x.label} ${v ? 'on' : 'off'} (sample)`) }} /></li>
          ))}</ul>
        </div>
      ))}
    </>
  )
}

function PayRules() {
  const { data: s } = useAdmSettings()
  const { savePayRules, saveBilling } = useAdmActions()
  const note = useNote()
  const [d, setD] = useState(s.payRules)
  const [b, setB] = useState(s.billing)
  const bnum = (k, lo, hi) => e => setB({ ...b, [k]: Math.min(hi, Math.max(lo, Number(e.target.value.replace(/[^0-9]/g, '')) || lo)) })
  const bsame = ['maxDaily', 'chargeHour', 'retryHour', 'foundingCount', 'foundingMonths'].every(k => b[k] === s.billing[k])
  const num = k => e => setD({ ...d, [k]: Math.max(0, Number(e.target.value.replace(/[^0-9.]/g, '')) || 0) })
  return (
    <>
      <Head title="Pay rules" sub="VAs are paid by the hour, from clock in and out. Paid every Monday." />
      <div className="fx-form-grid">
        <Field label="Hourly rate ($)" hint="Overtime past 40 hours a week at 1.5×"><input className="tp-money" inputMode="decimal" value={d.hourly} onChange={num('hourly')} /></Field>
      </div>
      <FormFoot dirty={!same(d, s.payRules)} onDiscard={() => setD(s.payRules)} onSave={() => { savePayRules(d); note('Pay rules saved (sample)') }} />
      <CallOpenSetting />
      {/* P909: lead billing. Lead spend is charged each night for the next day; a decline turns the next day's ads off. */}
      <Head title="Lead billing" sub="Each evening agents' cards are charged the next day's lead spend plus the booking desk (12%). A decline keeps the next day's ads off and retries in the morning." />
      <div className="fx-form-grid">
        <Field label="Max daily lead spend ($)" hint="Per agent. Raise one agent on Revenue › Agent billing"><input className="tp-money" inputMode="numeric" value={b.maxDaily} onChange={bnum('maxDaily', 50, 1000)} /></Field>
        <Field label="Nightly charge (hour, Central)" hint={`24-hour clock · ${b.chargeHour > 12 ? b.chargeHour - 12 : b.chargeHour} ${b.chargeHour >= 12 ? 'PM' : 'AM'}`}><input className="tp-num" inputMode="numeric" value={b.chargeHour} onChange={bnum('chargeHour', 12, 23)} /></Field>
        <Field label="Morning retry (hour, Central)" hint={`${b.retryHour} AM`}><input className="tp-num" inputMode="numeric" value={b.retryHour} onChange={bnum('retryHour', 5, 11)} /></Field>
        <Field label="Founding agents" hint="The first paying agents keep today's prices"><input className="tp-num" inputMode="numeric" value={b.foundingCount} onChange={bnum('foundingCount', 0, 500)} /></Field>
        <Field label="Founding lock (months)"><input className="tp-num" inputMode="numeric" value={b.foundingMonths} onChange={bnum('foundingMonths', 1, 60)} /></Field>
      </div>
      <FormFoot dirty={!bsame} onDiscard={() => setB(s.billing)} onSave={() => { saveBilling(b); note('Lead billing saved (sample)') }} />
    </>
  )
}

function Audit() {
  const { data: rows } = useAdmAudit()
  const [q, setQ] = useState('')
  const n = q.trim().toLowerCase()
  const list = rows.filter(r => !n || `${r.what} ${r.target} ${r.who}`.toLowerCase().includes(n))
  return (
    <>
      <Head title="Audit log" sub="Every admin action, newest first. Append-only: nobody can change or remove a row." />
      <div className="fx-form-row"><label className="fx-find adm-find-sm"><Search size={15} aria-hidden="true" /><input aria-label="Search the log" placeholder="Search actions or people" value={q} onChange={e => setQ(e.target.value)} /></label><span className="tp-grow" /><Chip tone="mute">{rows.length} rows</Chip></div>
      <ol className="adm-audit">{list.map(r => <li key={r.id}><small className="tp-num">{r.at}</small><span className="tp-grow"><b>{r.what}</b><small>{r.target}</small></span><small>{r.who}</small></li>)}</ol>
    </>
  )
}

// P876 — Bug reports: what agents, VAs and admins send from Help & Support → Report a bug, newest first, with what was
// captured for them. New → Seen → Fixed. Sample until P858 reads bug_reports (the P711 table).
const BUG_TONE = { new: 'warn', seen: 'blue', fixed: 'green' }
function Bugs() {
  const { data: bugs } = useAdmBugs()
  const { setBugStatus } = useAdmActions()
  const note = useNote()
  const [show, setShow] = useState('open')
  const list = bugs.filter(b => (show === 'open' ? b.status !== 'fixed' : show === 'fixed' ? b.status === 'fixed' : true))
  const count = k => bugs.filter(b => (k === 'open' ? b.status !== 'fixed' : k === 'fixed' ? b.status === 'fixed' : true)).length
  return (
    <>
      <Head title="Bug reports" sub="Sent from Help and support → Report a bug. Each one tells you the page, time, browser and screen." />
      <Seg label="Show" value={show} onChange={setShow} options={[{ key: 'open', label: 'Open', count: count('open') }, { key: 'fixed', label: 'Fixed', count: count('fixed') }, { key: 'all', label: 'All', count: count('all') }]} />
      {list.length === 0 && <Empty title="Nothing here" sub={show === 'open' ? 'No open bug reports.' : 'None yet.'} />}
      <ul className="tp-list adm-bugs">{list.map(b => (
        <li key={b.id} className="fx-mrow"><Avatar name={b.who} />
          <span className="tp-grow"><b>{b.who}{b.role ? ` (${b.role})` : ''} · {b.at}</b><small>{b.text}</small>{b.expected && <small>Expected: {b.expected}</small>}
            <small className="adm-bug-ctx">{[b.page, b.browser, b.screen].filter(Boolean).join(' · ')}</small></span>
          {b.shot && <button type="button" className="fx-pillbtn" onClick={() => note('Screenshots open once you sign in for real')}><ImageIcon size={13} />{b.file ? 'File' : 'Screenshot'}</button>}
          <Chip tone={BUG_TONE[b.status]}>{BUG_STATUS[b.status]}</Chip>
          {b.status !== 'fixed' && <button type="button" className="fx-pillbtn" onClick={() => { const to = b.status === 'new' ? 'seen' : 'fixed'; setBugStatus(b.id, to, b.who); note(to === 'seen' ? 'Marked seen' : 'Marked fixed') }}><Check size={13} />{b.status === 'new' ? 'Mark seen' : 'Mark fixed'}</button>}
        </li>
      ))}</ul>
    </>
  )
}

function Prefs() {
  const { data: s } = useAdmSettings()
  const { saveSettings, setTz } = useAdmActions()
  const [saved, saveTheme] = useThemePref()
  const note = useNote()
  const [look, setLook] = useState(saved)
  const [alerts, setAlerts] = useState(s.notifications)
  const savedRef = useRef(saved)
  useEffect(() => { savedRef.current = saved }, [saved])
  useEffect(() => () => previewTheme(savedRef.current), [])
  const pickLook = v => { setLook(v); previewTheme(v) }
  const flip = (key, field, v) => setAlerts(alerts.map(x => (x.key === key ? { ...x, [field]: v } : x)))
  return (
    <>
      <Head title="Preferences" sub="Theme, your time zone, and what also comes to your phone or email." />
      <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Theme</b><p className="tp-sub">{THEME_NAME[look]}</p></div><Seg label="Theme" value={look} onChange={pickLook} options={[{ key: 'light', label: 'Light' }, { key: 'dark', label: 'Dark' }, { key: 'system', label: 'System' }]} /></div>
      {look !== saved && <div className="fx-form-row"><span className="tp-grow" /><button type="button" className="tp-btn ov-ghost" onClick={() => pickLook(saved)}>Discard</button><button type="button" className="tp-primary fx-accent" onClick={() => { saveTheme(look); note(`${THEME_NAME[look]} theme saved`) }}>Save theme</button></div>}
      <DField label="Time zone" hint="The clock beside the page title and every time on the admin side."><Dropdown label="Time zone" value={s.tz} onChange={tz => { setTz(tz); note('Time zone saved') }} options={ZONES.map(([v, l, x]) => ({ value: v, label: `${l} time`, sub: x }))} /></DField>
      <div className="fx-alerts">
        <div className="fx-alerts-h"><span className="tp-grow" /><span>Push</span><span>Email</span></div>
        <ul className="tp-list">{alerts.map(x => (
          <li key={x.key} className="tp-li"><b className="tp-grow">{x.label}</b>
            <Switch on={x.push} label={`${x.label} push`} onChange={v => flip(x.key, 'push', v)} />
            <Switch on={x.email} label={`${x.label} email`} onChange={v => flip(x.key, 'email', v)} />
          </li>
        ))}</ul>
      </div>
      <FormFoot dirty={!same(alerts, s.notifications)} onDiscard={() => setAlerts(s.notifications)} onSave={() => { saveSettings({ notifications: alerts }); note('Notifications saved') }} />
    </>
  )
}

export default function Settings() {
  const { data: s } = useAdmSettings()
  const { saveSettings } = useAdmActions()
  const account = useAccount()
  const note = useNote()
  const [sp, setSp] = useSearchParams()
  const raw = sp.get('tab')
  const tab = TABS.some(t => t[0] === raw) ? raw : 'profile'
  const setTab = t => setSp(t === 'profile' ? {} : { tab: t }, { replace: true })
  const [p, setP] = useState(s.profile)
  const name = account.live ? account.name : s.profile.name
  const signOut = () => (account.live ? account.signOut() : note('Sign out works once you sign in for real'))
  const [panel, setPanel] = useState(null)
  const DeleteDialog = account.DeleteDialog
  return (
    <div className="tp-page fx-set adm-settings">
      <div className="fx-set-side">
        <ProfileCard name={name} email={s.profile.email} />
        <button type="button" className="fx-tile fx-signout" onClick={signOut}><LogOut size={16} aria-hidden="true" />Sign out</button>
      </div>
      <section className="fx-tile fx-panel" aria-label="Settings">
        <PillTabs label="Settings sections" className="fx-ptabs adm-settabs" itemClass="fx-ptab" value={tab} onChange={setTab} items={TABS.map(([key, label, icon]) => ({ key, label, icon }))} />
        <div className="fx-form" key={tab} role="tabpanel" aria-label={TABS.find(t => t[0] === tab)[1]}>
          {tab === 'profile' && <>
            <Head title="Profile" sub="How agents, VAs and Jordan see you on messages." />
            <div className="fx-form-grid">
              <Field label="Full name"><input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} /></Field>
              <Field label="Email"><input type="email" value={p.email} onChange={e => setP({ ...p, email: e.target.value })} /></Field>
              <Field label="Phone"><PhoneInput value={p.phone} onChange={(d, e164, shown) => setP({ ...p, phone: shown })} /></Field>
              <Field label="Role" hint="Admins are set outside the portal"><input value="Admin · owner" readOnly /></Field>
            </div>
            <Field label="Live Room link" hint="The one shared meeting room for the company"><input value={s.liveRoom} onChange={e => saveSettings({ liveRoom: e.target.value })} /></Field>
            <div className="fx-form-row"><span className="tp-grow" /><button type="button" className="tp-btn ov-ghost" onClick={() => (DeleteDialog ? setPanel('delete') : note('Admin accounts are removed by another admin'))}>Delete my account</button></div>
            <FormFoot dirty={!same(p, s.profile)} onDiscard={() => setP(s.profile)} onSave={() => { saveSettings({ profile: p }); note('Profile saved') }} />
          </>}
          {tab === 'people' && <People />}
          {tab === 'switches' && <Switches live={account.live} />}
          {tab === 'pay' && <PayRules />}
          {tab === 'billing' && <StripeBilling />}
          {tab === 'split' && <SplitRules />}
          {tab === 'ai' && <AiCallerSettings />}
          {tab === 'numbers' && <DeedstoneNumbers />}
          {tab === 'hold' && <HoldLineSettings />}
          {tab === 'playbook' && <CarrierPlaybookAdmin />}
          {tab === 'wording' && <WordingToApprove />}
          {tab === 'training' && <TrainingAdmin />}
          {tab === 'audit' && <Audit />}
          {tab === 'bugs' && <Bugs />}
          {tab === 'compliance' && <Compliance />}
          {tab === 'prefs' && <Prefs />}
        </div>
      </section>
      {panel === 'delete' && DeleteDialog && <DeleteDialog onClose={() => setPanel(null)} />}
    </div>
  )
}
