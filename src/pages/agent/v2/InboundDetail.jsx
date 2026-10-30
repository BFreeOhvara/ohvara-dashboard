import { Fragment, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Inbox, ArrowLeft, Phone, MessageSquare, CalendarDays, Zap, Check, Clock, PenLine, LogIn, Send, Info,
} from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useInbounds, useLeadEvents, useLeadTexts, useSetOutcome, useAddNote } from '../../../hooks/useInbounds'
import { PortalV2Layout, Ico, Skel, ErrorCard } from '../../../components/agent/PortalV2Nav'
import {
  stageOf, leadName, firstName, phoneDisplay, telHref, stateName, appointmentAt, apptText, timeText, dateText, dayLabel, dayKey,
  upcomingWords, buildTimeline, eventTitle, eventSub, cameInAt, PRODUCT_LABEL, OUTCOME_LABEL,
} from '../../../lib/inbounds'
import { DEFAULT_TIMEZONE } from '../../../lib/timezones'

// Inbound detail (/agent/leads/:id): who they are, a timeline of what we did and what happens next,
// the outcome buttons, the text thread (read only) and notes. Mockup:
// ohvara/mockups/build-v2-portal-shell-today-inbounds-inb.html.

const KIND = {
  came_in: [LogIn, 'in'], text_sent: [MessageSquare, 'text'], text_received: [MessageSquare, 'text'], reminder: [MessageSquare, 'text'],
  va_call: [Phone, ''], missed: [Phone, ''], no_show: [Phone, ''], booked: [CalendarDays, ''], rebooked: [CalendarDays, ''],
  transferred: [Zap, ''], follow_up: [Clock, ''], outcome: [PenLine, ''], note: [PenLine, ''], became_client: [Check, 'ok'],
}
const STAGE_TEXT = { just_submitted: 'Welcome text', not_reached: 'Missed-call text', reached: 'Follow-up text', opted_out: 'Opt-out confirmation' }
const OUTS = [['sold', 'Sold', 'sold'], ['follow_up', 'Follow up', 'follow'], ['not_interested', 'Not interested', 'lost']]

const mortgage = v => (/\$/.test(v) ? <span className="mono">{v}</span> : v)
function answerChips(qa) {
  const a = qa && typeof qa === 'object' ? qa : {}
  return [
    a.homeowner != null && (a.homeowner ? 'Homeowner' : 'Renter'),
    a.mortgage_balance_band && <>Mortgage&nbsp;{mortgage(a.mortgage_balance_band)}</>,
    a.age_band && `Age ${a.age_band}`,
    a.smoker != null && (a.smoker ? 'Smoker' : 'Non-smoker'),
    a.best_time && `Best time: ${String(a.best_time).toLowerCase()}`,
  ].filter(Boolean)
}

function Timeline({ events, tz, now }) {
  const { days, upcoming } = buildTimeline(events, tz, now)
  const node = e => {
    const [Icon, tone] = KIND[e.kind] || [Clock, '']
    return <span className={`pv-node${tone ? ` n-${tone}` : ''}`}><Ico icon={Icon} size={14} /></span>
  }
  if (!days.length && !upcoming.length) {
    return <p className="pv-note"><Ico icon={Info} size={14} /><span>Nothing yet. Steps show here as they happen.</span></p>
  }
  return (
    <div className="pv-tl">
      {days.map(g => (
        <Fragment key={g.key}>
          <p className="pv-tl-day">{g.label}</p>
          {g.items.map(e => (
            <div className="pv-ev" key={e.id}>
              <time>{timeText(e.at, tz)}</time>{node(e)}
              <div><b>{eventTitle(e)}</b>{eventSub(e) && <p>{eventSub(e)}</p>}</div>
            </div>
          ))}
        </Fragment>
      ))}
      <div className="pv-now"><i /><span>Now &middot; {timeText(new Date(now).toISOString(), tz)}</span></div>
      {upcoming.map(e => (
        <div className="pv-ev up" key={e.id}>
          <time>{e.detail?.when_label || upcomingWords(e.at, tz, now)}</time>{node(e)}
          <div><b>{eventTitle(e)}<span className="pv-up-tag">Upcoming</span></b>{eventSub(e) && <p>{eventSub(e)}</p>}</div>
        </div>
      ))}
    </div>
  )
}

function Outcome({ l, tz, due }) {
  const set = useSetOutcome(l.lead_id)
  const [last, setLast] = useState(null) // { outcome, at } of the last save
  const [asked, setAsked] = useState(null)
  const pick = o => {
    setAsked(o)
    set.mutate({ outcome: o }, { onSuccess: () => setLast({ outcome: o, at: new Date().toISOString() }) })
  }
  const current = set.isPending ? asked : l.outcome
  const name = firstName(leadName(l))
  return (
    <section className={`${due ? 'ov-attn' : 'ov-card'} pv-card a-out`} aria-label="Outcome">
      <div className="pv-card-head">
        <div className="pv-grow"><h3>How did it go?</h3><p className="pv-sub">Mark this after you meet {name}. Sold makes them your client and servicing starts.</p></div>
      </div>
      <div className={`pv-outs${set.isPending ? ' busy' : ''}`} role="group" aria-label="Outcome" aria-busy={set.isPending}>
        {OUTS.map(([v, label, cls]) => (
          <button key={v} type="button" className={`${cls}${current === v ? ' on' : ''}`} aria-pressed={current === v}
            disabled={set.isPending} onClick={() => pick(v)}>{label}</button>
        ))}
      </div>
      {set.isPending && <p className="pv-saved">Saving&hellip;</p>}
      {!set.isPending && !set.isError && last && (
        <p className="pv-saved">{'✓'} Marked {OUTCOME_LABEL[last.outcome]} at {timeText(last.at, tz)}.{last.outcome === 'sold' ? ` ${name} is now your client.` : ''}</p>
      )}
      {set.isError && (
        <p className="pv-inline-err" role="alert">
          <span>Couldn&rsquo;t save {OUTCOME_LABEL[asked]}. Nothing changed.</span>
          <button type="button" onClick={() => pick(asked)}>Try again</button>
        </p>
      )}
    </section>
  )
}

function Texts({ l, tz }) {
  const { data = [], isLoading } = useLeadTexts(l.lead_id)
  const num = phoneDisplay(l.phone)
  const rows = data.map((t, i) => ({ ...t, head: i === 0 || dayKey(t.at, tz) !== dayKey(data[i - 1].at, tz) ? dayLabel(t.at, tz) : null }))
  return (
    <section className="ov-card pv-card a-texts" aria-label="Texts">
      <div className="pv-card-head">
        <span className="pv-tile"><Ico icon={MessageSquare} size={20} /></span>
        <div className="pv-grow"><h3>Texts</h3><p className="pv-sub">{num ? `With ${num} · ` : ''}read only</p></div>
      </div>
      {isLoading ? <Skel w="60%" h={14} /> : data.length ? (
        <div className="pv-thread">
          {rows.map(t => {
            return (
              <Fragment key={t.id}>
                {t.head && <p className="pv-daydiv">{t.head}</p>}
                <div className={`pv-msg ${t.mine ? 'mine' : 'theirs'}`}>
                  <p className="pv-bubble">{t.mine ? `${STAGE_TEXT[t.stage] || 'Text'} sent` : t.body}</p>
                  <span className="pv-cap"><b>{t.mine ? 'Automated' : firstName(leadName(l)) || 'Them'}</b> &middot; {timeText(t.at, tz)}</span>
                </div>
              </Fragment>
            )
          })}
        </div>
      ) : (
        <p className="pv-note"><Ico icon={MessageSquare} size={14} /><span>No texts with {firstName(leadName(l)) || 'them'} yet. Our automated texts and their replies will show here.</span></p>
      )}
      <div className="pv-composer" aria-disabled="true"><span>Texting coming soon</span><button type="button" className="pv-send" disabled aria-label="Send (coming soon)"><Ico icon={Send} /></button></div>
      {data.length > 0 && num && <p className="pv-cap" style={{ marginTop: 8 }}>To reply now, tap Call {firstName(leadName(l))}.</p>}
    </section>
  )
}

function Notes({ l, events, tz }) {
  const add = useAddNote(l.lead_id)
  const [text, setText] = useState('')
  const notes = events.filter(e => e.kind === 'note').sort((a, b) => new Date(a.at) - new Date(b.at))
  const save = () => add.mutate(text.trim(), { onSuccess: () => setText('') })
  return (
    <section className="ov-card pv-card a-notes" aria-label="Notes">
      <div className="pv-card-head">
        <span className="pv-tile"><Ico icon={PenLine} size={20} /></span>
        <div className="pv-grow"><h3>Notes</h3><p className="pv-sub">Only you and our team see these</p></div>
      </div>
      {notes.length > 0 && (
        <div className="pv-nlist">
          {notes.map(n => (
            <p key={n.id} className="pv-nitem">
              <span className="pv-cap"><b>{n.actor_role === 'agent' ? 'You' : n.actor_name || 'Our team'}</b> &middot; {dateText(n.at, tz)}, {timeText(n.at, tz)}</span>
              {n.detail?.note}
            </p>
          ))}
        </div>
      )}
      <textarea className="pv-notebox" placeholder="Add a note for yourself" rows={3} aria-label="New note" value={text}
        onChange={e => setText(e.target.value)} maxLength={2000} />
      {add.isError && <p className="pv-inline-err" role="alert"><span>Couldn&rsquo;t save the note. Nothing changed.</span></p>}
      <div className="pv-foot" style={{ borderTop: 0, paddingTop: 0, marginTop: 12 }}>
        <button type="button" className="ov-ghost pv-btn" disabled={!text.trim() || add.isPending} onClick={save}>{add.isPending ? 'Saving…' : 'Save note'}</button>
      </div>
    </section>
  )
}

export default function InboundDetail() {
  const { id } = useParams()
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const inb = useInbounds()
  const ev = useLeadEvents(id)
  const l = (inb.data || []).find(x => x.lead_id === id)
  const events = ev.data || []
  const now = useMemo(() => new Date().getTime(), [ev.dataUpdatedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const back = <Link className="ov-ghost pv-btn pv-back" to="/agent/leads"><Ico icon={ArrowLeft} />Leads</Link>
  const shell = children => <PortalV2Layout active="inbounds" crumb="Leads" title={l ? leadName(l) : 'Lead'} icon={Inbox}>{back}{children}</PortalV2Layout>

  if (inb.isLoading) {
    return shell(
      <section className="ov-card pv-card" aria-busy="true">
        <Skel w={160} h={26} style={{ borderRadius: 999 }} /><Skel w="45%" h={14} style={{ marginTop: 14 }} />
        <Skel w="100%" h={46} style={{ marginTop: 16, borderRadius: 999 }} />
      </section>,
    )
  }
  if (inb.isError) return shell(<ErrorCard title="We couldn't load this lead" text="Check your connection and try again." onRetry={() => inb.refetch()} />)
  if (!l) {
    return shell(
      <section className="ov-card pv-card pv-empty">
        <span className="pv-tile"><Ico icon={Inbox} size={20} /></span>
        <h3>This lead isn&rsquo;t here</h3>
        <p className="pv-sub">It may belong to another agent, or the link is old.</p>
        <Link className="ov-ghost pv-btn" to="/agent/leads"><Ico icon={ArrowLeft} size={14} />Back to leads</Link>
      </section>,
    )
  }

  const st = stageOf(l)
  const appt = appointmentAt(events)
  const num = phoneDisplay(l.phone)
  const call = telHref(l.phone)
  const first = firstName(leadName(l))
  const chips = answerChips(l.qualifier_answers)
  const stageText = l.inbound_stage === 'booked' && appt ? `Booked · ${apptText(appt, tz)}` : l.outcome ? OUTCOME_LABEL[l.outcome] : st.label
  const place = [stateName(l.state), `came in ${apptText(cameInAt(l), tz)}`].filter(Boolean).join(' · ')

  return shell(
    <>
      <section className="ov-card pv-card pv-d-card" aria-label="Lead">
        <div className="pv-d-chips">
          <span className="pv-chip b">{PRODUCT_LABEL[l.inbound_product] || 'Inbound'}</span>
          <span className="pv-chip"><i className="pv-dot" />{stageText}</span>
        </div>
        <p className="pv-sub">{num ? place : `No phone number on file. Our VA is finding one.`}</p>
        {num && call && (
          <div className="pv-d-num"><b className="tab">{num}</b>
            <a className="ov-primary" href={call}><Ico icon={Phone} />Call {first}</a>
          </div>
        )}
        {chips.length > 0 && <div className="pv-ans">{chips.map((c, i) => <span key={i} className="pv-chip">{c}</span>)}</div>}
      </section>

      <div className="pv-detail">
        <section className="ov-card pv-card a-tl" aria-label="Timeline">
          <div className="pv-card-head"><div className="pv-grow"><h3>Timeline</h3><p className="pv-sub">What we&rsquo;ve done, and what happens next</p></div></div>
          {ev.isLoading ? <Skel w="55%" h={14} /> : ev.isError
            ? <p className="pv-inline-err" role="alert"><span>We couldn&rsquo;t load the timeline.</span><button type="button" onClick={() => ev.refetch()}>Try again</button></p>
            : <Timeline events={events} tz={tz} now={now} />}
        </section>
        <Outcome key={l.lead_id} l={l} tz={tz} due={!l.outcome && !!appt && new Date(appt).getTime() < now} />
        <Texts l={l} tz={tz} />
        <Notes l={l} events={events} tz={tz} />
      </div>
    </>,
  )
}
