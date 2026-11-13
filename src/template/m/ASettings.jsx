import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, X, User, Bell, CalendarDays, CreditCard, Shield, ChevronRight } from 'lucide-react'
import { useSampleSettings, useSampleActions, useSampleBilling, useSampleClients, useDataSource } from '../data'
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
import { CarrierSelect } from '../CarrierSelect'
import { isNativeApp } from '../../lib/native'
import { NATIVE_BILLING_TEXT } from '../../components/native/NativeBillingNote'
import { useProducts } from '../useProducts'
import { label as productsLabel } from '../../lib/products.js'
import '../settings929.css'
import { useApp, SubPage, Row, Toggle, Ini } from './AppKit'
import { weekWords } from './appModel'

// P971 — Settings on the phone: glass cards, one row per setting with its current value on the right and a chevron,
// real switches for the on/off ones, each row opening its own sub-screen (?set=…). P977: the first screen is a list of
// sections (Account, Notifications, Calls and calendar, Plan and billing, Privacy and security), each opening its own
// screen. Your profile (photo, name, phone, email, licensed states, carriers) lives only on its own screen, opened by
// "Edit profile" on the Account card. Delete account sits at the bottom of Account, a quiet red text row (Apple needs
// it reachable). Sign out is its own button on the Account page. Billing stays "managed on the website" in the app.
const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['system', 'Match my phone']]
const TITLE = {
  account: 'Account', notify: 'Notifications', calendar: 'Calls and calendar', billing: 'Plan and billing', privacy: 'Privacy and security',
  profile: 'Edit profile', zone: 'Time zone', licence: 'Licensed states', carriers: 'Carriers you write with', setup: 'Your setup', calls: 'Call hours',
  email: 'Carrier emails', alerts: 'Email alerts', receipts: 'Receipts', appearance: 'Theme', password: 'Password',
}
export const PRIVACY_URL = 'https://ohvara.com/privacy'
const GROUPS = { account: 1, notify: 1, calendar: 1, billing: 1, privacy: 1 }
const zoneWord = tz => String(tz || '').split(/[/]/).pop().replace(/_/g, ' ') || 'Not set'
const listWords = (xs, none) => (xs.length ? (xs.length > 2 ? `${xs.slice(0, 2).join(', ')} +${xs.length - 2}` : xs.join(', ')) : none)

export default function ASettings({ root = false, nested }) {
  const [params] = useSearchParams()
  // P982: each screen in the stack says which section it is (the address only knows the top one).
  const set = typeof nested === 'string' ? nested || null : root ? null : params.get('set')
  if (set && GROUPS[set]) return <SubPage title={TITLE[set]} line="Settings" big><GroupScreen k={set} /></SubPage>
  if (set && TITLE[set]) return <SubPage title={TITLE[set]} line={set === 'profile' ? 'You' : 'Settings'}><Section k={set} /></SubPage>
  return <SettingsList />
}

// The carriers the agent writes with: what they saved, else the carriers their clients are with.
function useCarriers() {
  const { data: s } = useSampleSettings()
  const { data: clients } = useSampleClients()
  if (Array.isArray(s.profile?.carriers)) return s.profile.carriers
  return [...new Set(clients.map(c => c.carrier_name).filter(Boolean))].sort()
}

// A setting row: its name, its current value on the right, a chevron; opens its own screen.
const Val = ({ children, bad }) => (children ? <span className={`ma-val${bad ? ' is-bad' : ''}`}>{children}</span> : null)

function useSettingsBits() {
  const app = useApp()
  const { data: s } = useSampleSettings()
  const { data: b } = useSampleBilling()
  const { has, picked } = useProducts()
  const [theme] = useThemePref()
  const go = k => app.open(`${paths.settings()}?set=${k}`)
  const leads = has('leads')
  const alerts = s.notifications || []
  return { app, s, b, go, leads, picked, theme, alerts }
}
const themeWordOf = theme => (THEMES.find(([k]) => k === theme) || THEMES[2])[1]

// The first screen: the sections, each with what's in it (or its current value) under the name.
function SettingsList() {
  const { s, b, go, leads, picked, theme, alerts } = useSettingsBits()
  const pushOn = alerts.filter(n => n.push).length
  return (
    <SubPage big title="Settings">
      <div className="ma-glass ma-list ma-set ma-sections ma-rise">
        <Row onClick={() => go('account')} lead={<span className="ma-sym is-sky"><User size={16} aria-hidden="true" /></span>} title="Account" sub={`${zoneWord(s.timeZone)} · ${themeWordOf(theme)}`} />
        <Row onClick={() => go('notify')} lead={<span className="ma-sym is-coral"><Bell size={16} aria-hidden="true" /></span>} title="Notifications" sub={pushOn ? `${pushOn} of ${alerts.length} come to your phone` : 'Only in the bell'} />
        <Row onClick={() => go('calendar')} lead={<span className="ma-sym is-sage"><CalendarDays size={16} aria-hidden="true" /></span>} title="Calls and calendar" sub={`Hours ${weekWords(s.week)}`} />
        <Row onClick={() => go('billing')} lead={<span className="ma-sym is-butter"><CreditCard size={16} aria-hidden="true" /></span>} title="Plan and billing" sub={leads ? planOf(b).label : productsLabel(picked)} />
        <Row onClick={() => go('privacy')} lead={<span className="ma-sym is-stone"><Shield size={16} aria-hidden="true" /></span>} title="Privacy and security" sub="Password, who sees your clients" />
      </div>
    </SubPage>
  )
}

// One section's own screen.
function GroupScreen({ k }) {
  const { s, b, go, app, leads, picked, theme, alerts } = useSettingsBits()
  const { setNotification } = useSampleActions()
  const account = useAccount()
  const note = useNote()
  const money = usd()
  const native = isNativeApp()
  const [panel, setPanel] = useState(null)
  const duty = !!b.take && inLiveHours(b.take.hours, b.take.tz)
  const emailed = alerts.filter(n => n.email).length
  const card = b.card?.onFile === false ? 'No card' : `${b.card?.brand || ''} ${b.card?.last4 || ''}`.trim()
  const DeleteDialog = account?.DeleteDialog
  if (k === 'account') {
    return (
      <>
        <div className="ma-glass ma-list ma-set ma-rise">
          <Row onClick={() => go('zone')} title="Time zone" right={<Val>{zoneWord(s.timeZone)}</Val>} />
          <Row onClick={() => go('appearance')} title="Theme" right={<Val>{themeWordOf(theme)}</Val>} />
        </div>
        <p className="ma-hint ma-set-note">Your photo, name, phone and email are on Edit profile, on the Account page.</p>
        <button type="button" className="ma-quiet-danger" onClick={() => (DeleteDialog ? setPanel('delete') : note('Delete my account works once you sign in for real'))}>Delete account</button>
        {panel === 'delete' && DeleteDialog && <DeleteDialog onClose={() => setPanel(null)} />}
      </>
    )
  }
  if (k === 'notify') {
    return (
      <>
        <p className="ma-hint">Everything shows in the bell. These also come to your phone.</p>
        <div className="ma-glass ma-list ma-set ma-rise">
          {alerts.map(n => (
            <div key={n.key} className="ma-row"><span className="ma-grow"><b>{n.label}</b></span>
              <Toggle on={n.push} label={`${n.label} push`} onChange={v => { setNotification(n.key, 'push', v); note(`${n.label}: push ${v ? 'on' : 'off'}`) }} /></div>
          ))}
          <Row onClick={() => go('alerts')} title="Email alerts" right={<Val>{emailed ? `${emailed} on` : 'Off'}</Val>} />
        </div>
      </>
    )
  }
  if (k === 'calendar') {
    return (
      <div className="ma-glass ma-list ma-set ma-rise">
        <Row onClick={() => go('calls')} title="Call hours" sub={leads ? (duty ? 'Live calls ring you now' : 'Outside your hours we book callers') : undefined} right={<Val>{weekWords(s.week)}</Val>} />
        <Row onClick={() => go('email')} title="Carrier emails" right={<Val>Forwarding</Val>} />
        {leads && <Row onClick={() => go('setup')} title="Your setup" right={<Val>Steps</Val>} />}
      </div>
    )
  }
  if (k === 'billing') {
    return (
      <>
        <div className="ma-glass ma-list ma-set ma-rise">
          <Row onClick={() => app.open(paths.billing())} title="Plan" right={<Val>{leads ? planOf(b).label : productsLabel(picked)}</Val>} />
          {leads && <Row onClick={() => app.open(paths.billing())} title="Lead spend" right={<span className="ma-val tp-money">{money(dailyTotal(b.spend))} a day</span>} />}
          <Row onClick={() => app.open(native ? paths.billing() : `${paths.billing()}?full=1`)} title="Card" right={<Val bad={card === 'No card'}>{card}</Val>} />
          <Row onClick={() => go('receipts')} title="Receipts" right={<Val>By email</Val>} />
        </div>
        {native && <p className="ma-hint ma-set-note">{NATIVE_BILLING_TEXT}</p>}
      </>
    )
  }
  if (k === 'privacy') {
    return (
      <>
        <div className="ma-glass ma-list ma-set ma-rise">
          <Row onClick={() => go('password')} title="Password" />
          <a className="ma-row" href={PRIVACY_URL} target="_blank" rel="noreferrer"><span className="ma-grow"><b>Privacy policy</b></span><ChevronRight size={18} className="ma-chev" aria-hidden="true" /></a>
        </div>
        <p className="ma-hint ma-set-note">Your clients and leads are seen only by you and the Ohvara team.</p>
      </>
    )
  }
  return null
}

// On Edit profile, under the fields: the states you're licensed in and the carriers you write with.
function ProfileWork() {
  const { s, go } = useSettingsBits()
  const carriers = useCarriers()
  const states = s.licence ? asPick(s.licence).states : []
  return (
    <div className="ma-glass ma-list ma-set">
      <Row onClick={() => go('licence')} title="Licensed states" right={<Val bad={!states.length}>{listWords(states, 'None yet')}</Val>} />
      <Row onClick={() => go('carriers')} title="Carriers" right={<Val bad={!carriers.length}>{listWords(carriers, 'None yet')}</Val>} />
    </div>
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
  const source = useDataSource()
  const carriers = useCarriers()
  const [cs, setCs] = useState(carriers)
  const done = text => { note(text); app.back() }
  const save = (on, fn) => <div className="ma-savebar"><button type="button" className="ma-btn is-solid is-tall ma-press" disabled={!on} onClick={fn}>Save</button></div>
  const intro = text => <p className="ma-hint">{text}</p>

  if (k === 'profile') {
    const dirty = JSON.stringify(p) !== JSON.stringify(s.profile)
    const onPhoto = e => {
      const f = e.target.files?.[0]
      if (!f) return
      const r = new FileReader()
      r.onload = () => setP(x => ({ ...x, photo: String(r.result) }))
      r.readAsDataURL(f)
    }
    return (
      <div className="ma-form">
        {intro('How you show up to the team and on everything we send for you.')}
        <div className="ma-glass ma-pad ma-photo">
          <Ini name={p.name} tone="sky" size={72} photo={p.photo} className="is-ring" />
          <label className="ma-btn is-soft ma-press">{p.photo ? 'Change photo' : 'Add a photo'}<input type="file" accept="image/*" onChange={onPhoto} hidden /></label>
          {p.photo && <button type="button" className="ma-link-btn" onClick={() => setP(x => ({ ...x, photo: null }))}>Remove</button>}
        </div>
        <div className="ma-glass ma-fields">
          <MField label="Full name"><input value={p.name || ''} autoComplete="name" onChange={e => setP({ ...p, name: e.target.value })} /></MField>
          <MField label="Phone"><PhoneInput value={p.phone || ''} onChange={(d, e164, shown) => setP({ ...p, phone: shown })} /></MField>
          <MField label="Email"><input type="email" value={p.email || ''} autoComplete="email" onChange={e => setP({ ...p, email: e.target.value })} /></MField>
        </div>
        <ProfileWork />
        {save(dirty, () => { if (source === 'sample') saveSettings({ profile: p }); done('Profile saved') })}
      </div>
    )
  }
  if (k === 'carriers') {
    const dirty = JSON.stringify(cs) !== JSON.stringify(carriers)
    return (
      <div className="ma-form">
        {intro('The carriers you’re appointed with. Our team uses them when they set up or save a policy.')}
        <div className="ma-glass ma-list ma-set">
          {cs.map(c => (
            <div key={c} className="ma-row"><span className="ma-grow"><b>{c}</b></span>
              <button type="button" className="ma-ib ma-press" aria-label={`Remove ${c}`} onClick={() => setCs(cs.filter(x => x !== c))}><X size={18} aria-hidden="true" /></button></div>
          ))}
          {!cs.length && <p className="ma-empty">No carriers yet.</p>}
        </div>
        <div className="ma-glass ma-fields"><div className="ma-field"><CarrierSelect label="Add a carrier" value="" onChange={v => { if (v && !cs.includes(v)) setCs([...cs, v].sort()) }} /></div></div>
        {save(dirty, () => { if (source === 'sample') saveSettings({ profile: { ...(s.profile || {}), carriers: cs } }); done('Carriers saved') })}
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
