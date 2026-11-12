import { useState } from 'react'
import { CalendarOff, Play, ChevronRight, Moon, Lock, Check, MessageCircle, Bug, GraduationCap } from 'lucide-react'
import { useFulPay, useFulSettings, useFulActions, useFulShift } from '../../ful/data'
import { DayOffDrawer } from '../../ful/Shift'
import { useTimeOff } from '../../ful/useTimeOff'
import { MY_SHEET, weekPay, hoursOf } from '../../ful/p879'
import { useAccount, useNote } from '../../kit'
import { useTheme } from '../../../hooks/useTheme'
import { useTraining, useLessons } from '../../../fulshell/training/store'
import VideoPlayer from '../../../fulshell/training/VideoPlayer'
import { hasVideo } from '../../../fulshell/training/videoModel'
import { PhoneInput } from '../../PhoneInput'
import { ReportBug } from '../../ReportBug'
import { AppAbout } from '../../../components/native/AppAbout'
import { SUPPORT_THREAD } from '../../support911'
import { useApp, SubPage, Row, Ini, Toggle, rise } from '../AppKit'

// P975 — Me: a dark card (you, hours this pay period, earned so far, next payday), two tiles (Ask for a day off,
// Training), then Hours and pay, Theme (a switch), Settings (your details on top, alerts, sign out), Help.
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
  const name = account?.name || 'You'
  const dark = theme === 'dark'
  return (
    <div className="ma-tabpage">
      <h1 className="ma-h1 ma-rise">Me</h1>
      <div className="ma-plan ma-rise" style={rise(0)}>
        <i className="ma-glow va-glow" aria-hidden="true" />
        <div className="ma-plan-me">
          <Ini name={name} tone="sage" size={58} />
          <span className="ma-grow"><b>{name}</b><small>Fulfillment · Ohvara team</small></span>
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
        <Row onClick={() => app.openSub('settings')} lead={<span className="ma-sym is-stone">⚙</span>} title="Settings" sub="Your details, alerts, sign out" />
        <Row onClick={() => app.openSub('help')} lead={<span className="ma-sym is-stone">?</span>} title="Help" sub="Message Brayden or Jordan" />
      </div>
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

// Settings: your details first (name, phone, email), then alerts, then the account (sign out, delete).
export function VSettings() {
  const account = useAccount()
  const note = useNote()
  const { data: s } = useFulSettings()
  const { data: shift } = useFulShift()
  const { saveSettings } = useFulActions()
  const [me, setMe] = useState(s.profile)
  const [alerts, setAlerts] = useState(s.notifications || [])
  const [panel, setPanel] = useState(null)
  const name = account?.live ? account.name : s.profile?.name
  const dirty = JSON.stringify(me) !== JSON.stringify(s.profile)
  const flip = (key, field, v) => { const next = alerts.map(n => (n.key === key ? { ...n, [field]: v } : n)); setAlerts(next); saveSettings({ notifications: next }) }
  const DeleteDialog = account?.DeleteDialog
  return (
    <SubPage title="Settings" big>
      <div className="ma-glass ma-pad va-you ma-rise">
        <div className="va-you-h"><Ini name={name} tone="sage" size={52} /><span className="ma-grow"><b>{name}</b><small>Fulfillment · {shift.shift?.text || '8 AM to 6 PM'} Central</small></span></div>
        <label className="va-field"><span>Full name</span><input value={me.name || ''} onChange={e => setMe({ ...me, name: e.target.value })} autoComplete="name" /></label>
        <label className="va-field"><span>Phone</span><PhoneInput value={me.phone || ''} onChange={(d, e164, shown) => setMe({ ...me, phone: shown })} /></label>
        <label className="va-field"><span>Email</span><input type="email" value={me.email || ''} onChange={e => setMe({ ...me, email: e.target.value })} autoComplete="email" /></label>
        {dirty && <div className="ma-two"><button type="button" className="ma-btn is-soft ma-press" onClick={() => setMe(s.profile)}>Undo</button><button type="button" className="ma-btn is-solid ma-press" onClick={() => { saveSettings({ profile: me }); note('Your details are saved') }}>Save</button></div>}
      </div>

      <p className="ma-cap is-out">Alerts</p>
      <div className="ma-glass ma-list ma-rise" style={rise(1)}>
        <div className="ma-row is-head"><span className="ma-grow" /><small>Push</small><small>Email</small></div>
        {alerts.map(n => (
          <div key={n.key} className="ma-row">
            <span className="ma-grow"><b>{n.label}</b></span>
            <Toggle small on={n.push} label={`${n.label} push`} onChange={v => flip(n.key, 'push', v)} />
            <Toggle small on={n.email} label={`${n.label} email`} onChange={v => flip(n.key, 'email', v)} />
          </div>
        ))}
      </div>

      <p className="ma-cap is-out">Account</p>
      <div className="ma-glass ma-list ma-rise" style={rise(2)}>
        <Row onClick={() => note('Change your password from the sign-in screen: Forgot password')} lead={<span className="ma-sym is-stone"><Lock size={16} aria-hidden="true" /></span>} title="Password" sub="Reset it from the sign-in screen" />
        <Row onClick={() => (account?.live ? account.signOut() : note('Sign out works once you sign in for real'))} lead={<span className="ma-sym is-stone">↩</span>} title="Sign out" chev={false} />
        <Row className="is-danger" onClick={() => (DeleteDialog ? setPanel('delete') : note('Delete my account works once you sign in for real'))} lead={<span className="ma-sym is-coral">✕</span>} title="Delete my account" chev={false} />
      </div>
      {DeleteDialog && panel === 'delete' && <DeleteDialog open onClose={() => setPanel(null)} />}
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

export function VLesson({ id }) {
  const account = useAccount()
  const lessons = useLessons()
  const l = lessons.find(x => x.id === id)
  if (!l) return <SubPage title="Training"><p className="ma-empty">This lesson isn’t here any more.</p></SubPage>
  return (
    <SubPage title={l.title} line={`${l.minutes} min`}>
      {hasVideo(l.id)
        ? <div className="va-video ma-rise"><VideoPlayer lessonId={l.id} who={account?.name} /></div>
        : <div className="ma-empty is-box ma-rise"><GraduationCap size={22} aria-hidden="true" /><b>Video coming soon</b><span>Read the lesson on the VA desk for now.</span></div>}
      <div className="ma-glass ma-pad ma-rise" style={rise(1)}><p className="ma-cap">What it covers</p><p>{l.job}</p></div>
      <p className="ma-note">Take this lesson’s check on the VA desk to mark it done.</p>
    </SubPage>
  )
}

// Help: message Brayden or Jordan (the Ohvara thread), report a problem, the app's version.
export function VHelp() {
  const app = useApp()
  const [bug, setBug] = useState(false)
  return (
    <SubPage title="Help" line="We usually answer within the hour on a shift day" big>
      <div className="ma-glass ma-list ma-rise">
        <Row onClick={() => app.openSub('thread', { t: SUPPORT_THREAD })} lead={<span className="ma-sym is-sky"><MessageCircle size={16} aria-hidden="true" /></span>} title="Message Brayden or Jordan" sub="Shifts, pay, the app, anything" />
        <Row onClick={() => app.openSub('training')} lead={<span className="ma-sym is-sage"><GraduationCap size={16} aria-hidden="true" /></span>} title="Training" sub="How every call works, step by step" />
        <Row onClick={() => setBug(true)} lead={<span className="ma-sym is-coral"><Bug size={16} aria-hidden="true" /></span>} title="Report a problem" sub="Something broken or looks wrong" />
      </div>
      <AppAbout style={{ margin: '22px 12px 0', textAlign: 'center', fontSize: 11 }} />
      <ReportBug open={bug} onClose={() => setBug(false)} role="Fulfillment" />
    </SubPage>
  )
}
