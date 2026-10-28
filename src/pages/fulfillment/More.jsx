import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { MessageSquare, Phone, PhoneIncoming, Bell, Moon, Sun, Settings, TriangleAlert, ChevronRight, LogOut, Landmark, CreditCard, Search } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { useUnreadMessageCount } from '../../hooks/usePolicyMessages'
import { usePayoutAccounts, usePaySettings } from '../../hooks/useFulfillmentPayouts'
import { useCarriers } from '../../hooks/useCarriers'
import { accountStatus } from '../../lib/myPay'
import { fmtCents } from '../../lib/payPeriod'
import { viewerHoursSummary } from '../../lib/carriers'
import { telHref } from '../../lib/fulfillmentCall'
import { DEFAULT_TIMEZONE } from '../../lib/timezones'
import { Avatar } from '../../components/ui/Avatar'
import { BugReportModal } from '../../components/shared/BugReportButton'
import { PhoneSheet } from '../../components/agent/phone/PhoneSheet'
import { AccountRows } from '../../components/shared/AccountRows'

// Prompt 773 — More, the rep's phone layout's fifth tab (mockup
// FulMore.dc.html): the profile ("Fulfillment · $10 a cancel", from the pay
// setting), Get paid to (bank, Ready / Not set, Payout settings), then
// Messages, Carrier phone numbers (a sheet over the carriers list), Notifications,
// Theme (one tap, like P766), Settings, Report a problem, and Sign out.
// Desktop has no More page (the sidebar holds all of this): it goes to the
// Overview.

const TONES = {
  blue: ['var(--ov-data-a)', 'var(--ov-data-a-tint)'],
  teal: ['var(--ov-data-b)', 'var(--ov-data-b-tint)'],
  amber: ['var(--ov-st-needs)', 'var(--ov-st-needs-tint)'],
  violet: ['var(--nt-purple)', 'var(--nt-purple-tint)'],
}
const whole = cents => (cents % 100 ? fmtCents(cents) : fmtCents(cents).replace(/\.00$/, ''))

function Row({ icon: Icon, tone, label, right, onClick }) {
  const [color, tint] = TONES[tone]
  return (
    <button type="button" className="ph-mrow" onClick={onClick}>
      <span className="ph-mrow-icon" style={{ background: tint, color }}><Icon size={18} strokeWidth={2} aria-hidden="true" /></span>
      <span className="ph-mrow-label">{label}</span>
      {right && <span style={{ fontSize: 13, color: 'var(--ov-mute)' }}>{right}</span>}
      <ChevronRight size={15} strokeWidth={2.2} className="ph-chev" aria-hidden="true" />
    </button>
  )
}

// Every carrier with a service number, tap to call. Hours on the rep's clock.
function CarrierNumbers({ tz, onClose }) {
  const { data: carriers = [], isLoading } = useCarriers()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const list = useMemo(() => carriers
    .filter(c => c.service_phone && (!q || c.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name)), [carriers, q])
  return (
    <PhoneSheet label="Carrier phone numbers" head={<b className="ph-h2" style={{ fontSize: 18 }}>Carrier phone numbers</b>} onClose={onClose}>
      <label className="ov-input ph-search" style={{ marginTop: 10 }}>
        <Search size={18} strokeWidth={2} style={{ flexShrink: 0 }} aria-hidden="true" />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a carrier" aria-label="Find a carrier" />
      </label>
      <div className="ph-info">
        {isLoading ? <div className="ph-empty">Loading…</div>
          : list.length === 0 ? <div className="ph-empty">{q ? `No carrier matches “${query.trim()}”.` : 'No carrier numbers saved yet.'}</div>
            : list.map(c => (
              <div key={c.id} className="ph-info-row">
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="ph-info-v">{c.name}</span>
                  <span className="ph-info-k">{c.hours && c.hours_tz ? viewerHoursSummary(c, tz) : 'Hours not saved'}</span>
                </span>
                <a className="ph-callbtn" href={telHref(c.service_phone)} aria-label={`Call ${c.name}, ${c.service_phone}`}>
                  <Phone size={15} strokeWidth={2.2} aria-hidden="true" /><span className="ph-mono" style={{ fontSize: 13 }}>{c.service_phone}</span>
                </a>
              </div>
            ))}
      </div>
    </PhoneSheet>
  )
}

export default function FulfillmentMore() {
  const phone = usePhoneLayout()
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [theme, setTheme] = useTheme()
  const [modal, setModal] = useState(null) // 'carriers' | 'report'
  const unread = useUnreadMessageCount(!!profile?.id)
  const { data: pay } = usePaySettings()
  const { data: accounts = [], isLoading: accountsLoading } = usePayoutAccounts(profile?.id, !!profile && phone)

  if (!phone) return <Navigate to="/fulfillment" replace />

  const light = theme === 'light'
  const account = accounts[0] || null
  const status = accountStatus(account)
  const ready = status === 'ready'
  const rateLine = pay?.pay_per_cancel_cents != null ? `Fulfillment · ${whole(pay.pay_per_cancel_cents)} a cancel` : 'Fulfillment'
  const BankIcon = account?.external_kind === 'card' ? CreditCard : Landmark
  const [statusText, statusColor] = accountsLoading ? ['—', 'var(--ov-mute)']
    : ready ? ['Ready', 'var(--ov-up)'] : status === 'action_needed' ? ['Action needed', 'var(--ov-st-needs)'] : ['Not set', 'var(--ov-st-needs)']

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="ph-stack" style={{ gap: 14 }}>
      <h1 className="ph-h1">More</h1>

      <section className="ov-hero ph-profile">
        <Avatar profile={profile} size={54} />
        <span style={{ flex: 1, minWidth: 0, color: '#FFFFFF' }}>
          <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, overflowWrap: 'anywhere' }}>{profile?.full_name || 'Your account'}</span>
          <span style={{ display: 'block', fontSize: 13, color: 'var(--ov-hero-soft)' }}>{rateLine}</span>
        </span>
      </section>

      <section className={`ov-card ph-bill${ready ? ' ph-bill-ok' : ''}`} aria-label="Get paid to">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }}>Get paid to</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: statusColor }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} aria-hidden="true" />{statusText}
          </span>
        </div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="ph-tile" style={{ width: 42, height: 42, background: ready ? 'var(--ov-data-b-tint)' : 'var(--ov-st-needs-tint)', color: ready ? 'var(--ov-data-b)' : 'var(--ov-st-needs)' }}>
            <BankIcon size={20} strokeWidth={2} aria-hidden="true" />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 16, fontWeight: 700, color: 'var(--ov-hi)', overflowWrap: 'anywhere' }}>
              {account?.last4 ? `${account.bank_name || 'Bank'} •••• ${account.last4}` : 'No bank yet'}
            </span>
            <span style={{ display: 'block', marginTop: 1, fontSize: 12.5, color: 'var(--ov-soft)' }}>
              {ready ? 'Paid every Monday by Stripe' : 'Add one to get your verified cancels paid'}
            </span>
          </span>
        </div>
        <button type="button" className="ov-ghost" onClick={() => navigate(ready || status === 'action_needed' ? '/fulfillment/pay?settings=1' : '/fulfillment/pay?settings=1&setup=1')}
          style={{ marginTop: 14, width: '100%', height: 46, borderRadius: 999, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          {ready ? 'Payout settings' : status === 'action_needed' ? 'Fix it in Payout settings' : 'Connect a bank'}
        </button>
      </section>

      <section className="ov-card ph-menu">
        <Row icon={MessageSquare} tone="blue" label="Messages" right={unread > 0 ? `${unread} new` : null} onClick={() => navigate('/messages')} />
        <Row icon={PhoneIncoming} tone="teal" label="Leads" onClick={() => navigate('/fulfillment/leads')} />
        <Row icon={Phone} tone="teal" label="Carrier phone numbers" onClick={() => setModal('carriers')} />
        <Row icon={Bell} tone="amber" label="Notifications" onClick={() => navigate('/settings#notifications')} />
        <button type="button" className="ph-mrow" onClick={() => setTheme(light ? 'dark' : 'light')}
          aria-label={light ? 'Theme: light. Switch to dark' : 'Theme: dark. Switch to light'}>
          <span className="ph-mrow-icon" style={{ background: TONES.violet[1], color: TONES.violet[0] }}>
            {light ? <Sun size={18} strokeWidth={2} aria-hidden="true" /> : <Moon size={18} strokeWidth={2} aria-hidden="true" />}
          </span>
          <span className="ph-mrow-label">Theme</span>
          <span style={{ fontSize: 13, color: 'var(--ov-mute)' }}>{light ? 'Light' : 'Dark'}</span>
        </button>
        <Row icon={Settings} tone="blue" label="Settings" onClick={() => navigate('/settings')} />
        <Row icon={TriangleAlert} tone="amber" label="Report a problem" onClick={() => setModal('report')} />
        <AccountRows />
      </section>

      <button type="button" className="ph-signout" onClick={handleSignOut}>
        <LogOut size={17} strokeWidth={2.2} aria-hidden="true" />Sign out
      </button>

      {modal === 'carriers' && <CarrierNumbers tz={profile?.timezone || DEFAULT_TIMEZONE} onClose={() => setModal(null)} />}
      {modal === 'report' && <BugReportModal onClose={() => setModal(null)} />}
    </div>
  )
}
