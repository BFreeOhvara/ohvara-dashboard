import { useContext, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useSampleSettings, useSampleActions } from '../data'
import { useTheme } from '../../hooks/useTheme'
import { Drawer, Field, Seg, Switch, Chip, useNote } from '../kit'
import { ShellAccount } from '../account'

export default function Settings() {
  const { data: s } = useSampleSettings()
  const { setNotification, setDuty } = useSampleActions()
  const [theme, setTheme] = useTheme()
  const note = useNote()
  const account = useContext(ShellAccount)
  const [panel, setPanel] = useState(null)
  const [name, setName] = useState(s.profile.name)
  const [profile, setProfile] = useState(s.profile)
  const [days, setDays] = useState(s.hours.days)
  const all = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return (
    <div className="tp-page">
      <div className="tp-g2">
        <section className="ov-card tp-card tp-stack" aria-label="Your account">
          <div className="tp-row tp-between"><h2 className="tp-h2">Your account</h2><button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('profile')}>Edit</button></div>
          <ul className="tp-list">
            {[['Name', profile.name], ['Email', profile.email], ['Phone', profile.phone], ['Plan', profile.plan]].map(([k, v]) => <li key={k} className="tp-li" style={{ minHeight: 44 }}><span className="tp-grow tp-mid">{k}</span><b>{v}</b></li>)}
          </ul>
          <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('password')}>Change password</button>
        </section>
        <section className="ov-card tp-card tp-stack" aria-label="Your setup">
          <h2 className="tp-h2">Your setup</h2>
          <div className="tp-row"><div className="tp-grow"><b>Theme</b><p className="tp-sub">Light or dark</p></div><Seg label="Theme" value={theme} onChange={setTheme} options={[{ key: 'light', label: 'Light' }, { key: 'dark', label: 'Dark' }]} /></div>
          <div className="tp-row"><div className="tp-grow"><b>On duty</b><p className="tp-sub">Live calls ring your phone</p></div><Switch on={s.duty} label="On duty" onChange={v => { setDuty(v); note(v ? 'You are on duty' : 'You are off duty') }} /></div>
          <div className="tp-row"><div className="tp-grow"><b>Working hours</b><p className="tp-sub">{s.hours.start} to {s.hours.end}, {days.join(', ')}</p></div><button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('hours')}>Edit</button></div>
        </section>
      </div>
      <section className="ov-card tp-card" aria-label="Notifications"><h2 className="tp-h2">Notifications</h2><p className="tp-sub">Everything shows in the bell. Choose what also comes to your phone or email.</p>
        <div className="tp-row tp-sub" style={{ justifyContent: 'flex-end', gap: 28, paddingRight: 2 }}><span>Push</span><span>Email</span></div>
        <ul className="tp-list">{s.notifications.map(n => <li key={n.key} className="tp-li"><b className="tp-grow">{n.label}</b>
          <Switch on={n.push} label={`${n.label} push`} onChange={v => setNotification(n.key, 'push', v)} /><Switch on={n.email} label={`${n.label} email`} onChange={v => setNotification(n.key, 'email', v)} /></li>)}</ul></section>
      <section className="ov-card tp-card"><div className="tp-row"><div className="tp-grow"><b>A number of your own for texts</b><p className="tp-sub">Coming later</p></div><Chip tone="mute">Not available yet</Chip></div></section>
      {account && <section className="ov-card tp-card"><div className="tp-row tp-wrap"><p className="tp-sub tp-grow" style={{ flexBasis: 260 }}>Deletes your login and personal details for good. Records the law makes us keep stay, without your name.</p><button type="button" className="tp-btn ov-ghost" style={{ color: 'var(--ov-live)' }} onClick={() => setPanel('delete')}><Trash2 size={16} aria-hidden="true" />Delete my account</button></div></section>}
      {account && panel === 'delete' && <account.DeleteDialog onClose={() => setPanel(null)} />}

      <Drawer open={panel === 'profile'} onClose={() => setPanel(null)} title="Edit profile" footer={<button type="button" className="ov-hero tp-primary" onClick={() => { setProfile({ ...profile, name }); note('Profile saved'); setPanel(null) }}>Save</button>}>
        <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Phone"><input defaultValue={profile.phone} /></Field>
      </Drawer>
      <Drawer open={panel === 'password'} onClose={() => setPanel(null)} title="Change password" footer={<button type="button" className="ov-hero tp-primary" onClick={() => { note('Password changes are not open yet'); setPanel(null) }}>Continue</button>}>
        <Field label="Current password"><input type="password" /></Field>
        <Field label="New password"><input type="password" /></Field>
        <button type="button" className="tp-link" onClick={() => note('A reset link would be sent here')}>Forgot password?</button>
      </Drawer>
      <Drawer open={panel === 'hours'} onClose={() => setPanel(null)} title="Working hours" sub={`${s.hours.start} to ${s.hours.end}`} footer={<button type="button" className="ov-hero tp-primary" onClick={() => { note('Working hours saved'); setPanel(null) }}>Save</button>}>
        <div className="tp-row tp-wrap">{all.map(d => <button key={d} type="button" aria-pressed={days.includes(d)} className="tp-btn ov-ghost" style={days.includes(d) ? { borderColor: 'var(--ov-data-a)', background: 'var(--ov-data-a-tint)' } : undefined} onClick={() => setDays(days.includes(d) ? days.filter(x => x !== d) : all.filter(x => x === d || days.includes(x)))}>{d}</button>)}</div>
        <p className="tp-sub">Off, no bookings this day</p>
      </Drawer>
    </div>
  )
}
