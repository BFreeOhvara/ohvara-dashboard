import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  User, Users, ToggleRight, Wallet, Building2, History, Bug, SlidersHorizontal, LogOut, Mail, UserPlus, ArrowUpRight, Search, ShieldCheck,
  ShieldOff, Image as ImageIcon, Check, Lock,
} from 'lucide-react'
import { useAdmSettings, useAdmActions, useAdmAgents, useAdmVas, useAdmInvites, useAdmCarriers, useAdmAudit, useAdmBugs, useAdmDay, SWITCHES, ME } from '../data'
import { useThemePref, previewTheme } from '../../hooks/useTheme'
import { Drawer, Field, Seg, Switch, Chip, PillTabs, Avatar, Empty, useNote, useAccount, initials } from '../../template/kit'
import { CountUp } from '../../template/motion'
import { avatarHue } from '../../template/avatarHue'
import { Dropdown, DField } from '../kit'
import { AddSomeone } from '../AdminFrame'
import { ap } from '../paths'
import { ZONES } from '../words'

// P849 — admin Settings on the agent page's shape: the profile card and Sign out on the left, one panel whose stretch
// tabs switch sections. Sections: Profile, People & access (everyone with a login, as Users does today), Switches,
// Pay rules, Carriers (hours), Audit log (append-only, every admin action), Bug reports, Preferences. Sample only: the
// real switches stay on today's /settings page until the backend step, and this page says so.
const TABS = [['profile', 'Profile', User], ['people', 'People & access', Users], ['switches', 'Switches', ToggleRight], ['pay', 'Pay rules', Wallet],
  ['carriers', 'Carriers', Building2], ['audit', 'Audit log', History], ['bugs', 'Bug reports', Bug], ['prefs', 'Preferences', SlidersHorizontal]]
const THEME_NAME = { light: 'Light', dark: 'Dark', system: 'System (follows your device)' }
const CARRIER_WORD = { verified: ['Verified', 'green'], review: ['Needs review', 'warn'], none: ['No hours yet', 'mute'] }

function FormFoot({ dirty, onDiscard, onSave, label = 'Save changes' }) {
  return (
    <footer className="fx-form-f">
      <button type="button" className="tp-btn ov-ghost" disabled={!dirty} onClick={onDiscard}>Discard</button>
      <button type="button" className="tp-primary fx-accent" disabled={!dirty} onClick={onSave}>{label}</button>
    </footer>
  )
}
const Head = ({ title, sub }) => <header className="fx-form-h"><h2>{title}</h2><p>{sub}</p></header>
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
        <label className="fx-find ad-find-sm"><Search size={15} aria-hidden="true" /><input aria-label="Find someone" placeholder="Name, email or phone" value={q} onChange={e => setQ(e.target.value)} /></label>
        <span className="tp-grow" />
        <button type="button" className="tp-primary sm fx-accent" onClick={() => setAdding(true)}><UserPlus size={14} />Add someone</button>
      </div>
      <Seg label="Who" value={who} onChange={setWho} options={[{ key: 'agent', label: 'Agents', count: agents.length }, { key: 'fulfillment', label: 'Fulfillment', count: vas.length }, { key: 'admin', label: 'Admins', count: 1 }, { key: 'invites', label: 'Invites', count: invites.length }]} />
      <ul className="tp-list ad-people">
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
  const note = useNote()
  const groups = [...new Set(SWITCHES.map(x => x.group))]
  return (
    <>
      <Head title="Switches" sub="Company-wide on and off. Each says what it does." />
      <p className="ad-warn">Sample only: flipping these changes nothing real.{live && <> The real switches are on the <a href="/settings" className="tp-link">current Settings page</a> until the backend step.</>}</p>
      {groups.map(g => (
        <div key={g} className="ad-swgroup">
          <h3 className="fx-h3">{g}</h3>
          <ul className="tp-list">{SWITCHES.filter(x => x.group === g).map(x => (
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
  const { savePayRules } = useAdmActions()
  const note = useNote()
  const [d, setD] = useState(s.payRules)
  const num = k => e => setD({ ...d, [k]: Math.max(0, Number(e.target.value.replace(/[^0-9.]/g, '')) || 0) })
  return (
    <>
      <Head title="Pay rules" sub="What a VA earns for each cancellation the carrier confirms, and the weekly limits." />
      <div className="fx-form-grid">
        <Field label="Pay per cancellation ($)"><input className="tp-money" inputMode="decimal" value={d.perCancel} onChange={num('perCancel')} /></Field>
        <Field label="Weekly minimum ($)" hint="Paid even in a slow week"><input className="tp-money" inputMode="decimal" value={d.weeklyMin} onChange={num('weeklyMin')} /></Field>
        <Field label="Weekly hold cap" hint="Cancellations past this wait for a look"><input className="tp-num" inputMode="numeric" value={d.holdCap} onChange={num('holdCap')} /></Field>
      </div>
      <FormFoot dirty={!same(d, s.payRules)} onDiscard={() => setD(s.payRules)} onSave={() => { savePayRules(d); note('Pay rules saved (sample)') }} />
    </>
  )
}

function Carriers() {
  const { data: carriers } = useAdmCarriers()
  const { saveCarrier } = useAdmActions()
  const note = useNote()
  const [show, setShow] = useState('review')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)
  const n = q.trim().toLowerCase()
  const list = carriers.filter(c => (show === 'all' || c.status === show) && (!n || c.name.toLowerCase().includes(n)))
  const cur = carriers.find(c => c.id === edit?.id)
  return (
    <>
      <Head title="Carriers" sub="Service phone and hours VAs call during. A lookup fills these; an admin marks them verified." />
      <div className="fx-form-row"><label className="fx-find ad-find-sm"><Search size={15} aria-hidden="true" /><input aria-label="Find a carrier" placeholder="Find a carrier" value={q} onChange={e => setQ(e.target.value)} /></label></div>
      <Seg label="Show" value={show} onChange={setShow} options={[{ key: 'all', label: 'All', count: carriers.length }, ...Object.entries(CARRIER_WORD).map(([k, [w]]) => ({ key: k, label: w, count: carriers.filter(c => c.status === k).length }))]} />
      <ul className="tp-list">{list.map(c => {
        const [w, t] = CARRIER_WORD[c.status]
        return (
          <li key={c.id} className="fx-mrow"><Building2 size={17} aria-hidden="true" /><span className="tp-grow"><b>{c.name}</b><small>{c.phone} · {c.hours || 'No hours yet'}</small></span><Chip tone={t}>{w}</Chip>
            <button type="button" className="fx-pillbtn" onClick={() => note(`Looked up ${c.name} again (sample)`)}>Look up</button>
            <button type="button" className="fx-pillbtn" onClick={() => setEdit({ id: c.id, phone: c.phone, hours: c.hours, tz: 'America/Chicago' })}>Edit hours</button>
          </li>
        )
      })}{list.length === 0 && <li><Empty title="None" sub="No carrier in this group." /></li>}</ul>
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={cur ? `${cur.name} hours` : 'Hours'} sub="Saved as verified"
        footer={<button type="button" className="tp-primary fx-accent" disabled={!edit?.hours?.trim()} onClick={() => { saveCarrier(edit.id, { phone: edit.phone, hours: edit.hours, status: 'verified' }); note('Saved as verified'); setEdit(null) }}><Check size={16} />Save as verified</button>}>
        {edit && <>
          <Field label="Service phone"><input value={edit.phone} onChange={e => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <DField label="Time zone"><Dropdown label="Time zone" value={edit.tz} onChange={tz => setEdit({ ...edit, tz })} options={ZONES.map(([v, l]) => ({ value: v, label: `${l} time` }))} /></DField>
          <Field label="Hours" hint="For example: Mon to Fri, 8:00 AM to 6:00 PM ET"><input value={edit.hours} onChange={e => setEdit({ ...edit, hours: e.target.value })} /></Field>
        </>}
      </Drawer>
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
      <div className="fx-form-row"><label className="fx-find ad-find-sm"><Search size={15} aria-hidden="true" /><input aria-label="Search the log" placeholder="Search actions or people" value={q} onChange={e => setQ(e.target.value)} /></label><span className="tp-grow" /><Chip tone="mute">{rows.length} rows</Chip></div>
      <ol className="ad-audit">{list.map(r => <li key={r.id}><small className="tp-num">{r.at}</small><span className="tp-grow"><b>{r.what}</b><small>{r.target}</small></span><small>{r.who}</small></li>)}</ol>
    </>
  )
}

function Bugs() {
  const { data: bugs } = useAdmBugs()
  const { resolveBug } = useAdmActions()
  const note = useNote()
  return (
    <>
      <Head title="Bug reports" sub="Sent from the account menu by agents and VAs." />
      <ul className="tp-list">{bugs.map(b => (
        <li key={b.id} className="fx-mrow"><Avatar name={b.who} /><span className="tp-grow"><b>{b.who} · {b.at}</b><small>{b.text}</small></span>
          {b.shot && <button type="button" className="fx-pillbtn" onClick={() => note('Screenshots open once you sign in for real')}><ImageIcon size={13} />Screenshot</button>}
          {b.resolved ? <Chip tone="green">Resolved</Chip> : <button type="button" className="fx-pillbtn" onClick={() => { resolveBug(b.id); note('Marked resolved') }}><Check size={13} />Mark resolved</button>}
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
      <DField label="Time zone" hint="The clock at the top and every time on the admin side."><Dropdown label="Time zone" value={s.tz} onChange={tz => { setTz(tz); note('Time zone saved') }} options={ZONES.map(([v, l, x]) => ({ value: v, label: `${l} time`, sub: x }))} /></DField>
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
    <div className="tp-page fx-set ad-settings">
      <div className="fx-set-side">
        <ProfileCard name={name} email={s.profile.email} />
        <button type="button" className="fx-tile fx-signout" onClick={signOut}><LogOut size={16} aria-hidden="true" />Sign out</button>
      </div>
      <section className="fx-tile fx-panel" aria-label="Settings">
        <PillTabs label="Settings sections" className="fx-ptabs ad-settabs" itemClass="fx-ptab" value={tab} onChange={setTab} items={TABS.map(([key, label, icon]) => ({ key, label, icon }))} />
        <div className="fx-form" key={tab} role="tabpanel" aria-label={TABS.find(t => t[0] === tab)[1]}>
          {tab === 'profile' && <>
            <Head title="Profile" sub="How agents, VAs and Jordan see you on messages." />
            <div className="fx-form-grid">
              <Field label="Full name"><input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} /></Field>
              <Field label="Email"><input type="email" value={p.email} onChange={e => setP({ ...p, email: e.target.value })} /></Field>
              <Field label="Phone"><input value={p.phone} onChange={e => setP({ ...p, phone: e.target.value })} /></Field>
              <Field label="Role" hint="Admins are set outside the portal"><input value="Admin · owner" readOnly /></Field>
            </div>
            <Field label="Live Room link" hint="The one shared meeting room for the company"><input value={s.liveRoom} onChange={e => saveSettings({ liveRoom: e.target.value })} /></Field>
            <div className="fx-form-row"><span className="tp-grow" /><button type="button" className="tp-btn ov-ghost" onClick={() => (DeleteDialog ? setPanel('delete') : note('Admin accounts are removed by another admin'))}>Delete my account</button></div>
            <FormFoot dirty={!same(p, s.profile)} onDiscard={() => setP(s.profile)} onSave={() => { saveSettings({ profile: p }); note('Profile saved') }} />
          </>}
          {tab === 'people' && <People />}
          {tab === 'switches' && <Switches live={account.live} />}
          {tab === 'pay' && <PayRules />}
          {tab === 'carriers' && <Carriers />}
          {tab === 'audit' && <Audit />}
          {tab === 'bugs' && <Bugs />}
          {tab === 'prefs' && <Prefs />}
        </div>
      </section>
      {panel === 'delete' && DeleteDialog && <DeleteDialog onClose={() => setPanel(null)} />}
    </div>
  )
}
