import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { User, Bell, Radio, CreditCard, SunMoon, Mail, LogOut, Trash2, ChevronRight, KeyRound, BadgeCheck } from 'lucide-react'
import { useSampleSettings, useSampleActions, useSampleBilling, useSampleClients, useSampleLeads, useSampleOverview } from '../data'
import { useThemePref, previewTheme } from '../../hooks/useTheme'
import { Drawer, Field, Seg, Switch, PillTabs, useNote, useAccount, initials } from '../kit'
import { TimeZoneSelect } from '../Clock'
import { PhoneInput } from '../PhoneInput'
import { CountUp, usd } from '../motion'
import { paths } from '../paths'
import { dailyTotal, rangeWords, planOf } from '../spendPlan'
import { BookedMeter } from '../PlanBuilder'
import { inLiveHours } from '../../lib/leadSplit'
import '../settings929.css'
import { HoursEditor } from '../Hours'
import { LicenceCard } from '../Licence'
import { PaymentIntakeCard } from '../PaymentIntake'
import { DeedstonePhone } from '../DeedstonePhone'

// P929: Settings back to the pre-P924 layout (profile card on the left, tabs on the right). Notifications is only the
// switches; the carrier-email forwarding address that sat under it has its own Email tab, so no section is long.
const TABS = [['profile', 'Profile', User], ['licence', 'Licence', BadgeCheck], ['alerts', 'Notifications', Bell], ['email', 'Email', Mail], ['calls', 'Hours and calls', Radio], ['billing', 'Billing', CreditCard], ['look', 'Appearance', SunMoon]]
const NEEDS = ['ringing', 'showed']
const THEME_NAME = { light: 'Light', dark: 'Dark', system: 'System (follows your device)' }

// Discard / Save under every section. Save is off until something changed.
function FormFoot({ dirty, onDiscard, onSave, saveLabel = 'Save changes' }) {
  return (
    <footer className="fx-form-f">
      <button type="button" className="tp-btn ov-ghost" disabled={!dirty} onClick={onDiscard}>Discard</button>
      <button type="button" className="tp-primary fx-accent" disabled={!dirty} onClick={onSave}>{saveLabel}</button>
    </footer>
  )
}

function Head({ title, sub }) {
  return <header className="fx-form-h"><h2>{title}</h2><p>{sub}</p></header>
}

// Left: who you are, this week's budget and how many it has booked, three numbers, what's next.
function ProfileCard({ profile }) {
  const { data: billing } = useSampleBilling()
  const duty = !!billing.take && inLiveHours(billing.take.hours, billing.take.tz)
  const { data: clients } = useSampleClients()
  const { data: leads } = useSampleLeads()
  const { data: ov } = useSampleOverview()
  const wk = billing.expected.appts.booked
  const money = usd()
  const next = ov.nextAppt || ov.upNext[0]
  const stats = [[clients.length, 'Clients'], [leads.filter(l => NEEDS.includes(l.stage)).length, 'Need you'], [leads.filter(l => l.stage === 'booked').length, 'Booked']]
  return (
    <aside className="fx-tile fx-prof" aria-label="Your profile">
      <div className="fx-prof-av" aria-hidden="true">{initials(profile.name).toUpperCase()}<i className={duty ? 'on' : ''} /></div>
      <h2>{profile.name}</h2>
      <p>Agent · {duty ? 'Inside your hours now' : 'Outside your hours now'}</p>
      <span className="fx-prof-mail"><Mail size={13} aria-hidden="true" />{profile.email}</span>
      <div className="fx-usage is-teal">
        <div className="tp-row tp-between"><b>Lead spend {money(dailyTotal(billing.spend))} a day</b><b className="fx-usage-n"><CountUp value={billing.booked} /></b></div>
        <BookedMeter booked={billing.booked} range={wk} />
        <small><b>{billing.booked}</b> booked this week · about {rangeWords(wk)} expected · servicing {billing.servicing.status}</small>
      </div>
      <ul className="fx-pstats">{stats.map(([n, label]) => <li key={label}><small>{label}</small><b className="tp-num"><CountUp value={n} /></b></li>)}</ul>
      {next && (
        <Link to={paths.calendar()} className="fx-pnext">
          <i aria-hidden="true" />
          <span className="tp-grow"><small>Next up</small><b>{next.label} with {next.who}</b><small>{next.day} · {next.time}</small></span>
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      )}
    </aside>
  )
}

// Settings, Solvik-style: the profile card on the left, one panel on the right whose pill tabs switch sections (P929:
// back from P924's side list).
// Each section is a short form with Discard / Save. Sign out and delete keep their real code.
export default function Settings() {
  const { data: s } = useSampleSettings()
  const { data: billing } = useSampleBilling()
  const { setNotification, saveSettings, saveWeek } = useSampleActions()
  const [saved, saveTheme] = useThemePref()
  const note = useNote()
  const account = useAccount()
  // P916: ?tab=calls opens Hours and calls (the call sheet's "Connect your phone" link).
  const loc = useLocation()
  const [tab, setTab] = useState(() => { const t = new URLSearchParams(loc.search).get('tab'); return TABS.some(([k]) => k === t) ? t : 'profile' })
  const [panel, setPanel] = useState(null)

  // Saved values and the drafts the forms edit
  const [profile, setProfile] = useState(s.profile)
  const [pDraft, setPDraft] = useState(s.profile)
  const [tz, setTz] = useState(s.timeZone)
  const [alerts, setAlerts] = useState(s.notifications)
  const [cDraft, setCDraft] = useState({ week: s.week })
  const [bill, setBill] = useState({ email: s.profile.email, receipts: true })
  const [bDraft, setBDraft] = useState(bill)
  const [look, setLook] = useState(saved)
  // P844: a theme choice shows at once as a preview; Save keeps it, Discard, another tab or leaving puts the saved one back.
  const savedRef = useRef(saved)
  useEffect(() => { savedRef.current = saved }, [saved])
  const pickLook = v => { setLook(v); previewTheme(v) }
  const backToSaved = () => { setLook(savedRef.current); previewTheme(savedRef.current) }
  useEffect(() => { if (tab !== 'look') backToSaved() }, [tab])
  useEffect(() => () => previewTheme(savedRef.current), [])

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const alertsDirty = !same(alerts, s.notifications)
  const callsSaved = { week: s.week }
  const signOut = () => (account.live ? account.signOut() : note('Sign out works once you sign in for real'))
  const DeleteDialog = account.DeleteDialog
  const flip = (key, field, v) => setAlerts(alerts.map(n => (n.key === key ? { ...n, [field]: v } : n)))
  const money = usd()

  return (
    <div className="tp-page fx-set">
      {/* P843: Sign out is its own small box under the profile card (same real sign-out as before) */}
      <div className="fx-set-side">
        <ProfileCard profile={profile} />
        <button type="button" className="fx-tile fx-signout" onClick={signOut}><LogOut size={16} aria-hidden="true" />Sign out</button>
      </div>

      <section className="fx-tile fx-panel" aria-label="Settings">
        <PillTabs label="Settings sections" className="fx-ptabs" itemClass="fx-ptab" value={tab} onChange={setTab} items={TABS.map(([key, label, icon]) => ({ key, label, icon }))} />

        <div className="fx-form" key={tab} role="tabpanel" aria-label={TABS.find(t => t[0] === tab)[1]}>
          {tab === 'profile' && <>
            <Head title="Profile" sub="How you show up to the team and on everything we send for you." />
            <div className="fx-form-grid">
              <Field label="Full name"><input value={pDraft.name} onChange={e => setPDraft({ ...pDraft, name: e.target.value })} /></Field>
              <Field label="Email"><input type="email" value={pDraft.email} onChange={e => setPDraft({ ...pDraft, email: e.target.value })} /></Field>
              <Field label="Phone"><PhoneInput value={pDraft.phone} onChange={(d, e164, shown) => setPDraft({ ...pDraft, phone: shown })} /></Field>
              <Field label="Plan" hint="Change your lead spend on the Billing page"><input value={pDraft.plan} readOnly /></Field>
              <Field label="Time zone" hint="The clock on your Overview uses it"><TimeZoneSelect value={tz} onChange={setTz} /></Field>
            </div>
            <div className="fx-form-row">
              <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('password')}><KeyRound size={15} />Change password</button>
              <span className="tp-grow" />
              <button type="button" className="tp-btn ov-ghost tp-danger" onClick={() => (DeleteDialog ? setPanel('delete') : note('Delete my account works once you sign in for real'))}><Trash2 size={15} />Delete my account</button>
            </div>
            <FormFoot dirty={!same(pDraft, profile) || tz !== s.timeZone} onDiscard={() => { setPDraft(profile); setTz(s.timeZone) }} onSave={() => { setProfile(pDraft); if (tz !== s.timeZone) saveSettings({ timeZone: tz }); note('Profile saved') }} />
          </>}

          {tab === 'licence' && <LicenceCard />}

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
            <FormFoot dirty={alertsDirty} onDiscard={() => setAlerts(s.notifications)} onSave={() => {
              alerts.forEach(n => { const was = s.notifications.find(x => x.key === n.key); if (was.push !== n.push) setNotification(n.key, 'push', n.push); if (was.email !== n.email) setNotification(n.key, 'email', n.email) })
              note('Notifications saved')
            }} />
          </>}

          {tab === 'email' && <>
            <Head title="Email" sub="Forward carrier emails here: a lapse, missed payment or bounced draft becomes a save call for the team." />
            <PaymentIntakeCard />
          </>}

          {tab === 'calls' && <>
            <Head title="Hours and calls" sub="One set of hours. Inside them, booked calls land on your calendar and live calls ring your phone. Outside them, we book callers for your next open time." />
            {/* P924: one set of hours for booked calls and live calls; no second schedule. */}
            <HoursEditor week={cDraft.week} onChange={week => setCDraft({ ...cDraft, week })} tz={s.timeZone} />
            {/* P916: calls go out as Deedstone from the agent's own phone (connected here, with a code call). */}
            <DeedstonePhone />
            <FormFoot dirty={!same(cDraft, callsSaved)} onDiscard={() => setCDraft(callsSaved)} onSave={() => {
              saveWeek(cDraft.week)
              note('Hours and calls saved. Clashes with booked appointments show on Calendar')
            }} />
          </>}

          {tab === 'billing' && <>
            <Head title="Billing" sub="Your plan and where receipts go. Change your lead spend on the Billing page." />
            <div className="fx-billsum">
              <div><small>Lead spend a day</small><b className="tp-money">{money(dailyTotal(billing.spend))}</b></div>
              <div><small>Membership</small><b>{planOf(billing).label}</b></div>
              <div><small>Next bill</small><b>{billing.nextBill}</b></div>
            </div>
            <div className="fx-form-grid">
              <Field label="Receipts go to"><input type="email" value={bDraft.email} onChange={e => setBDraft({ ...bDraft, email: e.target.value })} /></Field>
            </div>
            <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Email me each receipt</b><p className="tp-sub">Sent the day you're charged</p></div><Switch on={bDraft.receipts} label="Email me each receipt" onChange={v => setBDraft({ ...bDraft, receipts: v })} /></div>
            <Link to={paths.billing()} className="tp-btn ov-ghost fx-self"><CreditCard size={15} />Open Billing</Link>
            <FormFoot dirty={!same(bDraft, bill)} onDiscard={() => setBDraft(bill)} onSave={() => { setBill(bDraft); note('Billing settings saved') }} />
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
        <button type="button" className="tp-link" onClick={() => note('A reset link would be sent here')}>Forgot password?</button>
      </Drawer>
      {panel === 'delete' && DeleteDialog && <DeleteDialog onClose={() => setPanel(null)} />}
    </div>
  )
}
