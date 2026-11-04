import { useEffect, useRef, useState } from 'react'
import { User, SlidersHorizontal, Bell, MessageSquareText, LogOut, Trash2 } from 'lucide-react'
import { useSampleSettings, useSampleActions } from '../data'
import { useTheme } from '../../hooks/useTheme'
import { Drawer, Field, Seg, Switch, Chip, useNote, useAccount } from '../kit'

const SECTIONS = [['account', 'Your account', User], ['setup', 'Your setup', SlidersHorizontal], ['alerts', 'Notifications', Bell], ['texts', 'Texting number', MessageSquareText], ['leave', 'Sign out', LogOut]]

// Settings: the sections down the left, the page on the right. On a desktop the page holds still and the right
// pane scrolls; on a phone the sections become a strip of chips and the page scrolls.
export default function Settings() {
  const { data: s } = useSampleSettings()
  const { setNotification, setDuty } = useSampleActions()
  const [theme, setTheme] = useTheme()
  const note = useNote()
  const account = useAccount()
  const pane = useRef(null)
  const [at, setAt] = useState('account')
  const [panel, setPanel] = useState(null)
  const [name, setName] = useState(s.profile.name)
  const [profile, setProfile] = useState(s.profile)
  const [days, setDays] = useState(s.hours.days)
  const all = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const go = key => {
    setAt(key)
    pane.current?.querySelector(`#set-${key}`)?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  // The section in view lights up in the nav (the pane scrolls on a desktop, the page on a phone).
  useEffect(() => {
    const els = SECTIONS.map(([key]) => pane.current?.querySelector(`#set-${key}`)).filter(Boolean)
    if (!els.length || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(hits => {
      const hit = hits.filter(h => h.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (hit) setAt(hit.target.id.slice(4))
    }, { rootMargin: '-25% 0px -60% 0px' })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [])
  const signOut = () => (account.live ? account.signOut() : note('Sign out works once you sign in for real'))
  const DeleteDialog = account.DeleteDialog
  return (
    <div className="tp-page tp-setpage">
      <nav className="tp-setnav ov-card" aria-label="Settings sections">
        {SECTIONS.map(([key, label, Icon]) => (at === key
          ? <span key={key} className="on" aria-current="true"><Icon size={17} aria-hidden="true" />{label}</span>
          : <button key={key} type="button" onClick={() => go(key)}><Icon size={17} aria-hidden="true" />{label}</button>))}
      </nav>
      <div className="tp-setpane" ref={pane} tabIndex={0} aria-label="Settings">
        <section id="set-account" className="ov-card tp-card tp-stack" aria-label="Your account">
          <div className="tp-row tp-between"><h2 className="tp-h2">Your account</h2><button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('profile')}>Edit</button></div>
          <dl className="tp-facts">{[['Name', profile.name], ['Email', profile.email], ['Phone', profile.phone], ['Plan', profile.plan]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          <button type="button" className="tp-btn ov-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPanel('password')}>Change password</button>
        </section>
        <section id="set-setup" className="ov-card tp-card tp-stack" aria-label="Your setup">
          <h2 className="tp-h2">Your setup</h2>
          <div className="tp-row"><div className="tp-grow"><b>Theme</b><p className="tp-sub">Light or dark</p></div><Seg label="Theme" value={theme} onChange={setTheme} options={[{ key: 'light', label: 'Light' }, { key: 'dark', label: 'Dark' }]} /></div>
          <div className="tp-row"><div className="tp-grow"><b>On duty</b><p className="tp-sub">Live calls ring your phone</p></div><Switch on={s.duty} label="On duty" onChange={v => { setDuty(v); note(v ? 'You are on duty' : 'You are off duty') }} /></div>
          <div className="tp-row"><div className="tp-grow"><b>Working hours</b><p className="tp-sub">{s.hours.start} to {s.hours.end}, {days.join(', ')}</p></div><button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('hours')}>Edit</button></div>
        </section>
        <section id="set-alerts" className="ov-card tp-card" aria-label="Notifications"><h2 className="tp-h2">Notifications</h2><p className="tp-sub">Everything shows in the bell. Choose what also comes to your phone or email.</p>
          <div className="tp-row tp-sub" style={{ justifyContent: 'flex-end', gap: 28, paddingRight: 2 }}><span>Push</span><span>Email</span></div>
          <ul className="tp-list">{s.notifications.map(n => <li key={n.key} className="tp-li"><b className="tp-grow">{n.label}</b>
            <Switch on={n.push} label={`${n.label} push`} onChange={v => setNotification(n.key, 'push', v)} /><Switch on={n.email} label={`${n.label} email`} onChange={v => setNotification(n.key, 'email', v)} /></li>)}</ul></section>
        <section id="set-texts" className="ov-card tp-card"><div className="tp-row"><div className="tp-grow"><b>A number of your own for texts</b><p className="tp-sub">Coming later</p></div><Chip tone="mute">Not available yet</Chip></div></section>
        <section id="set-leave" className="ov-card tp-card tp-stack" aria-label="Sign out">
          <h2 className="tp-h2">Sign out</h2>
          <div className="tp-row tp-wrap">
            <button type="button" className="tp-btn ov-ghost" onClick={signOut}><LogOut size={15} />Sign out</button>
            <button type="button" className="tp-btn ov-ghost tp-danger" onClick={() => (DeleteDialog ? setPanel('delete') : note('Delete my account works once you sign in for real'))}><Trash2 size={15} />Delete my account</button>
          </div>
        </section>
      </div>

      <Drawer open={panel === 'profile'} onClose={() => setPanel(null)} title="Edit profile" footer={<button type="button" className="tp-primary fx-accent" onClick={() => { setProfile({ ...profile, name }); note('Profile saved'); setPanel(null) }}>Save</button>}>
        <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Phone"><input defaultValue={profile.phone} /></Field>
      </Drawer>
      <Drawer open={panel === 'password'} onClose={() => setPanel(null)} title="Change password" footer={<button type="button" className="tp-primary fx-accent" onClick={() => { note('Password changes are not open yet'); setPanel(null) }}>Continue</button>}>
        <Field label="Current password"><input type="password" /></Field>
        <Field label="New password"><input type="password" /></Field>
        <button type="button" className="tp-link" onClick={() => note('A reset link would be sent here')}>Forgot password?</button>
      </Drawer>
      <Drawer open={panel === 'hours'} onClose={() => setPanel(null)} title="Working hours" sub={`${s.hours.start} to ${s.hours.end}`} footer={<button type="button" className="tp-primary fx-accent" onClick={() => { note('Working hours saved'); setPanel(null) }}>Save</button>}>
        <div className="tp-row tp-wrap">{all.map(d => <button key={d} type="button" aria-pressed={days.includes(d)} className="tp-btn ov-ghost" style={days.includes(d) ? { borderColor: 'var(--ov-data-a)', background: 'var(--ov-data-a-tint)' } : undefined} onClick={() => setDays(days.includes(d) ? days.filter(x => x !== d) : all.filter(x => x === d || days.includes(x)))}>{d}</button>)}</div>
        <p className="tp-sub">Off, no bookings this day</p>
      </Drawer>
      {panel === 'delete' && DeleteDialog && <DeleteDialog onClose={() => setPanel(null)} />}
    </div>
  )
}
