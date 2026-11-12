import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useSampleSettings, useSampleActions, useSampleBilling } from '../data'
import { useThemePref } from '../../hooks/useTheme'
import { useNote, useAccount } from '../kit'
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
import { label as productsLabel } from '../../lib/products.js'
import '../settings929.css'
import { useApp, SubPage, Row, Toggle } from './AppKit'
import { weekWords } from './appModel'

// P971 — Settings on the phone, redone like the mockup: grouped glass cards (You · Calls and calendar ·
// Notifications · Plan and billing · Account), one row per setting with its current value on the right and a
// chevron, real switches for the on/off ones, and each row opening its own sub-screen (?set=…, same pinned header,
// so Back and the edge swipe come back to the list). Every setting the portal's Settings has (P929's tabs) is here:
// profile, time zone, licence, your setup, hours and calls, carrier emails, notifications (push and email),
// receipts, appearance, password; plus Sign out and Delete account (Apple requires it). Billing itself stays
// "managed on the Ohvara website" in the native app (no payments in the app).
const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['system', 'Match my phone']]
const THEME_WORD = { light: 'Light', dark: 'Dark', system: 'Automatic' }
const TITLE = {
  profile: 'Name and contact', zone: 'Time zone', licence: 'Licensed states', setup: 'Your setup', calls: 'Hours you take calls',
  email: 'Carrier emails', alerts: 'Email me too', receipts: 'Receipts', appearance: 'Appearance', password: 'Password and sign-in',
}
const zoneWord = tz => String(tz || '').split(/[/]/).pop().replace(/_/g, ' ') || 'Not set'

export default function ASettings() {
  const [params] = useSearchParams()
  const set = params.get('set')
  if (set && TITLE[set]) return <SubPage title={TITLE[set]} line="Settings"><Section k={set} /></SubPage>
  return <SettingsList />
}

// A setting row: its name, its current value on the right, a chevron; opens its own screen.
const Val = ({ children, bad }) => (children ? <span className={`ma-val${bad ? ' is-bad' : ''}`}>{children}</span> : null)
const Group = ({ title, children }) => <><p className="ma-cap is-out">{title}</p><div className="ma-glass ma-list ma-set">{children}</div></>

function SettingsList() {
  const app = useApp()
  const { data: s } = useSampleSettings()
  const { data: b } = useSampleBilling()
  const { setNotification } = useSampleActions()
  const [theme] = useThemePref()
  const account = useAccount()
  const note = useNote()
  const { has, picked } = useProducts()
  const money = usd()
  const native = isNativeApp()
  const [panel, setPanel] = useState(null)
  const go = k => app.open(`${paths.settings()}?set=${k}`)
  const states = s.licence ? asPick(s.licence).states : []
  const duty = !!b.take && inLiveHours(b.take.hours, b.take.tz)
  const alerts = s.notifications || []
  const emailed = alerts.filter(n => n.email).length
  const DeleteDialog = account?.DeleteDialog
  const signOut = () => (account?.live ? account.signOut() : note('Sign out works once you sign in for real'))
  const leads = has('leads')
  const card = b.card?.onFile === false ? 'No card' : `${b.card?.brand || ''} ${b.card?.last4 || ''}`.trim()
  return (
    <SubPage title="Settings" line="Everything from the portal’s Settings">
      <Group title="You">
        <Row onClick={() => go('profile')} title="Name and contact" right={<Val>{s.profile?.name}</Val>} />
        <Row onClick={() => go('zone')} title="Time zone" right={<Val>{zoneWord(s.timeZone)}</Val>} />
        <Row onClick={() => go('licence')} title="Licensed states" right={<Val bad={!states.length}>{states.length ? states.join(', ') : 'None yet'}</Val>} />
        {leads && <Row onClick={() => go('setup')} title="Your setup" right={<Val>Steps</Val>} />}
      </Group>

      <Group title="Calls and calendar">
        <Row onClick={() => go('calls')} title="Hours you take calls" sub={leads ? (duty ? 'Live calls ring you now' : 'Outside your hours: we book callers') : undefined} right={<Val>{weekWords(s.week)}</Val>} />
        <Row onClick={() => go('email')} title="Carrier emails" right={<Val>Forwarding</Val>} />
      </Group>

      <Group title="Notifications">
        {alerts.map(n => (
          <div key={n.key} className="ma-row"><span className="ma-grow"><b>{n.label}</b><small>Push to this phone</small></span>
            <Toggle on={n.push} label={`${n.label} push`} onChange={v => { setNotification(n.key, 'push', v); note(`${n.label}: push ${v ? 'on' : 'off'}`) }} /></div>
        ))}
        <Row onClick={() => go('alerts')} title="Email me too" right={<Val>{emailed ? `${emailed} on` : 'Off'}</Val>} />
      </Group>

      <Group title="Plan and billing">
        <Row onClick={() => app.open(paths.billing())} title="Plan" right={<Val>{leads ? planOf(b).label : productsLabel(picked)}</Val>} />
        {leads && <Row onClick={() => app.open(paths.billing())} title="Lead spend" right={<span className="ma-val tp-money">{money(dailyTotal(b.spend))} a day</span>} />}
        <Row onClick={() => app.open(native ? paths.billing() : `${paths.billing()}?full=1`)} title="Card" right={<Val bad={card === 'No card'}>{card}</Val>} />
        <Row onClick={() => go('receipts')} title="Receipts" right={<Val>Email</Val>} />
      </Group>
      {native && <p className="ma-hint ma-set-note">{NATIVE_BILLING_TEXT}</p>}

      <Group title="Account">
        <Row onClick={() => go('appearance')} title="Appearance" right={<Val>{THEME_WORD[theme] || 'Automatic'}</Val>} />
        <Row onClick={() => go('password')} title="Password and sign-in" />
        <Row onClick={signOut} title="Sign out" chev={false} />
        <Row onClick={() => (DeleteDialog ? setPanel('delete') : note('Delete my account works once you sign in for real'))} title="Delete account" className="is-danger" chev={false} />
      </Group>
      <AppAbout style={{ margin: '14px 12px 0', textAlign: 'center' }} />
      {panel === 'delete' && DeleteDialog && <DeleteDialog onClose={() => setPanel(null)} />}
    </SubPage>
  )
}

// A field in a glass card: the label over the input, a hint under it.
const MField = ({ label, hint, children }) => <label className="ma-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>

function Section({ k }) {
  const app = useApp()
  const { data: s } = useSampleSettings()
  const { setNotification, saveSettings, saveWeek } = useSampleActions()
  const [theme, saveTheme] = useThemePref()
  const note = useNote()
  const setupView = useLaunchView()
  const [p, setP] = useState(s.profile || {})
  const [tz, setTz] = useState(s.timeZone)
  const [week, setWeek] = useState(s.week)
  const [alerts, setAlerts] = useState(s.notifications || [])
  const [rc, setRc] = useState({ email: s.profile?.email || '', receipts: true })
  const done = text => { note(text); app.back() }
  const save = (on, fn) => <div className="ma-savebar"><button type="button" className="ma-btn is-solid is-tall ma-press" disabled={!on} onClick={fn}>Save</button></div>
  const intro = text => <p className="ma-hint">{text}</p>

  if (k === 'profile') {
    const dirty = JSON.stringify(p) !== JSON.stringify(s.profile)
    return (
      <div className="ma-form">
        {intro('How you show up to the team and on everything we send for you.')}
        <div className="ma-glass ma-fields">
          <MField label="Full name"><input value={p.name || ''} autoComplete="name" onChange={e => setP({ ...p, name: e.target.value })} /></MField>
          <MField label="Email"><input type="email" value={p.email || ''} autoComplete="email" onChange={e => setP({ ...p, email: e.target.value })} /></MField>
          <MField label="Phone"><PhoneInput value={p.phone || ''} onChange={(d, e164, shown) => setP({ ...p, phone: shown })} /></MField>
          <MField label="Plan" hint="Change it in Billing"><input value={p.plan || ''} readOnly /></MField>
        </div>
        {save(dirty, () => done('Profile saved'))}
      </div>
    )
  }
  if (k === 'zone') {
    return (
      <div className="ma-form">
        {intro('Your calendar, Home and every call time use it.')}
        <div className="ma-glass ma-fields"><MField label="Time zone"><TimeZoneSelect value={tz} onChange={setTz} /></MField></div>
        {save(tz !== s.timeZone, () => { saveSettings({ timeZone: tz }); done('Time zone saved') })}
      </div>
    )
  }
  if (k === 'licence') return <div className="ma-embed">{intro('Your licence and the states your leads come from.')}<LicenceCard /></div>
  if (k === 'setup') return <div className="ma-embed">{intro('The same steps our team sees, from sign-up to your first leads.')}{setupView ? <SetupProgress view={setupView} /> : <p className="ma-empty is-glass">Your setup steps show here once you’ve signed up.</p>}</div>
  if (k === 'email') return <div className="ma-embed">{intro('Forward carrier emails here: a lapse, missed payment or bounced draft becomes a save call for the team.')}<PaymentIntakeCard /></div>
  if (k === 'calls') {
    const dirty = JSON.stringify(week) !== JSON.stringify(s.week)
    return (
      <div className="ma-embed">
        {intro('One set of hours. Inside them, booked calls land on your calendar and live calls ring your phone. Outside them, we book callers for your next open time.')}
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
        {intro('Everything shows in the bell. Choose what also comes to your phone or email.')}
        <div className="ma-glass ma-list ma-set">
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
        {intro('Where your receipts go. Change your lead spend on the Billing page.')}
        <div className="ma-glass ma-fields"><MField label="Receipts go to"><input type="email" value={rc.email} onChange={e => setRc({ ...rc, email: e.target.value })} /></MField></div>
        <div className="ma-glass ma-list ma-set"><div className="ma-row"><span className="ma-grow"><b>Email me each receipt</b><small>Sent the day you’re charged</small></span><Toggle on={rc.receipts} label="Email me each receipt" onChange={v => setRc({ ...rc, receipts: v })} /></div></div>
        {save(true, () => done('Billing settings saved'))}
      </div>
    )
  }
  if (k === 'appearance') {
    return (
      <div className="ma-form">
        {intro('Light, dark, or match your phone. It changes right away.')}
        <div className="ma-glass ma-list ma-set" role="radiogroup" aria-label="Theme">
          {THEMES.map(([key, l]) => (
            <button key={key} type="button" role="radio" aria-checked={theme === key} className="ma-row" onClick={() => { saveTheme(key); note(key === 'system' ? 'Theme follows your phone' : `${l} mode on`) }}>
              <span className="ma-grow"><b>{l}</b></span>
              {theme === key && <Check size={20} strokeWidth={2.6} className="ma-tick" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </div>
    )
  }
  if (k === 'password') {
    return (
      <div className="ma-form">
        {intro('Change the password you sign in with.')}
        <div className="ma-glass ma-fields">
          <MField label="Current password"><input type="password" autoComplete="current-password" /></MField>
          <MField label="New password"><input type="password" autoComplete="new-password" /></MField>
        </div>
        <button type="button" className="ma-link-btn" onClick={() => note('A reset link would be sent here')}>Forgot password?</button>
        {save(true, () => done('Password changes are not open yet'))}
      </div>
    )
  }
  return null
}
