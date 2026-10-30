import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CalendarCheck, Pause, Pencil, Phone, Play, RefreshCw, TriangleAlert } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useBillingTiers } from '../../../hooks/useBillingTiers'
import { useBillingInbound, useSetBillingInbound } from '../../../hooks/useBillingInbound'
import { usePhoneLayout } from '../../../hooks/usePhoneLayout'
import { NativeBillingNote } from '../../native/NativeBillingNote'
import { InboundSpendSheet } from './InboundSpendSheet'
import { formatWeekly } from '../../../lib/billing'
import {
  aboutInboundsText, aboutText, activeCents, activeCount, formatMoney, HOW_IT_WORKS, orderedTypes, panelState, pausedTypes, plainError, rowKind, TYPE_LABEL, TYPE_ORDER, WHAT_YOU_GET,
} from '../../../lib/billingInbound'
import { isNativeApp } from '../../../lib/native'

// Get inbounds, at the top of /agent/inbounds: the weekly amount per type, Change / Pause, what you get and
// how it works. Which state shows, in order: phone-app note, load error, loading, not open yet, comped
// (read-only, nothing can call inbound_set), not subscribed (Start goes to Billing), empty, all paused, spending.
// Mockup: ohvara/mockups/get-inbounds-panel-on-a-minimal-agent-in.html.

const WORDS = {
  live: 'Set a weekly amount for each type. Raise it, lower it or pause it any time.',
  empty: 'Pick a weekly amount and we’ll start sending you Live Calls, Booked Appointments, or both.',
  paused: 'Nothing new is coming in. Resume a type below to start again.',
  noSub: 'Start Policy Servicing first. Inbounds go on top of it.',
  comped: 'You’re not billed, so inbounds aren’t charged.',
  notOpen: 'Inbounds aren’t open yet. They’ll show here when they are.',
}

const TYPE_LOOK = {
  live_call: { icon: Phone, color: 'var(--ov-data-b)', tint: 'var(--ov-data-b-tint)' },
  booked_appointment: { icon: CalendarCheck, color: 'var(--ov-data-a)', tint: 'var(--ov-data-a-tint)' },
}

const NUM = { fontFamily: 'var(--font-display)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }
const SKEL = { display: 'block', borderRadius: 10, background: 'var(--ov-stub)' }
const HERO_SKEL = { ...SKEL, background: 'color-mix(in srgb, var(--ov-hero-soft) 24%, transparent)' }

const heroStyle = phone => ({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: phone ? 16 : '20px 40px', padding: phone ? '22px 20px' : '28px 32px', minWidth: 0 })
const heroLeft = phone => ({ flex: phone ? '1 1 100%' : '1 1 420px', minWidth: 0 })
const heroRight = phone => ({ flex: phone ? '1 1 100%' : '0 0 auto', minWidth: 0 })
const heroTitle = phone => ({ margin: 0, color: 'inherit', fontFamily: 'var(--font-display)', fontSize: phone ? 26 : 34, fontWeight: 600, letterSpacing: phone ? '-0.03em' : '-0.035em', lineHeight: 1.1 })

function Hero({ phone, eyebrow, title, sub, chips, cta, total }) {
  return (
    <section className="ov-hero" style={heroStyle(phone)}>
      <div style={heroLeft(phone)}>
        {eyebrow && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-hero-soft)', marginBottom: 6 }}>{eyebrow}</div>}
        <h2 style={heroTitle(phone)}>{title}</h2>
        {sub && <p style={{ margin: '8px 0 0', fontSize: phone ? 14.5 : 15.5, color: 'var(--ov-hero-soft)', maxWidth: 560 }}>{sub}</p>}
        {chips?.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {chips.map(c => (
              <span key={c.text} className="ov-hero-chip" style={{ maxWidth: '100%' }}>
                {c.dot && <i style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ov-hero-dot)', flexShrink: 0 }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.text}</span>
              </span>
            ))}
          </div>
        )}
        {cta && (
          <button type="button" className="ov-hero-btn" onClick={cta.onClick} style={{ marginTop: 18, height: phone ? 50 : 48, padding: '0 30px', fontSize: phone ? 16 : 15, ...(phone ? { width: '100%' } : null) }}>
            {cta.text}{cta.arrow && <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />}
          </button>
        )}
      </div>
      {total && (
        <div style={heroRight(phone)}>
          <small style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ov-hero-soft)' }}>Your inbound spend</small>
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 9 }}>
            <b style={{ ...NUM, fontSize: phone ? 44 : 56, lineHeight: 1, letterSpacing: '-0.035em' }}>{total.amount}</b>
            <span style={{ fontSize: phone ? 16 : 18, fontWeight: 500, color: 'var(--ov-hero-soft)' }}>a week</span>
          </div>
          <span style={{ display: 'block', marginTop: 8, fontSize: 15, fontWeight: 600 }}>{total.about}</span>
        </div>
      )}
    </section>
  )
}

function Tile({ phone, type }) {
  const look = TYPE_LOOK[type]
  const Icon = look.icon
  return (
    <span style={{ width: phone ? 40 : 44, height: phone ? 40 : 44, borderRadius: phone ? 12 : 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: look.tint, color: look.color, ...(phone ? { alignSelf: 'flex-start' } : null) }}>
      <Icon size={20} strokeWidth={2} aria-hidden="true" />
    </span>
  )
}

const rowStyle = (phone, first) => ({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: phone ? 12 : '14px 20px', padding: phone ? 16 : '20px 26px', ...(first ? null : { borderTop: '1px solid var(--ov-line)' }) })
const whatStyle = phone => ({ flex: phone ? '1 1 calc(100% - 52px)' : '1 1 320px', minWidth: 0 })
const nameStyle = phone => ({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px', fontFamily: 'var(--font-display)', fontSize: phone ? 17 : 18, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.25, color: 'var(--ov-hi)' })
const amtStyle = phone => (phone
  ? { flex: '1 1 100%', minWidth: 0, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }
  : { flex: '0 0 200px', minWidth: 0 })
const actsStyle = phone => (phone
  ? { flex: '1 1 100%', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, minWidth: 0 }
  : { flex: '0 0 232px', display: 'flex', gap: 8, minWidth: 0 })

function RowButton({ phone, wide, icon: Icon, children, ...rest }) {
  return (
    <button type="button" className="ov-ghost" {...rest}
      style={{ flex: '1 1 0', minWidth: 0, width: phone ? '100%' : undefined, height: phone ? 46 : 44, padding: '0 10px', borderRadius: 999, fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, cursor: rest.disabled ? 'default' : 'pointer', whiteSpace: 'nowrap', ...(wide && phone ? { gridColumn: '1 / -1' } : null) }}>
      {Icon && <Icon size={15} strokeWidth={2} aria-hidden="true" />}{children}
    </button>
  )
}

// `readOnly` (comped, not subscribed): no buttons, so nothing on the row can call inbound_set.
function TypeRow({ phone, first, t, min, readOnly, comped, actions, busy }) {
  const kind = rowKind(t)
  const word = kind === 'off' ? (comped ? 'Not set' : 'Not started') : null
  const label = t.label || TYPE_LABEL[t.type]
  const lineGap = phone ? 0 : 2
  return (
    <div style={rowStyle(phone, first)}>
      <Tile phone={phone} type={t.type} />
      <div style={whatStyle(phone)}>
        <div style={nameStyle(phone)}>
          {label}
          {kind === 'paused' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 999, fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 700, letterSpacing: 0, background: 'var(--ov-stub)', color: 'var(--ov-mid)', whiteSpace: 'nowrap' }}>
              <i style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />Paused
            </span>
          )}
        </div>
        <p style={{ margin: '4px 0 0', fontSize: phone ? 13 : 13.5, lineHeight: 1.5, color: 'var(--ov-mute)', maxWidth: 520 }}>
          <b style={{ fontWeight: 700, color: 'var(--ov-soft)' }}>What you get:</b> {WHAT_YOU_GET[t.type]}
        </p>
      </div>
      <div style={amtStyle(phone)}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          {word ? (
            <b style={{ ...NUM, fontSize: 18, letterSpacing: '-0.015em', lineHeight: 1.5, color: 'var(--ov-mid)' }}>{word}</b>
          ) : (
            <>
              <b style={{ ...NUM, fontSize: 30, lineHeight: 1.1, letterSpacing: '-0.03em', color: kind === 'paused' ? 'var(--ov-mute)' : 'var(--ov-hi)' }}>{formatMoney(t.weekly_cents)}</b>
              <span style={{ fontSize: 14, color: 'var(--ov-mute)' }}>a week</span>
            </>
          )}
        </div>
        {kind === 'on' && <div style={{ marginTop: lineGap, fontSize: 13.5, fontWeight: 600, color: 'var(--ov-soft)' }}>{aboutText(t.estimate_count)}</div>}
        {kind === 'paused' && <div style={{ marginTop: lineGap, fontSize: 13.5, fontWeight: 500, color: 'var(--ov-mute)' }}>No new inbounds while paused</div>}
        {kind === 'off' && !comped && (
          <div style={{ marginTop: lineGap, fontSize: 13.5, fontWeight: 500, color: 'var(--ov-mute)' }}>
            From <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>{formatMoney(min)}</span> a week
          </div>
        )}
      </div>
      {!readOnly && (
        <div style={actsStyle(phone)}>
          {kind === 'off' ? (
            <RowButton phone={phone} wide disabled={busy} aria-label={`Start ${label}`} onClick={() => actions.open(t)}>Start</RowButton>
          ) : (
            <>
              <RowButton phone={phone} icon={Pencil} disabled={busy} aria-label={`Change ${label}`} onClick={() => actions.open(t)}>Change</RowButton>
              {kind === 'paused'
                ? <RowButton phone={phone} icon={Play} disabled={busy} aria-label={`Resume ${label}`} onClick={() => actions.setPaused(t, false)}>Resume</RowButton>
                : <RowButton phone={phone} icon={Pause} disabled={busy} aria-label={`Pause ${label}`} onClick={() => actions.setPaused(t, true)}>Pause</RowButton>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function HowItWorks({ phone }) {
  return (
    <section className="ov-card" style={{ padding: phone ? 16 : '20px 26px 22px' }}>
      <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ov-hi)' }}>How it works</h3>
      <ol style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: phone ? 'minmax(0, 1fr)' : 'repeat(3, minmax(0, 1fr))', gap: phone ? 14 : 22 }}>
        {HOW_IT_WORKS.map(([b, p], i) => (
          <li key={b} style={{ display: 'flex', gap: 12, minWidth: 0 }}>
            <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, background: 'var(--ov-data-a-tint)', color: 'var(--ov-data-a)' }}>{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <b style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--ov-hi)' }}>{b}</b>
              <p style={{ margin: '2px 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ov-mute)' }}>{p}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function ErrorStrip({ phone, message, onRetry }) {
  return (
    <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 16, background: 'var(--danger-dim)', border: 'var(--border-w) solid var(--danger-bd)', color: 'var(--danger)' }}>
      <TriangleAlert size={16} strokeWidth={2.2} style={{ flexShrink: 0 }} aria-hidden="true" />
      <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 14, fontWeight: 500 }}>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: phone ? 44 : 32, padding: '6px 12px', borderRadius: 10, border: 'var(--border-w) solid var(--danger-bd)', background: 'transparent', color: 'var(--danger)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <RefreshCw size={14} strokeWidth={2.2} aria-hidden="true" />Try again
        </button>
      )}
    </div>
  )
}

function LoadingPanel({ phone }) {
  return (
    <>
      <section className="ov-hero" aria-busy="true" style={heroStyle(phone)}>
        <div style={heroLeft(phone)}>
          <h2 style={heroTitle(phone)}>Get inbounds</h2>
          <span style={{ ...HERO_SKEL, height: 16, width: 'min(100%, 380px)', marginTop: 12 }} />
        </div>
        <div style={heroRight(phone)}>
          <span style={{ ...HERO_SKEL, height: 50, width: 170 }} />
          <span style={{ ...HERO_SKEL, height: 14, width: 150, marginTop: 10 }} />
        </div>
      </section>
      <section className="ov-card" aria-busy="true" style={{ overflow: 'hidden' }}>
        {TYPE_ORDER.map((type, i) => (
          <div key={type} style={rowStyle(phone, i === 0)}>
            <Tile phone={phone} type={type} />
            <div style={whatStyle(phone)}>
              <div style={nameStyle(phone)}>{TYPE_LABEL[type]}</div>
              <span style={{ ...SKEL, height: 13, width: 'min(100%, 300px)', marginTop: 8 }} />
            </div>
            <div style={amtStyle(phone)}><span style={{ ...SKEL, height: 30, width: 120 }} /></div>
            <div style={actsStyle(phone)}><span style={{ ...SKEL, height: 44, width: phone ? '100%' : 216, maxWidth: '100%', borderRadius: 999, gridColumn: '1 / -1' }} /></div>
          </div>
        ))}
      </section>
    </>
  )
}

export function GetInboundsPanel() {
  const phone = usePhoneLayout()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { data, isLoading, isError, error, refetch, isFetching } = useBillingInbound()
  const { data: tiers = [] } = useBillingTiers()
  const set = useSetBillingInbound()
  const [sheet, setSheet] = useState(null) // { type, choose }
  const [rowError, setRowError] = useState('')

  const wrap = { width: '100%', display: 'flex', flexDirection: 'column', gap: phone ? 14 : 20, minWidth: 0 }

  if (isNativeApp()) return <div style={wrap}><NativeBillingNote /></div>

  if (isError && !data) {
    return (
      <div style={wrap}>
        <ErrorStrip phone={phone} message={plainError(error?.message, 'Couldn’t load your inbounds.')} onRetry={isFetching ? undefined : () => refetch()} />
        <Hero phone={phone} title="Get inbounds" sub={WORDS.live} />
      </div>
    )
  }
  if (isLoading || !data) return <div style={wrap}><LoadingPanel phone={phone} /></div>

  const state = panelState(data)
  if (state === 'not_open') return <div style={wrap}><Hero phone={phone} title="Get inbounds" sub={WORDS.notOpen} /></div>

  const tier = tiers.find(t => t.key === profile?.billing_tier)
  const servicing = tier ? { text: `On top of Policy Servicing, ${formatWeekly(tier.weekly_cents)} a week`, dot: true } : null
  const readOnly = state === 'comped' || state === 'not_subscribed'

  const actions = {
    open: t => { setRowError(''); setSheet({ type: t.type, choose: false }) },
    setPaused: (t, paused) => {
      setRowError('')
      set.mutate({ type: t.type, weekly_cents: t.weekly_cents, paused }, {
        onError: e => setRowError(plainError(e.message, 'Couldn’t save that. Try again.')),
      })
    },
  }

  const hero = {
    spending: {
      title: 'Get inbounds', sub: WORDS.live,
      chips: [servicing, ...pausedTypes(data).map(t => ({ text: `${t.label || TYPE_LABEL[t.type]} paused` }))].filter(Boolean),
      total: { amount: formatMoney(activeCents(data)), about: aboutInboundsText(activeCount(data)) },
    },
    paused: { eyebrow: 'Get inbounds', title: 'Your inbounds are paused', sub: WORDS.paused, chips: servicing ? [servicing] : [] },
    empty: {
      eyebrow: 'Get inbounds', title: 'You’re not getting inbounds yet', sub: WORDS.empty, chips: servicing ? [servicing] : [],
      cta: { text: 'Start', onClick: () => { setRowError(''); setSheet({ type: TYPE_ORDER[0], choose: true }) } },
    },
    not_subscribed: {
      eyebrow: 'Get inbounds', title: 'You’re not getting inbounds yet', sub: WORDS.noSub,
      cta: { text: 'Start', arrow: true, onClick: () => navigate('/agent/billing') },
    },
    comped: { title: 'Get inbounds', sub: WORDS.comped, chips: [{ text: 'Not charged' }] },
  }[state]

  return (
    <div style={wrap}>
      <Hero phone={phone} {...hero} />
      {rowError && <ErrorStrip phone={phone} message={rowError} />}
      <section className="ov-card" style={{ overflow: 'hidden' }}>
        {orderedTypes(data).map((t, i) => (
          <TypeRow key={t.type} phone={phone} first={i === 0} t={t} min={data.min_weekly_cents} readOnly={readOnly} comped={state === 'comped'} actions={actions} busy={set.isPending} />
        ))}
      </section>
      {!readOnly && <HowItWorks phone={phone} />}
      {sheet && <InboundSpendSheet data={data} type={sheet.type} choose={sheet.choose} onClose={() => setSheet(null)} />}
    </div>
  )
}
