import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Activity, UserPlus, Bell, Moon, Sun, Settings, TriangleAlert, ChevronRight, LogOut } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { useBillingTiers, useWeeklyUsage } from '../../hooks/useBillingTiers'
import { capState, formatWeekly, formatBillingDate, formatReset, renewsAt, shownStatus, isComped } from '../../lib/billing'
import { Avatar } from '../../components/ui/Avatar'
import { InviteAgentModal } from '../../components/shared/InviteAgentModal'
import { BugReportModal } from '../../components/shared/BugReportButton'
import { AccountRows } from '../../components/shared/AccountRows'
import { isNativeApp } from '../../lib/native'
import { NATIVE_BILLING_TEXT } from '../../components/native/NativeBillingNote'

// Prompt 772 — More, the phone layout's fifth tab (mockup More.dc.html): the
// profile, a Billing card (plan, weekly price, next charge, this week's
// bookings, Manage billing), then Activity, Invite an agent, Notifications,
// Theme (one tap flips it, like P766), Settings and Report a problem, and
// Sign out. Desktop has no More page: the sidebar holds all of this, so the
// route sends a desktop visitor home.

const TONES = {
  blue: ['var(--ov-data-a)', 'var(--ov-data-a-tint)'],
  teal: ['var(--ov-data-b)', 'var(--ov-data-b-tint)'],
  amber: ['var(--ov-st-needs)', 'var(--ov-st-needs-tint)'],
  violet: ['var(--nt-purple)', 'var(--nt-purple-tint)'],
}

const STATUS = {
  active: ['Paid up', 'var(--ov-up)'],
  past_due: ['Payment due', 'var(--ov-st-needs)'],
  canceled: ['Cancelled', 'var(--ov-mute)'],
  none: ['No plan', 'var(--ov-mute)'],
}

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

export default function More() {
  const phone = usePhoneLayout()
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [theme, setTheme] = useTheme()
  const [modal, setModal] = useState(null) // 'invite' | 'report'
  const { data: tiers = [] } = useBillingTiers()
  const { data: usage } = useWeeklyUsage(profile?.id)

  if (!phone) return <Navigate to="/agent" replace />

  const light = theme === 'light'
  const comped = isComped(profile)
  const status = shownStatus(profile)
  const tier = tiers.find(t => t.key === profile?.billing_tier) || tiers.find(t => t.key === usage?.tier)
  const cap = capState(usage)
  const next = formatBillingDate(renewsAt(profile, usage), profile?.timezone)
  const [statusText, statusColor] = comped ? ['Not charged', 'var(--ov-up)'] : STATUS[status] || STATUS.none
  const planLine = [profile?.role === 'agent' ? 'Agent' : null, usage?.tier_name || tier?.name].filter(Boolean).join(' · ')
  const subscribed = comped || ['active', 'past_due', 'canceled'].includes(status)

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
          <span style={{ display: 'block', fontSize: 13, color: 'var(--ov-hero-soft)' }}>{planLine ? `${planLine} plan` : 'Agent'}</span>
        </span>
      </section>

      <section className="ov-card ph-bill" aria-label="Billing">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }}>Billing</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: statusColor }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} aria-hidden="true" />{statusText}
          </span>
        </div>
        {tier ? (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--ov-hi)' }}>{formatWeekly(tier.weekly_cents)}</span>
            <span style={{ fontSize: 13.5, color: 'var(--ov-soft)' }}>
              a week{comped ? ' · not charged' : next && status !== 'none' ? ` · ${status === 'canceled' ? 'ends' : 'next charge'} ${next}` : ''}
            </span>
          </div>
        ) : (
          <div style={{ marginTop: 6, fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--ov-hi)' }}>No plan yet</div>
        )}
        {cap?.cap != null && (
          <>
            <div className="ph-meter" role="progressbar" aria-label="Bookings this week" aria-valuemin={0} aria-valuemax={cap.cap} aria-valuenow={cap.used}>
              <span style={{ width: `${Math.min(100, (cap.used / cap.cap) * 100)}%` }} />
            </div>
            <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, color: 'var(--ov-soft)' }}>
              <span>{cap.used} of {cap.cap} bookings used</span>
              <span>Resets {formatReset(usage?.week_end, profile?.timezone)}</span>
            </div>
          </>
        )}
        {isNativeApp() ? (
          <p style={{ margin: '14px 0 0', fontSize: 13.5, color: 'var(--ov-mute)' }}>{NATIVE_BILLING_TEXT}</p>
        ) : (
          <button type="button" className="ov-ghost" onClick={() => navigate(subscribed ? '/agent/billing?manage=1' : '/agent/billing')}
            style={{ marginTop: 14, width: '100%', height: 46, borderRadius: 999, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            {subscribed ? 'Manage billing' : 'Choose a plan'}
          </button>
        )}
      </section>

      <section className="ov-card ph-menu">
        <Row icon={Activity} tone="blue" label="Activity" onClick={() => navigate('/agent/activity')} />
        <Row icon={UserPlus} tone="teal" label="Invite an agent" onClick={() => setModal('invite')} />
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

      {modal === 'invite' && <InviteAgentModal onClose={() => setModal(null)} />}
      {modal === 'report' && <BugReportModal onClose={() => setModal(null)} />}
    </div>
  )
}
