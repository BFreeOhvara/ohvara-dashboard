import { Link } from 'react-router-dom'
import { Inbox, CalendarDays, History, CreditCard, Settings, Sun, Moon, ChevronRight, ShieldCheck, Home, LogOut } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { useSampleBilling } from '../data'
import { Avatar, Money, SampleTag, useNote } from '../kit'
import { paths, isTemplateAddress } from '../paths'

// The phone's fifth tab: profile, a Billing card, then the pages that have no tab of their own.
export default function More() {
  const [theme, setTheme] = useTheme()
  const { data: b } = useSampleBilling()
  const note = useNote()
  const rows = [[paths.leads, 'Leads', Inbox, '3 new'], [paths.calendar, 'Calendar', CalendarDays], [paths.activity, 'Activity', History], [paths.settings, 'Settings', Settings]]
  if (isTemplateAddress()) rows.push([paths.signup, 'Sign-up preview', ShieldCheck], [paths.welcome, 'Welcome preview', Home])
  return (
    <div className="tp-page">
      <section className="ov-card tp-card"><div className="tp-row"><Avatar name="Dana Whitfield" tone="blue" /><div className="tp-grow"><b>Dana Whitfield</b><p className="tp-sub">Agent · Servicing {b.plan.size}</p></div></div></section>
      <Link to={paths.billing()} className="ov-card ov-link tp-card tp-stack">
        <div className="tp-row"><CreditCard size={18} /><b className="tp-grow">Billing</b><SampleTag /></div>
        <div className="tp-row tp-between"><span><Money v={b.plan.weekly} size="lg" /> <span className="tp-sub">/ week</span></span><span className="tp-sub">{b.submissions.used} of {b.submissions.cap} used</span></div>
        <span className="tp-sub">Next charge {b.next_charge}</span>
      </Link>
      <section className="ov-card tp-card"><ul className="tp-list">
        {rows.map(([to, label, Icon, badge]) => <li key={label}><Link to={to()} className="tp-li"><Icon size={18} aria-hidden="true" /><b className="tp-grow">{label}</b>{badge && <span className="tp-tb">{badge.split(' ')[0]}</span>}<ChevronRight size={16} aria-hidden="true" /></Link></li>)}
        <li><button type="button" className="tp-li" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}<b className="tp-grow">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</b></button></li>
        <li><button type="button" className="tp-li" onClick={() => note('Sign out is not part of the template')}><LogOut size={18} /><b className="tp-grow">Sign out</b></button></li>
      </ul></section>
    </div>
  )
}
