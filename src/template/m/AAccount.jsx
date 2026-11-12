import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Plus, Wallet, Search, X, UserPlus, StickyNote, ShieldAlert } from 'lucide-react'
import { useSampleBilling, useSampleSettings, useSampleClients, useSampleActivity, useSampleActions, useDataSource } from '../data'
import { useAccount, useNote } from '../kit'
import { useCheckSettings, todayFor } from '../checkSettings'
import { clientStatusOf, clientStatus, checkLists, mergeLists, workingWhy, ordinal } from '../../lib/clientCheck.js'
import { stagesOf } from '../../lib/clientStages.js'
import { agentOpensSaveCall } from '../ful/data'
import { asPick } from '../licenceModel'
import { dailyTotal, deliveredOf, planOf } from '../spendPlan'
import { usd } from '../motion'
import { paths, isTemplateAddress } from '../paths'
import { GetApp, Help, AddNote } from '../TemplateFrame'
import { AddClients } from '../AddClients891'
import { TalkDrawer } from '../Talk'
import { ReportBug } from '../ReportBug'
import { isNativeApp } from '../../lib/native'
import { NATIVE_BILLING_TEXT } from '../../components/native/NativeBillingNote'
import { AppAbout } from '../../components/native/AppAbout'
import { useProducts, useNavKeys } from '../useProducts'
import { label as productsLabel } from '../../lib/products.js'
import { useApp, SubPage, Row, Ini, BottomSheet, rise } from './AppKit'
import { CheckCard, ClientSheet } from './MClients'
import { chargeStat } from './appModel'
import { useClientStatusOf } from '../checkSettings'

// P967 — Account: a dark plan card (you, your plan, three numbers), two tiles (Submit a policy with a big +, Lead
// spend with the $ a day as the bold number), then Clients, Activity, Billing, Settings and Help. Each opens as a
// sub-screen from the right.
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
  const money = usd()
  const [panel, setPanel] = useState(null)
  const close = () => setPanel(null)
  const leads = has('leads')
  const states = s.licence ? asPick(s.licence).states : []
  const dl = deliveredOf({ booked: b.booked, live: b.live || 0 })
  const prot = clients.filter(c => statusOf(c) === 'protected').length
  const need = clients.filter(c => statusOf(c) === 'needs_attention').length
  const failed = !!b.payment?.failed
  const name = account?.name || s.profile?.name || 'You'
  const tiles = [serve && 'submit', leads && 'spend'].filter(Boolean)
  const charge = chargeStat(leads ? b.nightly?.at || '8 PM' : b.nextBill) // P971: "8 PM" + (tonight), one line

  return (
    <div className="ma-tabpage">
      <h1 className="ma-h1 ma-rise">Account</h1>

      <div className="ma-plan ma-rise" style={rise(0)}>
        <i className="ma-glow is-sky" aria-hidden="true" />
        <div className="ma-plan-me">
          <Ini name={name} tone="sky" size={58} className="is-ring" />
          <span className="ma-grow"><b>{name}</b><small>{[sinceOf(b), states.length ? states.join(', ') : null].filter(Boolean).join(' · ')}</small></span>
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
            <button type="button" className="ma-tile is-sage ma-press" onClick={() => app.open(paths.submit())}>
              <span className="ma-tile-plus" aria-hidden="true"><Plus size={24} strokeWidth={2.6} /></span>
              <span><b>Submit a policy</b><small>We service it for you</small></span>
            </button>
          )}
          {leads && (
            <button type="button" className="ma-tile is-butter ma-press" onClick={() => app.open(paths.billing())}>
              <span className="ma-tile-ic" aria-hidden="true"><Wallet size={19} /></span>
              <span><small>Lead spend</small><b className="ma-tile-big"><span className="tp-money">{money(dailyTotal(b.spend))}</span><em> a day</em></b></span>
            </button>
          )}
        </div>
      )}

      <div className="ma-glass ma-list ma-rise" style={rise(2)}>
        {navKeys.has('clients') && <Row onClick={() => app.open(paths.clients())} lead={<span className="ma-sym is-sage">{clients.length}</span>} title="Clients" sub={need ? `${need} need attention · our team is on it` : 'Our team works your clients'} />}
        <Row onClick={() => app.open(paths.activity())} lead={<span className="ma-sym is-sky">↻</span>} title="Activity" sub={act[0] ? `${act[0].who}: ${act[0].text}` : 'Everything that happened'} />
        <Row onClick={() => app.open(paths.billing())} lead={<span className="ma-sym is-butter">$</span>} title="Billing" sub={native ? NATIVE_BILLING_TEXT : 'Plan, card and receipts'} />
        <Row onClick={() => app.open(paths.settings())} lead={<span className="ma-sym is-stone">⚙</span>} title="Settings" sub="Hours, alerts, account" />
        <Row onClick={() => setPanel('help')} lead={<span className="ma-sym is-stone">?</span>} title="Help" sub="Message the team any time" />
        {!native && <Row onClick={() => setPanel('app')} lead={<span className="ma-sym is-sky">↓</span>} title="Get the phone app" sub="Alerts the moment a lead comes in" />}
      </div>

      {isTemplateAddress() && (
        <div className="ma-glass ma-list">
          <Row to={paths.signup()} title="Sign-up preview" />
          <Row to={paths.welcome()} title="Setup preview" />
          <Row to={paths.deedstone()} title="What a lead sees" />
        </div>
      )}
      <AppAbout style={{ margin: '4px 12px 12px' }} />

      <GetApp open={panel === 'app'} onClose={close} />
      <Help open={panel === 'help'} onClose={close} onBug={() => setPanel('bug')} onTalk={() => setPanel('talk')} />
      <TalkDrawer open={panel === 'talk'} onClose={close} />
      <ReportBug open={panel === 'bug'} onClose={close} role="Agent" />
    </div>
  )
}

// ── Clients ───────────────────────────────────────────────────────────────────────────────────────────────────
const fullName = c => `${c.client_first_name} ${c.client_last_name}`
const TONE_OF = { working: 'sky', needs_attention: 'apricot', protected: 'sage', closed: 'stone' }
const FILTERS = [['all', 'All'], ['needs_attention', 'Needs attention'], ['working', 'Working'], ['protected', 'Protected'], ['closed', 'Closed']]
const lineOf = (c, st) => {
  const where = [c.carrier_name, c.draft_day ? `drafts the ${ordinal(Number(c.draft_day))}` : null].filter(Boolean).join(' · ')
  if (st === 'working') return `${where ? `${where} · ` : ''}${stagesOf(c).current?.label || workingWhy(c)}`
  if (st === 'needs_attention') return `${where ? `${where} · ` : ''}still on the books?`
  if (st === 'closed') return c.track?.closed || 'Closed'
  return where || 'Nothing needed'
}

export function AClients({ id }) {
  const loc = useLocation()
  const navigate = useNavigate()
  const { data: clients } = useSampleClients()
  const { markLapsed } = useSampleActions()
  const source = useDataSource()
  const settings = useCheckSettings()
  const today = todayFor(source)
  const note = useNote()
  const [f, setF] = useState(loc.state?.cf === 'need' ? 'needs_attention' : 'all')
  const [q, setQ] = useState('')
  const [panel, setPanel] = useState(null)
  const [lapsing, setLapsing] = useState(null)
  const statusOf = useMemo(() => new Map(clients.map(c => [c.id, clientStatusOf(c, today, settings)])), [clients, today, settings])
  const merged = useMemo(() => mergeLists(checkLists(clients, today, settings)), [clients, today, settings])
  const count = k => (k === 'all' ? clients.filter(c => statusOf.get(c.id) !== 'closed').length : clients.filter(c => statusOf.get(c.id) === k).length)
  const n = q.trim().toLowerCase()
  const rows = clients.filter(c => (f === 'all' ? statusOf.get(c.id) !== 'closed' : statusOf.get(c.id) === f) && (!n || `${fullName(c)} ${c.client_phone} ${c.carrier_name || ''}`.toLowerCase().includes(n)))
  const filters = FILTERS.filter(([k]) => k === 'all' || k === f || count(k) > 0)
  const lapse = () => {
    const c = lapsing
    markLapsed?.(c.id, today)
    agentOpensSaveCall({ who: fullName(c), why: 'lapsed', state: c.state, city: c.city })
    note(`${fullName(c)} marked lapsed. Our team is calling to get it back on`)
    setLapsing(null)
  }
  const closeClient = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate(paths.clients(), { replace: true }))
  return (
    <SubPage title="Clients" line={`${clients.length} client${clients.length === 1 ? '' : 's'}`}
      right={<span className="ma-sub-acts"><button type="button" className="ma-round is-soft ma-press" aria-label="Add clients" onClick={() => setPanel('add')}><UserPlus size={19} aria-hidden="true" /></button><button type="button" className="ma-round is-soft ma-press" aria-label="Add a note to a client" onClick={() => setPanel('note')}><StickyNote size={19} aria-hidden="true" /></button></span>}>
      <div className="ma-chips" role="tablist" aria-label="Client status">
        {filters.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={f === k} className={`ma-fchip ma-press${f === k ? ' is-on' : ''}`} onClick={() => setF(k)}>{label} {count(k)}</button>)}
      </div>
      <p className="ma-hint">Our team works your clients. You just see where each one stands.</p>
      <label className="ma-search is-small"><Search size={18} aria-hidden="true" /><input type="search" aria-label="Find a client" placeholder="Name, phone or carrier" value={q} onChange={e => setQ(e.target.value)} />{q && <button type="button" className="ma-ib" aria-label="Clear" onClick={() => setQ('')}><X size={18} aria-hidden="true" /></button>}</label>
      {merged.rows.length > 0 && (f === 'all' || f === 'needs_attention') && !n && <div className="ma-checkwrap"><CheckCard key={merged.drafts.join()} m={merged} /></div>}
      <ul className="ma-cards">
        {rows.map(c => {
          const st = statusOf.get(c.id)
          return (
            <li key={c.id} className={`ma-lead is-${TONE_OF[st] || 'sage'} is-client`}>
              <button type="button" className="ma-lead-open" onClick={() => navigate(paths.client(c.id), { state: loc.state })}>
                <Ini name={fullName(c)} size={44} />
                <span className="ma-grow"><b>{fullName(c)}</b><small>{lineOf(c, st)}</small></span>
              </button>
              <span className="ma-tag">{clientStatus(st).label}</span>
            </li>
          )
        })}
      </ul>
      {!rows.length && <p className="ma-empty">{f === 'needs_attention' ? 'Nothing to check. Every policy is confirmed on the books.' : 'No clients match.'}</p>}
      {id && (source === 'sample' || clients.some(c => c.id === id)) && <ClientSheet key={id} id={id} today={today} settings={settings} onLapsed={setLapsing} onClose={closeClient} />}
      <BottomSheet open={!!lapsing} onClose={() => setLapsing(null)} label="Mark lapsed?">
        {lapsing && <>
          <p className="ma-sheet-t">Mark lapsed?</p>
          <p className="ma-sheet-s">{fullName(lapsing)} moves to Working and our team calls to get it back on.</p>
          <div className="ma-two"><button type="button" className="ma-btn is-soft ma-press" onClick={() => setLapsing(null)}>Cancel</button><button type="button" className="ma-btn is-solid ma-press" onClick={lapse}><ShieldAlert size={17} aria-hidden="true" />Yes, it lapsed</button></div>
        </>}
      </BottomSheet>
      <AddClients open={panel === 'add'} onClose={() => setPanel(null)} />
      <AddNote open={panel === 'note'} onClose={() => setPanel(null)} />
    </SubPage>
  )
}

// ── Activity, grouped by day ──────────────────────────────────────────────────────────────────────────────────
const KIND_TONE = { lead: 'sky', client: 'sage', moved: 'butter', call: 'apricot', text: 'stone' }
const splitAt = at => { const m = /^(.*?),?\s*(\d{1,2}:\d{2}\s*(?:AM|PM))$/i.exec(String(at || '')); return m ? [m[1] || 'Today', m[2]] : [String(at || 'Earlier'), ''] }
export function AActivity() {
  const { data: items } = useSampleActivity()
  const groups = useMemo(() => {
    const out = []
    items.forEach(a => {
      const [day, time] = splitAt(a.at)
      let g = out.find(x => x.day === day)
      if (!g) { g = { day, items: [] }; out.push(g) }
      g.items.push({ ...a, time })
    })
    return out
  }, [items])
  return (
    <SubPage title="Activity" line="Everything that happened">
      {groups.map(g => (
        <section key={g.day}>
          <p className="ma-cap is-out">{g.day}</p>
          <div className="ma-glass ma-pad is-tight">
            <ol className="ma-tl is-flat">{g.items.map(a => <li key={a.id}><i aria-hidden="true" className={`is-${KIND_TONE[a.kind] || 'stone'}`} /><span><b>{a.who}: {a.text}</b>{a.time && <small>{a.time}</small>}</span></li>)}</ol>
          </div>
        </section>
      ))}
      {!groups.length && <p className="ma-empty">Nothing has happened yet. Everything our team does for you shows here.</p>}
    </SubPage>
  )
}
