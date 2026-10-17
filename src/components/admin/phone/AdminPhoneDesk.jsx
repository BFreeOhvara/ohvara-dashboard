import { useMemo, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useFulfillmentQueue, useGiveCalls } from '../../../hooks/usePolicies'
import { useCallOutcomes } from '../../../hooks/useRepCallEvents'
import { useAllProfiles } from '../../../hooks/useProfiles'
import { isLive, useNow } from '../../../lib/agentBookings'
import { KIND, NOBODY, bestTaker, canGive, deskDay, giveOptions, shiftOf } from '../../../lib/adminDesk'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../../../lib/timezones'
import { dayBounds, timeText } from '../../../lib/fulfillmentDay'
import { fullName } from '../../../lib/policyFormat'
import { Avatar } from '../../ui/Avatar'
import { PhoneSheet } from '../../agent/phone/PhoneSheet'
import { PhoneToast } from './PhoneToast'

// Prompt 774 — the desk on a phone (mockup AdmDesk.dc.html), the phone
// version of Admin Fulfillment for today: a 4-part filter (Live / Past time /
// To call / Done), the calls past their time with one button that gives them
// all to whoever is free soonest (same admin_give_call as desktop; "Pick who"
// when nobody can take them all), and one card per person on the desk (status,
// tally, a bar of their calls). A card opens their day as a list. Rules are
// lib/adminDesk.js, shared with desktop.

const FILTERS = [
  { k: 'live', label: 'Live', color: 'var(--ov-live)', has: c => c.k === 'live' },
  { k: 'stuck', label: 'Past time', color: 'var(--ov-st-needs)', has: c => c.k === 'stuck' },
  { k: 'bk', label: 'To call', color: 'var(--ov-st-booked)', has: c => c.k === 'bk' },
  { k: 'done', label: 'Done', color: 'var(--ov-st-cancelled)', has: c => c.k === 'cx' || c.k === 'na' },
]
const TONE = { live: 'var(--ov-live)', warn: 'var(--ov-st-needs)', free: 'var(--ov-st-cancelled)', next: 'var(--ov-st-booked)', mute: 'var(--ov-mute)' }
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const carrierOf = p => p.current_carrier || p.carrier_name || 'Carrier not noted'
const firstOf = name => String(name || '').trim().split(/\s+/)[0] || ''
const mins = (now, ms) => Math.max(0, Math.floor((now - ms) / 6e4))

function giveWord(n, name) {
  if (n === 1) return `Give it to ${name}`
  if (n === 2) return `Give both to ${name}`
  return `Give all ${n} to ${name}`
}

function statusOf(l, now, tz) {
  if (l.id === NOBODY) return { text: 'Not given to anyone', tone: 'warn' }
  if (l.rep && !l.rep.is_active) return { text: 'Off today', tone: 'mute' }
  const lc = l.calls.find(c => c.k === 'live')
  if (lc) return { text: `On a call · ${mins(now, lc.ms)} min`, tone: 'live' }
  const stuck = l.calls.filter(c => c.k === 'stuck').length
  if (stuck) return { text: `${stuck} past their time`, tone: 'warn' }
  const ahead = l.calls.filter(c => !c.done && c.ms > now)
  if (ahead.length) {
    const soon = ahead[0].ms - now <= 90 * 6e4
    return { text: `${soon ? 'Next at' : 'Free until'} ${timeText(ahead[0].at, tz)}`, tone: soon ? 'next' : 'free' }
  }
  if (l.shift && now < l.shift.endMs) return { text: 'Free, no more calls', tone: 'free' }
  return { text: 'Done for today', tone: 'mute' }
}

// Live first, then whoever has calls past their time, then everyone else.
const rank = l => (l.calls.some(c => c.k === 'live') ? 0 : l.calls.some(c => c.k === 'stuck') ? 1 : 2)

function callWord(c, now) {
  if (c.k === 'live') return `On the call · ${mins(now, c.ms)} min`
  if (c.k === 'cx') return 'Cancelled'
  if (c.k === 'na') return `No answer${c.attempt > 1 ? ` · try ${c.attempt}` : ''}`
  if (c.k === 'stuck') return 'Past its time, not started'
  return c.retry ? `Still to call · try ${c.attempt}` : 'Still to call'
}

// Who to give these calls to, when nobody can take them all in one tap.
function PickWho({ calls, reps, rows, tz, onClose, onGiven }) {
  const give = useGiveCalls()
  const [err, setErr] = useState(null)
  const opts = useMemo(() => giveOptions(calls, reps, rows), [calls, reps, rows])
  const one = calls.length === 1 ? calls[0] : null
  const line = o => {
    const free = o.ids.length
    if (!free) return { text: one ? 'Has a call then' : 'Has calls at those times', tone: 'mute' }
    const off = o.offShift ? ` · ${o.offShift === free && one ? 'off shift then' : `${o.offShift} off shift`}` : ''
    return { text: (one ? `Free at ${timeText(one.at, tz)}` : `Free for ${free} of ${o.open}`) + off, tone: o.offShift ? 'warn' : 'free' }
  }
  const pick = o => {
    setErr(null)
    give.mutate({ ids: o.ids, to: o.rep.id }, {
      onSuccess: () => onGiven(`Given to ${o.rep.full_name || 'them'}`),
      onError: e => setErr(e?.message || 'That didn’t go through. Try again.'),
    })
  }
  return (
    <PhoneSheet label="Give to" onClose={() => !give.isPending && onClose()}
      head={(
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="aph-title" style={{ marginTop: 0, fontSize: 20 }}>{one ? 'Give this call to' : `Give ${plural(calls.length, 'call')} to`}</span>
          <span className="aph-sub">{calls.map(c => timeText(c.at, tz)).join(' · ')}</span>
        </span>
      )}>
      <div className="ov-card ph-card" style={{ marginTop: 14 }}>
        {!opts.length && <div className="ph-empty">No one else is on Fulfillment.</div>}
        {opts.map(o => {
          const l = line(o)
          return (
            <button key={o.rep.id} type="button" className="ph-row" disabled={!o.ids.length || give.isPending} onClick={() => pick(o)}
              style={{ opacity: o.ids.length ? 1 : 0.5 }}>
              <Avatar profile={o.rep} size={40} />
              <span className="ph-row-main">
                <span className="ph-row-title">{o.rep.full_name || 'Unnamed'}</span>
                <span className="ph-row-sub" style={{ color: TONE[l.tone], fontWeight: 700 }}>{l.text}</span>
              </span>
              {o.ids.length > 0 && <span className="aph-givego">{give.isPending && give.variables?.to === o.rep.id ? 'Giving…' : 'Give'}</span>}
            </button>
          )
        })}
      </div>
      {err && <p className="ph-err" role="alert" style={{ marginTop: 12 }}>{err}</p>}
    </PhoneSheet>
  )
}

// One person's day, as a list.
function PersonDay({ l, now, tz, onClose, onGive }) {
  const st = statusOf(l, now, tz)
  return (
    <PhoneSheet label={l.name} onClose={onClose}
      head={(
        <>
          {l.rep ? <Avatar profile={l.rep} size={44} /> : <span className="aph-noav">?</span>}
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="aph-title" style={{ marginTop: 0, fontSize: 20 }}>{l.name}</span>
            <span className="aph-sub" style={{ color: TONE[st.tone], fontWeight: 700 }}>{st.text}</span>
          </span>
        </>
      )}>
      <div className="ov-card ph-card" style={{ marginTop: 14 }}>
        {l.calls.map(c => (
          <div key={c.key} className="ph-row aph-dayrow" style={{ cursor: 'default' }}>
            <span className="aph-daytime" style={{ color: c.k === 'stuck' ? 'var(--ov-st-needs)' : c.k === 'live' ? 'var(--ov-live)' : 'var(--ov-hi)' }}>{timeText(c.at, tz)}</span>
            <span className="ph-row-main">
              <span className="ph-row-title">{fullName(c.p) || 'Client'}</span>
              <span className="ph-row-sub">{carrierOf(c.p)} · <span style={{ color: KIND[c.k].seg === KIND.bk.seg ? 'var(--ov-st-booked)' : KIND[c.k].seg, fontWeight: 700 }}>{callWord(c, now)}</span></span>
            </span>
            {canGive(c) && <button type="button" className="aph-givebtn" onClick={() => onGive([c])}>Give</button>}
          </div>
        ))}
      </div>
    </PhoneSheet>
  )
}

export function AdminPhoneDesk() {
  const { profile } = useAuth()
  const { data: queue = [], isLoading } = useFulfillmentQueue()
  const { data: profiles = [] } = useAllProfiles()
  const now = useNow(15e3)
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const day = zonedDateStr(now, tz)
  const [filter, setFilter] = useState(null)
  const [personId, setPersonId] = useState(null)
  const [picking, setPicking] = useState(null) // call keys
  const [toast, setToast] = useState(null)
  const give = useGiveCalls()
  const [giveErr, setGiveErr] = useState(null)

  const reps = useMemo(() => profiles.filter(r => r.role === 'fulfillment'), [profiles])
  const repById = useMemo(() => new Map(reps.map(r => [r.id, r])), [reps])
  const activeReps = useMemo(() => reps.filter(r => r.is_active).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')), [reps])

  const { startMs, endMs } = dayBounds(day, tz)
  const { data: events = [], isLoading: eventsLoading } = useCallOutcomes(new Date(startMs).toISOString(), new Date(endMs).toISOString(), { live: queue.some(isLive) })
  const busy = isLoading || eventsLoading || !profile
  const calls = useMemo(() => (busy ? [] : deskDay(queue, now, tz, day, events, repById)), [busy, queue, now, tz, day, events, repById])

  const lanes = useMemo(() => {
    const by = new Map()
    for (const c of calls) {
      if (!by.has(c.owner)) by.set(c.owner, [])
      by.get(c.owner).push(c)
    }
    return [...by.entries()].map(([id, list]) => {
      const rep = repById.get(id) || null
      return { id, rep, name: rep?.full_name || list[0].p.assigned?.full_name || 'Nobody yet', calls: list, shift: shiftOf(rep, day) }
    }).sort((a, b) => (a.id === NOBODY) - (b.id === NOBODY) || rank(a) - rank(b) || a.name.localeCompare(b.name))
  }, [calls, repById, day])

  const count = Object.fromEntries(FILTERS.map(f => [f.k, calls.filter(f.has).length]))
  const stuck = calls.filter(c => c.k === 'stuck')
  const taker = useMemo(() => (stuck.length ? bestTaker(stuck, activeReps, queue, now) : null), [stuck, activeReps, queue, now])
  const stuckOwners = [...new Set(stuck.map(c => c.owner))]
  const stuckWho = stuckOwners.length === 1
    ? (stuckOwners[0] === NOBODY ? 'Nobody has these yet.' : `${firstOf(stuck[0].ownerName)} hasn’t started ${stuck.length === 1 ? 'this' : 'these'}.`)
    : 'These haven’t started.'
  const onDesk = lanes.filter(l => l.id !== NOBODY).length
  const f = FILTERS.find(x => x.k === filter) || null
  const shown = f ? lanes.filter(l => l.calls.some(f.has)) : lanes
  const person = personId ? lanes.find(l => l.id === personId) || null : null
  const pickCalls = picking ? calls.filter(c => picking.includes(c.key) && canGive(c)) : []
  const pickOpen = pickCalls.length > 0

  function giveAll() {
    if (!taker) { setPicking(stuck.map(c => c.key)); return }
    setGiveErr(null)
    give.mutate({ ids: taker.ids, to: taker.rep.id }, {
      onSuccess: () => setToast(`Given to ${taker.rep.full_name || 'them'}`),
      onError: e => setGiveErr(e?.message || 'That didn’t go through. Try again.'),
    })
  }

  return (
    <div className="ph-stack" style={{ gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 className="ph-h1">The desk</h1>
        <span style={{ fontSize: 14, color: 'var(--ov-mute)' }}>{busy ? 'Loading…' : `${plural(calls.length, 'call')} today · ${plural(onDesk, 'person').replace('persons', 'people')}`}</span>
      </div>

      <div className="ov-card ph-seg" role="group" aria-label="Filter calls" style={{ marginTop: 0 }}>
        {FILTERS.map(x => {
          const on = filter === x.k
          return (
            <button key={x.k} type="button" className={`ph-seg-btn${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setFilter(on ? null : x.k)}>
              <span className="ph-seg-label" style={{ color: x.color }}>{x.label}</span>
              <span className="ph-seg-num">{busy ? '—' : count[x.k]}</span>
              <span className="ph-seg-bar" style={{ background: x.color }} aria-hidden="true" />
            </button>
          )
        })}
      </div>

      {stuck.length > 0 && (!filter || filter === 'stuck') && (
        <section className="aph-stuck" aria-label="Past their time">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="aph-ambdot" aria-hidden="true" />
            <span className="aph-cardtitle" style={{ flex: 1 }}>{plural(stuck.length, 'call')} past their time</span>
          </div>
          <div className="aph-stuck-sub">{stuckWho} Give {stuck.length === 1 ? 'it' : 'them'} to someone free.</div>
          <div className="aph-stuck-list">
            {stuck.map(c => (
              <div key={c.key} className="aph-stuck-row">
                <span className="aph-stuck-t">{timeText(c.at, tz)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="ph-row-title">{fullName(c.p) || 'Client'}</span>
                  <span className="ph-row-sub">{carrierOf(c.p)} · for {c.p.agent?.full_name || 'an agent'}</span>
                </span>
              </div>
            ))}
          </div>
          <button type="button" className="aph-pay" style={{ marginTop: 12, height: 48, fontSize: 15 }} disabled={give.isPending} onClick={giveAll}>
            <ArrowLeftRight size={17} strokeWidth={2.2} aria-hidden="true" />
            {give.isPending ? 'Giving…' : taker ? <>{giveWord(stuck.length, firstOf(taker.rep.full_name) || 'them')} · free</> : 'Pick who'}
          </button>
          {giveErr && <p className="ph-err" role="alert" style={{ margin: '10px 0 0' }}>{giveErr}</p>}
        </section>
      )}

      <section aria-label="On the desk">
        <div className="ph-sechead" style={{ marginBottom: 10 }}>
          <h2 className="ph-h2">On the desk</h2><span style={{ flex: 1 }} />
          <span className="ph-mute">Now {timeText(new Date(now).toISOString(), tz)}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {busy ? <div className="ov-card ph-card"><div className="ph-empty">Loading the desk…</div></div>
            : !shown.length ? <div className="ov-card ph-card"><div className="ph-empty">{f ? 'Nobody has a call like that today.' : 'No calls on the desk today.'}</div></div>
              : shown.map(l => {
                const st = statusOf(l, now, tz)
                const cx = l.calls.filter(c => c.k === 'cx').length
                return (
                  <button key={l.id} type="button" className={`ov-card aph-person${st.tone === 'live' ? ' is-live' : ''}`} onClick={() => setPersonId(l.id)}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {l.rep ? <Avatar profile={l.rep} size={40} /> : <span className="aph-noav">?</span>}
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="aph-pname">{l.name}</span>
                        <span className="aph-pstatus" style={{ color: TONE[st.tone] }}>{st.text}</span>
                      </span>
                      <span className="aph-tally">{plural(l.calls.length, 'call')} · {cx} cancelled</span>
                    </span>
                    <span className="aph-segbar" aria-hidden="true">
                      {l.calls.map(c => <span key={c.key} style={{ background: KIND[c.k].seg, opacity: f && !f.has(c) ? 0.25 : 1 }} />)}
                    </span>
                  </button>
                )
              })}
        </div>
      </section>

      {person && !pickOpen && (
        <PersonDay l={person} now={now} tz={tz} onClose={() => setPersonId(null)} onGive={list => setPicking(list.map(c => c.key))} />
      )}
      {pickOpen && (
        <PickWho calls={pickCalls} reps={activeReps} rows={queue} tz={tz} onClose={() => setPicking(null)}
          onGiven={msg => { setPicking(null); setPersonId(null); setToast(msg) }} />
      )}
      <PhoneToast text={toast} onDone={() => setToast(null)} />
    </div>
  )
}
