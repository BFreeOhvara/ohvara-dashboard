import { useState } from 'react'
import { CalendarOff, Play, ChevronRight, Moon, Lock, Check, MessageCircle, Bug, GraduationCap, Pencil, User, Bell, CalendarDays, Shield } from 'lucide-react'
import { useFulPay, useFulSettings, useFulActions, useFulShift } from '../../ful/data'
import { DayOffDrawer } from '../../ful/Shift'
import { useTimeOff } from '../../ful/useTimeOff'
import { MY_SHEET, weekPay, hoursOf } from '../../ful/p879'
import { useAccount, useNote } from '../../kit'
import { useTheme, useThemePref } from '../../../hooks/useTheme'
import { useTraining, useLessons } from '../../../fulshell/training/store'
import VideoPlayer from '../../../fulshell/training/VideoPlayer'
import { hasVideo } from '../../../fulshell/training/videoModel'
import { useWatchedMap } from '../../../fulshell/training/videoStore'
import { PhoneInput } from '../../PhoneInput'
import { ReportBug } from '../../ReportBug'
import { AppAbout } from '../../../components/native/AppAbout'
import { SUPPORT_THREAD } from '../../support911'
import { useApp, SubPage, Row, Ini, Toggle, SignOutButton, rise } from '../AppKit'
import { PRIVACY_URL } from '../ASettings'
import { ZonePicker } from '../zone'
import { zoneName, shiftWords } from '../zoneTime'

// P975 — Me: a dark card (you, hours this pay period, earned so far, next payday), two tiles (Ask for a day off,
// Training), then Hours and pay, Theme (a switch), Settings, Help. P977: "Edit profile" at the top right of the card
// (photo, name, phone, email live only there); Settings is a list of sections; Sign out is its own button under the
// list; Delete account is a quiet red line at the bottom of Settings → Account.
const money = n => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`
const hoursWords = h => `${Math.round(h * 10) / 10} h`
const shortPayday = p => String(p || '').replace(/^(\w{3}), \w{3} (\d+)$/, '$1 $2')

export default function VMe() {
  const app = useApp()
  const account = useAccount()
  const { data: pay } = useFulPay()
  const off = useTimeOff()
  const [theme, setTheme] = useTheme()
  const { sum } = useTraining(account?.name)
  const [panel, setPanel] = useState(null)
  const w = weekPay()
  const { data: st } = useFulSettings()
  const name = account?.name || st.profile?.name || 'You'
  const photo = st.profile?.photo || null
  const dark = theme === 'dark'
  return (
    <div className="ma-tabpage">
      <h1 className="ma-h1 ma-rise">Me</h1>
      <div className="ma-plan ma-rise" style={rise(0)}>
        <div className="ma-plan-me">
          <Ini name={name} tone="sage" size={58} photo={photo} className="is-ring" />
          <span className="ma-grow"><b>{name}</b><small>Fulfillment · Ohvara team</small></span>
          <button type="button" className="ma-editbtn ma-press" onClick={() => app.openSub('profile')}><Pencil size={14} aria-hidden="true" />Edit profile</button>
        </div>
        <div className="ma-plan-stats">
          <div><b>{hoursWords(w.hours)}</b><small>this pay period</small></div>
          <div><b className="tp-money">{money(w.pay)}</b><small>earned so far</small></div>
          <div><b>{shortPayday(pay.payday) || 'Not set'}</b><small>next payday</small></div>
        </div>
      </div>

      <div className="ma-tiles ma-rise" style={rise(1)}>
        <button type="button" className="ma-tile is-butter" onClick={() => setPanel('off')} disabled={off.notSet}>
          <span className="ma-tile-ic" aria-hidden="true"><CalendarOff size={19} /></span>
          <ChevronRight size={20} strokeWidth={2.4} className="ma-tile-go" aria-hidden="true" />
          <span><b>Ask for a day off</b><small>{off.notSet ? 'Once your rota is set' : `${off.left} left this month`}</small></span>
        </button>
        <button type="button" className="ma-tile is-sky" onClick={() => app.openSub('training')}>
          <span className="ma-tile-ic" aria-hidden="true"><Play size={19} /></span>
          <ChevronRight size={20} strokeWidth={2.4} className="ma-tile-go" aria-hidden="true" />
          <span><b>Training</b><small>{sum.passed} of {sum.total} lessons</small></span>
        </button>
      </div>

      <div className="ma-glass ma-list ma-acct-list ma-rise" style={rise(2)}>
        <Row onClick={() => app.openSub('pay')} lead={<span className="ma-sym is-sage">◷</span>} title="Hours and pay" sub="Every shift and payday" />
        <div className="ma-row ma-theme-row">
          <span className="ma-sym is-stone"><Moon size={16} aria-hidden="true" /></span>
          <span className="ma-grow"><b>Theme</b><small>{dark ? 'Dark' : 'Light'}</small></span>
          <Toggle on={dark} label="Dark theme" onChange={v => setTheme(v ? 'dark' : 'light')} />
        </div>
        <Row onClick={() => app.openSub('settings')} lead={<span className="ma-sym is-stone">⚙</span>} title="Settings" sub="Account, alerts, shifts, privacy" />
        <Row onClick={() => app.openSub('help')} lead={<span className="ma-sym is-stone">?</span>} title="Help" sub="Message Ohvara support" />
      </div>
      <SignOutButton />
      <DayOffDrawer open={panel === 'off'} onClose={() => setPanel(null)} />
    </div>
  )
}

// Hours and pay: the week so far (each scheduled shift and its hours), the pay rate, the next payday and the payouts.
export function VPay() {
  const { data: pay } = useFulPay()
  const w = weekPay()
  return (
    <SubPage title="Hours and pay" line={`${money(w.rate)} an hour · paid weekly`} big>
      <div className="ma-plan ma-rise">
        <div className="ma-plan-stats">
          <div><b>{hoursWords(w.hours)}</b><small>this week</small></div>
          <div><b className="tp-money">{money(w.pay)}</b><small>earned</small></div>
          <div><b>{shortPayday(pay.payday) || 'Not set'}</b><small>next payday</small></div>
        </div>
      </div>
      <p className="ma-cap is-out">Your shifts this week</p>
      <div className="ma-glass ma-list ma-rise" style={rise(1)}>
        {MY_SHEET.map(r => (
          <div key={r.day} className="ma-row">
            <span className="ma-sym is-sage">{r.d}</span>
            <span className="ma-grow"><b>Nov {r.day}</b><small>{r.in} to {r.out || 'now'}{r.live ? ' · on shift' : ''}</small></span>
            <span className="ma-val">{hoursWords(hoursOf(r))}</span>
          </div>
        ))}
      </div>
      <p className="ma-cap is-out">Payouts</p>
      <div className="ma-glass ma-list ma-rise" style={rise(2)}>
        {(pay.payouts || []).map(p => (
          <div key={p.id} className="ma-row">
            <span className="ma-sym is-stone"><Check size={16} aria-hidden="true" /></span>
            <span className="ma-grow"><b>{p.week}</b><small>Paid {p.paid}</small></span>
            <span className="ma-val tp-money">{money(p.amount)}</span>
          </div>
        ))}
        {!(pay.payouts || []).length && <p className="ma-empty">No payouts yet. Your first one lands on {pay.payday || 'payday'}.</p>}
      </div>
      <p className="ma-note">{pay.account?.bank ? `Paid to ${pay.account.bank} ••${pay.account.last4}. ` : ''}Pay is your set shifts minus days off.</p>
    </SubPage>
  )
}

// P977 — Settings: a list of sections, each its own screen (?s=settings&t=<section>).
const SECTIONS = { account: 'Account', alerts: 'Notifications', shifts: 'Shifts', privacy: 'Privacy and security', zone: 'Time zone' }
const THEME_WORD = { light: 'Light', dark: 'Dark', system: 'Match my phone' }

export function VSettings({ section }) {
  const app = useApp()
  const { data: s } = useFulSettings()
  const { data: shift } = useFulShift()
  const [pref] = useThemePref()
  const on = (s.notifications || []).filter(n => n.push).length
  if (SECTIONS[section]) return <SubPage title={SECTIONS[section]} line="Settings" big><VSection k={section} /></SubPage>
  const go = k => app.openSub('settings', { t: k })
  return (
    <SubPage title="Settings" big>
      <div className="ma-glass ma-list ma-set ma-sections ma-rise">
        <Row onClick={() => go('account')} lead={<span className="ma-sym is-sky"><User size={16} aria-hidden="true" /></span>} title="Account" sub={`${zoneName(s.timeZone)} · ${THEME_WORD[pref] || 'Match my phone'}`} />
        <Row onClick={() => go('alerts')} lead={<span className="ma-sym is-coral"><Bell size={16} aria-hidden="true" /></span>} title="Notifications" sub={on ? `${on} of ${(s.notifications || []).length} come to your phone` : 'Only in the bell'} />
        <Row onClick={() => go('shifts')} lead={<span className="ma-sym is-sage"><CalendarDays size={16} aria-hidden="true" /></span>} title="Shifts" sub={shiftWords(shift.shift?.text, s.timeZone)} />
        <Row onClick={() => go('privacy')} lead={<span className="ma-sym is-stone"><Shield size={16} aria-hidden="true" /></span>} title="Privacy and security" sub="Password, privacy policy" />
      </div>
    </SubPage>
  )
}

function VSection({ k }) {
  const app = useApp()
  const account = useAccount()
  const note = useNote()
  const { data: s } = useFulSettings()
  const { data: shift } = useFulShift()
  const { saveSettings } = useFulActions()
  const off = useTimeOff()
  const [pref, savePref] = useThemePref()
  const [alerts, setAlerts] = useState(s.notifications || [])
  const [panel, setPanel] = useState(null)
  const DeleteDialog = account?.DeleteDialog
  const flip = (key, field, v) => { const next = alerts.map(n => (n.key === key ? { ...n, [field]: v } : n)); setAlerts(next); saveSettings({ notifications: next }) }
  if (k === 'zone') return <ZonePicker tz={s.timeZone} onPick={tz => { saveSettings({ timeZone: tz }); note(`Time zone: ${zoneName(tz)}`) }} />
  if (k === 'account') {
    return (
      <>
        <div className="ma-glass ma-list ma-set ma-rise">
          <Row onClick={() => app.openSub('settings', { t: 'zone' })} title="Time zone" right={<span className="ma-val">{zoneName(s.timeZone)}</span>} />
        </div>
        <p className="ma-cap is-out">Theme</p>
        <div className="ma-glass ma-list ma-set ma-rise" role="radiogroup" aria-label="Theme">
          {Object.entries(THEME_WORD).map(([key, l]) => (
            <button key={key} type="button" role="radio" aria-checked={pref === key} className="ma-row" onClick={() => { savePref(key); note(key === 'system' ? 'Theme follows your phone' : `${l} mode on`) }}>
              <span className="ma-grow"><b>{l}</b></span>
              {pref === key && <Check size={20} strokeWidth={2.6} className="ma-tick" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <p className="ma-hint ma-set-note">Your photo, name, phone and email are on Edit profile, on the Me page.</p>
        <button type="button" className="ma-quiet-danger" onClick={() => (DeleteDialog ? setPanel('delete') : note('Delete my account works once you sign in for real'))}>Delete account</button>
        {DeleteDialog && panel === 'delete' && <DeleteDialog open onClose={() => setPanel(null)} />}
      </>
    )
  }
  if (k === 'alerts') {
    return (
      <div className="ma-glass ma-list ma-rise">
        <div className="ma-row is-head"><span className="ma-grow" /><small>Push</small><small>Email</small></div>
        {alerts.map(n => (
          <div key={n.key} className="ma-row">
            <span className="ma-grow"><b>{n.label}</b></span>
            <Toggle small on={n.push} label={`${n.label} push`} onChange={v => flip(n.key, 'push', v)} />
            <Toggle small on={n.email} label={`${n.label} email`} onChange={v => flip(n.key, 'email', v)} />
          </div>
        ))}
      </div>
    )
  }
  if (k === 'shifts') {
    return (
      <>
        <div className="ma-glass ma-list ma-set ma-rise">
          <div className="ma-row"><span className="ma-grow"><b>Shift hours</b><small>Set by the team</small></span><span className="ma-val">{shiftWords(shift.shift?.text, s.timeZone)}</span></div>
          <Row onClick={() => app.goTab('rota')} title="See the schedule" sub="Who works which day" />
          <Row onClick={() => (off.notSet ? note('Days off open once your schedule is set') : setPanel('off'))} title="Ask for a day off" right={<span className="ma-val">{off.notSet ? 'Not yet' : `${off.left} left`}</span>} />
        </div>
        <DayOffDrawer open={panel === 'off'} onClose={() => setPanel(null)} />
      </>
    )
  }
  if (k === 'privacy') {
    return (
      <>
        <div className="ma-glass ma-list ma-set ma-rise">
          <Row onClick={() => note('Change your password from the sign-in screen: Forgot password')} lead={<span className="ma-sym is-stone"><Lock size={16} aria-hidden="true" /></span>} title="Password" sub="Reset it from the sign-in screen" />
          <a className="ma-row" href={PRIVACY_URL} target="_blank" rel="noreferrer"><span className="ma-grow"><b>Privacy policy</b></span><ChevronRight size={18} className="ma-chev" aria-hidden="true" /></a>
        </div>
        <p className="ma-hint ma-set-note">Clients’ details stay inside Ohvara. Agents and clients never see your messages with other VAs.</p>
      </>
    )
  }
  return null
}

// P977 — Edit profile: photo, name, phone, email. Opened from the Me card.
export function VProfile() {
  const app = useApp()
  const note = useNote()
  const { data: s } = useFulSettings()
  const { saveSettings } = useFulActions()
  const [me, setMe] = useState(s.profile || {})
  const dirty = JSON.stringify(me) !== JSON.stringify(s.profile)
  const onPhoto = e => {
    const f = e.target.files?.[0]
    if (!f) return
    const r = new FileReader()
    r.onload = () => setMe(x => ({ ...x, photo: String(r.result) }))
    r.readAsDataURL(f)
  }
  return (
    <SubPage title="Edit profile" line="You">
      <div className="ma-form">
        <div className="ma-glass ma-pad ma-photo ma-rise">
          <Ini name={me.name} tone="sage" size={72} photo={me.photo} className="is-ring" />
          <label className="ma-btn is-soft ma-press">{me.photo ? 'Change photo' : 'Add a photo'}<input type="file" accept="image/*" onChange={onPhoto} hidden /></label>
          {me.photo && <button type="button" className="ma-link-btn" onClick={() => setMe(x => ({ ...x, photo: null }))}>Remove</button>}
        </div>
        <div className="ma-glass ma-pad ma-rise" style={rise(1)}>
          <label className="va-field"><span>Full name</span><input value={me.name || ''} onChange={e => setMe({ ...me, name: e.target.value })} autoComplete="name" /></label>
          <label className="va-field"><span>Phone</span><PhoneInput value={me.phone || ''} onChange={(d, e164, shown) => setMe({ ...me, phone: shown })} /></label>
          <label className="va-field"><span>Email</span><input type="email" value={me.email || ''} onChange={e => setMe({ ...me, email: e.target.value })} autoComplete="email" /></label>
        </div>
        <div className="ma-savebar"><button type="button" className="ma-btn is-solid is-tall ma-press" disabled={!dirty} onClick={() => { saveSettings({ profile: me }); note('Your details are saved'); app.back() }}>Save</button></div>
      </div>
    </SubPage>
  )
}

// Training: the lessons in the job's order, with your progress; a lesson plays its video here, with captions.
export function VTraining() {
  const app = useApp()
  const account = useAccount()
  const { states, sum } = useTraining(account?.name)
  const lessons = useLessons()
  return (
    <SubPage title="Training" line={sum.complete ? 'All lessons done' : `${sum.passed} of ${sum.total} lessons done`} big>
      <div className="va-bar is-sky ma-rise" role="progressbar" aria-label="Lessons done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(sum.pct * 100)}><i style={{ width: `${Math.round(sum.pct * 100)}%` }} /></div>
      <div className="ma-glass ma-list ma-rise" style={rise(1)}>
        {lessons.map((l, i) => {
          const st = states.find(x => x.id === l.id)?.state || 'locked'
          const lead = <span className={`ma-sym is-${st === 'passed' ? 'sage' : st === 'locked' ? 'stone' : 'sky'}`}>{st === 'passed' ? <Check size={16} aria-hidden="true" /> : st === 'locked' ? <Lock size={14} aria-hidden="true" /> : i + 1}</span>
          const sub = `${l.minutes} min · ${st === 'passed' ? 'Done' : st === 'next' ? 'Up next' : st === 'locked' ? 'Opens after the one before' : 'Open'}`
          return st === 'locked'
            ? <Row key={l.id} lead={lead} title={l.title} sub={sub} chev={false} className="is-locked" />
            : <Row key={l.id} onClick={() => app.openSub('training', { l: l.id })} lead={lead} title={l.title} sub={sub} />
        })}
      </div>
      <p className="ma-note">Watch here. The check for each lesson is on the VA desk on a computer.</p>
    </SubPage>
  )
}

// P984: plays the lesson's phone version (recorded in this app); a video watched here or on the desk counts once.
// Practice is on the desk only, so once the video is watched the lesson here is done and points to the desk.
export function VLesson({ id }) {
  const account = useAccount()
  const lessons = useLessons()
  const watched = useWatchedMap(account?.name, !!account?.live)
  const { states } = useTraining(account?.name)
  const [ended, setEnded] = useState(false)
  const l = lessons.find(x => x.id === id)
  if (!l) return <SubPage title="Training"><p className="ma-empty">This lesson isn’t here any more.</p></SubPage>
  const done = ended || !!watched[l.id]?.watched
  return (
    <SubPage title={l.title} line={`${l.minutes} min`}>
      {hasVideo(l.id)
        ? <div className="va-video ma-rise"><VideoPlayer lessonId={l.id} who={account?.name} variant="phone" onEnded={() => setEnded(true)} free={states.find(x => x.id === l.id)?.state === 'passed'} /></div>
        : <div className="ma-empty is-box ma-rise"><GraduationCap size={22} aria-hidden="true" /><b>Video coming soon</b><span>Read the lesson on the VA desk for now.</span></div>}
      {done && <div className="ma-glass ma-pad ma-rise va-lesson-done" role="status"><p className="ma-cap"><Check size={14} aria-hidden="true" /> Video watched</p><p>Practise this on the desk when you’re next on.</p></div>}
      <div className="ma-glass ma-pad ma-rise" style={rise(1)}><p className="ma-cap">What it covers</p><p>{l.job}</p></div>
      {!done && <p className="ma-note">Watch the video, then practise this on the desk when you’re next on.</p>}
    </SubPage>
  )
}

// Help: message Ohvara support (the Ohvara thread; P982: no names), report a problem, the app's version.
export function VHelp() {
  const app = useApp()
  const [bug, setBug] = useState(false)
  return (
    <SubPage title="Help" line="We usually answer within the hour on a shift day" big>
      <div className="ma-glass ma-list ma-rise">
        <Row onClick={() => app.openSub('thread', { t: SUPPORT_THREAD })} lead={<span className="ma-sym is-sky"><MessageCircle size={16} aria-hidden="true" /></span>} title="Message Ohvara support" sub="Shifts, pay, the app, anything" />
        <Row onClick={() => app.openSub('training')} lead={<span className="ma-sym is-sage"><GraduationCap size={16} aria-hidden="true" /></span>} title="Training" sub="How every call works, step by step" />
        <Row onClick={() => setBug(true)} lead={<span className="ma-sym is-coral"><Bug size={16} aria-hidden="true" /></span>} title="Report a problem" sub="Something broken or looks wrong" />
      </div>
      <AppAbout style={{ margin: '22px 12px 0', textAlign: 'center', fontSize: 11 }} />
      <ReportBug open={bug} onClose={() => setBug(false)} role="Fulfillment" />
    </SubPage>
  )
}
