import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Headphones, Clock, Mail, TriangleAlert, Wallet, ChevronRight } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useFulfillmentQueue } from '../../../hooks/usePolicies'
import { useCallOutcomes } from '../../../hooks/useRepCallEvents'
import { usePayouts } from '../../../hooks/useFulfillmentPayouts'
import { useAllProfiles, usePendingInvites } from '../../../hooks/useProfiles'
import { useRecoveryConfig } from '../../../hooks/useRecoveryConfig'
import { isLive, useNow } from '../../../lib/agentBookings'
import { flagsFor } from '../../../lib/fulfillmentFlags'
import { deskDay } from '../../../lib/adminDesk'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../../../lib/timezones'
import { weekFrame, buildCalls, adminWeek } from '../../../lib/fulfillmentDay'
import { money } from '../../../lib/adminPayouts'
import { roleLabel } from '../../../lib/roleLabels'
import { phoneText } from '../../../lib/policyFormat'
import { NotificationBell } from '../../notifications/NotificationBell'
import { Avatar } from '../../ui/Avatar'
import { LoadError } from '../../agent/AgentUI'
import { ListenSheet } from './ListenSheet'
import { PhoneToast } from './PhoneToast'
import { useAdminPay } from './useAdminPay'

// Prompt 774 — the admin's Home on a phone (mockup AdmHome.dc.html): date
// chip, bell (full screen), avatar → More; the greeting and how many things
// need you (amber ones only); Needs you, from the desktop Overview's sources
// plus cancels that need a listen (straight to the Listen sheet); the desk
// right now (who's live, to call / done / past time, from the desk's rules);
// and this week (booked, cancelled, cancel rate, a 7-day paired bar chart,
// the Overview's own numbers).

const TONE = {
  warn: ['var(--ov-st-needs)', 'var(--ov-st-needs-tint)'],
  info: ['var(--ov-data-a)', 'var(--ov-data-a-tint)'],
  mute: ['var(--ov-mute)', 'var(--ph-tile-bg)'],
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
function ago(iso, nowMs) {
  const d = Math.floor((nowMs - new Date(iso).getTime()) / 864e5)
  return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`
}
const fmtDay = (d, o) => d.toLocaleDateString('en-US', { ...o, timeZone: 'UTC' })

function WeekChart({ days, todayIdx }) {
  const top = Math.max(1, ...days.map(d => Math.max(d.booked, d.cancelled)))
  const h = v => (v ? Math.max(3, Math.round((v / top) * 52)) : 3)
  return (
    <div className="aph-week" role="img" aria-label={`This week day by day: ${days.map(d => `${d.booked} booked, ${d.cancelled} cancelled`).join('; ')}`}>
      {days.map((d, i) => (
        <span key={i} className="aph-wday" style={{ opacity: i > todayIdx ? 0.4 : 1 }}>
          <span className="aph-wbars">
            <span style={{ height: h(d.booked), background: 'var(--ov-st-booked)' }} />
            <span style={{ height: h(d.cancelled), background: 'var(--ov-st-cancelled)' }} />
          </span>
          <span className={`aph-wl${i === todayIdx ? ' is-today' : ''}`}>{i === todayIdx ? 'Today' : fmtDay(d.date, { weekday: 'narrow' })}</span>
        </span>
      ))}
    </div>
  )
}

export function AdminPhoneHome() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const now = useNow(30e3)
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const [listenId, setListenId] = useState(null)
  const [toast, setToast] = useState(null)

  const queueQ = useFulfillmentQueue()
  const { data: queue = [], isLoading: queueLoading } = queueQ
  const { data: profiles = [] } = useAllProfiles()
  const anyLive = queue.some(isLive)
  const todayStr = zonedDateStr(now, tz)
  const frame = useMemo(() => weekFrame(todayStr, tz), [todayStr, tz])
  const eventsQ = useCallOutcomes(
    new Date(frame.sinceMs).toISOString(), new Date(frame.bounds[14]).toISOString(), { live: anyLive },
  )
  const { data: events = [], isLoading: eventsLoading } = eventsQ
  const payQ = usePayouts(null)
  const { data: payouts = [], isLoading: payLoading } = payQ
  const invitesQ = usePendingInvites()
  const { data: invites = [], isLoading: invitesLoading } = invitesQ
  const configQ = useRecoveryConfig()
  const { data: config, isLoading: configLoading } = configQ
  const pay = useAdminPay()
  // P780 — a failed load says so instead of "Nothing needs you" and zeros.
  const broken = q => q.isError && !q.data
  const chartFailed = broken(queueQ) || broken(eventsQ)
  const needsFailed = chartFailed || [payQ, invitesQ, configQ].some(broken) || !!pay.error || !!pay.listenError
  const retry = () => { [queueQ, eventsQ, payQ, invitesQ, configQ].forEach(q => broken(q) && q.refetch()); if (pay.error || pay.listenError) pay.refetch() }

  const repById = useMemo(() => new Map(profiles.filter(r => r.role === 'fulfillment').map(r => [r.id, r])), [profiles])
  const week = useMemo(() => adminWeek(
    frame, buildCalls(queue, now, tz, { from: frame.dates[0], to: frame.dates[13], events }),
  ), [frame, queue, events, now, tz])
  const today = useMemo(() => deskDay(queue, now, tz, todayStr, events, repById), [queue, now, tz, todayStr, events, repById])
  const chartLoading = queueLoading || eventsLoading || !profile || chartFailed
  const needsLoading = queueLoading || payLoading || invitesLoading || configLoading || pay.loading || !profile || needsFailed

  const listen = pay.model.listen
  const needs = useMemo(() => {
    const out = []
    if (listen.length) {
      const c = listen[0]
      out.push({
        key: 'listen', tone: 'warn', icon: Headphones, hot: true, go: () => setListenId(c.id),
        title: `${plural(listen.length, 'cancel')} ${listen.length === 1 ? 'needs' : 'need'} a listen`,
        sub: listen.length === 1 ? <>{[c.client_name || 'Client', c.carrier_name].filter(Boolean).join(' · ')} · <span className="ph-mono">{money(c.amount_cents)}</span></>
          : `Oldest: ${[c.client_name || 'Client', c.carrier_name].filter(Boolean).join(' · ')}`,
      })
    }
    const owed = payouts.filter(p => p.status === 'failed' && p.amount_cents > 0)
    if (owed.length) {
      out.push({
        key: 'pay', tone: 'warn', icon: Wallet, hot: true, go: () => navigate('/admin/payouts'),
        title: 'Pay that didn’t go out',
        sub: <>{owed.length === 1 ? '1 person' : `${owed.length} people`} · <span className="ph-mono">{money(owed.reduce((s, p) => s + p.amount_cents, 0))}</span></>,
      })
    }
    const nowDate = new Date(now)
    const late = queue.filter(p => flagsFor(p, nowDate).overdue)
    if (late.length) {
      const names = [...new Set(late.map(p => p.assigned?.full_name || repById.get(p.assigned_fulfillment_id)?.full_name).filter(Boolean))]
      // P780 — the desk shows today only; calls missed on an earlier day are on the Pipeline.
      const older = late.some(p => zonedDateStr(new Date(p.scheduled_call_at).getTime(), tz) < todayStr)
      out.push({
        key: 'late', tone: 'warn', icon: Clock, hot: true, go: () => navigate(older ? '/admin/pipeline' : '/admin/fulfillment'),
        title: `${plural(late.length, 'call')} past their time`,
        sub: `Not started · ${names.length ? names.join(', ') : 'Not given to anyone'}`,
      })
    }
    if (invites.length) {
      const oldest = invites[invites.length - 1]
      const to = oldest.invited_email || (oldest.invited_phone ? phoneText(oldest.invited_phone) : null)
      out.push({
        key: 'invites', tone: 'info', icon: Mail, go: () => navigate(`/admin/users${oldest.role === 'fulfillment' ? '?role=fulfillment' : ''}`),
        title: `${plural(invites.length, 'invite')} not accepted`,
        sub: invites.length === 1 ? `${to || roleLabel(oldest.role)} · sent ${ago(oldest.created_at, now)}` : `Oldest sent ${ago(oldest.created_at, now)}`,
      })
    }
    // P784 (dry-run F3): one row each, like desktop Home, so both count the same.
    if (config && !config.voice_live) {
      out.push({ key: 'voice', tone: 'mute', icon: TriangleAlert, go: () => navigate('/settings#contact'), title: 'Calling isn’t live yet', sub: 'Switch it on in Settings' })
    }
    if (config && !config.sms_live) {
      out.push({ key: 'sms', tone: 'mute', icon: TriangleAlert, go: () => navigate('/settings#contact'), title: 'Texting isn’t live yet', sub: 'Switch it on in Settings' })
    }
    return out
  }, [listen, payouts, queue, invites, config, now, repById, navigate, tz, todayStr])
  // P784: every row counts, the same as desktop Home (it said 1 above 2 rows).
  const hot = needs.length

  const firstName = (profile?.full_name || '').split(' ')[0]
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now))
  const greeting = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}${firstName ? `, ${firstName}` : ''}`
  const chip = new Date(now).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' })
  const sub = needsFailed ? 'Couldn’t check what needs you.' : needsLoading ? 'Checking what needs you…'
    : hot ? `${hot} ${hot === 1 ? 'thing needs' : 'things need'} you today.` : 'Nothing needs you today.'

  const lives = today.filter(c => c.k === 'live')
  const deskNums = [
    ['To call', today.filter(c => c.k === 'bk').length, 'bk'],
    ['Done', today.filter(c => c.k === 'cx' || c.k === 'na').length, 'done'],
    ['Past time', today.filter(c => c.k === 'stuck').length, 'stuck'],
  ]
  const weekNums = [
    ['Booked', week.booked.value, 'var(--ov-st-booked)'],
    ['Cancelled', week.cancelled.value, 'var(--ov-st-cancelled)'],
    ['Cancel rate', week.rate == null ? '—' : `${week.rate}%`, 'var(--ov-mid)'],
  ]
  const range = week.days.length ? `${fmtDay(week.days[0].date, { month: 'short', day: 'numeric' })} – ${fmtDay(week.days[6].date, { day: 'numeric' })}` : ''
  const listenCard = listenId ? listen.find(c => c.id === listenId) || null : null

  return (
    <div className="ph-stack">
      <div className="ph-top">
        <span className="ph-chip"><span className="ph-chip-dot" aria-hidden="true" />{chip}</span>
        <span style={{ flex: 1 }} />
        {profile?.id && <NotificationBell profileId={profile.id} full />}
        <button type="button" className="ph-avatar" onClick={() => navigate('/admin/more')} aria-label="Your account">
          <Avatar profile={profile} size={44} />
        </button>
      </div>

      <div>
        <h1 className="ph-h1" style={{ fontSize: 31, letterSpacing: '-0.035em' }}>{greeting}</h1>
        <p style={{ margin: '6px 0 0', fontSize: 15, color: 'var(--ov-soft)' }}>{sub}</p>
      </div>

      <section aria-label="Needs you">
        <div className="ph-sechead" style={{ marginBottom: 10 }}>
          <h2 className="ph-h2">Needs you</h2>
          {!needsLoading && hot > 0 && <span className="ph-count">{hot}</span>}
        </div>
        <div className="ov-card ph-card">
          {needsFailed ? <LoadError what="what needs you" onRetry={retry} style={{ margin: 12 }} />
            : needsLoading ? <div className="ph-empty">Checking…</div>
            : !needs.length ? <div className="ph-empty">Nothing needs you right now.</div>
              : needs.map(n => {
                const [color, tint] = TONE[n.tone]
                const Icon = n.icon
                return (
                  <button key={n.key} type="button" className={`ph-row aph-need${n.hot ? ' is-hot' : ''}`} onClick={n.go}>
                    <span className="ph-tile" style={{ background: tint, color }}><Icon size={18} strokeWidth={2} aria-hidden="true" /></span>
                    <span className="ph-row-main">
                      <span className="ph-row-title">{n.title}</span>
                      <span className="ph-row-sub">{n.sub}</span>
                    </span>
                    <ChevronRight size={16} strokeWidth={2.2} className="ph-chev" aria-hidden="true" />
                  </button>
                )
              })}
        </div>
      </section>

      <button type="button" className="ov-hero aph-deskcard" onClick={() => navigate('/admin/fulfillment')}>
        <span className="aph-cardhead"><span className="aph-cardtitle">The desk right now</span><span className="aph-open">Open</span></span>
        {lives.length > 0 && (
          <span className="aph-liveline">
            <span className="aph-livedot" aria-hidden="true" />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lives[0].ownerName} is on a call{lives.length > 1 ? ` · +${lives.length - 1} more` : ''}
            </span>
            <span className="ph-mono aph-livemin">{Math.max(0, Math.floor((now - new Date(lives[0].p.call_live_since || lives[0].at).getTime()) / 6e4))} min</span>
          </span>
        )}
        <span className="aph-three">
          {deskNums.map(([l, v, k]) => (
            <span key={l}><span className={`aph-three-l is-${k}`}>{l}</span><span className="aph-three-n">{chartLoading ? '—' : v}</span></span>
          ))}
        </span>
      </button>

      <section className="ov-card aph-weekcard" aria-label="This week">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <span className="aph-cardtitle">This week</span><span className="ph-mute">{range}</span>
        </div>
        <span className="aph-three">
          {weekNums.map(([l, v, c]) => (
            <span key={l}><span className="aph-three-l" style={{ color: c }}>{l}</span><span className="aph-three-n">{chartLoading ? '—' : v}</span></span>
          ))}
        </span>
        <WeekChart days={week.days} todayIdx={frame.todayIdx} />
      </section>

      {listenCard && (
        <ListenSheet c={listenCard} rep={profiles.find(p => p.id === listenCard.rep_id)} tz={tz} onClose={() => setListenId(null)}
          onDecided={paid => { setListenId(null); setToast(paid ? `Marked paid · ${money(listenCard.amount_cents)}` : 'Marked not paid') }} />
      )}
      <PhoneToast text={toast} onDone={() => setToast(null)} />
    </div>
  )
}
