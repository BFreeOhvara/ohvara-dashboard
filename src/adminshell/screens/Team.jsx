import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Hand, MessageSquare, CalendarOff, Check, X, GripVertical, Plus, TriangleAlert, Landmark, ArrowUpRight, Phone, ShieldOff, ShieldCheck, Clock3, Headset } from 'lucide-react'
import { useAdmVas, useAdmDesk, useAdmRota, useAdmActions, useAdmMoney, WEEK, NEXT_WEEK, TODAY, SHIFT_MIN, SHIFT_MAX, dayName, dateText } from '../data'
import { Avatar, Chip, Drawer, PillTabs, Seg, useNote } from '../../template/kit'
import { RecordDrawer, Block } from '../../template/Record'
import { CountUp, usd } from '../../template/motion'
import { Dropdown, DField, Tile } from '../kit'
import { ap } from '../paths'
import { CALL_WORD, CALL_TONE, BANK_WORD, PAY_WORD } from '../words'

// P849 — the Fulfillment team: today's desk (every VA's calls on one timeline, the calls past their time and Give to,
// as admin_give_call does today), the weekly rota builder (two or three on shift every day; drag a VA onto a day, drag
// between days, or tap a VA then tap a day), day-off requests to approve, and the week's pay. A VA opens in a drawer at
// /admin/fulfillment/:id. Sample only: nothing is assigned or paid for real.
const money = usd()
const START = 8 * 60
const END = 20 * 60
const NOW = 13 * 60 + 30 // the sample "now", 1:30 PM
const mins = t => { const [, h, m, ap2] = t.match(/(\d+):(\d+) (AM|PM)/); return ((+h % 12) + (ap2 === 'PM' ? 12 : 0)) * 60 + +m }
const pct = m => `${((Math.min(END, Math.max(START, m)) - START) / (END - START)) * 100}%`

// Pick someone free for a call: on shift today, not on a call now.
function GivePicker({ call, vas, onPick }) {
  const free = vas.filter(v => v.onShift && v.id !== call.va_id)
  return (
    <ul className="tp-list">
      {free.map(v => (
        <li key={v.id}><button type="button" className="fx-mrow" onClick={() => onPick(v)}>
          <Avatar name={v.name} /><span className="tp-grow"><b>{v.name}</b><small>{v.onCall ? 'On a call now' : 'Free now'} · {v.today.total - v.today.done} calls left today</small></span>
          <span className="fx-pillbtn"><Hand size={13} />Give</span>
        </button></li>
      ))}
      {free.length === 0 && <li className="tp-sub">No one else is on shift today.</li>}
    </ul>
  )
}

function CallDrawer({ id, onClose }) {
  const { data: desk } = useAdmDesk()
  const { data: vas } = useAdmVas()
  const { giveCall } = useAdmActions()
  const note = useNote()
  const c = desk.find(x => x.id === id)
  const [giving, setGiving] = useState(false)
  if (!c) return null
  const tone = CALL_TONE[c.status]
  return (
    <Drawer open onClose={onClose} title={`${c.client} · ${c.time}`} sub={`Cancellation call · ${c.agent}'s client · closing ${c.old_carrier}`}
      footer={c.status === 'booked' || c.status === 'late' ? <button type="button" className="tp-primary fx-accent" onClick={() => setGiving(g => !g)}><Hand size={16} />Give to someone</button> : null}>
      <div className="fx-form-row"><Avatar name={c.va} /><span className="tp-grow"><b>{c.va}</b><small className="tp-sub">Has this call</small></span><Chip tone={tone}>{CALL_WORD[c.status]}</Chip></div>
      {c.status === 'late' && <p className="ad-warn">Past its time and not started. Give it to someone free so the client isn't left waiting.</p>}
      {giving && <GivePicker call={c} vas={vas} onPick={v => { giveCall(c.id, v.id); note(`${c.client} given to ${v.name}`); setGiving(false); onClose() }} />}
    </Drawer>
  )
}

function Desk({ openCall }) {
  const { data: desk } = useAdmDesk()
  const { data: vas } = useAdmVas()
  const { giveCall } = useAdmActions()
  const note = useNote()
  const [giveAll, setGiveAll] = useState(false)
  const late = desk.filter(c => c.status === 'late')
  const rows = vas.filter(v => v.onShift || desk.some(c => c.va_id === v.id))
  const counts = Object.keys(CALL_WORD).map(k => [k, desk.filter(c => c.status === k).length])
  const freeSoonest = vas.filter(v => v.onShift && !v.onCall).sort((a, b) => (a.today.total - a.today.done) - (b.today.total - b.today.done))[0]
  return (
    <>
      <section className="fx-tile ad-desk" style={{ '--i': 0 }} aria-label="Today's desk">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Today's desk</h2><p>{dateText(TODAY)} · {desk.length} calls · the line is now (sample)</p></span></header>
        <ul className="ad-legend">{counts.map(([k, n]) => <li key={k} className={`is-${CALL_TONE[k]}`}><i aria-hidden="true" />{CALL_WORD[k]} <b className="tp-num">{n}</b></li>)}</ul>
        <div className="ad-tl" role="table" aria-label="Calls by person">
          <div className="ad-tl-axis" aria-hidden="true">{[8, 10, 12, 14, 16, 18, 20].map(h => <span key={h} style={{ left: pct(h * 60) }}>{h > 12 ? h - 12 : h}{h >= 12 ? 'p' : 'a'}</span>)}</div>
          {rows.map((v, i) => {
            const mine = desk.filter(c => c.va_id === v.id)
            return (
              <div key={v.id} className="ad-tl-row" role="row" style={{ '--i': i }}>
                <Link to={ap('team', v.id)} className="ad-tl-who" role="rowheader"><Avatar name={v.name} /><span><b>{v.name.split(' ')[0]}</b><small>{v.onCall ? 'On a call' : v.onShift ? v.hours.replace(' to ', '–') : 'Off today'}</small></span></Link>
                <div className="ad-tl-track" role="cell">
                  <i className="ad-tl-now" style={{ left: pct(NOW) }} aria-hidden="true" />
                  {mine.map(c => (
                    <button key={c.id} type="button" className={`ad-tl-dot is-${CALL_TONE[c.status]}${c.status === 'live' ? ' is-live' : ''}`} style={{ left: pct(mins(c.time)) }}
                      aria-label={`${c.time} ${c.client}: ${CALL_WORD[c.status]}`} data-tip={`${c.time} · ${c.client}`} onClick={() => openCall(c.id)} />
                  ))}
                </div>
                <span className="ad-tl-n" role="cell"><b className="tp-num">{v.today.done}</b>/{v.today.total}</span>
              </div>
            )
          })}
        </div>
      </section>

      <div className="ad-two">
        <Tile className={late.length ? 'is-fill is-warn' : ''} i={1} title="Need a hand" sub={late.length ? `${late.length} calls past their time, not started` : 'Nothing is past its time'}>
          {late.length > 0 ? <>
            <ul className="tp-list">{late.map(c => (
              <li key={c.id}><button type="button" className="fx-mrow" onClick={() => openCall(c.id)}><Clock3 size={16} aria-hidden="true" /><span className="tp-grow"><b>{c.client}</b><small>{c.time} · {c.va}</small></span><span className="fx-pillbtn"><Hand size={13} />Give</span></button></li>
            ))}</ul>
            <button type="button" className="tp-primary sm fx-accent fx-self" onClick={() => setGiveAll(true)}><Hand size={14} />Give them all</button>
          </> : <p className="fx-calm"><Check size={16} aria-hidden="true" />The desk is on time.</p>}
        </Tile>
        <Tile i={2} title="Who is free" sub="On shift and not on a call">
          <ul className="tp-list">{vas.filter(v => v.onShift).map(v => (
            <li key={v.id} className="fx-mrow"><Avatar name={v.name} /><span className="tp-grow"><b>{v.name}</b><small>{v.today.total - v.today.done} calls left · {v.steps} servicing steps</small></span><Chip tone={v.onCall ? 'teal' : 'green'}>{v.onCall ? 'On a call' : 'Free'}</Chip></li>
          ))}</ul>
        </Tile>
      </div>

      <Drawer open={giveAll} center onClose={() => setGiveAll(false)} title="Give them all" sub={`${late.length} calls past their time`}
        footer={freeSoonest ? <><button type="button" className="tp-primary fx-accent" onClick={() => { late.forEach(c => giveCall(c.id, freeSoonest.id)); note(`${late.length} calls given to ${freeSoonest.name}`); setGiveAll(false) }}><Hand size={16} />Give all to {freeSoonest.name.split(' ')[0]}</button><button type="button" className="tp-btn ov-ghost" onClick={() => setGiveAll(false)}>Cancel</button></> : null}>
        <p className="tp-mid">{freeSoonest ? `${freeSoonest.name} is free soonest. Or open one call to pick who.` : 'Nobody on shift is free. Open one call to pick who.'}</p>
      </Drawer>
    </>
  )
}

function Rota() {
  const { data } = useAdmRota()
  const { data: vas } = useAdmVas()
  const { addShift, removeShift, moveShift } = useAdmActions()
  const note = useNote()
  const [week, setWeek] = useState('this')
  const [picked, setPicked] = useState(null)
  const [over, setOver] = useState(null)
  const days = week === 'this' ? WEEK : NEXT_WEEK
  const nameOf = id => vas.find(v => v.id === id)?.name || ''
  const offOn = d => data.dayOff.filter(x => x.date === d && x.status === 'approved')
  const place = (date, vaId, from) => {
    const day = data.rota[date] || []
    if (day.includes(vaId)) { note(`${nameOf(vaId).split(' ')[0]} is already on ${dateText(date)}`); return }
    if (day.length >= SHIFT_MAX) { note(`Three is the most on one day. Take someone off ${dayName(date)} first.`); return }
    if (offOn(date).some(x => x.va_id === vaId)) { note(`${nameOf(vaId).split(' ')[0]} has ${dateText(date)} off`); return }
    if (from) moveShift(from, date, vaId); else addShift(date, vaId)
    note(`${nameOf(vaId).split(' ')[0]} on shift ${dateText(date)}`)
    setPicked(null)
  }
  const drop = date => e => {
    e.preventDefault(); setOver(null)
    try { const { vaId, from } = JSON.parse(e.dataTransfer.getData('text/plain')); place(date, vaId, from) } catch { /* not ours */ }
  }
  const drag = (vaId, from = null) => e => { e.dataTransfer.setData('text/plain', JSON.stringify({ vaId, from })); e.dataTransfer.effectAllowed = 'move' }
  const short = days.filter(d => (data.rota[d] || []).length < SHIFT_MIN)
  return (
    <section className="fx-tile ad-rota" style={{ '--i': 0 }} aria-label="Rota">
      <header className="fx-tile-h">
        <span className="tp-grow"><h2>Weekly rota</h2><p>{SHIFT_MIN} or {SHIFT_MAX} on shift every day. Drag someone onto a day, or tap them and then a day.</p></span>
        <Seg label="Week" value={week} onChange={setWeek} options={[{ key: 'this', label: 'Nov 2 to 8' }, { key: 'next', label: 'Nov 9 to 15' }]} />
      </header>
      <div className="ad-rota-pool" role="group" aria-label="The team">
        {vas.map(v => (
          <button key={v.id} type="button" draggable onDragStart={drag(v.id)} aria-pressed={picked === v.id}
            className={`ad-chip${picked === v.id ? ' is-on' : ''}`} onClick={() => setPicked(p => (p === v.id ? null : v.id))}>
            <GripVertical size={13} aria-hidden="true" /><Avatar name={v.name} /><b>{v.name.split(' ')[0]}</b><small>{days.filter(d => (data.rota[d] || []).includes(v.id)).length} days</small>
          </button>
        ))}
      </div>
      {short.length > 0 && <p className="ad-warn"><TriangleAlert size={14} aria-hidden="true" />{short.map(dayName).join(', ')} {short.length === 1 ? 'has' : 'have'} fewer than {SHIFT_MIN} on shift.</p>}
      <div className="ad-rota-grid">
        {days.map((d, i) => {
          const on = data.rota[d] || []
          const bad = on.length < SHIFT_MIN || on.length > SHIFT_MAX
          return (
            <div key={d} className={`ad-day${d === TODAY ? ' is-today' : ''}${d < TODAY ? ' is-past' : ''}${over === d ? ' is-over' : ''}${bad ? ' is-short' : ''}`} style={{ '--i': i }}
              onDragOver={e => { e.preventDefault(); setOver(d) }} onDragLeave={() => setOver(o => (o === d ? null : o))} onDrop={drop(d)}>
              <header><b>{dayName(d)}</b><small>Nov {d}</small><span className={`ad-count${bad ? ' is-bad' : ''}`}>{on.length}/{SHIFT_MAX}</span></header>
              <ul>
                {on.map(id => (
                  <li key={id} draggable onDragStart={drag(id, d)} className="ad-shiftchip">
                    <Avatar name={nameOf(id)} /><b>{nameOf(id).split(' ')[0]}</b>
                    <button type="button" className="ad-x" aria-label={`Take ${nameOf(id)} off ${dateText(d)}`} onClick={() => { removeShift(d, id); note(`${nameOf(id).split(' ')[0]} off ${dateText(d)}`) }}><X size={13} /></button>
                  </li>
                ))}
                {offOn(d).map(x => <li key={x.id} className="ad-offchip"><CalendarOff size={12} aria-hidden="true" />{x.va.split(' ')[0]} off</li>)}
              </ul>
              {picked && !on.includes(picked) && on.length < SHIFT_MAX && <button type="button" className="ad-place" onClick={() => place(d, picked)}><Plus size={13} />Put {nameOf(picked).split(' ')[0]} here</button>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Requests() {
  const { data } = useAdmRota()
  const { decideDayOff } = useAdmActions()
  const note = useNote()
  const pending = data.dayOff.filter(d => d.status === 'pending')
  const done = data.dayOff.filter(d => d.status !== 'pending')
  return (
    <div className="ad-two">
      <Tile i={0} title="Day-off requests" sub={pending.length ? `${pending.length} to answer` : 'Nothing to answer'}>
        <ul className="tp-list">{pending.map(r => {
          const left = (data.rota[r.date] || []).filter(x => x !== r.va_id).length
          const onShift = (data.rota[r.date] || []).includes(r.va_id)
          return (
            <li key={r.id} className="ad-req">
              <Avatar name={r.va} />
              <span className="tp-grow"><b>{r.va} · {dateText(r.date)}</b><small>{r.reason} · asked {r.asked}</small>
                {onShift && left < SHIFT_MIN && <small className="ad-warn-t"><TriangleAlert size={12} aria-hidden="true" />Leaves {left} on shift. Add someone on the rota.</small>}</span>
              <button type="button" className="tp-primary sm fx-accent" onClick={() => { decideDayOff(r.id, true); note(`${r.va.split(' ')[0]} has ${dateText(r.date)} off`) }}><Check size={14} />Approve</button>
              <button type="button" className="tp-btn sm ov-ghost" onClick={() => { decideDayOff(r.id, false); note('Request declined') }}>Decline</button>
            </li>
          )
        })}{pending.length === 0 && <li className="fx-calm"><Check size={16} aria-hidden="true" />All answered.</li>}</ul>
      </Tile>
      <Tile i={1} title="Answered" sub="This month">
        <ul className="tp-list">{done.map(r => <li key={r.id} className="fx-mrow"><Avatar name={r.va} /><span className="tp-grow"><b>{r.va}</b><small>{dateText(r.date)} · {r.reason}</small></span><Chip tone={r.status === 'approved' ? 'green' : 'mute'}>{r.status === 'approved' ? 'Approved' : 'Declined'}</Chip></li>)}</ul>
      </Tile>
    </div>
  )
}

function Pay() {
  const { data: vas } = useAdmVas()
  const { data: m } = useAdmMoney()
  const total = vas.reduce((t, v) => t + v.week.verified + v.week.checking, 0)
  return (
    <div className="ad-two">
      <Tile i={0} title="This week's pay" sub={`Nov 2 to 8 · ${money(m.rate)} a confirmed cancellation · paid ${m.payday}`} to={`${ap('billing')}?tab=payouts`} label="Open payouts">
        <b className="fx-huge tp-money"><CountUp value={total} format={money} /></b>
        <ul className="tp-list ad-rows">{vas.map(v => {
          const [bw, bt] = BANK_WORD[v.bank]
          return (
            <li key={v.id} className="fx-mrow"><Avatar name={v.name} /><span className="tp-grow"><b>{v.name}</b><small>{v.week.cancels} cancellations{v.week.listen ? ` · ${v.week.listen} ${PAY_WORD.needs_listen[0].toLowerCase()}` : ''}</small></span><Chip tone={bt}>{bw}</Chip><b className="tp-money">{money(v.week.verified + v.week.checking)}</b></li>
          )
        })}</ul>
      </Tile>
      <Tile className="is-fill is-green" i={1} title="Next pay run" sub={`${m.payday}, ${m.paused ? 'paused' : 'automatic'}`}>
        <b className="fx-huge tp-money"><CountUp value={m.runTotal} format={money} /></b>
        <small>Verified so far, to people with a bank. Checking joins once confirmed.</small>
        <Link to={`${ap('billing')}?tab=payouts`} className="fx-pillbtn fx-self"><Landmark size={14} />Payouts<ArrowUpRight size={14} /></Link>
      </Tile>
    </div>
  )
}

function VaDrawer({ id, onClose }) {
  const { data: vas } = useAdmVas()
  const { data: desk } = useAdmDesk()
  const { data } = useAdmRota()
  const { setAccess, setRole } = useAdmActions()
  const note = useNote()
  const navigate = useNavigate()
  const [ask, setAsk] = useState(null)
  const v = vas.find(x => x.id === id)
  if (!v) return <RecordDrawer label="Not found" kicker="Fulfillment" onClose={onClose} hero={<h2>No one here</h2>}><p className="fx-calm">This person is not on the team any more.</p></RecordDrawer>
  const mine = desk.filter(c => c.va_id === v.id)
  const tone = v.onCall ? 'teal' : v.onShift ? 'green' : 'mute'
  const [bw, bt] = BANK_WORD[v.bank]
  return (
    <RecordDrawer label={v.name} kicker={`Fulfillment · joined ${v.joined}`} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><Headset size={13} aria-hidden="true" />{v.onCall ? 'On a call now' : v.onShift ? `On shift · ${v.hours}` : 'Off today'}</span><Chip tone={bt}>{bw}</Chip></div>
        <h2>{v.name}</h2>
        <p><Phone size={13} aria-hidden="true" />{v.phone} · {v.email}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big tp-money">{money(v.week.verified + v.week.checking)}</b><Avatar name={v.name} tone={tone} /></div>
      </>}
      actions={<>
        <Link to={`${ap('messages')}?to=${v.id}`} className="tp-primary fx-accent"><MessageSquare size={16} />Message</Link>
        <Link to={`${ap('team')}?tab=rota`} className="tp-btn ov-ghost">Rota</Link>
      </>}>
      <Block title="This week">
        <dl className="fx-facts">{[['On shift', `${v.days} of 7 days`], ['Cancellations', String(v.week.cancels)], ['Missed calls', String(v.missed)], ['Servicing steps', String(v.steps)]].map(([k, x]) => <div key={k}><dt>{k}</dt><dd>{x}</dd></div>)}</dl>
        <div className="ad-weekdots" aria-label="Days on shift">{WEEK.map(d => <span key={d} className={(data.rota[d] || []).includes(v.id) ? 'is-on' : ''}><small>{dayName(d)}</small></span>)}</div>
      </Block>
      <Block title="Today's calls">
        <ul className="tp-list">{mine.map(c => <li key={c.id} className="fx-mrow"><small className="tp-num ad-time">{c.time}</small><span className="tp-grow"><b>{c.client}</b><small>{c.old_carrier} · {c.agent}</small></span><Chip tone={CALL_TONE[c.status]}>{CALL_WORD[c.status]}</Chip></li>)}
          {mine.length === 0 && <li className="tp-sub">No calls today.</li>}</ul>
      </Block>
      <Block title="Access">
        <DField label="Role"><Dropdown label="Role" value="fulfillment" options={[{ value: 'fulfillment', label: 'Fulfillment' }, { value: 'agent', label: 'Agent' }]} onChange={x => x !== 'fulfillment' && setAsk('role')} /></DField>
        <div className="fx-form-row">
          {v.access
            ? <button type="button" className="tp-btn ov-ghost tp-danger" onClick={() => setAsk('off')}><ShieldOff size={15} />Turn access off</button>
            : <button type="button" className="tp-btn ov-ghost" onClick={() => { setAccess(v.id, true); note(`${v.name} can sign in again`) }}><ShieldCheck size={15} />Turn access back on</button>}
        </div>
      </Block>
      <Drawer open={ask === 'off'} center onClose={() => setAsk(null)} title="Turn access off?" sub={v.name}
        footer={<><button type="button" className="tp-primary fx-accent" onClick={() => { setAccess(v.id, false); note(`${v.name} can't sign in now`); setAsk(null) }}>Turn it off</button><button type="button" className="tp-btn ov-ghost" onClick={() => setAsk(null)}>Keep access</button></>}>
        <p className="tp-mid">They are signed out. {mine.filter(c => c.status === 'booked' || c.status === 'late').length ? 'Give their open calls to someone first.' : 'They have no open calls today.'}</p>
      </Drawer>
      <Drawer open={ask === 'role'} center onClose={() => setAsk(null)} title="Make them an agent?" sub={v.name}
        footer={<><button type="button" className="tp-primary fx-accent" onClick={() => { setRole(v.id, 'agent'); note(`${v.name} is an agent now`); setAsk(null); navigate(ap('agents', v.id)) }}>Change the role</button><button type="button" className="tp-btn ov-ghost" onClick={() => setAsk(null)}>Keep Fulfillment</button></>}>
        <p className="tp-mid">{mine.length ? `${v.name} has ${mine.length} calls today. They need someone else.` : 'They have no calls today.'} They come off the rota.</p>
      </Drawer>
    </RecordDrawer>
  )
}

const TABS = [['today', 'Today'], ['rota', 'Rota'], ['requests', 'Day off'], ['pay', 'Pay']]
export default function Team() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const { data: rota } = useAdmRota()
  const tab = TABS.some(t => t[0] === sp.get('tab')) ? sp.get('tab') : 'today'
  const call = sp.get('call')
  const pending = rota.dayOff.filter(d => d.status === 'pending').length
  const setTab = t => setSp(t === 'today' ? {} : { tab: t }, { replace: true })
  return (
    <div className="tp-page fx-page ad-team">
      <PillTabs label="Fulfillment team" className="fx-ptabs ad-pagetabs" itemClass="fx-ptab" value={tab} onChange={setTab}
        items={TABS.map(([k, label]) => ({ key: k, label, count: k === 'requests' && pending ? pending : undefined }))} />
      <div className="ad-tabpane" key={tab} role="tabpanel">
        {tab === 'today' && <Desk openCall={c => setSp({ call: c }, { replace: true })} />}
        {tab === 'rota' && <Rota />}
        {tab === 'requests' && <Requests />}
        {tab === 'pay' && <Pay />}
      </div>
      {call && <CallDrawer id={call} onClose={() => setSp({}, { replace: true })} />}
      {id && <VaDrawer id={id} onClose={() => navigate(ap('team'))} />}
    </div>
  )
}
