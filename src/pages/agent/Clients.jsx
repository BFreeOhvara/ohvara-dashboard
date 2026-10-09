import { useMemo, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Phone, Calendar, CalendarDays, MapPin } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { dmId } from '../../hooks/useDirectMessages'
import { useAgentBookings, useRescheduleBooking, useRebookCall, useConfirmRecoveryNumber } from '../../hooks/useAgentBookings'
import { AnchoredSelectField } from '../../components/ui/ExportForm'
import {
  ClientSearch, PipelineTabs, StatusList, ClientDrawer, InfoTile, StatusNote, Journey, DayChoice, SlotGrid,
} from '../../components/agent/AgentUI'
import { fmtBooking, callWhen, clientSlotISO, slotState, openBookingIsos, dayIn, addDaysStr, dateLabel, dayGone } from '../../lib/scheduling'
import { viewerTimezone } from '../../lib/timezones'
import { isLive, agentStageOf, stageOf, tabOf, canRebook, PIPELINE_TABS, RANGES, SUBSTATUS_LABEL, digits, useNow, startOfWeek, startOfMonth, placeOf } from '../../lib/agentBookings'
import { excludeTestAccounts } from '../../lib/testAccounts'

// My Pipeline (Prompt 665, was My Clients until 680) — replaces My Policies.
//
// Naming: "My Policies" read as an in-force book of business, which this
// dashboard doesn't track (Brayden, 2026-10-01). Every row an agent creates
// is a client whose EXISTING policy is being cancelled, so this is a log of
// clients you've booked and where each cancellation stands.
//
// Admin lands here too (nav "Clients") and sees every agent's bookings, with
// an agent filter; the test account is held out of that company-wide view.
//
// Prompt 672 — status and range live in the URL (?stage=noAnswer&range=week)
// so Overview's tiles link straight to the matching slice. Range is by
// booking date and scopes the whole page.
//
// Prompt 696/702 — a No answer lead in the automated text-and-retry flow is
// the system's; Confirm number and Needs attention are the agent's.
//
// Prompt 717 — rebuilt on the v16 language as a rethink: a "Find any client"
// search that always looks across every status, the "Your pipeline" box with
// four status tabs (Booked, No answer, Needs you, Cancelled — tabOf), one
// list per tab with columns built for that status, and client details in a
// right-side drawer. The page always opens on Booked; ?stage= wins. The page
// scrolls normally now (the P686/P707 fixed-height column is gone).
//
// Prompt 724 — rows show the client's "City, ST" and call times in the
// client's own zone (policies.client_timezone; older rows fall back to the
// viewer's). Move / Re-book follow Book a call's rules: client-local slots,
// 30 minutes' notice, no second booking at a time the agent already has.

const RANGE_VALUES = RANGES.map(r => r.value)
// Old ?stage= values still arrive from the Overview (attention rows, the
// "Booked this week" tile) and Activity.
const STAGE_ALIAS = { confirmNumber: 'needs', needsAttention: 'needs', all: 'booked' }

const byCall = (a, b) => (a.scheduled_call_at || '9').localeCompare(b.scheduled_call_at || '9')
const byLastCall = (a, b) => (a.last_call_at || '').localeCompare(b.last_call_at || '')
const SORT = {
  booked: byCall,
  noAnswer: byLastCall,
  // Needs attention first, then the oldest last call.
  needs: (a, b) => (agentStageOf(a) === 'needsAttention' ? 0 : 1) - (agentStageOf(b) === 'needsAttention' ? 0 : 1) || byLastCall(a, b),
  // Newest cancellation first.
  cancelled: (a, b) => (b.fulfillment_completed_at || b.updated_at || '').localeCompare(a.fulfillment_completed_at || a.updated_at || ''),
}

export default function Clients() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const navigate = useNavigate()
  const now = useNow()
  const [params, setParams] = useSearchParams()
  const openId = params.get('open')
  const rebook = params.get('rebook') === '1'

  const { data: raw = [], isLoading } = useAgentBookings(isAdmin ? null : profile?.id)
  const rows = useMemo(() => (isAdmin ? excludeTestAccounts(raw, profile?.id) : raw), [raw, isAdmin, profile?.id])

  const stageParam = params.get('stage')
  const tab = PIPELINE_TABS.includes(stageParam) ? stageParam : STAGE_ALIAS[stageParam] || 'booked'
  const range = RANGE_VALUES.includes(params.get('range')) ? params.get('range') : 'all'
  const update = fn => {
    const next = new URLSearchParams(params)
    fn(next)
    setParams(next, { replace: true })
  }
  const setParam = (key, value, fallback) => update(next => { if (value === fallback) next.delete(key); else next.set(key, value) })
  const [agentId, setAgentId] = useState('')

  const agents = useMemo(() => [...new Map(rows.map(p => [p.agent_id, p.agent?.full_name || 'Unknown'])).entries()]
    .map(([id, name]) => ({ value: id, label: name }))
    .sort((a, b) => a.label.localeCompare(b.label)), [rows])

  // Range + agent scope the search, the pipeline and the list alike.
  const scoped = useMemo(() => {
    const from = range === 'week' ? startOfWeek(new Date(now)).getTime()
      : range === 'month' ? startOfMonth(new Date(now)).getTime() : null
    return rows.filter(p => (!agentId || p.agent_id === agentId)
      && (from == null || new Date(p.created_at).getTime() >= from))
  }, [rows, agentId, range, now])

  const list = useMemo(() => scoped.filter(p => tabOf(p) === tab).sort(SORT[tab]), [scoped, tab])

  const canMove = p => isAdmin || p.agent_id === profile?.id
  const openOnly = id => update(next => { next.set('open', id); next.delete('rebook') })
  const startRebook = id => update(next => { next.set('open', id); next.set('rebook', '1') })
  const close = () => update(next => { next.delete('open'); next.delete('rebook') })
  // A search pick also switches to that client's tab, so their row is the
  // highlighted one behind the drawer.
  const openFromSearch = p => update(next => {
    next.set('open', p.id)
    next.delete('rebook')
    const t = tabOf(p)
    if (t === 'booked') next.delete('stage'); else next.set('stage', t)
  })
  // Looked up from every row, not the tab's list, so a link from Overview
  // opens its client whichever tab is selected.
  const openRow = openId ? rows.find(p => p.id === openId) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ClientSearch rows={scoped} onOpen={openFromSearch} hotkey={!openRow} />
      <PipelineTabs
        rows={scoped} tab={tab} onTab={t => setParam('stage', t, 'booked')}
        range={range} ranges={RANGES} onRange={v => setParam('range', v, 'all')}
        agentFilter={isAdmin && agents.length > 1 ? (
          <AnchoredSelectField
            value={agentId} onChange={setAgentId}
            options={[{ value: '', label: 'All agents' }, ...agents]}
            style={{ width: 200 }}
          />
        ) : null}
      />
      <StatusList
        key={tab} tab={tab} rows={list} now={now} showAgent={isAdmin} activeId={openId}
        onOpen={openOnly} onRebook={startRebook} onConfirm={openOnly} canMove={canMove}
        loading={isLoading} emptyRange={scoped.length === 0 && range !== 'all' ? range : null}
        onBook={isAdmin ? undefined : () => navigate('/agent/book')}
      />

      {openRow && (
        <ClientDetail
          key={`${openRow.id}:${rebook}`} p={openRow} now={now} canMove={canMove(openRow)} startRebook={rebook} isAdmin={isAdmin} onClose={close}
          agentRows={raw.filter(r => r.agent_id === openRow.agent_id)}
        />
      )}
    </div>
  )
}

const cap = s => s[0].toUpperCase() + s.slice(1)

function ClientDetail({ p, now, canMove, startRebook, isAdmin, onClose, agentRows }) {
  const navigate = useNavigate()
  const stage = agentStageOf(p)
  const tab = tabOf(p)
  const live = isLive(p)
  const rebookable = canRebook(p) && canMove
  const [moving, setMoving] = useState(!!startRebook && rebookable)
  const move = useMove(p, now, rebookable, () => setMoving(false), agentRows)
  const tz = p.client_timezone || null
  const place = placeOf(p)

  const attempted = (p.call_attempts || 0) > 0 || stage === 'cancelled'
  const caller = p.assigned?.full_name || 'Fulfillment'
  const steps = [
    { label: 'Booked', at: p.created_at, done: true },
    {
      label: attempted ? `Called by ${caller}` : 'Waiting for Fulfillment to call',
      at: attempted ? p.last_call_at || p.fulfillment_started_at || p.fulfillment_claimed_at : p.scheduled_call_at,
      // the waiting step's time is the call itself: the client's time
      sub: !attempted && p.scheduled_call_at ? callWhen(p.scheduled_call_at, tz) : undefined,
      done: attempted,
    },
    { label: 'Old policy cancelled', at: p.fulfillment_completed_at, done: stage === 'cancelled' },
  ]
  const statusText = {
    booked: live ? 'On a call right now' : 'Waiting for Fulfillment',
    noAnswer: `No answer${SUBSTATUS_LABEL[p.cancellation_substatus] ? ` · ${SUBSTATUS_LABEL[p.cancellation_substatus].toLowerCase()}` : ''} — ${{
      retry_locked: `retry call locked for ${fmtBooking(p.recovery_retry_at, tz)}; we've texted them a link to pick another time`,
      followup: "we're texting them a link to pick a time; you'll be told if they don't reply",
    }[p.recovery_step] || 're-book a time, or Fulfillment will try again'}`,
    confirmNumber: 'Two tries, no answer. Confirm their number to continue',
    needsAttention: "They haven't replied to our texts. Call them and re-book",
    cancelled: p.fulfillment_completed_at ? `Cancelled ${new Date(p.fulfillment_completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Cancelled',
  }[stage]

  const big = { width: '100%', height: 50, borderRadius: 999, fontSize: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }
  let footer = null
  if (moving) {
    footer = move.actions
  } else if (stage === 'booked' && !live && canMove) {
    footer = (
      <button type="button" className="ov-ghost" onClick={() => setMoving(true)} style={{ ...big, fontWeight: 600 }}>
        <CalendarDays size={16} strokeWidth={2} /> Move to a different time
      </button>
    )
  } else if (rebookable) {
    footer = (
      <button type="button" className="ov-solid" onClick={() => setMoving(true)} style={big}>
        {stage === 'needsAttention' ? <><Phone size={16} strokeWidth={2.2} /> Call &amp; rebook</> : <><CalendarDays size={16} strokeWidth={2} /> Re-book a call</>}
      </button>
    )
  } else if (stage === 'confirmNumber' && canMove) {
    footer = <ConfirmNumber p={p} />
  } else if ((stage !== 'booked' || live) && stage !== 'cancelled' && stage !== 'confirmNumber') {
    footer = (
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ov-mute)' }}>
        {stage === 'noAnswer' ? "We're working this one — nothing for you to do yet." : 'Fulfillment is on this one — if the time needs to change, message them.'}
      </p>
    )
  }

  return (
    <ClientDrawer
      p={p} tab={tab} onClose={onClose} footer={footer}
      onMessage={() => navigate(`/messages?dm=${dmId(p.agent_id, isAdmin ? 'admin' : p.assigned_fulfillment_id || 'admin')}`)}
      messageLabel={isAdmin ? 'Message agent' : 'Message Fulfillment'}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <InfoTile label="Fulfillment call" value={callWhen(p.scheduled_call_at, tz)} />
        <InfoTile label="Carrier they're leaving" value={p.current_carrier || 'Not noted'} />
        {place && (
          <div style={{ gridColumn: '1 / -1' }}>
            <InfoTile label="Where they live" value={
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><MapPin size={16} strokeWidth={2} style={{ flexShrink: 0 }} />{place}</span>
            } />
          </div>
        )}
        {(p.call_attempts || 0) > 0 && stage !== 'cancelled' && (
          <InfoTile label="Calls so far" value={`${p.call_attempts} ${p.call_attempts === 1 ? 'try' : 'tries'}`} />
        )}
      </div>
      {moving ? move.picker : (
        <>
          <StatusNote tab={tab} live={live && stage === 'booked'}>{cap(statusText)}</StatusNote>
          <Journey steps={steps} tab={tab} />
        </>
      )}
    </ClientDrawer>
  )
}

// Prompt 696 — the checkpoint after two unanswered calls: nothing else is sent
// until the agent says this is the right number (optionally fixing it first).
function ConfirmNumber({ p }) {
  const confirm = useConfirmRecoveryNumber()
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState(p.client_phone || '')
  const valid = [10, 11].includes(digits(phone).length)
  const first = p.client_first_name || 'them'
  const off = confirm.isPending || (editing && !valid)
  const pill = { height: 48, borderRadius: 999, fontSize: 14.5, cursor: 'pointer' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }}>Confirm the number</div>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--ov-soft)', lineHeight: 1.5 }}>
        Fulfillment couldn't reach {first} after two tries. Is <span style={{ fontWeight: 600, color: 'var(--ov-hi)', whiteSpace: 'nowrap' }}>{p.client_phone || 'no number'}</span> still
        right? Confirm and we'll text them tomorrow morning and evening. If neither gets a reply, you'll be asked to call them yourself.
      </p>
      {editing && (
        <span className="ov-input">
          <Phone size={17} strokeWidth={1.9} style={{ flexShrink: 0 }} />
          <input
            value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoFocus
            aria-label="Client phone number" placeholder="(555) 555-5555"
          />
        </span>
      )}
      {confirm.isError && <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{confirm.error?.message}</p>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button" disabled={off} className="ov-solid"
          onClick={() => confirm.mutate({ id: p.id, phone: editing && digits(phone) !== digits(p.client_phone) ? phone : null })}
          style={{ ...pill, flex: '1 1 220px', padding: '0 18px', opacity: off ? 0.5 : 1, cursor: off ? 'not-allowed' : 'pointer' }}
        >
          {confirm.isPending ? 'Saving…' : editing ? 'Save and confirm' : 'Yes, this is the right number'}
        </button>
        {!editing && (
          <button type="button" className="ov-ghost" onClick={() => setEditing(true)} style={{ ...pill, padding: '0 20px', fontWeight: 600 }}>
            Change number
          </button>
        )}
      </div>
    </div>
  )
}

// Moves a Booked call (Prompt 665) or, with `rebook`, puts a No answer lead
// back on Booked at a new time (Prompt 695). Same mutations as before; the
// picker is P715's DayChoice + SlotGrid. Returns the picker (drawer body)
// and the confirm/cancel buttons (drawer footer).
//
// Prompt 724 — days and slots are the client's (p.client_timezone, else the
// viewer's zone for older rows); "Too soon" and "Booked" slots are disabled,
// the booking being moved keeping its own slot. The far-out checkbox is gone.
function useMove(p, now, rebook, onDone, agentRows) {
  const reschedule = useRescheduleBooking()
  const rebookCall = useRebookCall()
  const move = rebook ? rebookCall : reschedule
  const tz = p.client_timezone || viewerTimezone()
  const today = dayIn(now, tz)
  const tomorrow = addDaysStr(today, 1)
  const current = p.scheduled_call_at ? new Date(p.scheduled_call_at).getTime() : null
  const [picked, setPicked] = useState(() => (current && current > Date.now() ? dayIn(current, tz) : null))
  const [slot, setSlot] = useState('')
  const dateInput = useRef(null)
  const date = picked && picked >= today ? picked : dayGone(today, tz, now) ? tomorrow : today
  const openIsoSet = useMemo(() => openBookingIsos(agentRows, { now, exceptId: p.id, stageOf }), [agentRows, now, p.id])
  const iso = slot ? clientSlotISO(date, slot, tz) : null
  const ok = !!iso && slotState(iso, { now, openIsoSet }) === 'open'

  const isOther = date !== today && date !== tomorrow
  const todayGone = dayGone(today, tz, now)
  const pickDate = d => { setPicked(d); setSlot('') }
  const openPicker = () => {
    const el = dateInput.current
    if (!el) return
    try { el.showPicker() } catch { el.focus(); el.click() }
  }
  const cancel = () => { setSlot(''); move.reset(); onDone() }

  const picker = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }}>{rebook ? 'Re-book for' : 'New time'}</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <DayChoice
          label="Today" on={date === today} disabled={todayGone} onClick={() => pickDate(today)}
          long={todayGone ? 'No times left' : dateLabel(today, 'long')} short={todayGone ? null : dateLabel(today, 'short')}
        />
        <DayChoice label="Tomorrow" on={date === tomorrow} onClick={() => pickDate(tomorrow)} long={dateLabel(tomorrow, 'long')} short={dateLabel(tomorrow, 'short')} />
      </div>
      <button
        type="button" onClick={openPicker} aria-pressed={isOther} className={`ov-choice${isOther ? ' is-on' : ''}`}
        style={{
          height: 48, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
          fontSize: 14.5, fontWeight: 600, color: isOther ? 'var(--ov-hi)' : 'var(--ov-mid)', cursor: 'pointer',
        }}
      >
        <Calendar size={17} strokeWidth={1.9} style={{ color: isOther ? 'var(--ov-pick)' : undefined }} />
        {isOther ? dateLabel(date, 'short') : 'Another day'}
      </button>
      <input
        ref={dateInput} type="date" value={date} min={today} tabIndex={-1} aria-label="Pick another day"
        onChange={e => e.target.value && pickDate(e.target.value)}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', border: 0, padding: 0 }}
      />
      <SlotGrid date={date} slot={ok ? slot : ''} onSlot={setSlot} now={now} gridClass="grid grid-cols-3" tz={tz} openIsoSet={openIsoSet} />
    </div>
  )

  const off = !ok || move.isPending
  const actions = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {move.isError && <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{move.error?.message}</p>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button" disabled={off} className="ov-solid"
          onClick={() => move.mutate({ id: p.id, scheduledAt: iso }, { onSuccess: onDone })}
          style={{ flex: 1, minWidth: 0, height: 50, borderRadius: 999, fontSize: 15, padding: '0 16px', opacity: off ? 0.5 : 1, cursor: off ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {move.isPending ? 'Saving…' : ok ? `${rebook ? 'Re-book for' : 'Move to'} ${callWhen(iso, tz)}` : 'Pick a time'}
        </button>
        <button type="button" className="ov-ghost" onClick={cancel} style={{ height: 50, padding: '0 20px', borderRadius: 999, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )

  return { picker, actions }
}
