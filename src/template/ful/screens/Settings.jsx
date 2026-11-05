import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { User, Bell, Clock3, Landmark, SunMoon, Mail, LogOut, Trash2, ChevronRight, KeyRound, ArrowUpRight } from 'lucide-react'
import { useFulSettings, useFulActions, useFulDay, useFulPay, useFulAgents } from '../data'
import { useThemePref, previewTheme } from '../../../hooks/useTheme'
import { Drawer, Field, Seg, Switch, Chip, PillTabs, Avatar, useNote, useAccount, initials } from '../../kit'
import { CountUp, usd } from '../../motion'
import { avatarHue } from '../../avatarHue'
import { fp } from '../paths'

// P845 — Settings, the agent's page for a VA: the profile card and the Sign out box on the left, one panel whose
// stretch tabs switch sections, each a short form with Discard / Save. VA tabs: Profile, Availability (working
// hours and Active or away), Pay details, Notifications, Appearance. Sign out and delete keep their real code.
// Saving Away for real needs a VA availability field on the server (a migration): it stays a door item.
const TABS = [['profile', 'Profile', User], ['hours', 'Availability', Clock3], ['pay', 'Pay details', Landmark], ['alerts', 'Notifications', Bell], ['look', 'Appearance', SunMoon]]
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TIMES = ['7:00 AM', '8:00 AM', '9:00 AM', '10:00 AM', '3:00 PM', '4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM']
const THEME_NAME = { light: 'Light', dark: 'Dark', system: 'System (follows your device)' }

function FormFoot({ dirty, onDiscard, onSave }) {
  return (
    <footer className="fx-form-f">
      <button type="button" className="tp-btn ov-ghost" disabled={!dirty} onClick={onDiscard}>Discard</button>
      <button type="button" className="tp-primary fx-accent" disabled={!dirty} onClick={onSave}>Save changes</button>
    </footer>
  )
}
const Head = ({ title, sub }) => <header className="fx-form-h"><h2>{title}</h2><p>{sub}</p></header>

// Left: who you are, this week's pay, three numbers, the next call.
function ProfileCard({ name, email, away, hours }) {
  const { data: day } = useFulDay()
  const { data: pay } = useFulPay()
  const money = usd()
  const stats = [[day.week.filter(k => k.status === 'cancelled').length, 'Cancelled'], [day.tasks.done.length, 'Steps done'], [day.queue.callback_due.length + day.queue.new.length, 'In queue']]
  return (
    <aside className="fx-tile fx-prof" aria-label="Your profile">
      <div className={`fx-prof-av av-${avatarHue(name)}`} aria-hidden="true">{initials(name).toUpperCase()}<i className={away ? '' : 'on'} /></div>
      <h2>{name}</h2>
      <p>Fulfillment · {away ? 'Away' : 'Active'}</p>
      <span className="fx-prof-mail"><Mail size={13} aria-hidden="true" />{email}</span>
      <div className="fx-usage is-green">
        <div className="tp-row tp-between"><b>This week</b><b className="fx-usage-n tp-money"><CountUp value={pay.earned} format={money} /></b></div>
        <div className="fx-meter" role="img" aria-label="Verified share of this week"><i style={{ '--w': pay.earned ? pay.verified / pay.earned : 0 }} /></div>
        <small>{money(pay.verified)} verified · paid {pay.payday} · {hours.days.length} days a week</small>
      </div>
      <ul className="fx-pstats">{stats.map(([n, label]) => <li key={label}><small>{label}</small><b className="tp-num"><CountUp value={n} /></b></li>)}</ul>
      {day.next && (
        <Link to={fp('calls', day.next.id)} className="fx-pnext">
          <i aria-hidden="true" />
          <span className="tp-grow"><small>Next call</small><b>{day.next.name}</b><small>Today · {day.next.time}</small></span>
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      )}
    </aside>
  )
}

export default function Settings() {
  const { data: s } = useFulSettings()
  const { data: agents } = useFulAgents()
  const { saveSettings, setAway } = useFulActions()
  const [saved, saveTheme] = useThemePref()
  const note = useNote()
  const account = useAccount()
  const [tab, setTab] = useState('profile')
  const [panel, setPanel] = useState(null)
  const name = account.live ? account.name : s.profile.name

  const [pDraft, setPDraft] = useState(s.profile)
  const [hDraft, setHDraft] = useState({ ...s.hours, away: s.away })
  const [payDraft, setPayDraft] = useState(s.payDetails)
  const [alerts, setAlerts] = useState(s.notifications)
  const [look, setLook] = useState(saved)
  const savedRef = useRef(saved)
  useEffect(() => { savedRef.current = saved }, [saved])
  const pickLook = v => { setLook(v); previewTheme(v) }
  const backToSaved = () => { setLook(savedRef.current); previewTheme(savedRef.current) }
  useEffect(() => { if (tab !== 'look') backToSaved() }, [tab])
  useEffect(() => () => previewTheme(savedRef.current), [])

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const hSaved = { ...s.hours, away: s.away }
  const signOut = () => (account.live ? account.signOut() : note('Sign out works once you sign in for real'))
  const DeleteDialog = account.DeleteDialog
  const flip = (key, field, v) => setAlerts(alerts.map(n => (n.key === key ? { ...n, [field]: v } : n)))
  const toggleDay = d => setHDraft(c => ({ ...c, days: c.days.includes(d) ? c.days.filter(x => x !== d) : DAYS.filter(x => x === d || c.days.includes(x)) }))

  return (
    <div className="tp-page fx-set">
      <div className="fx-set-side">
        <ProfileCard name={name} email={s.profile.email} away={s.away} hours={s.hours} />
        <button type="button" className="fx-tile fx-signout" onClick={signOut}><LogOut size={16} aria-hidden="true" />Sign out</button>
      </div>

      <section className="fx-tile fx-panel" aria-label="Settings">
        <PillTabs label="Settings sections" className="fx-ptabs" itemClass="fx-ptab" value={tab} onChange={setTab} items={TABS.map(([key, label, icon]) => ({ key, label, icon }))} />

        <div className="fx-form" key={tab} role="tabpanel" aria-label={TABS.find(t => t[0] === tab)[1]}>
          {tab === 'profile' && <>
            <Head title="Profile" sub="How agents see you on calls, steps and messages." />
            <div className="fx-form-grid">
              <Field label="Full name"><input value={pDraft.name} onChange={e => setPDraft({ ...pDraft, name: e.target.value })} /></Field>
              <Field label="Email"><input type="email" value={pDraft.email} onChange={e => setPDraft({ ...pDraft, email: e.target.value })} /></Field>
              <Field label="Phone"><input value={pDraft.phone} onChange={e => setPDraft({ ...pDraft, phone: e.target.value })} /></Field>
              <Field label="Role" hint="Set by the Ohvara team"><input value="Fulfillment" readOnly /></Field>
            </div>
            <div className="tp-field"><span>Agents you serve</span>
              <ul className="fs-agents is-tight">{agents.map(a => <li key={a.id}><Avatar name={a.name} /><span className="tp-grow"><b>{a.name}</b><small>{a.clients} clients · {a.city}</small></span></li>)}</ul>
            </div>
            <div className="fx-form-row">
              <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('password')}><KeyRound size={15} />Change password</button>
              <span className="tp-grow" />
              <button type="button" className="tp-btn ov-ghost tp-danger" onClick={() => (DeleteDialog ? setPanel('delete') : note('Delete my account works once you sign in for real'))}><Trash2 size={15} />Delete my account</button>
            </div>
            <FormFoot dirty={!same(pDraft, s.profile)} onDiscard={() => setPDraft(s.profile)} onSave={() => { saveSettings({ profile: pDraft }); note('Profile saved') }} />
          </>}

          {tab === 'hours' && <>
            <Head title="Availability" sub="When you're active, new people and callbacks come to you inside these hours. Away stops them." />
            <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>{hDraft.away ? 'Away' : 'Active'}</b><p className="tp-sub">{hDraft.away ? 'No new people come to you' : 'New people and callbacks come to you'}</p></div><Switch on={!hDraft.away} label="Active" onChange={v => setHDraft({ ...hDraft, away: !v })} /></div>
            <div className="tp-field"><span>Working days</span>
              <div className="fx-days" role="group" aria-label="Working days">{DAYS.map(d => <button key={d} type="button" aria-pressed={hDraft.days.includes(d)} className={`fx-day${hDraft.days.includes(d) ? ' is-on' : ''}`} onClick={() => toggleDay(d)}>{d}</button>)}</div>
            </div>
            <div className="fx-form-grid">
              <Field label="Start"><select value={hDraft.start} onChange={e => setHDraft({ ...hDraft, start: e.target.value })}>{TIMES.map(t => <option key={t}>{t}</option>)}</select></Field>
              <Field label="End"><select value={hDraft.end} onChange={e => setHDraft({ ...hDraft, end: e.target.value })}>{TIMES.map(t => <option key={t}>{t}</option>)}</select></Field>
            </div>
            <div className="fx-form-row"><div className="tp-grow"><b>Time zone</b><p className="tp-sub">Central time. Calls show in the client's time on each call.</p></div><Chip tone="mute">Central</Chip></div>
            <FormFoot dirty={!same(hDraft, hSaved)} onDiscard={() => setHDraft(hSaved)} onSave={() => {
              const { away, ...hours } = hDraft
              saveSettings({ hours })
              if (away !== s.away) setAway(away)
              note('Availability saved')
            }} />
          </>}

          {tab === 'pay' && <>
            <Head title="Pay details" sub="Where your Monday payout goes and where tax forms are sent." />
            <div className="fx-billsum">
              <div><small>Payout account</small><b>{payDraft.bank} •••• {payDraft.last4}</b></div>
              <div><small>Status</small><b>{payDraft.status}</b></div>
              <div><small>Paid</small><b>Every Monday</b></div>
            </div>
            <div className="fx-form-grid">
              <Field label="Tax forms go to"><input type="email" value={payDraft.taxEmail} onChange={e => setPayDraft({ ...payDraft, taxEmail: e.target.value })} /></Field>
            </div>
            <div className="fx-form-row">
              <button type="button" className="tp-btn ov-ghost" onClick={() => note('Bank changes open in the payout service once you sign in for real')}><Landmark size={15} />Change bank</button>
              <span className="tp-grow" />
              <Link to={fp('pay')} className="tp-btn ov-ghost">Open Pay<ArrowUpRight size={14} /></Link>
            </div>
            <FormFoot dirty={!same(payDraft, s.payDetails)} onDiscard={() => setPayDraft(s.payDetails)} onSave={() => { saveSettings({ payDetails: payDraft }); note('Pay details saved') }} />
          </>}

          {tab === 'alerts' && <>
            <Head title="Notifications" sub="Everything shows in the bell. Choose what also comes to your phone or email." />
            <div className="fx-alerts">
              <div className="fx-alerts-h"><span className="tp-grow" /><span>Push</span><span>Email</span></div>
              <ul className="tp-list">{alerts.map(n => (
                <li key={n.key} className="tp-li"><b className="tp-grow">{n.label}</b>
                  <Switch on={n.push} label={`${n.label} push`} onChange={v => flip(n.key, 'push', v)} />
                  <Switch on={n.email} label={`${n.label} email`} onChange={v => flip(n.key, 'email', v)} />
                </li>
              ))}</ul>
            </div>
            <FormFoot dirty={!same(alerts, s.notifications)} onDiscard={() => setAlerts(s.notifications)} onSave={() => { saveSettings({ notifications: alerts }); note('Notifications saved') }} />
          </>}

          {tab === 'look' && <>
            <Head title="Appearance" sub="Light, dark, or match your device. Try one and it shows right away. Save keeps it." />
            <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Theme</b><p className="tp-sub">{THEME_NAME[look]}</p></div><Seg label="Theme" value={look} onChange={pickLook} options={[{ key: 'light', label: 'Light' }, { key: 'dark', label: 'Dark' }, { key: 'system', label: 'System' }]} /></div>
            <FormFoot dirty={look !== saved} onDiscard={backToSaved} onSave={() => { saveTheme(look); note(look === 'system' ? 'Theme follows your device' : `${THEME_NAME[look]} mode on`) }} />
          </>}
        </div>
      </section>

      <Drawer open={panel === 'password'} onClose={() => setPanel(null)} title="Change password" footer={<button type="button" className="tp-primary fx-accent" onClick={() => { note('Password changes are not open yet'); setPanel(null) }}>Continue</button>}>
        <Field label="Current password"><input type="password" /></Field>
        <Field label="New password"><input type="password" /></Field>
      </Drawer>
      {panel === 'delete' && DeleteDialog && <DeleteDialog onClose={() => setPanel(null)} />}
    </div>
  )
}
