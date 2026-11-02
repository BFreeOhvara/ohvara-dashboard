import { Link } from 'react-router-dom'
import {
  ShieldCheck, ListChecks, TriangleAlert, ClipboardList, ArrowUpRight, ArrowRight, ChevronRight, Check, CalendarDays, Zap, FileUp,
} from 'lucide-react'
import { useSampleOverview, useSampleActions } from '../data'
import { Avatar } from '../kit'
import { paths } from '../paths'

// The approved Overview page (Both state: Servicing and Leads), inside the shell frame. Sample data only.
// Desktop and phone share one set of blocks; the phone reorders them and swaps in its own ring card and leads cards.

const SERIES = [['packet', 'Packet checks'], ['review', 'Review calls'], ['cancel', 'Cancellations'], ['save', 'Saves']]
const sumOf = d => d.packet + d.review + d.cancel + d.save
const apptTo = a => (a.kind === 'client' ? paths.client(a.ref) : paths.lead(a.ref))
const PILL = { booked: ['booked', 'Booked'], ringing: ['contacting', 'Ringing'], missed: ['new', 'Missed'] }

function DutySwitch({ on, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label="Active for live call transfers" className={`tp-ovsw${on ? ' on' : ''}`} onClick={() => onChange(!on)}><i /></button>
  )
}

function StepsDone({ days, range }) {
  const total = days.reduce((n, d) => n + sumOf(d), 0)
  const most = Math.max(4, ...days.map(sumOf))
  const step = most <= 8 ? 1 : Math.ceil(most / 4)
  const top = most <= 8 ? most : step * 4
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step)
  return (
    <section className="ov-card tp-ovst" data-block="steps-done" aria-label="Steps done">
      <div className="tp-ovst-head">
        <span className="tp-num tp-ovst-total">{total}</span>
        <div className="tp-ovst-titles"><h2>Steps done</h2><p>Last week, {range}</p></div>
        <div className="tp-ovlegend">{SERIES.map(([k, label]) => <span key={k}><i className={`k-${k}`} />{label} <b>{days.reduce((n, d) => n + d[k], 0)}</b></span>)}</div>
      </div>
      <div className="tp-ovst-body" role="img" aria-label="Steps done last week, per day">
        <div className="tp-ovst-axis" aria-hidden="true">{ticks.map(v => <span key={v} style={{ bottom: `calc(${(v / top) * 100}% - 6px)` }}>{v}</span>)}</div>
        <div className="tp-ovst-right">
          <div className="tp-ovst-plot">
            {ticks.map(v => <div key={v} className={`tp-ovst-line${v === 0 ? ' base' : ''}`} style={{ bottom: `${(v / top) * 100}%` }} />)}
            <div className="tp-ovst-cols">
              {days.map(d => {
                const sum = sumOf(d)
                return sum === 0 ? (
                  <div key={d.day} className="tp-ovst-col"><span className="tp-ovst-stack stub"><i /></span></div>
                ) : (
                  <div key={d.day} className="tp-ovst-col">
                    <span className="tp-ovst-sum">{sum}</span>
                    <span className="tp-ovst-stack" style={{ height: `${(sum / top) * 100}%` }}>
                      {SERIES.map(([k]) => d[k] > 0 && <i key={k} className={`s-${k}`} style={{ flex: `${d[k]} 1 0` }} />)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="tp-ovst-xs">{days.map(d => <div key={d.day}><b>{d.day}</b> <span>{d.date}</span></div>)}</div>
        </div>
      </div>
    </section>
  )
}

export default function Overview() {
  const { data: o } = useSampleOverview()
  const { setDuty } = useSampleActions()
  const { used, cap } = o.submissions
  const sub = o.stepsOpen === 0 ? 'No steps due this week' : `${o.stepsOpen} ${o.stepsOpen === 1 ? 'step' : 'steps'} due this week`
  const next = o.nextAppt
  const dutyText = o.duty ? `Active since ${o.dutySince}` : 'Off. We book callers on your calendar.'
  const ring = 2 * Math.PI * 33

  const book = [
    { key: 'protected', label: 'Protected', n: o.book.protected, Icon: ShieldCheck, c: 'var(--ov-data-b)', f: 'var(--ov-data-b-tint)', sub: 'Payments on time', sub0: 'Payments on time' },
    { key: 'setting_up', label: 'Setting up', n: o.book.settingUp, Icon: ListChecks, c: 'var(--ov-data-a)', f: 'var(--ov-data-a-tint)', sub: 'First 30 days', sub0: 'First 30 days' },
    { key: 'needs_attention', label: 'Needs attention', n: o.book.needsAttention, Icon: TriangleAlert, c: 'var(--ov-warn)', f: 'var(--ov-warn-tint)', sub: 'See who and why', sub0: 'All caught up', attn: o.book.needsAttention > 0 },
    { key: 'requests', label: 'Requests open', n: o.book.requestsOpen, Icon: ClipboardList, c: 'var(--ov-data-a)', f: 'transparent', e: 'var(--ov-data-a)', sub: 'In progress', sub0: 'None open' },
  ].map(b => (b.key === 'needs_attention' && b.n === 0 ? { ...b, Icon: Check, c: 'var(--ov-up)', f: 'var(--ov-up-tint)', good: true } : b))

  const toConfirm = o.attention.filter(c => /^confirm/i.test(c.attention || '')).length
  const intro = [toConfirm && `${toConfirm} to confirm`, o.attention.length - toConfirm && `${o.attention.length - toConfirm} to call`].filter(Boolean).join(' · ')

  return (
    <div className="tp-page tp-ov">
      <section className="ov-hero tp-ovhero" aria-label="Today">
        <div className="tp-ovhero-l">
          <span className="ov-hero-chip"><i />{o.today}</span>
          <h2>Good afternoon, {o.name}</h2>
          <p>{sub}</p>
        </div>
        <div className="tp-ovhero-r">
          <span className="tp-ovclock">{o.clock.time}<small>{o.clock.ampm}</small></span>
          <Link to={paths.submit()} className="ov-hero-btn"><FileUp size={17} aria-hidden="true" />Submit</Link>
        </div>
      </section>

      <section className="ov-hero tp-ovring" aria-label="This week">
        <div className="tp-ovring-row">
          <span className="tp-ovring-dial">
            <svg width="78" height="78" viewBox="0 0 78 78" aria-hidden="true">
              <circle cx="39" cy="39" r="33" fill="none" strokeWidth="8" className="track" />
              <circle cx="39" cy="39" r="33" fill="none" strokeWidth="8" strokeLinecap="round" className="arc" strokeDasharray={`${ring * Math.min(1, used / cap)} ${ring}`} transform="rotate(-90 39 39)" />
            </svg>
            <span className="tp-ovring-mid"><b>{used}</b><small>of {cap}</small></span>
          </span>
          <span className="tp-grow"><span className="l1">Submissions this week</span><span className="l2">{cap - used} left</span><span className="l3">Resets Monday</span></span>
        </div>
        <Link to={paths.submit()} className="ov-hero-btn tp-ovring-btn"><FileUp size={18} aria-hidden="true" />Submit</Link>
      </section>

      <section className="tp-ovbook" aria-label="Your book" data-block="your-book">
        <div className="tp-ovbook-head"><h2>Your book</h2><p>Open a box to see those clients.</p></div>
        <div className="tp-ovbook-row">
          {book.map(b => (
            <Link key={b.key} to={paths.clients(b.key)} className={`${b.attn ? 'ov-attn' : 'ov-card'} ov-link tp-ovbk`} aria-label={`Open Clients filtered to ${b.label}`}>
              <span className="tp-ovbk-ic" style={{ '--c': b.c, '--f': b.f, '--e': b.e || 'transparent' }}><b.Icon size={18} aria-hidden="true" /></span>
              <span className="tp-ovbk-t" style={{ '--c': b.c }}>
                <span className="tp-ovbk-label">{b.label}</span>
                <span className={`tp-ovbk-sub${b.good ? ' good' : ''}`}>{b.n === 0 ? b.sub0 : b.sub}</span>
              </span>
              <span className="tp-num tp-ovbk-num">{b.n}</span>
              <ArrowUpRight size={14} aria-hidden="true" className="tp-ovbk-go" />
            </Link>
          ))}
        </div>
      </section>

      <section className="ov-card tp-ovstrip" data-block="today-strip" aria-label="Today">
        <div className="tp-ovstrip-seg is-next">
          <span className="tp-ovstrip-tile"><CalendarDays size={16} aria-hidden="true" /></span>
          <div className="tp-ovstrip-t"><b>Next appointment</b><span>{next ? `${next.time} · ${next.who}` : 'Nothing else today'}</span></div>
          {next && <span className="tp-ovchip tp-ovstrip-chip">{next.inText}</span>}
        </div>
        <div className="tp-ovstrip-seg is-duty">
          <span className="tp-ovstrip-tile"><Zap size={16} aria-hidden="true" /></span>
          <div className="tp-ovstrip-t"><b>Live call transfers</b><span>{dutyText}</span></div>
          <DutySwitch on={o.duty} onChange={setDuty} />
        </div>
        <div className="tp-ovstrip-seg is-plan">
          <span className="tp-ovstrip-tile"><CalendarDays size={16} aria-hidden="true" /></span>
          <div className="tp-ovstrip-t"><b>{o.apptsLeft.left} of {o.apptsLeft.cap} left</b><span>Appointments this month</span></div>
        </div>
        <div className="tp-ovstrip-links">
          <Link to={paths.calendar()} className="ov-ghost tp-btn">Today’s appointments<b>{o.todayAppts.length}</b><ChevronRight size={14} aria-hidden="true" /></Link>
          <Link to={paths.leads()} className="ov-ghost tp-btn">New leads<b>{o.newLeads.length}</b><ChevronRight size={14} aria-hidden="true" /></Link>
        </div>
      </section>

      <div className="tp-ovsvc">
        <div className="tp-ovsvc-l">
          {o.attention.length > 0 ? (
            <section className="ov-attn tp-ovna" data-block="attention" aria-label="Needs your attention">
              <div className="tp-ovna-head">
                <span className="tp-ovic warn"><TriangleAlert size={15} aria-hidden="true" /></span>
                <h2 className="tp-ovtitle">Needs your attention</h2>
                <span className="tp-ovcount">{o.attention.length}</span>
                <span className="tp-ovna-intro">{intro}</span>
                <Link to={paths.clients('needs_attention')} className="tp-link">See all in Clients<ArrowRight size={14} aria-hidden="true" /></Link>
              </div>
              <ul className="tp-ovna-list">
                {o.attention.map(c => (
                  <li key={c.id} className="tp-ovna-row">
                    <Link to={paths.client(c.id)} className="tp-ovna-main" aria-label={`Open ${c.client_first_name} ${c.client_last_name}`}>
                      <Avatar name={`${c.client_first_name} ${c.client_last_name}`} tone="warn" />
                      <span className="tp-ovna-m"><b>{c.client_first_name} {c.client_last_name}</b><small>{c.carrier_name} · {c.note}</small></span>
                    </Link>
                    <Link to={paths.client(c.id)} className="ov-ghost tp-btn tp-ovna-open" tabIndex={-1} aria-hidden="true">Open<ArrowRight size={13} /></Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="ov-card tp-ovcu" data-block="attention" aria-label="You are all caught up">
              <div className="tp-ovcu-l">
                <span className="tp-ovcu-ic"><Check size={20} strokeWidth={2.2} aria-hidden="true" /></span>
                <div className="tp-grow"><h2 className="tp-ovtitle">You’re all caught up</h2><p>Nobody is waiting on you.</p></div>
              </div>
              <div className="tp-ovcu-r">
                <div className="tp-ovcu-h"><b>Up next</b><span>{o.upNext.length} calls</span></div>
                <ul>
                  {o.upNext.map(a => (
                    <li key={a.id}>
                      <Link to={apptTo(a)} className="tp-ovcu-row">
                        <span className="tp-ovtile"><small>{a.day}</small><b>{a.date}</b></span>
                        <span className="tp-grow"><span className="who">{a.who} <span>· {a.label}</span></span><span className="when">{a.day}, {a.time}</span></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
          <StepsDone days={o.doneByDay} range={o.doneRange} />
        </div>

        <div className="tp-ovsvc-r">
          <Link to={paths.submit()} className="ov-card ov-link tp-ovwk" data-block="this-week" aria-label="This week: open Submit">
            <span className="tp-ovwk-top"><span className="tp-num">{used}</span><span className="of">of {cap} submissions used</span>{used >= cap ? <b className="full">Limit reached</b> : <b className="left">{cap - used} left</b>}</span>
            <span className="tp-ovwk-segs" aria-hidden="true">{Array.from({ length: cap }, (_, i) => <i key={i} className={used >= cap ? 'full' : i < used ? 'on' : ''} />)}</span>
            <span className="tp-ovwk-foot"><span>This week · resets Monday</span><span className="tp-link">Submit<ArrowRight size={13} aria-hidden="true" /></span></span>
          </Link>

          <section className="ov-card tp-ovup" data-block="coming-up" aria-label="Coming up">
            <div className="tp-ovup-head"><h2 className="tp-ovtitle">Coming up</h2><span>{o.dueSoon.filter(s => !s.done).length} steps</span></div>
            <ul className="tp-ovup-list">
              {o.dueSoon.map((s, i) => (
                <li key={s.id}>
                  <Link to={paths.client(s.clientId)} className="tp-ovup-row" aria-label={`Open ${s.clientName}`}>
                    <span className={`tp-ovtile${i === 0 ? ' first' : ''}`}><small>{s.day}</small><b>{s.date}</b></span>
                    <span className="tp-grow"><span className="who">{s.clientName} <span>· {s.label}</span></span><span className="when">{s.dueAt}</span></span>
                    <ChevronRight size={15} aria-hidden="true" className="chev" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <div className="tp-ovlc" data-block="leads-panels">
        <h2 className="tp-ovph-h2">Your leads today</h2>
        {next && (
          <section className="ov-card tp-ovlc-card" data-block="next-appointment" aria-label="Next appointment">
            <div className="tp-ovlc-head"><span className="tp-ovic"><CalendarDays size={16} aria-hidden="true" /></span><h2 className="tp-grow">Next appointment</h2><span className="tp-ovchip">{next.inText}</span></div>
            <p className="tp-ovlc-clock"><b>{next.time.split(' ')[0]}</b><span>{next.time.split(' ')[1]}</span></p>
            <p className="tp-ovlc-name">{next.who}</p>
            <p className="tp-ovlc-sub">{next.label}</p>
            <Link to={apptTo(next)} className="ov-ghost tp-btn tp-ovlc-btn">{next.kind === 'client' ? 'Open client' : 'Open lead'}<ChevronRight size={14} aria-hidden="true" /></Link>
          </section>
        )}
        <section className="ov-card tp-ovlc-card" data-block="live-transfers" aria-label="Live call transfers">
          <div className="tp-ovlc-head"><span className="tp-ovic"><Zap size={16} aria-hidden="true" /></span><div className="tp-grow"><h2>Live call transfers</h2><p className="tp-ovlc-sub">{dutyText}</p></div><DutySwitch on={o.duty} onChange={setDuty} /></div>
          <p className="tp-ovlc-body">While you’re active, our VA sends callers straight to you. When you’re not, we book them on your calendar instead.</p>
        </section>
        <section className="ov-card tp-ovlc-card" data-block="appointments-left" aria-label="Appointments left this month">
          <div className="tp-ovlc-head"><span className="tp-ovic"><CalendarDays size={16} aria-hidden="true" /></span><h2 className="tp-grow">Appointments left this month</h2></div>
          <p className="tp-ovlc-meter"><b>{o.apptsLeft.left}</b><span>of {o.apptsLeft.cap} left</span></p>
          <div className="tp-ovlc-segs" role="img" aria-label={`${o.apptsLeft.cap - o.apptsLeft.left} of ${o.apptsLeft.cap} used`}>{Array.from({ length: o.apptsLeft.cap }, (_, i) => <i key={i} className={i < o.apptsLeft.cap - o.apptsLeft.left ? 'used' : ''} />)}</div>
          <p className="tp-ovlc-foot"><span>{o.apptsLeft.cap - o.apptsLeft.left} used</span><span>Resets {o.apptsLeft.resets}</span></p>
        </section>
        <section className="ov-card tp-ovlc-card" data-block="todays-appointments" aria-label="Today’s appointments">
          <div className="tp-ovlc-head"><div className="tp-grow"><h2>Today’s appointments</h2><p className="tp-ovlc-sub">{o.todayAppts.length} {o.todayAppts.length === 1 ? 'appointment' : 'appointments'} today, times in your time zone</p></div></div>
          <ul className="tp-ovlc-rows">
            {o.todayAppts.map(a => (
              <li key={a.id}>
                <Link to={apptTo(a)} className="tp-ovlc-row" aria-label={`Open ${a.who}`}>
                  <span className="tp-ovlc-tt"><b>{a.time.split(' ')[0]}</b><span>{a.time.split(' ')[1]}</span></span>
                  <span className="tp-grow"><h3>{a.who}</h3><span className="tp-ovlc-sub">{a.label} · {a.inText}</span></span>
                  <span className="tp-ovpill is-booked">Booked</span><ChevronRight size={15} aria-hidden="true" className="chev" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section className="ov-card tp-ovlc-card" data-block="new-leads" aria-label="New leads">
          <div className="tp-ovlc-head"><div className="tp-grow"><h2>New leads</h2><p className="tp-ovlc-sub">{o.newLeads.length} on your list</p></div></div>
          <ul className="tp-ovlc-rows">
            {o.newLeads.map(l => {
              const [tone, label] = PILL[l.stage] || ['new', 'New']
              return (
                <li key={l.id}>
                  <Link to={paths.lead(l.id)} className="tp-ovlc-row" aria-label={`Open ${l.name}`}>
                    <span className="tp-grow"><h3>{l.name}</h3><span className="tp-ovlc-sub">{l.kind === 'live_call' ? 'Live call' : `Appointment${l.appt ? ` · ${l.appt}` : ''}`}</span></span>
                    <span className={`tp-ovpill is-${tone}`}>{label}</span><ChevronRight size={15} aria-hidden="true" className="chev" />
                  </Link>
                </li>
              )
            })}
          </ul>
          <Link to={paths.leads()} className="ov-ghost tp-btn tp-ovlc-btn">See all leads<ArrowRight size={15} aria-hidden="true" /></Link>
        </section>
      </div>
    </div>
  )
}
