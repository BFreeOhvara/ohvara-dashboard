import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Phone, ChevronRight, ArrowRight, Zap, CalendarDays, CalendarClock, Info, Inbox, MessageSquare } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useInbounds, useInboundEvents, useMembershipTier, useWaitingTexts } from '../../hooks/useInbounds'
import { useAgentDuty } from '../../hooks/useAgentDuty'
import { dutySince } from '../../lib/duty'
import { AttentionCard, ComingUpCard, IconChip, LoadError } from './AgentUI'
import {
  stageOf, leadName, phoneDisplay, telHref, appointmentAt, timeText, clockParts, untilWords, sameDay, dateText,
  isRecent, cameInAt, nextLine, whenText, PRODUCT_LABEL, PRODUCT_SHORT, LIVE_RESULT,
} from '../../lib/inbounds'
import { DEFAULT_TIMEZONE } from '../../lib/timezones'
import './todayCards.css'

// Portal parity T3: Today's cards (v2 Today, /agent) inside the old Overview, in its card
// language (.ov-card, .ov-link rows, the v16 type scale). The old hero stays the only hero,
// so Next appointment is a card (answer 3). Texts waiting folds into the Overview's amber
// attention box (answer 4, AttentionWithTexts below); `showTexts` draws it as its own card
// where there is no such box (the phone Home, the old Today page). The greeting and the
// "No texts waiting / all caught up" card are left out: the Overview already shows both.
// Each card loads and fails on its own.

const lead = id => `/agent/inbounds/${id}`
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const Pill = ({ tone, children }) => <span className={`tc-pill tc-p-${tone}`}>{children}</span>
const Skel = ({ w, h, style }) => <span className="tc-skel" style={{ width: w, height: h, ...style }} />

function Head({ icon, title, sub, right }) {
  return (
    <div className="tc-head">
      {icon && <IconChip icon={icon} color="var(--ov-st-booked)" tint="var(--ov-st-booked-tint)" />}
      <div className="tc-grow">
        <h2 className="tc-title">{title}</h2>
        {sub && <p className="tc-sub">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

function Note({ icon: Icon, children }) {
  return <p className="tc-note"><Icon size={14} strokeWidth={2} aria-hidden="true" /><span>{children}</span></p>
}

// Today's shared data: inbounds, their events, and the clock the cards read.
function useToday() {
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const inb = useInbounds()
  const ev = useInboundEvents()
  const now = useMemo(() => new Date(), [inb.dataUpdatedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const evMap = useMemo(() => ev.data || new Map(), [ev.data])
  const list = useMemo(() => inb.data || [], [inb.data])
  const appts = useMemo(() => list
    .map(l => ({ l, at: appointmentAt(evMap.get(l.lead_id)) }))
    .filter(a => a.at && a.l.inbound_stage !== 'lost')
    .sort((a, b) => new Date(a.at) - new Date(b.at)), [list, evMap])
  return { tz, inb, now, evMap, list, appts }
}

// Replies nobody has handled yet, as rows for the attention box: { id, name, body, when, to }.
function useTextsWaiting() {
  const { tz, inb, now } = useToday()
  const texts = useWaitingTexts()
  const rows = useMemo(() => {
    const byId = new Map((inb.data || []).map(l => [l.lead_id, l]))
    return (texts.data || []).filter(t => byId.has(t.lead_id)).map(t => ({
      id: t.id,
      name: leadName(byId.get(t.lead_id)),
      body: t.body,
      when: sameDay(t.received_at, now, tz) ? timeText(t.received_at, tz) : whenText(t.received_at, tz, now.getTime()),
      to: lead(t.lead_id),
    }))
  }, [inb.data, texts.data, now, tz])
  return { rows, isLoading: inb.isLoading || texts.isLoading, isError: inb.isError || texts.isError, refetch: () => { inb.refetch(); texts.refetch() } }
}

// The Overview's side box with Today's Texts waiting folded in: amber while a client or a
// text needs the agent, otherwise the calm "You're all caught up" box.
export function AttentionWithTexts({ items, loading, upcoming, now, onGo, fit }) {
  const { rows } = useTextsWaiting()
  return loading || items.length > 0 || rows.length > 0
    ? <AttentionCard items={items} loading={loading} onGo={onGo} texts={loading ? [] : rows} fit={fit} />
    : <ComingUpCard upcoming={upcoming} now={now} onGo={onGo} fit={fit} />
}

function NextAppointment({ appts, now, tz, evMap, loading, failed, onRetry }) {
  const next = appts.find(a => a.l.inbound_stage === 'booked' && new Date(a.at) >= now)
  if (loading) {
    return (
      <section className="ov-card tc-card tc-a-next" aria-label="Next appointment" aria-busy="true">
        <Head icon={CalendarClock} title="Next appointment" />
        <Skel w={170} h={48} style={{ margin: '18px 0 12px' }} /><Skel w="60%" h={14} />
      </section>
    )
  }
  if (failed) {
    return (
      <section className="ov-card tc-card tc-a-next" aria-label="Next appointment">
        <Head icon={CalendarClock} title="Next appointment" />
        <LoadError what="your appointments" onRetry={onRetry} style={{ marginTop: 14 }} />
      </section>
    )
  }
  if (!next) {
    return (
      <section className="ov-card tc-card tc-a-next" aria-label="Next appointment">
        <Head icon={CalendarClock} title="Next appointment" />
        <p className="tc-empty-big">Nothing booked today</p>
        <p className="tc-sub">When our VA books someone with you, it shows here with a reminder of when to call.</p>
      </section>
    )
  }
  const { l, at } = next
  const evs = evMap.get(l.lead_id) || []
  const bookedOn = evs.find(e => e.kind === 'booked' && e.state === 'done')
  const reminder = evs.filter(e => e.kind === 'reminder' && e.state === 'done' && sameDay(e.at, now, tz))
    .sort((a, b) => new Date(b.at) - new Date(a.at))[0]
  const [clock, ampm] = clockParts(at, tz)
  const num = phoneDisplay(l.phone)
  const call = telHref(l.phone)
  const later = appts.filter(a => a !== next && sameDay(a.at, now, tz))
  return (
    <section className="ov-card tc-card tc-a-next" aria-label="Next appointment">
      <Head icon={CalendarClock} title="Next appointment" right={<span className="tc-chip">{untilWords(at, tz, now.getTime())}</span>} />
      <div className="tc-clock"><b>{clock}</b><span>{ampm}</span></div>
      <p className="tc-name">{leadName(l)}</p>
      <p className="tc-sub">
        {PRODUCT_LABEL[l.inbound_product] || 'Inbound'}
        {bookedOn ? ` · Our VA booked this on ${dateText(bookedOn.at, tz)}.` : ''}
        {reminder ? ` Reminder text went out at ${timeText(reminder.at, tz)}.` : ''}
      </p>
      <div className="tc-acts">
        {call && num && <a className="ov-primary tc-btn" href={call}><Phone size={16} strokeWidth={2.1} aria-hidden="true" />Call {num}</a>}
        <Link className="ov-ghost tc-btn" to={lead(l.lead_id)}>Open inbound<ChevronRight size={15} strokeWidth={2.1} aria-hidden="true" /></Link>
      </div>
      {later.length > 0 && (
        <div className="tc-later">
          <p>Later today</p>
          <div>
            {later.map(a => (
              <span key={a.l.lead_id} className="tc-chip">
                {new Date(a.at) < now ? 'Done: ' : ''}{timeText(a.at, tz)} &middot; {leadName(a.l)}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function DutyCard({ tz }) {
  const { on, since, soon, loading, failed, saveFailed, toggle } = useAgentDuty()
  const live = !loading && !soon && !failed
  return (
    <section className="ov-card tc-card tc-a-duty" aria-label="Live call transfers">
      <Head
        icon={Zap} title="Live call transfers"
        sub={loading ? 'Checking…' : soon ? 'Coming soon' : failed ? "Couldn't check right now"
          : on ? (since ? `Active since ${dutySince(since, new Date(), tz)}` : "You're active") : "You're not active"}
        right={(
          <button type="button" className={`tc-sw${on ? ' on' : ''}`} role="switch" aria-checked={on} disabled={!live}
            aria-label={soon ? 'Active for live call transfers (coming soon)' : 'Active for live call transfers'}
            onClick={() => toggle(!on)}><i /></button>
        )}
      />
      <p className="tc-body">
        {soon
          ? 'Soon you can turn this on to take callers live the moment our VA checks the fit. Until then, every live call is booked on your calendar.'
          : "While you're active, our VA sends callers straight to you. When you're not, we book them on your calendar instead."}
      </p>
      {saveFailed && <p className="tc-err" role="alert">Couldn&rsquo;t save that. Try again.</p>}
    </section>
  )
}

function PlanCard({ used, tz, now, loading }) {
  const { data: tier, isLoading, isError, refetch } = useMembershipTier()
  const total = tier?.monthly_appointments
  const has = Number.isInteger(total) && total > 0
  const left = has ? Math.max(0, total - used) : null
  const resets = new Date(new Date(`${new Date(now).toLocaleDateString('en-CA', { timeZone: tz })}T12:00:00Z`))
  resets.setUTCMonth(resets.getUTCMonth() + 1, 1)
  const segs = has ? Math.min(total, 12) : 0
  const usedSegs = has ? Math.min(segs, Math.round((Math.min(used, total) / total) * segs)) : 0
  return (
    <section className="ov-card tc-card tc-a-plan" aria-label="Plan usage">
      <Head icon={CalendarDays} title="Appointments left this month" sub={has ? `Your plan includes ${total} a month` : 'Your plan'} />
      {isLoading || loading ? <Skel w={90} h={44} style={{ marginTop: 16 }} />
        : isError ? <LoadError what="your plan" onRetry={() => refetch()} style={{ marginTop: 14 }} />
          : has ? (
            <>
              <div className="tc-meter-num"><b>{left}</b><span>of {total} left</span></div>
              <div className="tc-segs" role="img" aria-label={`${Math.min(used, total)} of ${total} used`}>
                {Array.from({ length: segs }, (_, i) => <i key={i} className={i < usedSegs ? 'used' : undefined} />)}
              </div>
              <div className="tc-meter-foot">
                <span>{left === 0 ? `All ${total} used` : `${used} used`}</span>
                <span>Resets {resets.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
              </div>
            </>
          ) : (
            <>
              <div className="tc-meter-num"><b>&mdash;</b></div>
              <Note icon={Info}>This shows once your plan includes appointments.</Note>
            </>
          )}
    </section>
  )
}

function ApptRow({ a, now, tz, evMap }) {
  const { l, at } = a
  const [clock, ampm] = clockParts(at, tz)
  const past = new Date(at) < now
  const stage = stageOf(l)
  const reminder = (evMap.get(l.lead_id) || []).filter(e => e.kind === 'reminder' && e.state === 'done')
    .sort((x, y) => new Date(y.at) - new Date(x.at))[0]
  const sub = l.inbound_stage === 'met' ? `Met at ${timeText(at, tz)} · outcome not marked yet`
    : past ? `${stage.label} · ${timeText(at, tz)}`
    : `${l.inbound_product === 'live_call' ? 'Live call · ' : ''}${untilWords(at, tz, now.getTime())}${reminder ? ` · reminder sent ${timeText(reminder.at, tz)}` : ''}`
  return (
    <Link className="tc-row" to={lead(l.lead_id)}>
      <span className={`tc-ttile${past ? ' past' : ''}`}><b>{clock}</b><span>{ampm}</span></span>
      <div className="tc-grow"><h3>{leadName(l)}</h3><p className="tc-sub">{sub}</p></div>
      <Pill tone={stage.pill}>{stage.label}</Pill>
      <ChevronRight size={16} strokeWidth={2.2} className="tc-chev" aria-hidden="true" />
    </Link>
  )
}

function inboundLine(l, evs, tz, now) {
  const came = sameDay(cameInAt(l), now, tz) ? timeText(cameInAt(l), tz) : whenText(cameInAt(l), tz, now.getTime()).replace(/^./, c => c.toLowerCase())
  const base = `${PRODUCT_SHORT[l.inbound_product] || 'Inbound'} · came in ${came}`
  if (l.inbound_product === 'live_call' && l.live_call_result) {
    const r = LIVE_RESULT[l.live_call_result]
    return l.live_call_result === 'transferred' && l.transferred_at
      ? `Live call · transferred to you at ${timeText(l.transferred_at, tz)}`
      : `${base} · ${r.label.toLowerCase()}`
  }
  return `${base} · ${nextLine(l, evs, tz, now.getTime()).text.replace(/^./, c => c.toLowerCase())}`
}

// Texts waiting as its own card, for pages without the Overview's attention box.
function TextsCard() {
  const { rows, isLoading, isError, refetch } = useTextsWaiting()
  if (isError) {
    return (
      <section className="ov-card tc-card tc-a-texts" aria-label="Texts waiting">
        <Head icon={MessageSquare} title="Texts waiting" />
        <LoadError what="your texts" onRetry={refetch} style={{ marginTop: 14 }} />
      </section>
    )
  }
  if (isLoading || rows.length === 0) return null
  return (
    <section className="ov-card tc-card tc-a-texts" aria-label="Texts waiting">
      <Head icon={MessageSquare} title="Texts waiting" sub="Replies from your inbounds" right={<span className="tc-count">{rows.length}</span>} />
      <div className="tc-rows">
        {rows.slice(0, 5).map(t => (
          <Link key={t.id} className="tc-row tc-trow" to={t.to}>
            <div className="tc-grow"><h3>{t.name}</h3><q>{t.body}</q></div>
            <time>{t.when}</time>
          </Link>
        ))}
      </div>
      <Note icon={Info}>Texting from the portal is coming soon. Open one to read it, then call them back.</Note>
    </section>
  )
}

// Booked appointments that came in this month (the plan meter's "used").
function usedThisMonth(list, now, tz) {
  const monthKey = now.toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 7)
  return list.filter(l => l.inbound_product === 'booked_appointment' && ['booked', 'met', 'sold', 'follow_up'].includes(l.inbound_stage)
    && new Date(cameInAt(l)).toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 7) === monthKey).length
}

// The Overview on a 1280x700+ screen (fit mode) has no room for the five cards, so it shows this one slim row:
// Next appointment, the Live call transfers switch and Appointments left, from the same hooks as the cards.
// Today's appointments lives on the Calendar and New inbounds in Activity (each row there opens its inbound);
// the two links carry the counts. Under 1280x700 and on phones the five cards are shown as before.
export function TodayStrip() {
  const { tz, inb, now, list, appts } = useToday()
  const { on, since, soon, loading: dutyLoading, failed: dutyFailed, toggle } = useAgentDuty()
  const { data: tier, isLoading: tierLoading, isError: tierFailed } = useMembershipTier()
  const loading = inb.isLoading
  const failed = inb.isError
  const next = appts.find(a => a.l.inbound_stage === 'booked' && new Date(a.at) >= now)
  const todayCount = appts.filter(a => sameDay(a.at, now, tz)).length
  const recentCount = list.filter(l => isRecent(l, tz, now.getTime())).length
  const total = tier?.monthly_appointments
  const has = Number.isInteger(total) && total > 0
  const left = has ? Math.max(0, total - usedThisMonth(list, now, tz)) : null
  const dutyLive = !dutyLoading && !soon && !dutyFailed

  return (
    <section className="ov-card tcs" aria-label="Today">
      <div className="tcs-seg tcs-next">
        <span className="tcs-tile"><CalendarClock size={16} strokeWidth={2} aria-hidden="true" /></span>
        <div className="tcs-t">
          <b>Next appointment</b>
          <span>{loading ? '—' : failed ? 'Couldn’t load your appointments' : next ? `${timeText(next.at, tz)} · ${leadName(next.l)}` : 'Nothing booked today'}</span>
        </div>
        {next && !loading && !failed && <span className="tc-chip tcs-chip">{untilWords(next.at, tz, now.getTime())}</span>}
      </div>

      <div className="tcs-seg tcs-duty">
        <span className="tcs-tile"><Zap size={16} strokeWidth={2} aria-hidden="true" /></span>
        <div className="tcs-t">
          <b>Live call transfers</b>
          <span>{dutyLoading ? 'Checking…' : soon ? 'Coming soon' : dutyFailed ? 'Couldn’t check right now'
            : on ? (since ? `Active since ${dutySince(since, new Date(), tz)}` : 'You’re active') : 'You’re not active'}</span>
        </div>
        <button type="button" className={`tc-sw${on ? ' on' : ''}`} role="switch" aria-checked={on} disabled={!dutyLive}
          aria-label={soon ? 'Active for live call transfers (coming soon)' : 'Active for live call transfers'}
          onClick={() => toggle(!on)}><i /></button>
      </div>

      <div className="tcs-seg tcs-plan">
        <span className="tcs-tile"><CalendarDays size={16} strokeWidth={2} aria-hidden="true" /></span>
        <div className="tcs-t">
          <b>{tierLoading || loading || tierFailed || !has ? '—' : `${left} of ${total} left`}</b>
          <span>Appointments this month</span>
        </div>
      </div>

      <div className="tcs-links">
        <Link className="ov-ghost" to="/agent/calendar">Today’s appointments{!loading && !failed && <b>{todayCount}</b>}<ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" /></Link>
        <Link className="ov-ghost" to="/agent/activity">New inbounds{!loading && !failed && <b>{recentCount}</b>}<ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" /></Link>
      </div>
    </section>
  )
}

export function TodayCards({ showTexts = false }) {
  const { tz, inb, now, evMap, list, appts } = useToday()
  const today = appts.filter(a => sameDay(a.at, now, tz))
  const recent = list.filter(l => isRecent(l, tz, now.getTime()))
  const used = usedThisMonth(list, now, tz)

  const loading = inb.isLoading
  const failed = inb.isError
  const retry = () => inb.refetch()

  return (
    <section className={`tc-grid${showTexts ? ' tc-grid--texts' : ''}`} aria-label="Your inbounds today">
      <NextAppointment appts={appts} now={now} tz={tz} evMap={evMap} loading={loading} failed={failed} onRetry={retry} />

      <DutyCard tz={tz} />

      <PlanCard used={used} tz={tz} now={now.getTime()} loading={loading} />

      <section className="ov-card tc-card tc-a-appts" aria-label="Today's appointments">
        <Head title="Today’s appointments" sub={loading || failed ? null : `${plural(today.length, 'appointment')} today, times in your time zone`} />
        {loading ? <Skel w="60%" h={46} style={{ marginTop: 14 }} />
          : failed ? <LoadError what="your appointments" onRetry={retry} style={{ marginTop: 14 }} />
            : today.length ? (
              <div className="tc-rows">{today.map(a => <ApptRow key={a.l.lead_id} a={a} now={now} tz={tz} evMap={evMap} />)}</div>
            ) : <Note icon={CalendarDays}>Nothing on your calendar today.</Note>}
      </section>

      <section className="ov-card tc-card tc-a-inb" aria-label="New inbounds">
        <Head title="New inbounds" sub={recent.length > 0 ? `${recent.length} since yesterday` : null} />
        {loading ? <Skel w="55%" h={46} style={{ marginTop: 14 }} />
          : failed ? <LoadError what="your inbounds" onRetry={retry} style={{ marginTop: 14 }} />
            : recent.length ? (
              <>
                <div className="tc-rows">
                  {recent.slice(0, 4).map(l => {
                    const st = l.live_call_result && LIVE_RESULT[l.live_call_result] ? LIVE_RESULT[l.live_call_result] : stageOf(l)
                    return (
                      <Link key={l.lead_id} className="tc-row" to={lead(l.lead_id)}>
                        <div className="tc-grow"><h3>{leadName(l)}</h3><p className="tc-sub">{inboundLine(l, evMap.get(l.lead_id), tz, now)}</p></div>
                        <Pill tone={st.pill}>{st.label.replace(' to you', '')}</Pill>
                        <ChevronRight size={16} strokeWidth={2.2} className="tc-chev" aria-hidden="true" />
                      </Link>
                    )
                  })}
                </div>
                <div className="tc-foot"><Link className="ov-ghost tc-btn" to="/agent/inbounds">See all inbounds<ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" /></Link></div>
              </>
            ) : <Note icon={Inbox}>No new inbounds yet. They show up here as soon as they come in. You don&rsquo;t need to refresh.</Note>}
      </section>

      {showTexts && <TextsCard />}
    </section>
  )
}

export default TodayCards
