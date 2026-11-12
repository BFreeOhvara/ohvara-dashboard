import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LogOut, Trash2, KeyRound } from 'lucide-react'
import { useSampleSettings, useSampleActions, useSampleBilling } from '../data'
import { useThemePref } from '../../hooks/useTheme'
import { Field, useNote, useAccount } from '../kit'
import { TimeZoneSelect } from '../Clock'
import { PhoneInput } from '../PhoneInput'
import { dailyTotal, planOf } from '../spendPlan'
import { usd } from '../motion'
import { paths } from '../paths'
import { inLiveHours } from '../../lib/leadSplit'
import { HoursEditor } from '../Hours'
import { LicenceCard } from '../Licence'
import { PaymentIntakeCard } from '../PaymentIntake'
import { DeedstonePhone } from '../DeedstonePhone'
import { SetupProgress } from '../SetupProgress'
import { useLaunchView } from '../launchView'
import { asPick } from '../licenceModel'
import { AppAbout } from '../../components/native/AppAbout'
import { isNativeApp } from '../../lib/native'
import { NATIVE_BILLING_TEXT } from '../../components/native/NativeBillingNote'
import { useProducts } from '../useProducts'
import '../settings929.css'
import { useApp, SubPage, Row, Toggle } from './AppKit'

// P967 — Settings on the phone: every setting the portal's Settings has (P929's tabs), grouped like the mockup: You,
// Calls and calendar, Notifications, Plan and billing, Appearance, Account (Sign out, Delete account: Apple requires it).
// A row opens its section as the next screen (?set=…), so Back and the edge swipe come back to the list.
const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']]
const TITLE = { profile: 'Name and contact', licence: 'Licence and states', setup: 'Your setup', calls: 'Hours and calls', email: 'Carrier emails', alerts: 'Notifications', receipts: 'Receipts', password: 'Password' }

export default function ASettings() {
  const [params] = useSearchParams()
  const set = params.get('set')
  if (set && TITLE[set]) return <SubPage title={TITLE[set]} line="Settings"><Section k={set} /></SubPage>
  return <SettingsList />
}

function SettingsList() {
  const app = useApp()
  const { data: s } = useSampleSettings()
  const { data: b } = useSampleBilling()
  const { setNotification } = useSampleActions()
  const [theme, saveTheme] = useThemePref()
  const account = useAccount()
  const note = useNote()
  const { has } = useProducts()
  const money = usd()
  const native = isNativeApp()
  const [panel, setPanel] = useState(null)
  const go = k => app.open(`${paths.settings()}?set=${k}`)
  const states = s.licence ? asPick(s.licence).states : []
  const days = Object.values(s.week || {}).filter(d => d.on)
  const duty = !!b.take && inLiveHours(b.take.hours, b.take.tz)
  const DeleteDialog = account?.DeleteDialog
  const signOut = () => (account?.live ? account.signOut() : note('Sign out works once you sign in for real'))
  const leads = has('leads')
  return (
    <SubPage title="Settings" line="Everything from the portal’s Settings">
      <p className="ma-cap is-out">You</p>
      <div className="ma-glass ma-list">
        <Row onClick={() => go('profile')} title="Name and contact" sub={[s.profile?.email, s.profile?.phone].filter(Boolean).join(' · ')} right={<span className="ma-val">{s.profile?.name}</span>} />
        <Row onClick={() => go('licence')} title="Licensed states" sub="Your licence and the states your leads come from" right={<span className="ma-val">{states.length ? states.join(', ') : 'None yet'}</span>} />
        {leads && <Row onClick={() => go('setup')} title="Your setup" sub="The steps from sign-up to your first leads" />}
      </div>

      <p className="ma-cap is-out">Calls and calendar</p>
      <div className="ma-glass ma-list">
        <Row onClick={() => go('calls')} title="Hours you take calls" sub={leads ? (duty ? 'Live transfers ring you now' : 'Outside your hours: we book callers') : 'Your hours and your phone'} right={<span className="ma-val">{days.length ? `${days.length} days` : 'Not set'}</span>} />
        <Row onClick={() => go('email')} title="Carrier emails" sub="Forward carrier emails: a lapse becomes a save call" />
      </div>

      <p className="ma-cap is-out">Notifications</p>
      <div className="ma-glass ma-list">
        {(s.notifications || []).map(n => (
          <div key={n.key} className="ma-row"><span className="ma-grow"><b>{n.label}</b><small>Push to this phone</small></span>
            <Toggle on={n.push} label={`${n.label} push`} onChange={v => { setNotification(n.key, 'push', v); note(`${n.label}: push ${v ? 'on' : 'off'}`) }} /></div>
        ))}
        <Row onClick={() => go('alerts')} title="Email me too" sub="Pick which ones also come by email" />
      </div>

      <p className="ma-cap is-out">Plan and billing</p>
      <div className="ma-glass ma-list">
        <Row onClick={() => app.open(paths.billing())} title="Plan" sub={native ? NATIVE_BILLING_TEXT : undefined} right={<span className="ma-val">{leads ? planOf(b).label : 'Your products'}</span>} />
        {leads && <Row onClick={() => app.open(paths.billing())} title="Lead spend" right={<span className="ma-val tp-money">{money(dailyTotal(b.spend))} a day</span>} />}
        <Row onClick={() => app.open(`${paths.billing()}?full=1`)} title="Card" right={<span className="ma-val">{b.card?.onFile === false ? 'No card' : `${b.card?.brand || ''} ${b.card?.last4 || ''}`.trim()}</span>} />
        <Row onClick={() => go('receipts')} title="Receipts" sub="Where receipts go" />
      </div>

      <p className="ma-cap is-out">Appearance</p>
      <div className="ma-glass ma-pad">
        <div className="ma-themes" role="radiogroup" aria-label="Theme">
          {THEMES.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={theme === k} className={`ma-press${theme === k ? ' is-on' : ''}`} onClick={() => { saveTheme(k); note(k === 'system' ? 'Theme follows your device' : `${l} mode on`) }}>{l}</button>)}
        </div>
      </div>

      <p className="ma-cap is-out">Account</p>
      <div className="ma-glass ma-list">
        <Row onClick={() => go('password')} lead={<span className="ma-sym is-stone"><KeyRound size={16} aria-hidden="true" /></span>} title="Password and sign-in" />
        <Row onClick={signOut} lead={<span className="ma-sym is-stone"><LogOut size={16} aria-hidden="true" /></span>} title="Sign out" chev={false} />
        <Row onClick={() => (DeleteDialog ? setPanel('delete') : note('Delete my account works once you sign in for real'))} lead={<span className="ma-sym is-coral"><Trash2 size={16} aria-hidden="true" /></span>} title="Delete account" className="is-danger" chev={false} />
      </div>
      <AppAbout style={{ margin: '4px 12px 0' }} />
      {panel === 'delete' && DeleteDialog && <DeleteDialog onClose={() => setPanel(null)} />}
    </SubPage>
  )
}

function Section({ k }) {
  const app = useApp()
  const { data: s } = useSampleSettings()
  const { setNotification, saveSettings, saveWeek } = useSampleActions()
  const note = useNote()
  const setupView = useLaunchView()
  const [p, setP] = useState(s.profile || {})
  const [tz, setTz] = useState(s.timeZone)
  const [week, setWeek] = useState(s.week)
  const [alerts, setAlerts] = useState(s.notifications || [])
  const [rc, setRc] = useState({ email: s.profile?.email || '', receipts: true })
  const done = text => { note(text); app.back() }
  const save = (on, fn) => <div className="ma-savebar"><button type="button" className="ma-btn is-solid ma-press" disabled={!on} onClick={fn}>Save</button></div>
  if (k === 'profile') {
    const dirty = JSON.stringify(p) !== JSON.stringify(s.profile) || tz !== s.timeZone
    return (
      <div className="ma-form">
        <Field label="Full name"><input value={p.name || ''} onChange={e => setP({ ...p, name: e.target.value })} /></Field>
        <Field label="Email"><input type="email" value={p.email || ''} onChange={e => setP({ ...p, email: e.target.value })} /></Field>
        <Field label="Phone"><PhoneInput value={p.phone || ''} onChange={(d, e164, shown) => setP({ ...p, phone: shown })} /></Field>
        <Field label="Time zone" hint="Your calendar and Home use it"><TimeZoneSelect value={tz} onChange={setTz} /></Field>
        <Field label="Plan" hint="Change it in Billing"><input value={p.plan || ''} readOnly /></Field>
        {save(dirty, () => { if (tz !== s.timeZone) saveSettings({ timeZone: tz }); done('Profile saved') })}
      </div>
    )
  }
  if (k === 'licence') return <div className="ma-embed"><LicenceCard /></div>
  if (k === 'setup') return <div className="ma-embed">{setupView ? <SetupProgress view={setupView} /> : <p className="ma-muted">Your setup steps show here once you’ve signed up.</p>}</div>
  if (k === 'email') return <div className="ma-embed"><PaymentIntakeCard /></div>
  if (k === 'calls') {
    const dirty = JSON.stringify(week) !== JSON.stringify(s.week)
    return (
      <div className="ma-embed">
        <p className="ma-muted">One set of hours. Inside them, booked calls land on your calendar and live calls ring your phone. Outside them, we book callers for your next open time.</p>
        <HoursEditor week={week} onChange={setWeek} tz={s.timeZone} />
        <DeedstonePhone />
        {save(dirty, () => { saveWeek(week); done('Hours saved. Clashes with booked calls show on Calendar') })}
      </div>
    )
  }
  if (k === 'alerts') {
    const flip = (key, field, v) => setAlerts(alerts.map(n => (n.key === key ? { ...n, [field]: v } : n)))
    const dirty = JSON.stringify(alerts) !== JSON.stringify(s.notifications)
    return (
      <div className="ma-form">
        <p className="ma-muted">Everything shows in the bell. Choose what also comes to your phone or email.</p>
        <div className="ma-glass ma-list">
          <div className="ma-row is-head"><span className="ma-grow" /><small>Push</small><small>Email</small></div>
          {alerts.map(n => (
            <div key={n.key} className="ma-row"><span className="ma-grow"><b>{n.label}</b></span>
              <Toggle small on={n.push} label={`${n.label} push`} onChange={v => flip(n.key, 'push', v)} />
              <Toggle small on={n.email} label={`${n.label} email`} onChange={v => flip(n.key, 'email', v)} />
            </div>
          ))}
        </div>
        {save(dirty, () => {
          alerts.forEach(n => { const was = (s.notifications || []).find(x => x.key === n.key); if (!was) return; if (was.push !== n.push) setNotification(n.key, 'push', n.push); if (was.email !== n.email) setNotification(n.key, 'email', n.email) })
          done('Notifications saved')
        })}
      </div>
    )
  }
  if (k === 'receipts') {
    return (
      <div className="ma-form">
        <Field label="Receipts go to"><input type="email" value={rc.email} onChange={e => setRc({ ...rc, email: e.target.value })} /></Field>
        <div className="ma-glass ma-list"><div className="ma-row"><span className="ma-grow"><b>Email me each receipt</b><small>Sent the day you’re charged</small></span><Toggle on={rc.receipts} label="Email me each receipt" onChange={v => setRc({ ...rc, receipts: v })} /></div></div>
        {save(true, () => done('Billing settings saved'))}
      </div>
    )
  }
  if (k === 'password') {
    return (
      <div className="ma-form">
        <Field label="Current password"><input type="password" autoComplete="current-password" /></Field>
        <Field label="New password"><input type="password" autoComplete="new-password" /></Field>
        <button type="button" className="ma-link-btn" onClick={() => note('A reset link would be sent here')}>Forgot password?</button>
        {save(true, () => done('Password changes are not open yet'))}
      </div>
    )
  }
  return null
}
