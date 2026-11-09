import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CreditCard, History, Settings, MessageSquare, LifeBuoy, Smartphone, CircleHelp, LogOut, ChevronRight, Radio, PauseCircle, PlayCircle, Wallet, Sun, Moon, Bell, Clock3, MapPin, ShieldCheck, Mail, Phone } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { useSampleBilling, useSampleSettings, useSampleActivity, useSampleActions, useSampleThreads } from '../data'
import { Money, Switch, useAccount, useNote, initials } from '../kit'
import { avatarHue } from '../avatarHue'
import { SpendSliders, TakeLeads } from '../PlanBuilder'
import { takeOk, inLiveHours } from '../../lib/leadSplit'
import { dailyTotal, openSlotsPerWeek, spendOk, tierOf } from '../spendPlan'
import { usd } from '../motion'
import { paths } from '../paths'
import { Sheet, ActionSheet, ActRow } from './Sheet'
import { Sec } from './bits'
import { mp } from './mpaths'

// P908 — More on a phone: you, then stacked cards for Billing, Activity and Settings (each its own page with a back
// arrow), then Messages, Request a service, the app, help and sign out. Every row is at least 56 px.
function MoreRow({ to, href, icon: Icon, label, sub, right, onClick }) {
  const inner = <><span className="mx-row-ic"><Icon size={19} aria-hidden="true" /></span><span className="tp-grow"><b>{label}</b>{sub && <small>{sub}</small>}</span>{right}<ChevronRight size={18} className="mx-chev" aria-hidden="true" /></>
  if (to) return <li><Link to={to} className="mx-row is-link">{inner}</Link></li>
  if (href) return <li><a href={href} className="mx-row is-link">{inner}</a></li>
  return <li><button type="button" className="mx-row is-link" onClick={onClick}>{inner}</button></li>
}

export default function MMore() {
  const account = useAccount()
  const [theme, setTheme] = useTheme()
  const { data: b } = useSampleBilling()
  const { data: s } = useSampleSettings()
  const { data: act } = useSampleActivity()
  const { data: threads } = useSampleThreads()
  const note = useNote()
  const money = usd()
  const duty = b.take?.mode === 'both' && inLiveHours(b.take.hours, b.take.tz)
  const unread = threads.reduce((n, t) => n + t.unread, 0)
  return (
    <div className="mx-page">
      <section className="mx-card mx-me-card">
        <span className={`mx-me is-big av-${avatarHue(account.name)}`} aria-hidden="true">{initials(account.name).toUpperCase()}</span>
        <span className="tp-grow"><b>{account.name}</b><small>{s.profile.plan}</small></span>
        <button type="button" className="mx-ib is-soft" aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}</button>
      </section>

      <Link to={mp.billing()} className={`mx-duty${duty ? ' is-on' : ''}`}>
        <Radio size={18} aria-hidden="true" />
        <span className="tp-grow"><b>{duty ? 'Live transfers ring you now' : 'Live transfers off now'}</b><small>{duty ? 'Inside your live-call hours' : 'We book callers on your calendar'}</small></span>
        <ChevronRight size={18} aria-hidden="true" />
      </Link>

      <ul className="mx-stack">
        <MoreRow to={mp.billing()} icon={CreditCard} label="Billing" sub={`${money(dailyTotal(b.spend))} a day · next charge ${b.nightly.at.replace('Tonight, ', 'tonight ')}`} />
        <MoreRow to={mp.activity()} icon={History} label="Activity" sub={act[0] ? `${act[0].who}: ${act[0].text}` : 'Everything we did for you'} />
        <MoreRow to={mp.settings()} icon={Settings} label="Settings" sub={`${s.hours.start} to ${s.hours.end} · ${s.hours.days.length} days`} />
      </ul>
      <ul className="mx-stack">
        <MoreRow to={paths.messages()} icon={MessageSquare} label="Messages" sub="You and our team" right={unread > 0 ? <span className="mx-count">{unread}</span> : null} />
        <MoreRow to={paths.requestService()} icon={LifeBuoy} label="Request a service" sub="A change for one of your clients" />
        <MoreRow icon={Smartphone} label="Get the phone app" sub="Alerts the moment a lead comes in" onClick={() => note('The app store links open here')} />
        <MoreRow icon={CircleHelp} label="Help and support" sub="Talk to us, or report a problem" onClick={() => note('Help opens here: talk to us or report a bug')} />
      </ul>
      <ul className="mx-stack">
        <MoreRow icon={LogOut} label="Sign out" onClick={() => note('Sample: sign out is off in the preview')} />
      </ul>
    </div>
  )
}

// The daily lead spend and how leads come in (the same sliders as Billing), as a full-screen sheet.
export function SpendSheet({ open, onClose }) {
  const { data: billing } = useSampleBilling()
  const { data: settings } = useSampleSettings()
  const { setSpend, setTake } = useSampleActions()
  const note = useNote()
  const [spend, setDraft] = useState({ daily: dailyTotal(billing.spend) })
  const [take, setTakeDraft] = useState(billing.take)
  return (
    <Sheet open={open} onClose={onClose} title="Daily lead spend" kicker="Starts tomorrow at 12:00 AM"
      footer={<button type="button" className="mx-btn is-primary is-wide" disabled={!spendOk(billing.plan, spend) || !takeOk(take)} onClick={() => { setSpend(spend); setTake(take); note('Lead spend saved. Starts tomorrow. Sample only'); onClose() }}>Save lead spend</button>}>
      <section className="mx-card mx-plan"><SpendSliders spend={spend} onSpend={setDraft} plan={billing.plan} mode={take.mode} id="m-spend" openSlots={openSlotsPerWeek(settings.week)} /></section>
      <section className="mx-card mx-plan"><TakeLeads take={take} onTake={setTakeDraft} id="m-take" /></section>
    </Sheet>
  )
}

export function MBilling() {
  const { data: b } = useSampleBilling()
  const { pause, resume } = useSampleActions()
  const note = useNote()
  const money = usd()
  const [spend, setSpend] = useState(false)
  const [pausing, setPausing] = useState(false)
  const n = b.nightNow
  const w = b.bought.week
  const daily = dailyTotal(b.spend)
  const tier = tierOf(daily)
  const doPause = until => { pause({ from: 'Tue, Nov 3', until, untilIso: null }); setPausing(false); note(until ? `Paused until ${until}` : 'Paused until you resume') }
  return (
    <div className="mx-page">
      <h1 className="mx-title is-sub">Billing</h1>
      <section className="mx-card mx-spend">
        <small>Lead spend</small>
        <b className="tp-money">{money(daily)}<em>a day</em></b>
        <span className="mx-sub">{b.plan === 'pilot' ? 'Pilot · lead spend only' : `${tier.label} plan`}{b.pending ? ` · ${b.pending.starts}` : ''}</span>
        <div className="mx-two">
          <button type="button" className="mx-btn is-primary" onClick={() => setSpend(true)}><Wallet size={18} aria-hidden="true" />Change spend</button>
          {b.paused
            ? <button type="button" className="mx-btn" onClick={() => { resume(); note('Resumed. Leads start again tomorrow') }}><PlayCircle size={18} aria-hidden="true" />Resume</button>
            : <button type="button" className="mx-btn" onClick={() => setPausing(true)}><PauseCircle size={18} aria-hidden="true" />Pause</button>}
        </div>
        {b.paused && <p className="mx-note is-warn">Paused{b.paused.until ? ` until ${b.paused.until}` : ' until you resume'}. No lead spend, no new leads.</p>}
      </section>
      <section className="mx-card">
        <h3>Next charge</h3>
        <div className="mx-kv"><span>{b.nightly.at}</span><b className="tp-money">{money(n.tonight.total)}</b></div>
        <p className="mx-sub">For {n.forDay}. One paid day ahead, charged each night.</p>
        <div className="mx-kv"><span><CreditCard size={16} aria-hidden="true" />{b.card.onFile ? b.card.label : 'No card on file'}</span><button type="button" className="mx-link" onClick={() => note('Change card opens here')}>{b.card.onFile ? 'Change' : 'Add card'}</button></div>
      </section>
      <Sec title="This week">
        <ul className="mx-tiles">
          <li><small>Spent</small><b className="tp-money">{money(w.spent)}</b></li>
          <li><small>Leads</small><b className="tp-num">{w.leads}</b></li>
          <li><small>Booked</small><b className="tp-num">{w.booked}</b></li>
          <li><small>Sold</small><b className="tp-num">{w.sold}</b><em><Money v={w.premium} /> premium</em></li>
        </ul>
      </Sec>
      <SpendSheet open={spend} onClose={() => setSpend(false)} />
      <ActionSheet open={pausing} onClose={() => setPausing(false)} title="Pause leads" sub="Lead spend and new leads stop. Booked appointments and servicing keep going.">
        <ActRow icon={PauseCircle} label="Until Monday, Nov 9" sub="Starts again by itself that morning" onClick={() => doPause('Mon, Nov 9')} />
        <ActRow icon={PauseCircle} label="Until Monday, Nov 16" sub="We remind you 2 days before" onClick={() => doPause('Mon, Nov 16')} />
        <ActRow icon={PauseCircle} label="Until I resume" sub="Resume any time from here" onClick={() => doPause(null)} />
      </ActionSheet>
    </div>
  )
}

export function MActivity() {
  const { data: act } = useSampleActivity()
  const days = act.reduce((m, a) => { const d = a.at.split(',')[0]; (m[d] = m[d] || []).push(a); return m }, {})
  return (
    <div className="mx-page">
      <h1 className="mx-title is-sub">Activity</h1>
      <p className="mx-sub mx-pad">Everything our team and your texts did for you.</p>
      {Object.entries(days).map(([d, rows]) => (
        <Sec key={d} title={d}>
          <ol className="mx-feed">{rows.map(a => <li key={a.id}><span className="mx-feed-t">{a.at.split(', ')[1] || ''}</span><span className="tp-grow"><b>{a.who}</b><small>{a.text}</small></span></li>)}</ol>
        </Sec>
      ))}
    </div>
  )
}

export function MSettings() {
  const { data: s } = useSampleSettings()
  const { setNotification } = useSampleActions()
  const [theme, setTheme] = useTheme()
  return (
    <div className="mx-page">
      <h1 className="mx-title is-sub">Settings</h1>
      <Sec title="You">
        <ul className="mx-stack">
          <li className="mx-row"><span className="mx-row-ic"><Mail size={18} aria-hidden="true" /></span><span className="tp-grow"><b>{s.profile.name}</b><small>{s.profile.email}</small></span></li>
          <li className="mx-row"><span className="mx-row-ic"><Phone size={18} aria-hidden="true" /></span><span className="tp-grow"><b className="tp-num">{s.profile.phone}</b><small>Live transfers ring this phone</small></span></li>
          <li className="mx-row"><span className="mx-row-ic"><ShieldCheck size={18} aria-hidden="true" /></span><span className="tp-grow"><b>Licensed in {s.licence.states.join(', ')}</b><small>Leads only come from these states</small></span></li>
        </ul>
      </Sec>
      <Sec title="Working hours">
        <ul className="mx-stack">
          {Object.entries(s.week).map(([d, h]) => <li key={d} className="mx-row is-tight"><span className="mx-day">{d}</span><span className="tp-grow">{h.on ? `${h.start} to ${h.end}` : <em>Off</em>}</span><Clock3 size={16} className="mx-chev" aria-hidden="true" /></li>)}
          <li className="mx-row is-tight"><span className="mx-row-ic"><MapPin size={16} aria-hidden="true" /></span><span className="tp-grow">Central time</span></li>
        </ul>
      </Sec>
      <Sec title="Alerts on this phone">
        <ul className="mx-stack">
          {s.notifications.map(x => <li key={x.key} className="mx-row"><span className="mx-row-ic"><Bell size={18} aria-hidden="true" /></span><span className="tp-grow"><b>{x.label}</b></span><Switch on={x.push} label={x.label} onChange={on => setNotification?.(x.key, 'push', on)} /></li>)}
        </ul>
      </Sec>
      <Sec title="Look">
        <div className="mx-seg" role="radiogroup" aria-label="Theme">
          {[['light', 'Light', Sun], ['dark', 'Dark', Moon]].map(([k, l, I]) => <button key={k} type="button" role="radio" aria-checked={theme === k} className={theme === k ? 'is-on' : ''} onClick={() => setTheme(k)}><I size={17} aria-hidden="true" />{l}</button>)}
        </div>
      </Sec>
    </div>
  )
}
