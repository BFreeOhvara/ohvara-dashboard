import { lazy, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Users, ListFilter, MessageSquare, Wallet, Phone, Bell, Moon, Sun, Settings, ChevronRight, LogOut, Landmark } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { useUnreadMessageCount } from '../../hooks/usePolicyMessages'
import { useAllProfiles, usePendingInvites } from '../../hooks/useProfiles'
import { useRecoveryConfig } from '../../hooks/useRecoveryConfig'
import {
  invokeConnect, usePaySettings, usePayoutAccounts, useRefreshPayouts, useSavePaySettings, useStripeBalance,
} from '../../hooks/useFulfillmentPayouts'
import { bankText, money } from '../../lib/adminPayouts'
import { Avatar } from '../../components/ui/Avatar'
import { Switch } from '../../components/ui/Switch'
import { BankModal } from '../../components/admin/PayoutsView'
import { PhoneSheet } from '../../components/agent/phone/PhoneSheet'

// Prompt 774 — More, the admin phone's fifth tab (mockup AdmMore.dc.html):
// the profile ("Admin · owner"), then People (Users as a phone list),
// Pipeline (view only), Messages, Payout settings (a sheet with desktop
// Payouts' settings: your bank, the Stripe balance, pay per cancel, automatic
// payouts), then Calling & texting (Not live until voice_live and sms_live),
// Notifications, Theme (one tap), Settings, and Sign out. Desktop has no More
// page (the sidebar holds all of this): it goes to the Overview.

const LazyEmbed = lazy(() => import('../../components/fulfillment/ConnectEmbeds'))
const TONES = {
  blue: ['var(--ov-data-a)', 'var(--ov-data-a-tint)'],
  teal: ['var(--ov-data-b)', 'var(--ov-data-b-tint)'],
  amber: ['var(--ov-st-needs)', 'var(--ov-st-needs-tint)'],
  violet: ['var(--nt-purple)', 'var(--nt-purple-tint)'],
}

function Row({ icon: Icon, tone, label, right, rightTone, onClick, ariaLabel }) {
  const [color, tint] = TONES[tone]
  return (
    <button type="button" className="ph-mrow" onClick={onClick} aria-label={ariaLabel}>
      <span className="ph-mrow-icon" style={{ background: tint, color }}><Icon size={18} strokeWidth={2} aria-hidden="true" /></span>
      <span className="ph-mrow-label">{label}</span>
      {right && <span style={{ fontSize: 13, fontWeight: rightTone ? 700 : 500, color: rightTone || 'var(--ov-mute)' }}>{right}</span>}
      <ChevronRight size={15} strokeWidth={2.2} className="ph-chev" aria-hidden="true" />
    </button>
  )
}

function PayoutSettings({ onClose }) {
  const { profile } = useAuth()
  const settings = usePaySettings()
  const save = useSavePaySettings()
  const balance = useStripeBalance()
  const accounts = usePayoutAccounts(null)
  const refresh = useRefreshPayouts()
  const [bankOpen, setBankOpen] = useState(false)
  const mine = (accounts.data || []).find(a => a.rep_id === profile?.id) || null
  const bank = bankText(mine)
  const live = !!settings.data?.payouts_live
  const autoOn = !settings.data?.payouts_paused
  const rate = settings.data?.pay_per_cancel_cents
  return (
    <PhoneSheet label="Payout settings" onClose={onClose} head={<b className="ph-h2" style={{ fontSize: 20 }}>Payout settings</b>}>
      <div className="ph-info">
        <div className="ph-info-row">
          <span className="ph-tile" style={{ background: 'var(--ph-tile-bg)', color: 'var(--ov-mid)' }}><Landmark size={18} strokeWidth={2} aria-hidden="true" /></span>
          <span style={{ flex: 1, minWidth: 0 }}><span className="ph-info-k">Your bank</span><span className="ph-info-v">{bank || 'No bank yet'}</span></span>
          <button type="button" className="aph-givebtn" onClick={() => setBankOpen(true)}>{bank ? 'Change' : 'Connect'}</button>
        </div>
        <div className="ph-info-row">
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="ph-info-k">Stripe balance</span>
            <span className="ph-info-v ph-mono">{balance.isLoading ? 'Checking…' : balance.data == null ? 'Unavailable' : money(balance.data)}</span>
          </span>
        </div>
        <div className="ph-info-row">
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="ph-info-k">Pay per cancel · applies to new cancels</span>
            <span className="ph-info-v ph-mono">{rate == null ? '—' : money(rate)}</span>
          </span>
          <Link to="/settings#pay" className="aph-givebtn" style={{ textDecoration: 'none' }}>Change</Link>
        </div>
        <div className="ph-info-row">
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="ph-info-v">Automatic payouts</span>
            <span className="ph-info-k">{!live ? 'Not live yet · turn on in Settings' : autoOn ? 'Every Monday 8 AM · tap to pause' : 'Paused · tap to resume'}</span>
          </span>
          <Switch checked={autoOn} disabled={save.isPending || settings.isLoading} onChange={on => save.mutate({ payouts_paused: !on })} />
        </div>
      </div>
      {save.error && <p className="ph-err" role="alert" style={{ marginTop: 12 }}>{save.error.message}</p>}
      {bankOpen && (
        <BankModal account={bank} hasAccount={!!mine?.details_submitted} Embed={LazyEmbed}
          onClose={() => { setBankOpen(false); invokeConnect('overview').catch(() => {}).finally(refresh) }} />
      )}
    </PhoneSheet>
  )
}

export default function AdminMore() {
  const phone = usePhoneLayout()
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [theme, setTheme] = useTheme()
  const [modal, setModal] = useState(null) // 'payout'
  const unread = useUnreadMessageCount(!!profile?.id)
  const { data: profiles = [] } = useAllProfiles()
  const { data: invites = [] } = usePendingInvites()
  const { data: config } = useRecoveryConfig()
  const { data: pay } = usePaySettings()
  const people = useMemo(() => profiles.filter(u => (u.role === 'agent' || u.role === 'fulfillment') && u.is_active).length, [profiles])

  if (!phone) return <Navigate to="/admin" replace />

  const light = theme === 'light'
  const allLive = config ? config.voice_live && config.sms_live : null
  const payOn = pay ? pay.payouts_live && !pay.payouts_paused : null

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
          <span style={{ display: 'block', fontSize: 13, color: 'var(--ov-hero-soft)' }}>Admin · owner</span>
        </span>
      </section>

      <section className="ov-card ph-menu">
        <Row icon={Users} tone="teal" label="People" onClick={() => navigate('/admin/users')}
          right={`${people}${invites.length ? ` · ${invites.length} invite${invites.length === 1 ? '' : 's'}` : ''}`} />
        <Row icon={ListFilter} tone="blue" label="Pipeline" right="View only" onClick={() => navigate('/admin/pipeline')} />
        <Row icon={MessageSquare} tone="blue" label="Messages" right={unread > 0 ? `${unread} new` : null} onClick={() => navigate('/messages')} />
        <Row icon={Wallet} tone="teal" label="Payout settings" onClick={() => setModal('payout')}
          right={payOn == null ? null : payOn ? 'On' : !pay.payouts_live ? 'Not live' : 'Paused'}
          rightTone={payOn == null ? null : payOn ? 'var(--ph-pill-teal)' : 'var(--ov-st-needs)'} />
      </section>

      <section className="ov-card ph-menu">
        <Row icon={Phone} tone="amber" label="Calling & texting" onClick={() => navigate('/settings#contact')}
          right={allLive == null ? null : allLive ? 'Live' : 'Not live'} rightTone={allLive == null ? null : allLive ? 'var(--ph-pill-teal)' : 'var(--ov-st-needs)'} />
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
      </section>

      <button type="button" className="ph-signout" onClick={handleSignOut}>
        <LogOut size={17} strokeWidth={2.2} aria-hidden="true" />Sign out
      </button>

      {modal === 'payout' && <PayoutSettings onClose={() => setModal(null)} />}
    </div>
  )
}
