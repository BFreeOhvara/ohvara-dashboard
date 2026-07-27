import { useMemo, useState, useEffect } from 'react'
import {
  FileText, TrendingUp, DollarSign, Phone, Target,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePolicies, pendingEffectuation, bookMetrics } from '../../hooks/usePolicies'
import { useFollowUps } from '../../hooks/useFollowUps'
import { money, moneyShort, fullName, todayISO } from '../../lib/policyFormat'

// Closer · Overview — literal port of the approved Claude Design export
// (vault: media/claude-design-export-ohvara-dashboard-v3.html, lines 163-227).
// Same DOM structure, same tokens, same spacing; the export's sample numbers
// are replaced with the real Supabase book, and anything with no data source
// yet renders an em-dash in the exact same slot rather than a fabricated
// number (Prompt 327).

const MONO = "'JetBrains Mono',monospace"

// Fixed row height for "Needs your attention" (Prompt 347) — every row is
// forced to this height via a fixed height+border-box so the 5-row scroll
// cap below is an exact pixel figure, not an estimate.
//
// Prompt 349 fix: Prompt 347 used `minHeight` here, which is only a floor —
// this card's real width (it shares a 2-column grid with "Monthly goal") only
// gives the Name/Detail columns ~76px/~137px, so almost any real name or
// detail string wrapped to 2 lines and grew the row to ~63.5px measured live,
// well past the 42px the container's `ATTENTION_ROW_H * 5` cap assumed —
// exactly Brayden's "clips mid-row" screenshot. Switched to a real fixed
// `height` plus ATTENTION_CLIP's single-line truncation below so a row's
// height can no longer depend on which name/detail happens to be in it.
const ATTENTION_ROW_H = 42

// Forces Name/Detail to a single line with an ellipsis instead of wrapping —
// `minWidth: 0` is required for a CSS Grid item to actually shrink below its
// content's intrinsic width (grid's default `min-width: auto` would otherwise
// let the text overflow the track instead of truncating).
const ATTENTION_CLIP = { overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0 }

// Prompt 360 made Type `minmax(70px,max-content)` so the column would shrink
// to whatever a given row's pill needed — verified at the time only against
// the FOLLOW-UP tag (~57-79px). Prompt 363: each data row below is rendered
// as its OWN independent `display:grid` div (not one shared grid across
// rows), so `max-content` gets resolved separately per row against THAT
// row's own badge width. Live-measured with real seeded data (nate44) across
// all 3 real tag strings: FOLLOW-UP = 77.86px, CONFIRM EFFECTIVE = 120.89px,
// CANCELLATION PENDING = 142.58px — so Name's start x drifted 430.9 / 473.9 /
// 495.6px across rows, and Detail's drifted 603.3 / 629.8 / 643.2px,
// depending purely on which tag happened to be in that row (confirmed via
// `getBoundingClientRect` on the live page, not assumed). `max-content` is
// the wrong tool here since it re-measures per row instead of sharing one
// column width; switched to a plain fixed px sized to the widest of the 3
// real tag strings (142.58px measured) plus a small buffer for font-load/
// sub-pixel variance, so Type is identical on every row regardless of which
// tag it holds — Name and Detail then land at the same x on every row since
// their `fr` tracks compute from the same fixed remainder every time. Gap
// bumped 20→24 for the breathing room Prompt 363 asked for now that Type
// isn't stealing shared space per-row. Header and rows share this constant
// so they can't drift out of alignment with each other either.
const ATTENTION_COLUMNS = { display: 'grid', gridTemplateColumns: '150px 1fr 1.6fr', gap: 24 }

// Elegant serif clock font (Prompt 350, replaces Prompt 342's DSEG7
// seven-segment choice — Brayden didn't like the digital/LCD look after
// living with it) — self-hosted via @fontsource/playfair-display (imported
// in main.jsx). Scoped to the clock text only, not the shared MONO constant
// above (that's used elsewhere for policy numbers/money, unrelated here).
const CLOCK_FONT = "'Playfair Display',serif"

// Prompt 353: Playfair Display's default numerals are old-style (text)
// figures, not lining figures — confirmed via canvas TextMetrics
// (actualBoundingBoxAscent/Descent per glyph): 3/4/5/7/9 render with a
// 5px descent below the baseline, 6/8 render with a 22px ascent (cap-height,
// vs 16px for 0/1/2). `lining-nums` switches the font to its lining figures
// (uniform height, sit on the baseline, no ascenders/descenders) and fixes
// that part for real — this feature IS supported by the font.
const CLOCK_NUMERIC_VARIANT = 'lining-nums'

// Prompt 360: `tabular-nums` (also applied here through Prompt 353-359) is a
// silent no-op on Playfair Display — confirmed by loading the actual
// self-hosted woff2 in an isolated harness and measuring per-glyph
// getBoundingClientRect() width at 36px/700: digits ranged 14.0px–23.5px
// with `tabular-nums` applied, identical to the widths with it omitted. The
// font simply has no `tnum` OpenType feature table entry for the browser to
// select, so the property is accepted but does nothing — which is exactly
// why the clock pill kept visibly resizing every second despite Prompt 353's
// fix. `font-variant-numeric` can't fix a feature the font doesn't ship, so
// each digit character is instead wrapped in a fixed-width inline-block span
// (see `renderClockDigits` below) — CSS-level width control that doesn't
// depend on font metrics support. Re-verified in the same harness: a string
// wrapped this way renders at an identical total px width across every
// digit combination (0000–9999), vs. the un-wrapped string's per-second
// jitter.
const CLOCK_DIGIT_CHAR_WIDTH = '0.68em'

// Digit size, bumped up from Prompt 350's 30px now that the baseline/sizing
// bug above is fixed first (no point enlarging inconsistent glyphs). AM/PM
// is derived as exactly half rather than a second hardcoded number, so the
// "50% of digit height" rule from Prompt 350 can't drift out of sync.
const CLOCK_DIGIT_SIZE = 36
const CLOCK_AMPM_SIZE = CLOCK_DIGIT_SIZE / 2

// Splits a clock digit string ("2:45:30") into DOM nodes, giving every 0-9
// character a fixed-width wrapper so the rendered string's total width can't
// change as digit values change — see CLOCK_DIGIT_CHAR_WIDTH above for why
// `tabular-nums` alone doesn't do this on this font. Non-digit characters
// (the colons) pass through as plain text — they never change value, so they
// can't contribute to the jitter and don't need fixing.
function renderClockDigits(str) {
  return [...str].map((ch, i) => (
    /[0-9]/.test(ch)
      ? <span key={i} style={{ display: 'inline-block', width: CLOCK_DIGIT_CHAR_WIDTH, textAlign: 'center' }}>{ch}</span>
      : ch
  ))
}

// Local calendar date (not UTC) for a timestamptz value — matches todayISO()'s
// own local-time convention, so "same day" comparisons on cancellation_call_at
// (Prompt 346) can't drift a day off from what the closer sees on their clock.
function localISO(value) {
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function AgentOverview() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { data: policies = [], isLoading } = usePolicies(isAdmin ? null : profile?.id)
  const { data: followUps = [] } = useFollowUps(profile?.id)

  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const today = todayISO()
  const month = today.slice(0, 7)

  const k = useMemo(() => {
    const ap = rows => rows.reduce((s, p) => s + Number(p.annual_premium || 0), 0)
    const submittedToday = policies.filter(p => p.policy_sold_date === today)
    const activeThisMonth = policies.filter(
      p => p.status === 'In Effect' && (p.effective_date || '').slice(0, 7) === month
    )
    // Submitted this month (Prompt 344) — same "policy_sold_date, falling back
    // to created_at" window bookMetrics() uses for its own submittedAP, so
    // this tile can't drift from Stats' definition of "submitted."
    const submittedThisMonth = policies.filter(
      p => (p.policy_sold_date || p.created_at?.slice(0, 10) || '').slice(0, 7) === month
    )
    return {
      submittedTodayAP: ap(submittedToday),
      submittedTodayCount: submittedToday.length,
      activeMonthAP: ap(activeThisMonth),
      activeMonthCount: activeThisMonth.length,
      submittedMonthCount: submittedThisMonth.length,
      avgPremium: activeThisMonth.length
        ? activeThisMonth.reduce((s, p) => s + Number(p.monthly_premium || 0), 0) / activeThisMonth.length
        : 0,
    }
  }, [policies, today, month])

  // "Needs your attention" (Prompt 329, unified in Prompt 347) — a real
  // pipeline-state worklist, not a schedule. Three sources: policies past
  // their Effective Date still awaiting the Yes/No effectuation
  // confirmation, policies sitting in Cancellation Pending with a call
  // booked today, and follow-ups (My Calls → Schedule, `closer_followups`)
  // due today. Same `pendingEffectuation` helper My Policies uses for its
  // own banner, so the two screens can't drift on the definition.
  //
  // Cancellation calls and follow-ups only ever show same-day (Prompt 346,
  // extended to follow-ups in 347) — a closer always books the call on the
  // spot, so there's no "not yet scheduled" state worth a UI branch; this
  // list is a today-only reminder, not an upcoming schedule (that's My
  // Calls → Schedule's job). Confirm Effective items intentionally do NOT
  // get the same day-of filter — they're an accumulating overdue backlog,
  // not a today-only reminder.
  const attention = useMemo(() => {
    const effectuation = pendingEffectuation(policies, new Date()).map(p => ({
      id: `eff-${p.id}`,
      // Prompt 349: purple, not blue — blue is now FOLLOW-UP's color (below),
      // matching My Calls → Schedule's own blue for its FOLLOW-UP badge. Two
      // different concepts can't share a color across pages.
      tag: 'CONFIRM EFFECTIVE', color: 'var(--purple)', dim: 'var(--purple-dim)', bd: 'var(--purple-bd)',
      name: fullName(p),
      detail: 'Confirm effectuation status',
    }))
    const cancellations = policies
      .filter(p => p.cancellation_status === 'Cancellation Pending' && p.cancellation_call_at && localISO(p.cancellation_call_at) === today)
      .map(p => ({
        id: `canc-${p.id}`,
        tag: 'CANCELLATION PENDING', color: 'var(--warning)', dim: 'var(--warning-dim)', bd: 'var(--warning-bd)',
        name: fullName(p),
        detail: `Cancellation call at ${new Date(p.cancellation_call_at).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
      }))
    const followups = followUps
      .filter(f => f.scheduled_at && localISO(f.scheduled_at) === today)
      .map(f => ({
        id: `fu-${f.id}`,
        // Prompt 349: blue (var(--info)), matching My Calls → Schedule's own
        // FOLLOW-UP badge color, so the same concept reads the same color on
        // both pages (was green, colliding with nothing but still worth
        // aligning now that Confirm Effective moved off blue onto purple).
        tag: 'FOLLOW-UP', color: 'var(--info)', dim: 'var(--info-dim)', bd: 'var(--info-bd)',
        name: f.client_name,
        detail: `Follow-up at ${new Date(f.scheduled_at).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
      }))
    return [...effectuation, ...cancellations, ...followups]
  }, [policies, followUps, today])

  // Monthly goal progress — real submitted AP this month vs. the closer's
  // own target (set on the Profile page, `monthly_ap_goal`; defaults to
  // 20000). Profile moved out of Settings' tabs to its own route in Prompt
  // 338 — this comment/copy updated to match.
  const goal = useMemo(() => {
    const target = Number(profile?.monthly_ap_goal) || 20000
    const submittedAP = bookMetrics(policies, { month }).submittedAP
    return { target, submittedAP, pct: target ? Math.min(100, Math.round((submittedAP / target) * 100)) : 0 }
  }, [policies, month, profile?.monthly_ap_goal])

  const greeting = (() => {
    const h = clock.getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  })()

  const firstName = profile?.full_name?.split(' ')[0] || 'there'

  // Split "2:45:30 PM" into the digits and the AM/PM suffix (Prompt 350) so
  // AM/PM can render at roughly half the digit size — same treatment for
  // both, this isn't an AM-vs-PM styling difference.
  const clockStr = clock.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
  const [, clockDigits, clockAmPm] = clockStr.match(/^(.*?)\s*([AP]M)$/i) || [null, clockStr, '']

  const row1 = [
    {
      label: 'Submitted AP — Today', icon: FileText,
      value: isLoading ? '—' : money(k.submittedTodayAP),
      sub: `${k.submittedTodayCount} app${k.submittedTodayCount === 1 ? '' : 's'} submitted today`,
      subColor: 'var(--text-muted)',
    },
    {
      // Prompt 344: was "Policies Active — This Month" (same cohort as the
      // "Active AP" tile that used to sit to its left, just count vs.
      // dollars — a real duplicate). Replaced with a distinct monthly
      // submissions count, the natural companion to "Submitted AP — Today"
      // above. Prompt 347 swapped this tile ahead of Active AP.
      label: 'Policies Submitted — This Month', icon: FileText,
      value: isLoading ? '—' : String(k.submittedMonthCount),
      sub: 'Submitted this month', subColor: 'var(--text-muted)',
    },
    {
      label: 'Active AP — This Month', icon: TrendingUp,
      value: isLoading ? '—' : money(k.activeMonthAP),
      sub: `${k.activeMonthCount} polic${k.activeMonthCount === 1 ? 'y' : 'ies'} went active this month`,
      subColor: 'var(--text-muted)',
    },
    {
      label: 'Average Premium — This Month', icon: DollarSign,
      value: isLoading || !k.avgPremium ? '—' : `${money(k.avgPremium)}/mo`,
      sub: "Avg. across this month's new policies", subColor: 'var(--text-muted)',
    },
  ]

  // Calls happen on the agent's own phone today — no in-app call data exists,
  // so these read as unavailable rather than as a zero.
  const row2 = [
    { label: 'Calls Taken — Today', icon: Phone, value: '—', sub: 'Not tracked in-app yet', subColor: 'var(--text-muted)' },
    { label: 'Close Rate — Today', icon: Target, value: '—', sub: 'Needs call tracking', subColor: 'var(--text-muted)' },
    { label: 'Calls Taken — This Month', icon: Phone, value: '—', sub: 'Not tracked in-app yet', subColor: 'var(--text-muted)' },
    { label: 'Close Rate — This Month', icon: Target, value: '—', sub: 'Needs call tracking', subColor: 'var(--text-muted)' },
  ]

  return (
    <div style={{ maxWidth: 1280 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 26, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, fontSize: 21, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            {greeting}, {firstName}
          </p>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Here's where things stand before your first call.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            {clock.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </span>
          <div style={{
            background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '9px 16px', whiteSpace: 'nowrap',
          }}>
            <span style={{
              display: 'inline-block',
              fontSize: CLOCK_DIGIT_SIZE, fontWeight: 700, letterSpacing: '0.02em', lineHeight: 1, color: '#fff',
              fontFamily: CLOCK_FONT, fontVariantNumeric: CLOCK_NUMERIC_VARIANT,
            }}>
              {renderClockDigits(clockDigits)}
              {clockAmPm && (
                <span style={{ fontSize: CLOCK_AMPM_SIZE, marginLeft: 3 }}>{clockAmPm}</span>
              )}
            </span>
          </div>
        </div>
      </div>

      <div style={{
        background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
        borderRadius: 8, padding: '28px 32px', marginBottom: 20,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Today at a glance</span>
        <KpiRow items={row1} style={{ marginTop: 22 }} />
        <KpiRow
          items={row2}
          style={{ marginTop: 26, paddingTop: 22, borderTop: 'var(--border-w) solid var(--border)' }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: 20, marginTop: 20 }}>
        {/* Needs your attention — real pipeline-state worklist. Prompt 347:
            dropped the "View my policies" CTA (doesn't fit every row type
            now that follow-ups/cancellation calls share the feed with
            policy rows) and capped the box at 5 visible rows with an
            internal scroll — the header stays pinned, only data rows
            scroll, so the card's footprint never grows past a 5-row feed
            regardless of real backlog size. Prompt 354: split widened from
            an even 1fr/1fr to 1.8fr/1fr (~64/36) — "Monthly goal" is just a
            number + progress bar and doesn't need half the row, while this
            card's Name/Detail columns were genuinely ellipsis-truncating at
            common laptop widths. */}
        <div style={{
          background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 8,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 22px', borderBottom: 'var(--border-w) solid var(--border)', flexShrink: 0,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Needs your attention</span>
          </div>

          {/* Prompt 344: Policy # column dropped — anyone acting on a row
              clicks through to My Policies anyway, so it was dead weight
              here. Row/type sizing also trimmed down a notch so this block
              reads lighter than the amount of info in it warrants. */}
          <div style={{
            ...ATTENTION_COLUMNS,
            padding: '9px 22px', borderBottom: 'var(--border-w) solid var(--border)', flexShrink: 0,
          }}>
            {['Type', 'Name', 'Detail'].map(h => (
              <span key={h} style={{
                fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'var(--text-secondary)',
              }}>
                {h}
              </span>
            ))}
          </div>

          <div style={{ maxHeight: ATTENTION_ROW_H * 5, overflowY: 'auto' }}>
            {attention.length === 0 ? (
              <div style={{ padding: '18px 22px', fontSize: 13, color: 'var(--text-muted)' }}>
                {isLoading ? 'Loading…' : 'Nothing needs attention right now.'}
              </div>
            ) : attention.map((a, i) => (
              <div
                key={a.id}
                style={{
                  ...ATTENTION_COLUMNS,
                  alignItems: 'center', padding: '11px 22px', height: ATTENTION_ROW_H, boxSizing: 'border-box',
                  borderBottom: i < attention.length - 1 ? 'var(--border-w) solid var(--border)' : 'none',
                }}
              >
                <span style={{
                  // justifySelf: without it this grid item stretches to fill
                  // the full 150px Type column (Prompt 346) — reads as the
                  // pill having way more padding than its text needs, when
                  // really the pill itself was oversized.
                  display: 'inline-flex', alignItems: 'center', alignSelf: 'start', justifySelf: 'start',
                  padding: '2px 7px', borderRadius: 4, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
                  background: a.dim, color: a.color, border: `var(--border-w) solid ${a.bd}`,
                }}>
                  {a.tag}
                </span>
                <span style={{ ...ATTENTION_CLIP, fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{a.name}</span>
                <span style={{ ...ATTENTION_CLIP, fontSize: 13, color: 'var(--text-secondary)' }}>{a.detail}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly goal progress */}
        <div style={{
          background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 8,
          padding: '20px 24px',
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Monthly goal</span>
          <p style={{ margin: '4px 0 20px', fontSize: 11, color: 'var(--text-muted)' }}>
            Submitted AP this month vs. your target · set it on your Profile page
          </p>
          <div style={{
            fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-primary)',
            fontFamily: MONO, fontVariantNumeric: 'tabular-nums', marginBottom: 12,
          }}>
            {isLoading ? '—' : moneyShort(goal.submittedAP)}
            <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}> of {moneyShort(goal.target)}</span>
          </div>
          <div style={{ height: 10, borderRadius: 5, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 5,
              background: goal.pct >= 100 ? 'var(--success)' : 'var(--accent)',
              width: `${isLoading ? 0 : goal.pct}%`, transition: 'width 300ms ease-out',
            }} />
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
            {isLoading ? '—' : `${goal.pct}% of goal`}
          </p>
        </div>
      </div>
    </div>
  )
}

// Four columns, hairline dividers between them, no gap — the export's own
// KPI grid, used for both rows.
function KpiRow({ items, style }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 0, ...style }}>
      {items.map((k, i) => (
        <div
          key={k.label}
          style={{
            minWidth: 0,
            padding: `0 32px 0 ${i === 0 ? '0' : '32px'}`,
            borderRight: i % 4 !== 3 ? 'var(--border-w) solid var(--border)' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, minHeight: 28 }}>
            <k.icon size={12} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'var(--text-secondary)', lineHeight: 1.4,
            }}>
              {k.label}
            </span>
          </div>
          <div style={{
            fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1,
            color: 'var(--text-primary)', fontFamily: MONO, fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap', overflowWrap: 'anywhere',
          }}>
            {k.value}
          </div>
          <p style={{ margin: '11px 0 0', fontSize: 11.5, color: k.subColor }}>{k.sub}</p>
        </div>
      ))}
    </div>
  )
}
