import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Info, Lock, Phone } from 'lucide-react'
import { useCarriers, useCarrierHours } from '../../hooks/useCarriers'
import { useClientTimezone } from '../../hooks/useClientTimezone'
import { useAgentTaken, useChecklistDraft } from '../../hooks/useVaDesk'
import { US_STATES } from '../../lib/usStates'
import { inferTimezoneFromState } from '../../lib/timezones'
import { firstName, initialsOf, telHref } from '../../lib/fulfillmentCall'
import { phoneText } from '../../lib/policyFormat'
import { addDaysStr, carrierDaySlots, clientSlotISO, dateLabel, dayGone, dayIn, fmtBooking, slotState } from '../../lib/scheduling'
import {
  CHECKLIST_ITEMS, QUESTION_TYPES, URGENCIES, callbackOk, callbackPresets, checklistProgress, clockText, countdown,
  displayName, holdGone, itemDone, leadTypeLabel, secondsLeft, timeSince, toLocalInput,
} from '../../lib/vaQueue'
import './vaDesk.css'

// The claimed-lead view (mockup: ohvara/mockups/build-the-va-desk-queue-claim-4-item-che.html):
// hold hero with the countdown, the 4-item checklist, then the outcome. The
// screen is logistics only: nothing about cost or coverage, and no advice. Booking and transfer write records; nothing
// here texts, emails or calls anyone.

export const LOGISTICS_LINE = 'Logistics only. Any coverage question goes to a licensed agent.'

const OUTCOMES = [
  { key: 'book', title: 'Book a call', sub: "On an agent's calendar" },
  { key: 'transfer', title: 'Record a transfer', sub: 'You handed the caller to an agent' },
  { key: 'callback', title: 'Not reached', sub: 'Set a time to call back' },
]

const errText = err => err?.message || 'Something went wrong'

export function LogisticsLine({ hero }) {
  return hero
    ? <p className="ov-hero-chip va-hero-rule"><Info size={18} strokeWidth={2} aria-hidden="true" /><span>{LOGISTICS_LINE}</span></p>
    : <p className="ov-note va-rule"><Info size={18} strokeWidth={2} aria-hidden="true" /><span>{LOGISTICS_LINE}</span></p>
}

function InlineErr({ children, onRetry, retryLabel = 'Try again' }) {
  return (
    <p className="va-inline-err" role="alert">
      <span>{children}</span>
      {onRetry && <button type="button" className="va-linkbtn" onClick={onRetry}>{retryLabel}</button>}
    </p>
  )
}

// ── Hold ended ──────────────────────────────────────────────────────────────

function HoldEnded({ name, onBack }) {
  return (
    <div className="ov-card va-empty" role="alert">
      <span className="va-tile"><Info size={20} strokeWidth={2} aria-hidden="true" /></span>
      <h3>Your hold on this lead ended</h3>
      <p className="sub">{name} is back in the queue. Checklist answers you picked are kept on this device.</p>
      <button type="button" className="ov-ghost" onClick={onBack}>Back to queue</button>
    </div>
  )
}

function Done({ title, sub, onBack }) {
  return (
    <div className="ov-card va-done" role="status">
      <span className="va-tile"><Check size={20} strokeWidth={2.4} aria-hidden="true" /></span>
      <h3>{title}</h3>
      <p className="sub tab">{sub}</p>
      <button type="button" className="ov-ghost" onClick={onBack}>Back to queue</button>
    </div>
  )
}

// ── Hero ────────────────────────────────────────────────────────────────────

function Hero({ row, expiresAt, now, onRelease, releasing, releaseErr, onRetryRelease }) {
  const left = secondsLeft(expiresAt, now)
  const tries = row.va_attempts || 0
  return (
    <section className="ov-hero" aria-label="Lead you're holding">
      <div className="va-hero-top">
        <span className="va-ph"><i />Held for you</span>
        <button type="button" className="ov-hero-chip va-hero-btn" onClick={onRelease} disabled={releasing}>
          {releasing ? 'Releasing…' : 'Release'}
        </button>
      </div>
      <h2 className="va-hero-name">{displayName(row)}</h2>
      <div className="va-hchips">
        {row.state && <span className="ov-hero-chip">{row.state}</span>}
        <span className="ov-hero-chip">{leadTypeLabel(row.lead_type)}</span>
        <span className="ov-hero-chip">Arrived {timeSince(row.created_at, now)}</span>
        <span className="ov-hero-chip">{tries === 0 ? 'First try' : `${tries} ${tries === 1 ? 'try' : 'tries'} so far`}</span>
      </div>
      <div className="va-hero-mid">
        <div>
          <div className="va-clock" role="timer" aria-label="Time left on your hold">
            <b className="tab">{countdown(left)}</b><span>left on your hold</span>
          </div>
          <p className="sub va-hero-sub tab">Your hold ends at {clockText(expiresAt, now)}.</p>
        </div>
        <div className="va-hero-acts">
          {row.phone
            ? <a className="ov-hero-btn va-hero-call" href={telHref(row.phone)}><Phone size={18} strokeWidth={2} aria-hidden="true" /><span className="tab">{phoneText(row.phone)}</span></a>
            : <p className="sub va-hero-sub">No phone number on this lead.</p>}
        </div>
      </div>
      {releaseErr && (
        <p className="va-inline-err" role="alert" style={{ marginBottom: 12 }}>
          <span>Couldn't release this lead. It will free up when your hold ends.</span>
          <button type="button" className="va-linkbtn" onClick={onRetryRelease}>Try again</button>
        </p>
      )}
      <LogisticsLine hero />
    </section>
  )
}

// ── Checklist ───────────────────────────────────────────────────────────────

function Item({ label, done, children }) {
  return (
    <div className={`va-q${done ? ' done' : ''}`}>
      <p className="va-ql">
        <span className="va-tick" aria-hidden="true">{done && <Check size={12} strokeWidth={3} />}</span>
        {label}
        <span className="sr-only">{done ? ' (done)' : ' (to do)'}</span>
      </p>
      {children}
    </div>
  )
}

function Pills({ options, value, onPick, label }) {
  return (
    <div className="va-opts" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o} type="button" className={`ov-ghost va-opt${value === o ? ' on' : ''}`} aria-pressed={value === o} onClick={() => onPick(o)}>{o}</button>
      ))}
    </div>
  )
}

function Picker({ value, onPick, placeholder, label, children }) {
  return (
    <div className="va-selwrap">
      <select className={`ov-ghost va-sel${value ? '' : ' empty'}`} value={value} onChange={e => onPick(e.target.value)} aria-label={label}>
        <option value="">{placeholder}</option>
        {children}
      </select>
      <ChevronDown size={18} strokeWidth={2} aria-hidden="true" />
    </div>
  )
}

function Checklist({ draft, carriers, carriersState }) {
  const { checklist, set, status, retry } = draft
  const prog = checklistProgress(checklist)
  const carrierNames = carriers.map(c => c.name)
  if (checklist.carrier && !carrierNames.includes(checklist.carrier)) carrierNames.unshift(checklist.carrier)
  const savedText = status.state === 'saved' ? `Saved on this device ${clockText(status.at)}` : status.state === 'error' ? 'Not saved' : ''
  return (
    <section className="ov-card" aria-label="Checklist">
      <div className="va-card-h">
        <h2>Checklist</h2>
        <span className="va-prog tab">{prog.done} of {prog.total}</span>
        {savedText && <span className={`va-saved${status.state === 'error' ? ' err' : ''}`} role={status.state === 'error' ? 'alert' : 'status'}>{savedText}</span>}
      </div>
      <div className="va-bar" role="progressbar" aria-label="Checklist progress" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.done}>
        <i style={{ width: `${(prog.done / prog.total) * 100}%` }} />
      </div>
      {status.state === 'error' && (
        <div style={{ marginTop: 12 }}><InlineErr onRetry={retry}>Couldn't save your last answer. It's still picked here.</InlineErr></div>
      )}

      <Item label={CHECKLIST_ITEMS[0].label} done={itemDone(checklist, 'question_type')}>
        <Pills options={QUESTION_TYPES} value={checklist.question_type} onPick={v => set('question_type', v)} label="Question type" />
      </Item>

      <div className="va-two">
        <Item label={CHECKLIST_ITEMS[1].label} done={itemDone(checklist, 'carrier')}>
          <Picker value={checklist.carrier} onPick={v => set('carrier', v)} placeholder={carriersState === 'loading' ? 'Loading carriers…' : 'Pick a carrier'} label="Carrier">
            {carrierNames.map(n => <option key={n} value={n}>{n}</option>)}
          </Picker>
          {carriersState === 'error' && <p className="sub" style={{ marginTop: 6 }} role="alert">Couldn't load the carrier list.</p>}
        </Item>
        <Item label={CHECKLIST_ITEMS[2].label} done={itemDone(checklist, 'state')}>
          <Picker value={checklist.state} onPick={v => set('state', v)} placeholder="Pick a state" label="State">
            {US_STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
          </Picker>
        </Item>
      </div>

      <Item label={CHECKLIST_ITEMS[3].label} done={itemDone(checklist, 'urgency')}>
        <Pills options={URGENCIES} value={checklist.urgency} onPick={v => set('urgency', v)} label="Urgency" />
      </Item>

      {/* The call-consent line is the door's to write: a marked placeholder only. */}
      <div className="va-door"><b>legal text: door</b>Placeholder only.</div>
    </section>
  )
}

// ── Agent picker ────────────────────────────────────────────────────────────

function AgentPicker({ roster, value, onPick, label, fullIds }) {
  if (roster.isLoading) {
    return (
      <div className="va-agents" aria-busy="true">
        {[0, 1, 2].map(i => <span key={i} className="ov-skel" style={{ display: 'block', height: 56, borderRadius: 14 }} />)}
      </div>
    )
  }
  if (roster.isError) {
    return <InlineErr onRetry={() => roster.refetch()}>Couldn't load the agent list.</InlineErr>
  }
  const list = roster.data || []
  if (list.length === 0) return <p className="ov-note va-info">No agents to pick yet. Ask an admin to add one.</p>
  return (
    <div className="va-agents" role="group" aria-label={label}>
      {list.map(a => {
        const full = fullIds?.has(a.id)
        return (
          <button key={a.id} type="button" className={`ov-ghost va-agent${value === a.id ? ' on' : ''}${full ? ' full' : ''}`} aria-pressed={value === a.id} onClick={() => onPick(a.id)}>
            <span className="va-av" aria-hidden="true">{initialsOf(a.full_name)}</span>
            <span className="grow">
              <span className="nm">{a.full_name}</span>
              {full && <span className="sub" style={{ display: 'block', fontSize: 12.5 }}>Full this week</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── Outcome panels ──────────────────────────────────────────────────────────

const dayNum = d => Number(d.slice(8))
const weekday = d => dateLabel(d, 'short').split(',')[0]

function BookPanel({ desk, row, checklist, roster, onDone, now }) {
  const [agentId, setAgentId] = useState(null)
  const [pickedDate, setPickedDate] = useState(null)
  const [slot, setSlot] = useState('')
  const [fullIds, setFullIds] = useState(() => new Set())
  const [err, setErr] = useState(null) // { text, retry: 'book' | 'record' }
  const [bookingId, setBookingId] = useState(null)

  const { data: carriers = [] } = useCarriers()
  const picked = carriers.find(c => c.name === checklist.carrier) || null
  const { carrier, checking } = useCarrierHours(picked)
  const resolved = useClientTimezone(row.city || '', checklist.state || '')
  const tz = resolved.tz || (!row.city && checklist.state ? inferTimezoneFromState(checklist.state) : null)
  const ready = !!tz && !!carrier
  const { isos: openIsoSet, loading: takenLoading } = useAgentTaken(agentId)

  const today = dayIn(now, tz || undefined)
  const days = useMemo(() => {
    if (!ready) return []
    const out = []
    for (let i = 0; i < 21 && out.length < 5; i++) {
      const d = addDaysStr(today, i)
      const s = carrierDaySlots(d, tz, carrier)
      if (s.length && !dayGone(d, tz, now, s)) out.push(d)
    }
    return out
  }, [ready, today, tz, carrier, now])
  const date = pickedDate && days.includes(pickedDate) ? pickedDate : days[0] || null
  const daySlots = ready && date ? carrierDaySlots(date, tz, carrier) : []
  // Times already past are left out; ones inside the 30-minute notice or already
  // booked for that agent stay on the grid, dimmed.
  const slotInfo = daySlots.flatMap(s => {
    const iso = clientSlotISO(date, s, tz)
    const state = slotState(iso, { now, openIsoSet })
    return state === 'past' ? [] : [{ label: s, iso, open: state === 'open' }]
  })
  const chosen = slotInfo.find(s => s.label === slot && s.open) || null
  const agent = (roster.data || []).find(a => a.id === agentId) || null
  const full = !!agentId && fullIds.has(agentId)
  const busy = desk.book.isPending

  const submit = () => {
    if (!agent || !chosen || busy) return
    setErr(null)
    desk.book.mutate(
      { lead: row, agentId: agent.id, scheduledAt: chosen.iso, timezone: tz, carrier: picked, checklist, bookingId },
      {
        onSuccess: () => onDone({ title: `Booked with ${agent.full_name}`, sub: `${fmtBooking(chosen.iso, tz)}. No text, email or call was sent.` }),
        onError: e => {
          if (e?.bookingId) { setBookingId(e.bookingId) }
          if (holdGone(e) && e?.bookingId) { setErr({ text: "Booked on the calendar, but your hold on this lead ended before it saved to the lead. Take the lead again to finish.", retry: false }); return }
          if (e?.hint === 'weekly_cap') { setFullIds(s => new Set(s).add(agent.id)); setErr(null); return }
          if (e?.bookingId) { setErr({ text: `Booked on the calendar, but it didn't save to the lead: ${errText(e)}`, retry: true }); return }
          setErr({ text: "Couldn't book. Nothing was saved.", retry: true })
        },
      },
    )
  }

  return (
    <div className="va-panel">
      <div>
        <p className="va-lab">Agent</p>
        <AgentPicker roster={roster} value={agentId} onPick={id => { setAgentId(id); setErr(null) }} label="Agent" fullIds={fullIds} />
      </div>
      {full && <p className="ov-note va-info" role="status">{agent?.full_name} has reached their weekly booking limit. Pick another agent.</p>}

      {!ready && !checking && !resolved.resolving && (
        <p className="ov-note va-info"><Info size={16} strokeWidth={2} aria-hidden="true" style={{ marginRight: 8, verticalAlign: '-3px' }} />Pick the carrier and state in the checklist to see open times.</p>
      )}
      {ready && days.length === 0 && <p className="ov-note va-info">No open days in the next three weeks. Try the callback option.</p>}

      {(checking || resolved.resolving) && (
        <div className="va-slots" aria-busy="true">
          {[0, 1, 2, 3].map(i => <span key={i} className="ov-skel" style={{ display: 'block', height: 44, borderRadius: 12 }} />)}
        </div>
      )}

      {ready && days.length > 0 && (
        <>
          <div>
            <p className="va-lab">Day</p>
            <div className="va-days" role="group" aria-label="Day">
              {days.map(d => (
                <button key={d} type="button" className={`ov-ghost va-day${d === date ? ' on' : ''}`} aria-pressed={d === date} onClick={() => { setPickedDate(d); setSlot(''); setErr(null) }}>
                  <span>{weekday(d)}</span><b className="tab">{dayNum(d)}</b>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="va-lab">Time <span className="sub">in the caller's local time</span></p>
            {takenLoading
              ? <div className="va-slots" aria-busy="true">{[0, 1, 2, 3].map(i => <span key={i} className="ov-skel" style={{ display: 'block', height: 44, borderRadius: 12 }} />)}</div>
              : slotInfo.length === 0
                ? <p className="ov-note va-info" style={{ marginTop: 8 }}>No open times on {dateLabel(date, 'short')}. Try another day.</p>
                : (
                  <div className="va-slots" role="group" aria-label="Time">
                    {slotInfo.map(s => (
                      <button key={s.label} type="button" className={`ov-ghost va-slot${chosen?.label === s.label ? ' on' : ''}`} disabled={!s.open} aria-pressed={chosen?.label === s.label} onClick={() => { setSlot(s.label); setErr(null) }}>{s.label}</button>
                    ))}
                  </div>
                )}
          </div>
        </>
      )}

      {err && <InlineErr onRetry={err.retry ? submit : null}>{err.text}</InlineErr>}

      <div className="va-foot">
        <button type="button" className="ov-primary va-btn" disabled={!agent || !chosen || full || busy} onClick={submit}>
          {busy ? 'Booking…' : chosen && date ? `Book ${dateLabel(date, 'short')}, ${chosen.label}` : 'Book'}
        </button>
        <p className="sub">{agent ? `Saves the booking on ${agent.full_name}'s calendar.` : "Saves the booking on the agent's calendar."} No text, email or call goes out from here.</p>
      </div>
    </div>
  )
}

function TransferPanel({ desk, row, checklist, roster, onHoldGone, onDone }) {
  const [agentId, setAgentId] = useState(null)
  const [err, setErr] = useState(null)
  const agent = (roster.data || []).find(a => a.id === agentId) || null
  const busy = desk.record.isPending
  const submit = () => {
    if (!agent || busy) return
    setErr(null)
    desk.record.mutate(
      { leadId: row.lead_id, outcome: 'transferred', agentId: agent.id, checklist },
      {
        onSuccess: () => onDone({ title: 'Transfer saved', sub: `Handed to ${agent.full_name}.` }),
        onError: e => (holdGone(e) ? onHoldGone() : setErr("Couldn't save the transfer. Nothing was saved.")),
      },
    )
  }
  return (
    <div className="va-panel">
      <div>
        <p className="va-lab">Who did you hand them to?</p>
        <AgentPicker roster={roster} value={agentId} onPick={id => { setAgentId(id); setErr(null) }} label="Agent" />
      </div>
      <p className="ov-note va-info">This saves your choice only. It doesn't ring anyone.</p>
      {err && <InlineErr onRetry={submit}>{err}</InlineErr>}
      <div className="va-foot">
        <button type="button" className="ov-primary va-btn" disabled={!agent || busy} onClick={submit}>
          {busy ? 'Saving…' : agent ? `Save transfer to ${agent.full_name}` : 'Save transfer'}
        </button>
      </div>
    </div>
  )
}

function CallbackPanel({ desk, row, checklist, onHoldGone, onDone, now }) {
  const minute = Math.floor(now / 60e3)
  const presets = useMemo(() => callbackPresets(minute * 60e3), [minute])
  const [choice, setChoice] = useState(presets[0].key)
  const [custom, setCustom] = useState('')
  const [err, setErr] = useState(null)
  const at = choice === 'custom' ? (custom ? new Date(custom) : null) : presets.find(p => p.key === choice)?.at || null
  const valid = callbackOk(at, now)
  const busy = desk.record.isPending
  const submit = () => {
    if (!valid || busy) return
    setErr(null)
    desk.record.mutate(
      { leadId: row.lead_id, outcome: 'callback', callbackAt: at, checklist },
      {
        onSuccess: () => onDone({ title: `Callback set for ${clockText(at.toISOString())}`, sub: `${firstName(row.contact_name) || 'This lead'} moves to Callback due then.` }),
        onError: e => (holdGone(e) ? onHoldGone() : setErr("Couldn't save the callback time.")),
      },
    )
  }
  return (
    <div className="va-panel">
      <div>
        <p className="va-lab">Call back</p>
        <div className="va-opts" role="group" aria-label="Call back">
          {presets.map(p => (
            <button key={p.key} type="button" className={`ov-ghost va-opt${choice === p.key ? ' on' : ''}`} aria-pressed={choice === p.key} onClick={() => { setChoice(p.key); setErr(null) }}>{p.label}</button>
          ))}
          <button type="button" className={`ov-ghost va-opt${choice === 'custom' ? ' on' : ''}`} aria-pressed={choice === 'custom'} onClick={() => { setChoice('custom'); if (!custom) setCustom(toLocalInput(new Date(now + 2 * 3600e3))) }}>Pick a time</button>
        </div>
        {choice === 'custom' && (
          <div style={{ marginTop: 10 }}>
            <input type="datetime-local" className="ov-ghost va-dt" value={custom} min={toLocalInput(new Date(now))} onChange={e => setCustom(e.target.value)} aria-label="Call back at" />
            {custom && !valid && <p className="sub" style={{ marginTop: 6 }} role="status">Pick a time in the next 90 days.</p>}
          </div>
        )}
      </div>
      {err && <InlineErr onRetry={submit}>{err}</InlineErr>}
      <button type="button" className="ov-primary va-btn" disabled={!valid || busy} onClick={submit}>{busy ? 'Saving…' : 'Save and go back to the queue'}</button>
      <p className="sub">The lead moves to Callback due at that time. The hold ends.</p>
    </div>
  )
}

function Outcome({ desk, row, draft, now, onHoldGone, onDone }) {
  const [pick, setPick] = useState(null)
  const complete = checklistProgress(draft.checklist).complete
  const active = complete ? pick : null
  const shared = { desk, row, checklist: draft.checklist, roster: desk.roster, onHoldGone, onDone, now }
  return (
    <section className="ov-card" aria-label="Outcome">
      <div className="va-card-h"><h2>Outcome</h2></div>
      <div className="va-picks" role="radiogroup" aria-label="Outcome">
        {OUTCOMES.map(o => (
          <button key={o.key} type="button" role="radio" aria-checked={active === o.key} disabled={!complete}
            className={`ov-ghost va-pick${active === o.key ? ' on' : ''}`} onClick={() => setPick(o.key)}>
            <b>{o.title}</b><span>{o.sub}</span>
          </button>
        ))}
      </div>
      {!complete && (
        <p className="va-lock"><Lock size={16} strokeWidth={2} aria-hidden="true" /><span>Finish the checklist to pick an outcome.</span></p>
      )}
      {active === 'book' && <BookPanel {...shared} />}
      {active === 'transfer' && <TransferPanel {...shared} />}
      {active === 'callback' && <CallbackPanel {...shared} />}
    </section>
  )
}

// ── The desk ────────────────────────────────────────────────────────────────

// `row` is the va_queue row for the lead, `expiresAt` the end of the hold.
// onBack returns to the queue (and clears the hold on the page).
export default function VaDesk({ desk, row, expiresAt, onBack }) {
  const [now, setNow] = useState(() => Date.now())
  const [done, setDone] = useState(null)
  const [ended, setEnded] = useState(false)
  const draft = useChecklistDraft(row)
  const carriersQ = useCarriers()

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const gone = ended || (!done && secondsLeft(expiresAt, now) === 0)
  const carriersState = carriersQ.isLoading ? 'loading' : carriersQ.isError ? 'error' : 'ok'

  if (done) return <Done title={done.title} sub={done.sub} onBack={onBack} />
  if (gone) return <HoldEnded name={displayName(row)} onBack={onBack} />

  const release = () => desk.release.mutate(row.lead_id, { onSuccess: onBack })

  return (
    <>
      <Hero
        row={row} expiresAt={expiresAt} now={now}
        onRelease={release} releasing={desk.release.isPending}
        releaseErr={desk.release.isError} onRetryRelease={release}
      />
      <Checklist draft={draft} carriers={carriersQ.data || []} carriersState={carriersState} />
      <Outcome desk={desk} row={row} draft={draft} now={now} onHoldGone={() => setEnded(true)} onDone={setDone} />
    </>
  )
}
