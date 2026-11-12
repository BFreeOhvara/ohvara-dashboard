import { useState } from 'react'
import { Plus, Wallet, ChevronRight, Moon, Inbox, Pencil } from 'lucide-react'
import { useSampleBilling, useSampleSettings, useSampleClients, useSampleActivity } from '../data'
import { useAccount } from '../kit'
import { asPick } from '../licenceModel'
import { dailyTotal, deliveredOf, planOf } from '../spendPlan'
import { usd } from '../motion'
import { paths, isTemplateAddress } from '../paths'
import { GetApp } from '../TemplateFrame'
import { isNativeApp } from '../../lib/native'
import { NATIVE_BILLING_TEXT } from '../../components/native/NativeBillingNote'
import { useTheme } from '../../hooks/useTheme'
import { useProducts, useNavKeys } from '../useProducts'
import { label as productsLabel } from '../../lib/products.js'
import { useApp, Row, Ini, Toggle, SignOutButton, rise } from './AppKit'
import { chargeStat, tabsFromNav } from './appModel'
import { useClientStatusOf } from '../checkSettings'

// P967 — Account: a dark plan card (you, your plan, three numbers), two tiles, then the list. P974: the tiles are
// real buttons (raised, a press state, a small arrow) with a clear gap before the list. Lead spend is THE way into
// Billing (so there's no separate Billing row while it shows). Theme is a row with a Light/Dark switch that flips the
// app at once and is remembered. No "About this app" line here any more (the version is at the foot of Help).
// P977: "Edit profile" at the top right of the card opens the profile screen; Sign out is its own button under the
// list. Servicing-only agents have Clients in the bottom bar, so here Clients gives way to Leads.
const sinceOf = b => { const m = /([A-Z][a-z]{2}) \d+/.exec(b.setupPaid || ''); return m ? `Agent since ${m[1]} ${b.year || 2026}` : 'Agent' }

export default function AAccount() {
  const app = useApp()
  const account = useAccount()
  const native = isNativeApp()
  const { data: b } = useSampleBilling()
  const { data: s } = useSampleSettings()
  const { data: clients } = useSampleClients()
  const { data: act } = useSampleActivity()
  const statusOf = useClientStatusOf()
  const { picked, has, serve } = useProducts()
  const navKeys = useNavKeys()
  const [theme, setTheme] = useTheme()
  const money = usd()
  const [panel, setPanel] = useState(null)
  const leads = has('leads')
  const clientsTab = tabsFromNav(navKeys).includes('clients')
  const states = s.licence ? asPick(s.licence).states : []
  const dl = deliveredOf({ booked: b.booked, live: b.live || 0 })
  const prot = clients.filter(c => statusOf(c) === 'protected').length
  const need = clients.filter(c => statusOf(c) === 'needs_attention').length
  const failed = !!b.payment?.failed
  const name = account?.name || s.profile?.name || 'You'
  const tiles = [serve && 'submit', leads && 'spend'].filter(Boolean)
  const charge = chargeStat(leads ? b.nightly?.at || '8 PM' : b.nextBill) // P971: "8 PM" + (tonight), one line
  const dark = theme === 'dark'

  return (
    <div className="ma-tabpage">
      <h1 className="ma-h1 ma-rise">Account</h1>

      <div className="ma-plan ma-rise" style={rise(0)}>
        <i className="ma-glow is-sky" aria-hidden="true" />
        <div className="ma-plan-me">
          <Ini name={name} tone="sky" size={58} photo={s.profile?.photo} className="is-ring" />
          <span className="ma-grow"><b>{name}</b><small>{[sinceOf(b), states.length ? states.join(', ') : null].filter(Boolean).join(' · ')}</small></span>
          <button type="button" className="ma-editbtn ma-press" onClick={() => app.open(`${paths.settings()}?set=profile`)}><Pencil size={14} aria-hidden="true" />Edit profile</button>
        </div>
        <div className="ma-plan-row">
          <span><small>Plan</small><b>{leads ? planOf(b).label : productsLabel(picked)}</b></span>
          <span className={`ma-paid${failed ? ' is-bad' : ''}`}>{failed ? 'Card declined' : 'Paid up'}</span>
        </div>
        <div className="ma-plan-stats">
          <div><b>{dl.total}</b><small>delivered this week</small></div>
          <div><b>{prot}/{clients.length}</b><small>protected</small></div>
          <div><b>{charge.value}</b><small>next charge{charge.when ? ` (${charge.when})` : ''}</small></div>
        </div>
      </div>

      {tiles.length > 0 && (
        <div className={`ma-tiles ma-rise${tiles.length === 1 ? ' is-one' : ''}`} style={rise(1)}>
          {serve && (
            <button type="button" className="ma-tile is-sage" onClick={() => app.open(paths.submit())}>
              <span className="ma-tile-plus" aria-hidden="true"><Plus size={24} strokeWidth={2.6} /></span>
              <ChevronRight size={20} strokeWidth={2.4} className="ma-tile-go" aria-hidden="true" />
              <span><b>Submit a policy</b><small>We service it for you</small></span>
            </button>
          )}
          {leads && (
            <button type="button" className="ma-tile is-butter" onClick={() => app.open(paths.billing())} aria-label={`Lead spend, ${money(dailyTotal(b.spend))} a day. Opens Billing`}>
              <span className="ma-tile-ic" aria-hidden="true"><Wallet size={19} /></span>
              <ChevronRight size={20} strokeWidth={2.4} className="ma-tile-go" aria-hidden="true" />
              <span><small>Lead spend</small><b className="ma-tile-big"><span className="tp-money">{money(dailyTotal(b.spend))}</span><em> a day</em></b></span>
            </button>
          )}
        </div>
      )}

      <div className="ma-glass ma-list ma-acct-list ma-rise" style={rise(2)}>
        {clientsTab
          ? <Row onClick={() => app.open(paths.leads())} lead={<span className="ma-sym is-apricot"><Inbox size={16} aria-hidden="true" /></span>} title="Leads" sub="Add leads, or import your own" />
          : navKeys.has('clients') && <Row onClick={() => app.open(paths.clients())} lead={<span className="ma-sym is-sage">{clients.length}</span>} title="Clients" sub={need ? `${need} need attention · our team is on it` : 'Our team works your clients'} />}
        <Row onClick={() => app.open(paths.activity())} lead={<span className="ma-sym is-sky">↻</span>} title="Activity" sub={act[0] ? `${act[0].who}: ${act[0].text}` : 'Everything that happened'} />
        {!leads && <Row onClick={() => app.open(paths.billing())} lead={<span className="ma-sym is-butter">$</span>} title="Billing" sub={native ? NATIVE_BILLING_TEXT : 'Plan, card and receipts'} />}
        <Row onClick={() => app.open(paths.settings())} lead={<span className="ma-sym is-stone">⚙</span>} title="Settings" sub="Account, alerts, hours, plan, privacy" />
        <div className="ma-row ma-theme-row">
          <span className="ma-sym is-stone"><Moon size={16} aria-hidden="true" /></span>
          <span className="ma-grow"><b>Theme</b><small>{dark ? 'Dark' : 'Light'}</small></span>
          <Toggle on={dark} label="Dark theme" onChange={v => setTheme(v ? 'dark' : 'light')} />
        </div>
        <Row onClick={() => app.openSub('help')} lead={<span className="ma-sym is-stone">?</span>} title="Help" sub="Message the team any time" />
        {!native && <Row onClick={() => setPanel('app')} lead={<span className="ma-sym is-sky">↓</span>} title="Get the phone app" sub="Alerts the moment a lead comes in" />}
      </div>
      <SignOutButton />

      {isTemplateAddress() && (
        <div className="ma-glass ma-list ma-acct-list">
          <Row to={paths.signup()} title="Sign-up preview" />
          <Row to={paths.welcome()} title="Setup preview" />
          <Row to={paths.deedstone()} title="What a lead sees" />
        </div>
      )}

      <GetApp open={panel === 'app'} onClose={() => setPanel(null)} />
    </div>
  )
}
