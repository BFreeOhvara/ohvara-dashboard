import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CreditCard, History, Settings, MessageSquare, LifeBuoy, Smartphone, CircleHelp, LogOut, ChevronRight, Radio, Sun, Moon, Trash2, ShieldCheck, Home, Globe, FileUp } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { useSampleBilling, useSampleSettings, useSampleActivity, useSampleActions, useSampleThreads } from '../data'
import { useAccount, useNote, initials } from '../kit'
import { avatarHue } from '../avatarHue'
import { SpendSliders, TakeLeads } from '../PlanBuilder'
import { takeOk, inLiveHours } from '../../lib/leadSplit'
import { dailyTotal, openSlotsPerWeek, spendOk } from '../spendPlan'
import { usd } from '../motion'
import { paths, isTemplateAddress } from '../paths'
import { GetApp, Help } from '../TemplateFrame'
import { TalkDrawer } from '../Talk'
import { ReportBug } from '../ReportBug'
import ViewToggle from '../ViewToggle'
import { Sheet } from './Sheet'
import { mp } from './mpaths'

// P908 — More on a phone: you, live-transfer status, then stacked rows for Billing, Activity and Settings (their full
// pages, with a back arrow), Messages, Submit, Request a service, the app, help, sign out and delete. Rows 64 px.
function MoreRow({ to, icon: Icon, label, sub, right, onClick, danger }) {
  const inner = <><span className="mx-row-ic"><Icon size={19} aria-hidden="true" /></span><span className="tp-grow"><b>{label}</b>{sub && <small>{sub}</small>}</span>{right}<ChevronRight size={18} className="mx-chev" aria-hidden="true" /></>
  const cls = `mx-row is-link${danger ? ' is-danger' : ''}`
  if (to) return <li><Link to={to} className={cls}>{inner}</Link></li>
  return <li><button type="button" className={cls} onClick={onClick}>{inner}</button></li>
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
  const [panel, setPanel] = useState(null)
  const close = () => setPanel(null)
  const DeleteDialog = account.DeleteDialog
  const duty = b.take?.mode === 'both' && inLiveHours(b.take.hours, b.take.tz)
  const unread = threads.reduce((n, t) => n + t.unread, 0)
  const days = s.hours?.days?.length
  return (
    <div className="mx-page">
      <section className="mx-card mx-me-card">
        <span className={`mx-me is-big av-${avatarHue(account.name)}`} aria-hidden="true">{initials(account.name).toUpperCase()}</span>
        <span className="tp-grow"><b>{account.name}</b><small>Agent · {b.plan === 'pilot' ? 'pilot, lead spend only' : s.profile.plan}</small></span>
        <button type="button" className="mx-ib is-soft" aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}</button>
      </section>
      {account.view?.canPreview && <div className="mx-card mx-view"><ViewToggle /></div>}

      <Link to={mp.billing()} className={`mx-duty${duty ? ' is-on' : ''}`}>
        <Radio size={18} aria-hidden="true" />
        <span className="tp-grow"><b>{duty ? 'Live transfers ring you now' : 'Live transfers off now'}</b><small>{duty ? 'Inside your live-call hours' : 'We book callers on your calendar'}</small></span>
        <ChevronRight size={18} aria-hidden="true" />
      </Link>

      <ul className="mx-stack">
        <MoreRow to={mp.billing()} icon={CreditCard} label="Billing" sub={`${money(dailyTotal(b.spend))} a day · next charge ${money(b.nightNow.tonight.total)} ${b.nightly.at.toLowerCase()}`} />
        <MoreRow to={mp.activity()} icon={History} label="Activity" sub={act[0] ? `${act[0].who}: ${act[0].text}` : 'Everything our team did for you'} />
        <MoreRow to={mp.settings()} icon={Settings} label="Settings" sub={s.hours ? `${s.hours.start} to ${s.hours.end}${days ? ` · ${days} days` : ''}` : 'Your hours, alerts and account'} />
      </ul>
      <ul className="mx-stack">
        <MoreRow to={paths.messages()} icon={MessageSquare} label="Messages" sub="You and our team" right={unread > 0 ? <span className="mx-count">{unread}</span> : null} />
        <MoreRow to={paths.submit()} icon={FileUp} label="Submit a policy" sub="A sale for servicing" />
        <MoreRow to={paths.requestService()} icon={LifeBuoy} label="Request a service" sub="Changes, cancellations, documents" />
        <MoreRow icon={Smartphone} label="Get the phone app" sub="Alerts the moment a lead comes in" onClick={() => setPanel('app')} />
        <MoreRow icon={CircleHelp} label="Help and support" sub="Talk to someone, or report a bug" onClick={() => setPanel('help')} />
      </ul>
      {isTemplateAddress() && (
        <ul className="mx-stack">
          <MoreRow to={paths.signup()} icon={ShieldCheck} label="Sign-up preview" />
          <MoreRow to={paths.welcome()} icon={Home} label="Setup preview" />
          <MoreRow to={paths.deedstone()} icon={Globe} label="What a lead sees" />
        </ul>
      )}
      <ul className="mx-stack">
        <MoreRow icon={LogOut} label="Sign out" onClick={() => (account.live ? account.signOut() : note('Sign out works once you sign in for real'))} />
        <MoreRow icon={Trash2} label="Delete my account" danger onClick={() => (DeleteDialog ? setPanel('delete') : note('Delete my account works once you sign in for real'))} />
      </ul>

      <GetApp open={panel === 'app'} onClose={close} />
      <Help open={panel === 'help'} onClose={close} onBug={() => setPanel('bug')} onTalk={() => setPanel('talk')} />
      <TalkDrawer open={panel === 'talk'} onClose={close} />
      <ReportBug open={panel === 'bug'} onClose={close} role="Agent" />
      {panel === 'delete' && DeleteDialog && <DeleteDialog onClose={close} />}
    </div>
  )
}

// The daily lead spend and how leads come in (the same controls as Billing), as a full-screen sheet.
export function SpendSheet({ open, onClose }) {
  const { data: billing } = useSampleBilling()
  const { data: settings } = useSampleSettings()
  const { setSpend, setTake } = useSampleActions()
  const note = useNote()
  const [spend, setDraft] = useState({ daily: dailyTotal(billing.spend) })
  const [take, setTakeDraft] = useState(billing.take)
  return (
    <Sheet open={open} onClose={onClose} title="Daily lead spend" kicker="Starts with the next day not yet paid"
      footer={<button type="button" className="mx-btn is-primary is-wide" disabled={!spendOk(billing.plan, spend) || !takeOk(take)} onClick={() => { setSpend(spend); setTake(take); note('Lead spend saved. It starts with the next day not yet paid'); onClose() }}>Save lead spend</button>}>
      <section className="mx-card mx-plan"><SpendSliders spend={spend} onSpend={setDraft} plan={billing.plan} mode={take.mode} id="m-spend" openSlots={openSlotsPerWeek(settings.week)} /></section>
      <section className="mx-card mx-plan"><TakeLeads take={take} onTake={setTakeDraft} id="m-take" /></section>
    </Sheet>
  )
}
