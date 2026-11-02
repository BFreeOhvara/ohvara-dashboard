import { Link, useNavigate } from 'react-router-dom'
import { ShieldCheck, ListChecks, Clock3, TriangleAlert, ArrowRight, Check, Inbox, Wrench } from 'lucide-react'
import { useSampleOverview, useSampleActions } from '../data'
import { Avatar, Chip, useNote } from '../kit'
import { paths } from '../paths'

const SERIES = [['packet', 'Packet checks', 's-packet'], ['review', 'Review calls', 's-review'], ['cancel', 'Cancellations', 's-cancel'], ['save', 'Saves', 's-save']]

function Chart({ days }) {
  const max = Math.max(4, ...days.map(d => d.packet + d.review + d.cancel + d.save))
  return (
    <>
      <div className="tp-bars" role="img" aria-label="Steps done last week, per day">
        {days.map(d => {
          const sum = d.packet + d.review + d.cancel + d.save
          return (
            <div key={d.day}>
              <b>{sum || ''}</b>
              {sum === 0 ? <span className="stack stub" /> : (
                <span className="stack" style={{ height: `${(sum / max) * 150}px` }}>
                  {SERIES.map(([k,, cls]) => d[k] > 0 && <i key={k} className={cls} style={{ flex: d[k] }} />)}
                </span>
              )}
              <span>{d.day}</span>
            </div>
          )
        })}
      </div>
      <div className="tp-legend">{SERIES.map(([k, label, cls]) => <span key={k}><i className={cls} />{label} <b className="tp-money">{days.reduce((n, d) => n + d[k], 0)}</b></span>)}</div>
    </>
  )
}

export default function Overview() {
  const { data: o } = useSampleOverview()
  const { doneTask } = useSampleActions()
  const note = useNote()
  const go = useNavigate()
  const stepsDone = o.doneByDay.reduce((n, d) => n + d.packet + d.review + d.cancel + d.save, 0)
  const book = [
    ['Protected', o.book.protected, 'protected', 'var(--ov-st-cancelled)', 'In force', ShieldCheck],
    ['Setting up', o.book.settingUp, 'setting_up', 'var(--ov-data-a)', 'First 30 days', ListChecks],
    ['Needs attention', o.book.needsAttention, 'needs_attention', 'var(--ov-warn)', 'See who and why', TriangleAlert],
    ['Requests open', o.book.requestsOpen, 'requests', 'var(--nt-purple)', 'In progress', Wrench],
  ]
  return (
    <div className="tp-page">
      <section className="tp-head" aria-label="Your book">
        <h2 className="tp-h1"><span>Good afternoon, {o.name}</span><span className="dim">{o.stepsOpen} steps due this week</span></h2>
        <div className="tp-chips">
          {book.map(([label, n, stage, color, sub, Icon]) => (
            <Link key={stage} to={paths.clients(stage)} className="ov-card ov-link tp-chipcard" style={{ '--c': color }}>
              <span className="tp-row"><span className="tp-chip-ic"><Icon size={16} /></span><b className="tp-grow">{label}</b></span>
              <span className="tp-row"><span className="tp-num" style={{ fontSize: 40 }}>{n}</span><span className="tp-badge">{sub}</span></span>
            </Link>
          ))}
        </div>
      </section>

      <div className="tp-split">
        <div className="tp-stack">
          {o.attention.length > 0 ? (
            <section className="ov-attn tp-card" aria-label="Needs your attention">
              <div className="tp-row"><span className="tp-ic warn"><TriangleAlert size={16} /></span><h2 className="tp-h2 tp-grow">Needs your attention</h2><Link to={paths.clients('needs_attention')} className="tp-link">See all in Clients<ArrowRight size={14} /></Link><span className="tp-tb">{o.attention.length}</span></div>
              <ul className="tp-list">
                {o.attention.map(c => (
                  <li key={c.id} className="tp-li">
                    <Avatar name={`${c.client_first_name} ${c.client_last_name}`} tone="warn" />
                    <span className="tp-grow"><b>{c.client_first_name} {c.client_last_name}</b><small>{c.note}</small></span>
                    <button type="button" className="tp-btn ov-ghost" onClick={() => go(paths.client(c.id))}>Open</button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="ov-card tp-card"><div className="tp-row"><Check size={20} /><div><h2 className="tp-h2">You are all caught up</h2><p className="tp-sub">Nothing needs you right now.</p></div></div></section>
          )}

          <section className="ov-card tp-card" aria-label="Steps done">
            <div className="tp-row tp-between"><div><h2 className="tp-h2">Steps done</h2><p className="tp-sub">Last Monday to Sunday</p></div><span className="tp-num" style={{ fontSize: 30 }}>{stepsDone}</span></div>
            <div style={{ height: 14 }} />
            <Chart days={o.doneByDay} />
          </section>
        </div>

        <div className="tp-stack">
          <section className="ov-card tp-card" aria-label="This week">
            <div className="tp-row"><span className="tp-num" style={{ fontSize: 26 }}>{o.submissions.used}</span><span className="tp-mid">of {o.submissions.cap} submissions</span><b className="tp-grow" style={{ textAlign: 'right' }}>{o.submissions.cap - o.submissions.used} left</b></div>
            <div className="tp-meter">{Array.from({ length: o.submissions.cap }, (_, i) => <i key={i} className={i < o.submissions.used ? 'on' : ''} />)}</div>
            <div className="tp-row tp-between" style={{ marginTop: 8 }}><span className="tp-sub">Resets {o.submissions.resetsAt}</span><Link to={paths.billing()} className="tp-link">Plan<ArrowRight size={14} /></Link></div>
          </section>

          <section className="ov-card tp-card" aria-label="Coming up">
            <div className="tp-row tp-between"><h2 className="tp-h2">Coming up</h2><span className="tp-sub">{o.dueSoon.filter(s => !s.done).length} steps</span></div>
            <ul className="tp-list">
              {o.dueSoon.map((s, i) => (
                <li key={s.id} className="tp-li">
                  <span className={`tp-tilecal${i === 0 ? ' first' : ''}`}><small>{s.day}</small><b>{s.date}</b></span>
                  <Link to={paths.client(s.clientId)} className="tp-grow"><b>{s.clientName}</b><small>{s.label}, {s.dueAt}</small></Link>
                  <button type="button" className="tp-btn ov-ghost" disabled={s.done} onClick={() => { doneTask(s.id); note(`${s.label} for ${s.clientName} marked done`) }}>{s.done ? 'Done' : 'Mark done'}</button>
                </li>
              ))}
            </ul>
          </section>

          <section className="ov-card tp-card" aria-label="Up next">
            <div className="tp-row tp-between"><h2 className="tp-h2">Up next</h2><span className="tp-sub">{o.upNext.length} calls</span></div>
            <ul className="tp-list">
              {o.upNext.map(a => <li key={a.id} className="tp-li"><Clock3 size={18} aria-hidden="true" /><span className="tp-grow"><b>{a.who}</b><small>{a.day}, {a.time}, {a.label}</small></span></li>)}
            </ul>
            <Link to={paths.leads()} className="tp-link"><Inbox size={14} />Open Leads</Link>
          </section>
          <Chip tone="teal">{o.leadsToday} leads in your list</Chip>
        </div>
      </div>
    </div>
  )
}
