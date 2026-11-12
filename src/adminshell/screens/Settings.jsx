import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import {
  User, Users, Wallet, History, SlidersHorizontal, LogOut, Mail, UserPlus, ArrowUpRight, Search, ShieldCheck,
  ShieldOff, Lock, Bot, CreditCard, Hand, Smartphone,
} from 'lucide-react'
import { useAdmSettings, useAdmActions, useAdmAgents, useAdmVas, useAdmInvites, useAdmAudit, useAdmDay, useAdmSource, ME } from '../data'
import { useThemePref, previewTheme } from '../../hooks/useTheme'
import { Field, Seg, Switch, Chip, PillTabs, Avatar, Empty, useNote, useAccount, initials } from '../../template/kit'
import { CountUp } from '../../template/motion'
import '../../template/settings929.css'
import { avatarHue } from '../../template/avatarHue'
import { Dropdown, DField } from '../kit'
import { AddSomeone } from '../AdminFrame'
import { ap } from '../paths'
import { PhoneInput } from '../../template/PhoneInput'
import { ZONES } from '../words'
import { BookingGap } from './Launch906'
import { BookCheck } from './BookCheck899'
import { WelcomeLoad } from './WelcomeLoad891'
import { AiCallerSettings } from './AiCalls892'
import { StripeBilling } from './Billing933'
import { useCallOpenMin, saveCallOpenMin } from '../../hooks/useCallOpen'
import { AppAbout } from '../../components/native/AppAbout'
import { AppReviewLogins } from './AppReview962'

// P849 — admin Settings on the agent page's shape: the profile card and Sign out on the left, one panel whose stretch
// tabs switch sections. Sections: Profile, People & access (everyone with a login, as Users does today), Switches,
// Pay rules, Audit log (append-only, every admin action), Bug reports, Preferences. Sample only: the
// real switches stay on today's /settings page until the backend step, and this page says so.
// P934 (Brayden, Nov 10): the tabs fit one row at 1440 wide. Settings holds only what is set: the working pages (Bug
// reports, Deedstone numbers and VA pods (with the P932 hold line), Carrier playbook, Wording to approve, Training,
// Compliance) are their own rail pages
// (screens/Work934.jsx); Lead split and the Call ads switch are gone; there is no Go live card (P950: CC turns live things on with Brayden's yes); Stripe's
// setup checks are their own tab so no section scrolls. Old ?tab= links land where the section went (MOVED).
const TABS = [['profile', 'Profile', User], ['people', 'People', Users], ['pay', 'Pay', Wallet], ['stripe', 'Stripe', CreditCard],
  ['servicing', 'Servicing', Hand], ['ai', 'AI caller', Bot], ['audit', 'Audit log', History], ['review', 'Review', Smartphone], ['prefs', 'Preferences', SlidersHorizontal]]
const MOVED = { bugs: 'bugs', numbers: 'numbers', compliance: 'compliance', hold: 'numbers' } // P936: wording, training, playbook gone
const RENAMED = { switches: 'profile', golive: 'profile', billing: 'stripe', split: 'profile' } // P950: Go live is gone; old links land on Profile
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

function PayRules() {
  const { data: s } = useAdmSettings()
  const { savePayRules, saveBilling } = useAdmActions()
  const note = useNote()
  const [d, setD] = useState(s.payRules)
  const [b, setB] = useState(s.billing)
  const bnum = (k, lo, hi) => e => setB({ ...b, [k]: Math.min(hi, Math.max(lo, Number(e.target.value.replace(/[^0-9]/g, '')) || lo)) })
  const bsame = ['maxDaily', 'chargeHour', 'retryHour'].every(k => b[k] === s.billing[k])
  const num = k => e => setD({ ...d, [k]: Math.max(0, Number(e.target.value.replace(/[^0-9.]/g, '')) || 0) })
  return (
    <>
      {/* P934: two columns so the section never scrolls: VA pay on the left, lead billing on the right. */}
      <div className="adm-set-two"><div>
      <Head title="Pay rules" sub="VAs are paid by the hour on their scheduled shifts, minus days off. Paid every Monday." />
      <div className="fx-form-grid">
        <Field label="Hourly rate ($)" hint="Overtime past 40 hours a week at 1.5×"><input className="tp-money" inputMode="decimal" value={d.hourly} onChange={num('hourly')} /></Field>
      </div>
      <FormFoot dirty={!same(d, s.payRules)} onDiscard={() => setD(s.payRules)} onSave={() => { savePayRules(d); note('Pay rules saved (sample)') }} />
      <CallOpenSetting />
      </div><div>
      {/* P909: lead billing. Lead spend is charged each night for the next day; a decline turns the next day's ads off. */}
      <Head title="Lead billing" sub="Each evening agents' cards are charged the next day's lead spend plus the booking desk (12%). A decline keeps the next day's ads off and retries in the morning." />
      <div className="fx-form-grid">
        <Field label="Max daily lead spend ($)" hint="Per agent. Raise one agent on Revenue › Agent billing"><input className="tp-money" inputMode="numeric" value={b.maxDaily} onChange={bnum('maxDaily', 50, 1000)} /></Field>
        <Field label="Nightly charge (hour, Central)" hint={`24-hour clock · ${b.chargeHour > 12 ? b.chargeHour - 12 : b.chargeHour} ${b.chargeHour >= 12 ? 'PM' : 'AM'}`}><input className="tp-num" inputMode="numeric" value={b.chargeHour} onChange={bnum('chargeHour', 12, 23)} /></Field>
        <Field label="Morning retry (hour, Central)" hint={`${b.retryHour} AM`}><input className="tp-num" inputMode="numeric" value={b.retryHour} onChange={bnum('retryHour', 5, 11)} /></Field>
      </div>
      <FormFoot dirty={!bsame} onDiscard={() => setB(s.billing)} onSave={() => { saveBilling(b); note('Lead billing saved (sample)') }} />
      </div></div>
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
      <div className="adm-set-two"><div>
      <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Theme</b><p className="tp-sub">{THEME_NAME[look]}</p></div><Seg label="Theme" value={look} onChange={pickLook} options={[{ key: 'light', label: 'Light' }, { key: 'dark', label: 'Dark' }, { key: 'system', label: 'System' }]} /></div>
      {look !== saved && <div className="fx-form-row"><span className="tp-grow" /><button type="button" className="tp-btn ov-ghost" onClick={() => pickLook(saved)}>Discard</button><button type="button" className="tp-primary fx-accent" onClick={() => { saveTheme(look); note(`${THEME_NAME[look]} theme saved`) }}>Save theme</button></div>}
      <DField label="Time zone" hint="The clock beside the page title and every time on the admin side."><Dropdown label="Time zone" value={s.tz} onChange={tz => { setTz(tz); note('Time zone saved') }} options={ZONES.map(([v, l, x]) => ({ value: v, label: `${l} time`, sub: x }))} /></DField>
      </div><div>
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
      </div></div>
    </>
  )
}

export default function Settings() {
  const { data: s } = useAdmSettings()
  const { saveSettings } = useAdmActions()
  const account = useAccount()
  const note = useNote()
  const [sp, setSp] = useSearchParams()
  const asked = sp.get('tab')
  const raw = RENAMED[asked] || asked
  const tab = TABS.some(t => t[0] === raw) ? raw : 'profile'
  const setTab = t => setSp(t === 'profile' ? {} : { tab: t }, { replace: true })
  const [p, setP] = useState(s.profile)
  const name = account.live ? account.name : s.profile.name
  const signOut = () => (account.live ? account.signOut() : note('Sign out works once you sign in for real'))
  const [panel, setPanel] = useState(null)
  const DeleteDialog = account.DeleteDialog
  if (MOVED[asked]) return <Navigate to={ap(MOVED[asked])} replace />
  return (
    <div className="tp-page fx-set adm-settings">
      <div className="fx-set-side">
        <ProfileCard name={name} email={s.profile.email} />
        <button type="button" className="fx-tile fx-signout" onClick={signOut}><LogOut size={16} aria-hidden="true" />Sign out</button>
        <AppAbout />
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
          {tab === 'pay' && <PayRules />}
          {tab === 'stripe' && <StripeBilling />}
          {tab === 'servicing' && <>
            <Head title="Servicing" sub="How clients are kept on the books, for every agent and VA." />
            <BookingGap />
            <div className="adm-set-two"><BookCheck /><WelcomeLoad /></div>
          </>}
          {tab === 'ai' && <AiCallerSettings />}
          {tab === 'audit' && <Audit />}
          {tab === 'review' && <AppReviewLogins />}
          {tab === 'prefs' && <Prefs />}
        </div>
      </section>
      {panel === 'delete' && DeleteDialog && <DeleteDialog onClose={() => setPanel(null)} />}
    </div>
  )
}
