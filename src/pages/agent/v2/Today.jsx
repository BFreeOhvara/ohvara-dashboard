import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Sun, Phone, ChevronRight, Zap, CalendarDays, Info, Inbox, MessageSquare, Check } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useInbounds, useInboundEvents, useMembershipTier, useWaitingTexts } from '../../../hooks/useInbounds'
import { useAgentDuty } from '../../../hooks/useAgentDuty'
import { dutySince } from '../../../lib/duty'
import { PortalV2Layout, Ico, Pill, Skel, ErrorCard } from '../../../components/agent/PortalV2Nav'
import {
  stageOf, leadName, firstName, phoneDisplay, telHref, appointmentAt, timeText, clockParts, untilWords, sameDay, dateText,
  greeting, isRecent, cameInAt, nextLine, whenText, PRODUCT_LABEL, PRODUCT_SHORT, LIVE_RESULT,
} from '../../../lib/portalV2'
import { DEFAULT_TIMEZONE } from '../../../lib/timezones'

// Today (/agent when the v2 portal is on): the next appointment, the Active switch for live
// call transfers (useAgentDuty; Coming soon until agent_duty is there), plan usage, today's appointments, new inbounds and texts waiting.
// Each card loads and fails on its own. Mockup: ohvara/mockups/build-v2-portal-shell-today-inbounds-inb.html.

const lead = id => `/agent/inbounds/${id}`
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function Hero({ appts, now, tz, evMap }) {
  const next = appts.find(a => a.l.inbound_stage === 'booked' && new Date(a.at) >= now)
  if (!next) {
    return (
      <section className="ov-hero pv-hero a-hero" aria-label="Next appointment">
        <div className="pv-hero-top"><span className="pv-hero-label"><i className="pv-dot" />Next appointment</span></div>
        <p className="pv-hero-name" style={{ marginTop: 14 }}>Nothing booked today</p>
        <p className="pv-sub" style={{ marginTop: 4 }}>When our VA books someone with you, it shows here with a reminder of when to call.</p>
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
    <section className="ov-hero pv-hero a-hero" aria-label="Next appointment">
      <div className="pv-hero-top">
        <span className="pv-hero-label"><i className="pv-dot" />Next appointment</span>
        <span className="ov-hero-chip">{untilWords(at, tz, now.getTime())}</span>
      </div>
      <div className="pv-clock tab"><b>{clock}</b><span>{ampm}</span></div>
      <p className="pv-hero-name">{leadName(l)}</p>
      <p className="pv-sub">
        {PRODUCT_LABEL[l.inbound_product] || 'Inbound'}
        {bookedOn ? ` · Our VA booked this on ${dateText(bookedOn.at, tz)}.` : ''}
        {reminder ? ` Reminder text went out at ${timeText(reminder.at, tz)}.` : ''}
      </p>
      <div className="pv-hero-acts">
        {call && num && <a className="ov-hero-btn pv-btn-hero" href={call}><Ico icon={Phone} />Call {num}</a>}
        <Link className="pv-hero-ghost" to={lead(l.lead_id)}>Open inbound<Ico icon={ChevronRight} size={14} /></Link>
      </div>
      {later.length > 0 && (
        <div className="pv-later">
          <p>Later today</p>
          <div>
            {later.map(a => (
              <span key={a.l.lead_id} className="ov-hero-chip">
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
    <section className="ov-card pv-card a-active" aria-label="Live call transfers">
      <div className="pv-act-head">
        <span className="pv-tile"><Ico icon={Zap} size={20} /></span>
        <div className="pv-grow">
          <h3>Live call transfers</h3>
          <p className="pv-sub">
            {loading ? 'Checking…' : soon ? 'Coming soon' : failed ? "Couldn't check right now"
              : on ? (since ? `Active since ${dutySince(since, new Date(), tz)}` : "You're active") : "You're not active"}
          </p>
        </div>
        <button type="button" className={`pv-sw${on ? ' on' : ''}`} role="switch" aria-checked={on} disabled={!live}
          aria-label={soon ? 'Active for live call transfers (coming soon)' : 'Active for live call transfers'}
          onClick={() => toggle(!on)}><i /></button>
      </div>
      <p className="pv-act-body">
        {soon
          ? 'Soon you can turn this on to take callers live the moment our VA checks the fit. Until then, every live call is booked on your calendar.'
          : "While you're active, our VA sends callers straight to you. When you're not, we book them on your calendar instead."}
      </p>
      {saveFailed && <p className="pv-act-err" role="alert">Couldn&rsquo;t save that. Try again.</p>}
    </section>
  )
}

function PlanCard({ used, tz, now }) {
  const { data: tier, isLoading } = useMembershipTier()
  const total = tier?.monthly_appointments
  const has = Number.isInteger(total) && total > 0
  const left = has ? Math.max(0, total - used) : null
  const resets = new Date(new Date(`${new Date(now).toLocaleDateString('en-CA', { timeZone: tz })}T12:00:00Z`))
  resets.setUTCMonth(resets.getUTCMonth() + 1, 1)
  const segs = has ? Math.min(total, 12) : 0
  const usedSegs = has ? Math.min(segs, Math.round((Math.min(used, total) / total) * segs)) : 0
  return (
    <section className="ov-card pv-card a-plan" aria-label="Plan usage">
      <div className="pv-card-head">
        <span className="pv-tile"><Ico icon={CalendarDays} size={20} /></span>
        <div className="pv-grow">
          <h3>Appointments left this month</h3>
          <p className="pv-sub">{has ? `Your plan includes ${total} a month` : 'Your plan'}</p>
        </div>
      </div>
      {isLoading ? <Skel w={90} h={44} /> : has ? (
        <>
          <div className="pv-meter-num tab"><b>{left}</b><span>of {total} left</span></div>
          <div className="pv-segs" role="img" aria-label={`${Math.min(used, total)} of ${total} used`}>
            {Array.from({ length: segs }, (_, i) => <i key={i} className={i < usedSegs ? 'used' : undefined} />)}
          </div>
          <div className="pv-meter-foot">
            <span>{left === 0 ? `All ${total} used` : `${used} used`}</span>
            <span>Resets {resets.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
          </div>
        </>
      ) : (
        <>
          <div className="pv-meter-num tab"><b>&mdash;</b></div>
          <p className="pv-note"><Ico icon={Info} size={14} /><span>This shows once your plan includes appointments.</span></p>
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
    <Link className="pv-row" to={lead(l.lead_id)}>
      <span className={`pv-ttile tab${past ? ' past' : ''}`}><b>{clock}</b><span>{ampm}</span></span>
      <div className="pv-grow"><h4>{leadName(l)}</h4><p className="pv-sub">{sub}</p></div>
      <Pill tone={stage.pill}>{stage.label}</Pill>
      <Ico icon={ChevronRight} />
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

export default function Today() {
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const inb = useInbounds()
  const ev = useInboundEvents()
  const texts = useWaitingTexts()
  const now = useMemo(() => new Date(), [inb.dataUpdatedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const evMap = useMemo(() => ev.data || new Map(), [ev.data])
  const list = useMemo(() => inb.data || [], [inb.data])

  const appts = useMemo(() => list
    .map(l => ({ l, at: appointmentAt(evMap.get(l.lead_id)) }))
    .filter(a => a.at && a.l.inbound_stage !== 'lost')
    .sort((a, b) => new Date(a.at) - new Date(b.at)), [list, evMap])
  const today = appts.filter(a => sameDay(a.at, now, tz))
  const recent = list.filter(l => isRecent(l, tz, now.getTime()))
  const monthKey = now.toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 7)
  const used = list.filter(l => l.inbound_product === 'booked_appointment' && ['booked', 'met', 'sold', 'follow_up'].includes(l.inbound_stage)
    && new Date(cameInAt(l)).toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 7) === monthKey).length
  const nameOf = new Map(list.map(l => [l.lead_id, l]))
  const waiting = (texts.data || []).filter(t => nameOf.has(t.lead_id))

  const loading = inb.isLoading
  const failed = inb.isError

  return (
    <PortalV2Layout active="today" title="Today" icon={Sun}>
      <div className="pv-greet">
        <h1>{greeting(tz, now.getTime())}{firstName(profile?.full_name) ? `, ${firstName(profile.full_name)}` : ''}</h1>
        <p className="pv-sub">
          {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz })}
          {' · '}{today.length ? plural(today.length, 'appointment') + ' today' : 'No appointments today'}
        </p>
      </div>
      <div className="pv-today">
        {loading ? (
          <section className="ov-hero pv-hero a-hero" aria-busy="true">
            <Skel w={130} h={14} /><Skel w={180} h={52} style={{ margin: '16px 0 10px' }} /><Skel w="70%" h={14} /><Skel w={200} h={44} style={{ marginTop: 18, borderRadius: 999 }} />
          </section>
        ) : failed ? (
          <div className="a-hero"><ErrorCard title="We couldn't load today" text="Your inbounds are safe. Check your connection and try again." onRetry={() => inb.refetch()} /></div>
        ) : <Hero appts={appts} now={now} tz={tz} evMap={evMap} />}

        <DutyCard tz={tz} />

        <section className="ov-card pv-card a-appts" aria-label="Today's appointments">
          <div className="pv-card-head"><div className="pv-grow"><h3>Today&rsquo;s appointments</h3><p className="pv-sub">{loading ? ' ' : `${today.length} today, times in your time zone`}</p></div></div>
          {loading ? <Skel w="60%" h={46} /> : today.length ? (
            <div className="pv-rows">{today.map(a => <ApptRow key={a.l.lead_id} a={a} now={now} tz={tz} evMap={evMap} />)}</div>
          ) : <p className="pv-note"><Ico icon={CalendarDays} size={14} /><span>Nothing on your calendar today.</span></p>}
        </section>

        <section className="ov-card pv-card a-inb" aria-label="New inbounds">
          <div className="pv-card-head"><div className="pv-grow"><h3>New inbounds</h3>{recent.length > 0 && <p className="pv-sub">{recent.length} since yesterday</p>}</div></div>
          {loading ? <Skel w="55%" h={46} /> : recent.length ? (
            <>
              <div className="pv-rows">
                {recent.slice(0, 4).map(l => {
                  const st = l.live_call_result && LIVE_RESULT[l.live_call_result] ? LIVE_RESULT[l.live_call_result] : stageOf(l)
                  return (
                    <Link key={l.lead_id} className="pv-row" to={lead(l.lead_id)}>
                      <div className="pv-grow"><h4>{leadName(l)}</h4><p className="pv-sub">{inboundLine(l, evMap.get(l.lead_id), tz, now)}</p></div>
                      <Pill tone={st.pill}>{st.label.replace(' to you', '')}</Pill>
                      <Ico icon={ChevronRight} />
                    </Link>
                  )
                })}
              </div>
              <div className="pv-foot"><Link className="ov-ghost pv-btn" to="/agent/inbounds">See all inbounds<Ico icon={ChevronRight} size={14} /></Link></div>
            </>
          ) : <p className="pv-note"><Ico icon={Inbox} size={14} /><span>No new inbounds yet. They show up here as soon as they come in. You don&rsquo;t need to refresh.</span></p>}
        </section>

        {waiting.length > 0 ? (
          <section className="ov-attn pv-card a-texts" aria-label="Texts waiting">
            <div className="pv-card-head">
              <span className="pv-tile warn"><Ico icon={MessageSquare} size={20} /></span>
              <div className="pv-grow"><h3>Texts waiting</h3><p className="pv-sub">Replies from your inbounds</p></div>
              <span className="pv-badge tab">{waiting.length}</span>
            </div>
            <div className="pv-rows">
              {waiting.slice(0, 5).map(t => (
                <Link key={t.id} className="pv-trow" to={lead(t.lead_id)}>
                  <div className="pv-grow"><h4>{leadName(nameOf.get(t.lead_id))}</h4><q>{t.body}</q></div>
                  <time>{sameDay(t.received_at, now, tz) ? timeText(t.received_at, tz) : whenText(t.received_at, tz, now.getTime())}</time>
                </Link>
              ))}
            </div>
            <p className="pv-note" style={{ marginTop: 12 }}><Ico icon={Info} size={14} /><span>Texting from the portal is coming soon. Open one to read it, then call them back.</span></p>
          </section>
        ) : (
          <section className="ov-card pv-card a-texts" aria-label="Texts waiting">
            <div className="pv-card-head" style={{ marginBottom: 0 }}>
              <span className="pv-tile ok"><Ico icon={Check} size={20} /></span>
              <div className="pv-grow"><h3>No texts waiting</h3><p className="pv-sub">You&rsquo;re all caught up.</p></div>
            </div>
          </section>
        )}

        <PlanCard used={used} tz={tz} now={now.getTime()} />
      </div>
    </PortalV2Layout>
  )
}
