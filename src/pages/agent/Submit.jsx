import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, CalendarClock, ChevronRight, CreditCard, FileUp, LifeBuoy, TriangleAlert } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useSubmitLive } from '../../hooks/useAppSettings'
import { useBillingTiers, useWeeklyUsage } from '../../hooks/useBillingTiers'
import { capState, nextTier, formatReset, formatWeekly } from '../../lib/billing'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { WeeklyUsage } from '../../components/agent/AgentUI'
import { PhoneSubHead } from '../../components/layout/PhoneShell'
import { NATIVE_BILLING_TEXT } from '../../components/native/NativeBillingNote'
import { isNativeApp } from '../../lib/native'
import BookCall from './BookCall'
import SubmitDeal from './SubmitDeal'
import ServiceRequest from './ServiceRequest'

// Submit (migration 187) — "Submit a deal for servicing or request a service".
// Replaces Book a call at /agent/submit (/agent/book redirects here).
//
// The gate: app_settings.submit_live. Off, unset, loading or a failed load all
// give today's BookCall (New booking + Change a booking) and nothing else, so
// merging before the migration is applied changes nothing but the name. On:
//
//   /agent/submit              the chooser (or the leads-only view)
//   ?kind=deal                 SubmitDeal
//   ?kind=request              ServiceRequest
//   ?change, ?change=<id>      Change a booking (BookCall's change mode)
//
// Leads-only is profile.has_servicing === false on a loaded agent profile that
// isn't comped. get_my_profile() has no such column until the migration is
// applied, so undefined never counts as Leads only.
export default function Submit() {
  const { live } = useSubmitLive()
  const { profile } = useAuth()
  const [params] = useSearchParams()
  if (!live) return <BookCall />
  if (params.has('change')) return <BookCall />
  const leadsOnly = profile?.role === 'agent' && !profile.billing_exempt && profile.has_servicing === false
  if (leadsOnly) return <LeadsOnly />
  const kind = params.get('kind')
  if (kind === 'deal') return <DealPage />
  if (kind === 'request') return <RequestPage />
  return <Chooser />
}

const toChooser = navigate => () => navigate('/agent/submit')

function DealPage() {
  const navigate = useNavigate()
  return <SubmitDeal onBack={toChooser(navigate)} />
}

function RequestPage() {
  const navigate = useNavigate()
  return <ServiceRequest onBack={toChooser(navigate)} />
}

const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

// Phone: a back arrow header, with the week's count on the right.
function PhoneHead({ cap }) {
  const navigate = useNavigate()
  const pill = cap && cap.cap != null && (
    <span className={`ph-usepill${cap.atCap ? ' is-full' : ''}`}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} aria-hidden="true" />{cap.used} of {cap.cap} this week
    </span>
  )
  return <div style={{ margin: '-4px -16px 8px' }}><PhoneSubHead title="Submit" onBack={() => navigate('/agent')} right={pill} /></div>
}

// A whole-card link on the chooser. `hero` is the filled card (the deal), the
// other the plain card. The button inside is a span: a link can't hold a button.
function ChoiceCard({ hero, to, off, icon: Icon, title, text, items, action, note }) {
  const tile = hero
    ? { background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.12)', color: '#FFFFFF' }
    : { background: 'var(--ov-st-booked-tint)', color: 'var(--ov-st-booked)' }
  const dot = hero
    ? { background: 'rgba(255,255,255,0.10)', color: '#FFFFFF' }
    : { background: 'var(--ov-st-booked-tint)', color: 'var(--ov-st-booked)' }
  const body = (
    <>
      <span aria-hidden="true" style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', ...tile }}>
        <Icon size={24} strokeWidth={2} />
      </span>
      <div>
        <h3 className="text-[22px] sm:text-[26px]" style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.15, color: hero ? '#FFFFFF' : 'var(--ov-hi)' }}>{title}</h3>
        <p style={{ margin: '6px 0 0', fontSize: 15, lineHeight: 1.5, color: hero ? 'var(--ov-hero-soft)' : 'var(--ov-mute)' }}>{text}</p>
      </div>
      <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map(t => (
          <li key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14.5, lineHeight: 1.4, listStyle: 'none', color: hero ? 'inherit' : 'var(--ov-soft)' }}>
            <i aria-hidden="true" style={{ width: 20, height: 20, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', ...dot }}><Check size={12} strokeWidth={3} /></i>
            <span>{t}</span>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
        {hero
          ? <span className="ov-hero-btn" style={{ width: '100%', height: 50, fontSize: 15.5, ...(off ? { opacity: 0.6, cursor: 'not-allowed' } : null) }}>{action}{!off && <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />}</span>
          : <span className="ov-ghost" style={{ width: '100%', height: 50, fontSize: 15.5, fontWeight: 600, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>{action}<ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" /></span>}
        <span style={{ textAlign: 'center', fontSize: 13, color: hero ? 'var(--ov-hero-soft)' : 'var(--ov-mute)' }}>{note}</span>
      </div>
    </>
  )
  const cls = `${hero ? 'ov-hero' : 'ov-card'}${off ? '' : ' ov-link'} p-5 sm:p-7`
  const style = { display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }
  return off
    ? <div className={cls} style={style} aria-disabled="true">{body}</div>
    : <Link to={to} className={cls} style={style}>{body}</Link>
}

// "Change a booking" stays reachable from the chooser and from leads-only.
function ChangeRow() {
  return (
    <Link to={{ search: '?change' }} className="ov-card ov-link" style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 76, padding: '14px 18px', borderRadius: 20 }}>
      <span aria-hidden="true" style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ov-st-booked-tint)', color: 'var(--ov-st-booked)' }}>
        <CalendarClock size={19} strokeWidth={2} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--ov-hi)' }}>Change a booking</b>
        <span style={{ display: 'block', marginTop: 1, fontSize: 13, lineHeight: 1.4, color: 'var(--ov-mute)' }}>Move a call or fix a client’s details</span>
      </span>
      <ChevronRight size={18} strokeWidth={2.2} style={{ flexShrink: 0, color: 'var(--ov-faint)' }} aria-hidden="true" />
    </Link>
  )
}

function Chooser() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const phone = usePhoneLayout()
  const { data: tiers = [] } = useBillingTiers()
  const { data: usage, isLoading } = useWeeklyUsage(profile?.id)
  const cap = capState(usage)
  const upgrade = cap ? nextTier(tiers, usage.tier) : null
  const resets = formatReset(usage?.week_end, profile?.timezone)
  const capped = !!cap?.blocking
  const limited = cap && cap.cap != null

  const dealNote = capped ? `Comes back ${resets}`
    : limited ? `Uses 1 of your ${cap.left} left this week`
      : cap ? 'No weekly limit on your account' : ''
  const capWarning = capped && (
    <div className="ov-attn" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: phone ? '16px 16px' : '18px 22px' }}>
      <TriangleAlert size={18} strokeWidth={2} style={{ color: 'var(--ov-warn)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ margin: 0, flex: '1 1 260px', fontSize: 14, lineHeight: 1.5, color: 'var(--ov-mid)' }}>
          You've used all {cap.cap} submissions on the {cap.tierName} plan this week.{' '}
          {upgrade && !isNativeApp()
            ? <>Upgrade to {upgrade.name} (<span style={{ fontFamily: 'var(--font-mono)' }}>{formatWeekly(upgrade.weekly_cents)}</span>/week, {upgrade.weekly_cap ?? 'unlimited'} a week) to keep submitting, or wait until {resets}. Service requests stay open.</>
            : <>The cap resets {resets}. Service requests stay open.</>}
        </p>
        {upgrade && !isNativeApp() && (
          <button type="button" className="ov-ghost" onClick={() => navigate('/agent/billing')} style={{ height: 44, padding: '0 18px', fontSize: 14 }}>Upgrade</button>
        )}
      </div>
    </div>
  )

  const meter = isLoading
    ? (
      <div className="ov-card" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 22px' }}>
        <span className="ov-skel" style={{ display: 'block', width: '60%', height: 20 }} />
        <span className="ov-skel" style={{ display: 'block', width: '100%', height: 8, borderRadius: 4 }} />
        <span className="ov-skel" style={{ display: 'block', width: '45%', height: 13 }} />
      </div>
    )
    : limited && <WeeklyUsage cap={cap} resets={resets} title="Submissions this week" />

  const cards = (
    <div style={{ display: 'grid', gap: phone ? 14 : 20, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', alignItems: 'stretch' }}>
      <ChoiceCard
        hero to="?kind=deal" off={capped} icon={FileUp} title="New deal for servicing" text="You closed it. We keep it on the books."
        items={['The client and their new policy', 'The old policy cancelled, if it replaced one', 'Packet check, review call and chargeback watch']}
        action={capped ? 'Weekly cap reached' : 'Submit a deal'} note={dealNote}
      />
      <ChoiceCard
        to="?kind=request" icon={LifeBuoy} title="Service request" text="Something needs doing on a client you already have."
        items={['Beneficiary, address, payment or draft-date change', 'Lapse help or claims help', 'A call with the carrier']}
        action="Request a service" note="Doesn’t use a submission"
      />
    </div>
  )

  return (
    <>
      {phone && <PhoneHead cap={cap} />}
      <div className="ov-book">
        <div className="flex flex-col gap-[14px] sm:gap-5" style={{ minWidth: 0 }}>
          {capWarning}
          {cards}
          {phone && meter}
        </div>
        <div className="ov-book-side" style={{ display: 'flex', flexDirection: 'column', gap: phone ? 14 : 20, minWidth: 0 }}>
          {!phone && meter}
          <ChangeRow />
        </div>
      </div>
    </>
  )
}

// What Servicing gives. Same words on the web page and the app's hero.
const INCLUDED = [
  ['Set up right', 'Packet delivery and a review call on every new policy'],
  ['Changes handled', 'Cancellations, plus beneficiary, address, payment and draft-date changes'],
  ['Watched for you', 'Lapse saves and a chargeback watch'],
  ['Help when it counts', 'Annual reviews, claims help and carrier calls'],
]
const STEPS = [
  ['Open Billing', 'Policy Servicing is on the Billing page.'],
  ['Subscribe', 'Billed weekly, cancel anytime.'],
  ['Submit your next deal', 'This page opens up once Servicing is on your account.'],
]

function LeadsOnly() {
  const phone = usePhoneLayout()
  const native = isNativeApp()
  return (
    <>
      {phone && <PhoneHead />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: phone ? 14 : 20, maxWidth: 1120, margin: '0 auto', width: '100%' }}>
        <section className="ov-hero grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)] xl:items-center gap-7 xl:gap-10 p-6 sm:p-9">
          <div style={{ minWidth: 0 }}>
            <span className="ov-hero-chip"><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ov-hero-dot)' }} />Leads only</span>
            <h2 className="text-[30px] sm:text-[40px]" style={{ margin: '16px 0 0', fontFamily: 'var(--font-display)', fontWeight: 600, lineHeight: 1.08, letterSpacing: '-0.035em', color: '#FFFFFF' }}>
              {native ? 'Servicing isn’t on your account' : 'Add Servicing to submit deals'}
            </h2>
            <p style={{ margin: '12px 0 0', maxWidth: 560, fontSize: 16.5, lineHeight: 1.5, color: 'var(--ov-hero-soft)' }}>
              {native
                ? 'You’re getting leads. With Servicing, we take over after you close, so your book stays on the books.'
                : 'You’re getting leads, but Servicing isn’t on your account. With it, we take over after you close, so your book stays on the books.'}
            </p>
            {!native && (
              <div style={{ marginTop: 22, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <Link to="/agent/billing" className="ov-hero-btn" style={{ height: 48, padding: '0 22px', fontSize: 15 }}>
                  See Servicing on Billing<ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />
                </Link>
                <span style={{ fontSize: 13, color: 'var(--ov-hero-soft)' }}>Your leads stay as they are.</span>
              </div>
            )}
          </div>
          <ul aria-label="What Servicing gives you" style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {INCLUDED.map(([b, s]) => (
              <li key={b} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', borderRadius: 16, listStyle: 'none', background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.12)' }}>
                <i aria-hidden="true" style={{ width: 24, height: 24, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FFFFFF', color: 'var(--ov-hero-btn-text)' }}><Check size={13} strokeWidth={3} /></i>
                <div style={{ minWidth: 0 }}>
                  <b style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{b}</b>
                  <span style={{ display: 'block', marginTop: 2, fontSize: 13, lineHeight: 1.45, color: 'var(--ov-hero-soft)' }}>{s}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {native ? (
          <section className="ov-card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 18 }}>
            <span aria-hidden="true" style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ov-data-a-tint)', color: 'var(--ov-data-a)' }}><CreditCard size={19} strokeWidth={2} /></span>
            <span style={{ minWidth: 0 }}>
              <b style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--ov-hi)' }}>{NATIVE_BILLING_TEXT}</b>
              <span style={{ display: 'block', marginTop: 2, fontSize: 13.5, color: 'var(--ov-mute)' }}>Your plan and payments can’t be changed in the app.</span>
            </span>
          </section>
        ) : (
          <section className="ov-card" aria-label="How to add it" style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '24px 26px' }}>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>How to add it</h3>
            <ol className="grid grid-cols-1 md:grid-cols-3 gap-[18px]" style={{ margin: 0, padding: 0 }}>
              {STEPS.map(([b, s], i) => (
                <li key={b} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0, listStyle: 'none' }}>
                  <span className="ov-step" style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 11, fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <b style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)', ...ellipsis, whiteSpace: 'normal' }}>{b}</b>
                    <span style={{ display: 'block', marginTop: 2, fontSize: 13, lineHeight: 1.45, color: 'var(--ov-mute)' }}>{s}</span>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
        <ChangeRow />
      </div>
    </>
  )
}
