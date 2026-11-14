import { useMemo, useState } from 'react'
import { Check, ChevronRight, Hand, Repeat, CalendarX } from 'lucide-react'
import { useAdmDesk, useAdmVas, useAdmRota, useAdmSettings, useAdmActions, WEEK, NEXT_WEEK, TODAY, dayName } from '../data'
import { useAdmShifts } from '../../hooks/useVaShiftsAdmin'
import { useNote } from '../../template/kit'
import { usd } from '../../template/motion'
import { BottomSheet, Ini, rise } from '../../template/m/AppKit'
import { weekCalls, vaHue, theirTime, minutesOf } from '../calendar'
import { CALL_WORD } from '../words'
import { SWAPS, OPEN_SHIFTS, HOLIDAYS, HOLIDAY_WORD, TIMESHEET, sheetTotals, dayHours } from '../p879'
import { DAYS_OFF_DEFAULT, daysUsed, daysLeft } from '../../lib/dayOff'
import { canTakeCalls, TRAIN_FIRST } from '../../lib/trainingGate.js'
import { NUDGE_AFTER, HANDOFF_AFTER } from '../../lib/callEscalation.js'

// P1002 — the Team page's other tabs on the admin phone, the desktop's words and data: Calendar (the week's calls, each
// VA in their colour, a call opens with Give to someone), Time off (the days-a-month allowance, booked days) with Swaps
// and Open shifts, Holidays (on the Rota tab, as on the desktop) and Hours & pay. Same hooks and sample data as
// adminshell/screens/Team.jsx and Team879.jsx.
const cents = usd(true)
const WEEKS = [WEEK, NEXT_WEEK]
const ALL_DAYS = [...WEEK, ...NEXT_WEEK]
const first = name => String(name || '').split(' ')[0]
const Sample = () => <span className="ma-tag am-sample">Sample</span>
// The four tones the phone's palette has stand in for the desktop's five VA colours (lilac has its own in adm1002.css).
const TONE_OF_CALL = { cancelled: 'sage', no_answer: 'butter', live: 'sky', booked: 'sky', late: 'apricot', rebook: 'lilac', failed: 'coral' }

// ── Calendar ────────────────────────────────────────────────────────────────────────────────────────────────────
export function TeamCalendar() {
  const { data: desk } = useAdmDesk()
  const { data: vas } = useAdmVas()
  const { data: rota } = useAdmRota()
  const [week, setWeek] = useState(0)
  const [who, setWho] = useState('all')
  const [sel, setSel] = useState(null)
  const calls = useMemo(() => weekCalls({ desk, rota: rota.rota, vas, today: TODAY, days: ALL_DAYS }), [desk, rota.rota, vas])
  const mine = c => who === 'all' || c.va_id === who
  const countIn = w => calls.filter(c => WEEKS[w].includes(c.day) && mine(c)).length
  const picked = sel ? calls.find(c => c.id === sel) : null
  return (
    <>
      <div className="ma-seg am-seg ma-rise" role="tablist" aria-label="Week">
        {[['This week', 0], ['Next week', 1]].map(([w, i]) => (
          <button key={w} type="button" role="tab" aria-selected={week === i} className={`is-sky${week === i ? ' is-on' : ''}`} onClick={() => setWeek(i)}>{w} <span>{countIn(i)}</span></button>
        ))}
      </div>
      <div className="ma-chips am-vachips ma-rise" style={rise(1)} role="group" aria-label="Show a VA">
        <button type="button" className={`ma-fchip am-fchip${who === 'all' ? ' is-on' : ''}`} aria-pressed={who === 'all'} onClick={() => setWho('all')}>Every VA</button>
        {vas.map(v => (
          <button key={v.id} type="button" className={`ma-fchip am-fchip am-vachip is-${vaHue(vas, v.id)}${who === v.id ? ' is-on' : ''}`} aria-pressed={who === v.id} onClick={() => setWho(who === v.id ? 'all' : v.id)}><i aria-hidden="true" />{first(v.name)}</button>
        ))}
      </div>
      <p className="ma-hint am-clock">Central time · client times beside theirs</p>
      {WEEKS[week].map(d => {
        const list = calls.filter(c => c.day === d && mine(c)).sort((a, b) => minutesOf(a.time) - minutesOf(b.time))
        return (
          <section key={d} className="ma-rise" style={rise(2)} aria-label={`${dayName(d)}, Nov ${d}`}>
            <div className={`am-dayh${d === TODAY ? ' is-today' : ''}`}><b>{dayName(d)} <span className="tp-num">{d}</span></b><small>{d === TODAY ? 'Today · ' : ''}{list.length} {list.length === 1 ? 'call' : 'calls'}</small></div>
            <div className="ma-glass ma-list">
              {list.map(c => {
                const their = theirTime(c.time, c.state)
                return (
                  <button key={c.id} type="button" className="ma-row am-callrow" onClick={() => setSel(c.id)}
                    aria-label={`${c.time}${their ? ` (${their} for the client)` : ''}, ${c.client}, ${c.va}, ${CALL_WORD[c.status]}`}>
                    <span className="ma-time tp-num">{c.time}</span>
                    <span className={`ma-dot is-${vaHue(vas, c.va_id)}`} aria-hidden="true" />
                    <span className="ma-grow"><b>{c.client}</b><small>{first(c.va)} · {CALL_WORD[c.status]}{their ? ` · client ${their}` : ''}</small></span>
                    <ChevronRight size={18} className="ma-chev" aria-hidden="true" />
                  </button>
                )
              })}
              {!list.length && <p className="ma-empty">Nothing booked.</p>}
            </div>
          </section>
        )
      })}
      <CallSheet call={picked} vas={vas} onClose={() => setSel(null)} />
    </>
  )
}

// A call's details: who has it, the client's time, and Give to someone while it's still ahead (the desktop's call drawer).
function EscalationLine({ c, vas }) {
  const name = id => first(vas.find(v => v.id === id)?.name || 'Their VA')
  if (c.moved) return <p className="ma-hint">Moved from {name(c.moved.from)} after {c.moved.after} minutes with no start ({name(c.moved.from)} was told).</p>
  if (c.status === 'rebook') return <p className="ma-hint">Nobody was free {HANDOFF_AFTER} minutes after its time, so the AI front desk is texting the client to rebook.</p>
  if (c.status === 'late') return <p className="ma-hint">Not started yet. {name(c.va_id)} was pinged at {NUDGE_AFTER} minutes; at {HANDOFF_AFTER} it goes to the next free VA by itself (their pod first), or the AI front desk rebooks it.</p>
  return null
}
function CallSheet({ call: c, vas, onClose }) {
  const { giveCall } = useAdmActions()
  const note = useNote()
  const [giving, setGiving] = useState(false)
  const [keep, setKeep] = useState(null)
  if (c && keep !== c.id) { setKeep(c.id); setGiving(false) }
  const their = c ? theirTime(c.time, c.state) : ''
  const open = !!c && (c.status === 'booked' || c.status === 'late')
  const free = c ? vas.filter(v => v.onShift && v.id !== c.va_id && canTakeCalls(v)) : []
  const training = c ? vas.filter(v => v.onShift && v.id !== c.va_id && !canTakeCalls(v)) : []
  return (
    <BottomSheet open={!!c} onClose={onClose} label={c ? `${c.client}, ${c.time}` : 'Call'} tall>
      {c && (
        <>
          <p className="ma-sheet-t">{c.client} · {c.time}</p>
          <p className="ma-sheet-s">Cancellation call · {dayName(c.day ?? TODAY)}, Nov {c.day ?? TODAY} · {c.time} Central{their ? ` · ${their} for them` : ''}</p>
          <div className="ma-glass ma-list am-sheetgap">
            <div className="ma-row"><Ini person name={c.va} size={40} /><span className="ma-grow"><b>{c.va}</b><small>Has this call</small></span><span className={`ma-tag is-${TONE_OF_CALL[c.status] || 'stone'}`}>{CALL_WORD[c.status]}</span></div>
          </div>
          <div className="ma-glass ma-pad va-facts is-glass am-sheetgap">
            {[['Call', 'Cancellation call'], ['Closing', c.old_carrier], ['Agent', c.agent || 'Their agent'], ['Client in', c.state]].map(([k, v]) => <span key={k}><small>{k}</small><b>{v}</b></span>)}
          </div>
          <EscalationLine c={c} vas={vas} />
          {open && (
            <button type="button" className="ma-btn is-solid is-tall ma-press am-wide" aria-expanded={giving} onClick={() => setGiving(g => !g)}><Hand size={18} aria-hidden="true" />Give to someone</button>
          )}
          {open && giving && (
            <div className="ma-glass ma-list am-sheetgap">
              {training.map(v => <div key={v.id} className="ma-row is-off" aria-disabled="true"><Ini person name={v.name} size={40} /><span className="ma-grow"><b>{v.name}</b><small>{TRAIN_FIRST}</small></span></div>)}
              {free.map(v => (
                <button key={v.id} type="button" className="ma-row" onClick={() => { giveCall(c.id, v.id); note(`${c.client} given to ${v.name}`); setGiving(false); onClose() }}>
                  <Ini person name={v.name} size={40} /><span className="ma-grow"><b>{v.name}</b><small>{v.onCall ? 'On a call now' : 'Free now'} · {v.today.total - v.today.done} calls left today</small></span><span className="ma-tag">Give</span>
                </button>
              ))}
              {!free.length && !training.length && <p className="ma-empty">No one else is on shift today.</p>}
            </div>
          )}
        </>
      )}
    </BottomSheet>
  )
}

// ── Time off ────────────────────────────────────────────────────────────────────────────────────────────────────
// No approvals: each VA gets a set number of days off a month (an admin setting), books their own, and can't book more
// once they're used up (src/lib/dayOff.js).
export function TimeOffTab() {
  const data = useAdmShifts()
  const { data: settings } = useAdmSettings()
  const { saveSettings } = useAdmActions()
  const note = useNote()
  const allowance = settings.daysOffPerMonth ?? DAYS_OFF_DEFAULT
  const [n, setN] = useState(String(allowance))
  const booked = data.dayOff.filter(d => d.status !== 'declined')
  const team = data.team || []
  const save = () => {
    const v = Number(n)
    if (!Number.isInteger(v) || v < 0 || v > 15) { note('Pick 0 to 15 days a month'); return }
    saveSettings?.({ daysOffPerMonth: v })
    note(`Each VA gets ${v} ${v === 1 ? 'day' : 'days'} off a month`)
  }
  return (
    <>
      <div className="ma-h2 ma-rise"><h2>Days off each month</h2></div>
      <p className="ma-hint">VAs book their own days. When they've used them up, they can't book more.</p>
      <div className="ma-glass ma-pad ma-rise" style={rise(1)}>
        <div className="am-allow">
          <label className="am-allow-l"><span>Days off a month, per VA</span>
            <input className="am-num tp-num" inputMode="numeric" value={n} onChange={e => setN(e.target.value.replace(/\D/g, ''))} aria-label="Days off a month, per VA" /></label>
          <button type="button" className="ma-btn is-solid ma-press" disabled={Number(n) === allowance} onClick={save}><Check size={18} aria-hidden="true" />Save</button>
        </div>
      </div>
      <div className="ma-glass ma-list ma-rise" style={rise(2)}>
        {team.map(v => {
          const used = daysUsed(booked, v.id)
          const left = daysLeft(booked, v.id, allowance)
          return (
            <div key={v.id} className="ma-row"><Ini person name={v.name} size={40} /><span className="ma-grow"><b>{v.name}</b><small>{used} of {allowance} used this month</small></span><span className={`ma-tag is-${left ? 'sage' : 'stone'}`}>{left ? `${left} left` : 'All used'}</span></div>
          )
        })}
      </div>
      <div className="ma-h2 ma-rise" style={rise(3)}><h2>Booked days off</h2><span>{booked.length ? `${booked.length} this month` : 'None booked'}</span></div>
      <div className="ma-glass ma-list ma-rise" style={rise(3)}>
        {booked.map(r => (
          <div key={r.id} className="ma-row"><Ini person name={r.va} size={40} /><span className="ma-grow"><b>{r.va}</b><small>{data.dateText(r.date)}{r.reason ? ` · ${r.reason}` : ''} · booked {r.asked}</small></span><span className="ma-tag is-sky">Off</span></div>
        ))}
        {!booked.length && <p className="ma-empty">Nobody is off this month.</p>}
      </div>
      <SwapsAndOpen />
    </>
  )
}

// Swap requests between VAs (both agreed; an admin approves) and open shifts pushed to eligible VAs (first to accept,
// then an admin confirms). N-F-07; sample data, the same as the desktop.
function SwapsAndOpen() {
  const note = useNote()
  const [swaps, setSwaps] = useState(SWAPS)
  const [open, setOpen] = useState(OPEN_SHIFTS)
  const decide = (id, ok) => { setSwaps(s => s.map(x => (x.id === id ? { ...x, status: ok ? 'approved' : 'declined' } : x))); note(ok ? 'Swap approved. The rota is updated.' : 'Swap declined') }
  return (
    <>
      <div className="ma-h2 ma-rise" style={rise(4)}><h2>Shift swaps</h2></div>
      <p className="ma-hint">Both VAs agreed; you approve</p>
      <div className="ma-glass ma-list ma-rise" style={rise(4)}>
        {swaps.map(s => (
          <div key={s.id} className="ma-row am-reqrow">
            <span className="ma-sym is-sky"><Repeat size={16} aria-hidden="true" /></span>
            <span className="ma-grow"><b>{s.from} → {s.to}</b><small>{s.day}</small></span>
            {s.status === 'pending'
              ? <span className="am-reqbtns"><button type="button" className="ma-nb is-solidnb ma-press" onClick={() => decide(s.id, true)}>Approve</button><button type="button" className="ma-nb ma-press" onClick={() => decide(s.id, false)}>Decline</button></span>
              : <span className={`ma-tag is-${s.status === 'approved' ? 'sage' : 'stone'}`}>{s.status === 'approved' ? 'Approved' : 'Declined'}</span>}
          </div>
        ))}
        {!swaps.length && <p className="ma-empty">No swap requests.</p>}
      </div>
      <div className="ma-h2 ma-rise" style={rise(5)}><h2>Open shifts</h2></div>
      <p className="ma-hint">Sent to every VA free that day; first to accept takes it</p>
      <div className="ma-glass ma-list ma-rise" style={rise(5)}>
        {open.map(s => (
          <div key={s.id} className="ma-row am-reqrow">
            <span className="ma-sym is-butter"><CalendarX size={16} aria-hidden="true" /></span>
            <span className="ma-grow"><b>{s.day} · <span className="tp-num">{s.hours}</span></b><small>{s.why}{s.accepted ? ` · ${s.accepted} accepted` : ' · nobody yet'}</small></span>
            {s.status === 'accepted' && <button type="button" className="ma-nb is-solidnb ma-press" onClick={() => { setOpen(o => o.map(x => (x.id === s.id ? { ...x, status: 'confirmed' } : x))); note(`${s.accepted} is on the rota for ${s.day}`) }}>Confirm</button>}
            {s.status === 'confirmed' && <span className="ma-tag is-sage">On the rota</span>}
            {s.status === 'open' && <span className="ma-tag is-sky">Waiting</span>}
          </div>
        ))}
      </div>
    </>
  )
}

// ── Holidays ────────────────────────────────────────────────────────────────────────────────────────────────────
const HOLIDAY_TONE = { warn: 'apricot', blue: 'sky', teal: 'sage' }
export function Holidays() {
  const note = useNote()
  return (
    <>
      <div className="ma-h2 ma-rise" style={rise(4)}><h2>Holidays</h2></div>
      <p className="ma-hint">On the rota and the VAs' schedule; closed days run the after-hours path</p>
      <div className="ma-glass ma-list ma-rise" style={rise(4)}>
        {HOLIDAYS.map(h => {
          const [w, tone] = HOLIDAY_WORD[h.kind]
          return (
            <div key={h.id} className="ma-row am-reqrow"><span className="ma-sym is-stone"><CalendarX size={16} aria-hidden="true" /></span><span className="ma-grow"><b>{h.date} · {h.name}</b><small>{h.note}</small></span><span className={`ma-tag is-${HOLIDAY_TONE[tone] || 'stone'}`}>{w}</span></div>
          )
        })}
      </div>
      <button type="button" className="ma-btn is-soft is-tall ma-press am-wide" onClick={() => note('Sample: adding a day saves once the backend is wired')}>Add a day</button>
    </>
  )
}

// ── Hours & pay ─────────────────────────────────────────────────────────────────────────────────────────────────
// The week's pay: each VA's scheduled hours times their rate, days off taken out (P945). No corrections, nothing to approve.
export function HoursPay() {
  const [open, setOpen] = useState(null)
  const rows = TIMESHEET.map(r => ({ ...r, t: sheetTotals(r) }))
  const total = rows.reduce((t, r) => t + r.t.pay, 0)
  const row = rows.find(r => r.va === open)
  return (
    <>
      <div className="ma-h2 ma-rise"><h2>This week's hours</h2><Sample /></div>
      <p className="ma-hint">Nov 2 to 8 · scheduled hours minus days off · pay is hourly</p>
      <div className="ma-plan am-profitline ma-rise" style={rise(1)}>
        <span className="ma-grow"><small>Pay this week</small><b className="tp-money">{cents(total)}</b></span>
      </div>
      <div className="ma-glass ma-list ma-rise" style={rise(2)}>
        {rows.map(r => (
          <button key={r.va} type="button" className="ma-row" onClick={() => setOpen(r.va)}>
            <Ini person name={r.name} size={40} />
            <span className="ma-grow"><b>{r.name}</b><small><span className="tp-num">{r.t.hours.toFixed(2)}</span> h × <span className="tp-money">{cents(r.t.rate)}</span> · {r.days.length} {r.days.length === 1 ? 'shift' : 'shifts'}{r.t.ot ? ` · ${r.t.ot.toFixed(1)} h overtime` : ''}</small></span>
            <span className="ma-val tp-money">{cents(r.t.pay)}</span>
          </button>
        ))}
      </div>
      <p className="ma-note">From the rota: each shift's set hours, days off taken out. Paid in Monday's run; Brayden says yes before anything is paid.</p>
      <BottomSheet open={!!row} onClose={() => setOpen(null)} label={row ? `${row.name}'s shifts` : 'Shifts'} tall>
        {row && (
          <>
            <p className="ma-sheet-t">{row.name}'s shifts</p>
            <p className="ma-sheet-s">Nov 2 to 8 · scheduled hours</p>
            <div className="ma-glass ma-list am-sheetgap">
              {row.days.map(d => (
                <div key={d.d} className="ma-row"><b className="am-dayabbr">{d.d}</b><span className="ma-grow"><b className="tp-num">{d.in} to {d.out}</b><small>Scheduled shift</small></span><span className="ma-val tp-num">{dayHours(d).toFixed(2)} h</span></div>
              ))}
            </div>
          </>
        )}
      </BottomSheet>
    </>
  )
}
