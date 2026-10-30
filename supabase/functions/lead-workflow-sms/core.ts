// The rules for the Booked Appointments texts to a mortgage_protection lead:
//   not reached   welcome text now, then day 0 (+4 h), day 1, day 3, day 7,
//                 then monthly (+30 days, up to MONTHLY_MAX); a reply, a
//                 booking or an opt-out stops them
//   booked        confirmation now, a reminder the day before and 1 hour before
//   no-show       a rebook text right away, for the first NO_SHOW_MAX no-shows
// Every step is ONE row in inbound_events (180): planned as 'scheduled', then
// updated in place to 'done' (detail.twilio_sid) or 'skipped' (detail.reason),
// so the agent's timeline shows it. All texts go from the one central Ohvara
// number (recovery_config.sms_from_number). Pure: index.ts wires the database
// and Twilio; tests pass fakes. No Deno APIs, so node --test can load it.
import { stateWindow, zonesForState } from '../_shared/smsWindow.ts'
import { firstName, toE164 } from '../lead-followup-sms/core.ts'
import { fill, OPT_OUT_PLACEHOLDER, TEMPLATES, type Step, type Template } from './templates.ts'

export type { Step } from './templates.ts'

// inbound_events' check lists (180).
export const KINDS = [
  'came_in', 'text_sent', 'text_received', 'va_call', 'booked', 'reminder',
  'transferred', 'missed', 'no_show', 'rebooked', 'follow_up', 'outcome',
  'note', 'became_client',
] as const
export const STATES = ['done', 'scheduled', 'skipped'] as const
export type Kind = typeof KINDS[number]
export type State = typeof STATES[number]

export type StopReason = 'stopped_reply' | 'stopped_booked' | 'stopped_opt_out'
export type Reason =
  | 'sms_off' | 'opt_out' | 'no_phone' | 'no_sender' | 'quiet_hours' | 'no_link' | 'draft_copy'
  | StopReason
  | 'rescheduled'          // the appointment moved; this reminder was for the old time
  | 'appointment_passed'   // the reminder came due after the appointment
  | 'send_failed'          // Twilio refused it (detail.error: status + code only)

export type Lead = {
  id: string
  lead_type: string | null       // leads.lead_type (166)
  inbound_stage: string | null   // leads.inbound_stage (180)
  phone: string | null
  contact_name: string | null
  state: string | null
  agent_id: string | null        // leads.assigned_rep_id
  agent_name: string | null      // the assigned agent's full name
}

export type Detail = Record<string, unknown>
export type Event = {
  id: string; lead_id: string; kind: string; state: string; at: string
  detail: Detail; created_at?: string | null
}
export type NewEvent = {
  lead_id: string; agent_id: string | null; kind: Kind; state: State; at: string
  label: string; detail: Detail; actor_name: 'Ohvara'; actor_role: 'system'
}
export type Patch = { state?: State; at?: string; detail?: Detail }

export type Deps = {
  smsLive(): Promise<boolean>
  centralNumber(): Promise<string | null>                // recovery_config.sms_from_number
  getLead(id: string): Promise<Lead | null>
  events(leadId: string): Promise<Event[]>               // every inbound_events row for the lead
  replied(leadId: string): Promise<boolean>              // lead_sms_replies has a row (false if the table isn't there)
  optedOut(phone: string): Promise<boolean>              // sms_is_opted_out (157)
  leadsWithScheduled(): Promise<string[]>                // leads with a scheduled step row
  insert(row: NewEvent): Promise<boolean>                // false when the step is already there (unique index)
  update(id: string, patch: Patch, from: State): Promise<boolean>  // only while the row is still `from`
  send(to: string, body: string, from: string): Promise<{ ok: boolean; sid?: string; error?: string }>
  now(): Date
  rescheduleUrl: string | null                           // env LEAD_RESCHEDULE_URL
  templates?: Record<Step, Template>                     // tests only; defaults to TEMPLATES
}

export type Result = { status: number; body: Record<string, unknown> }

const MIN = 60e3
const HOUR = 60 * MIN
const DAY = 24 * HOUR
export const MONTHLY_GAP_MS = 30 * DAY
export const MONTHLY_MAX = 12
export const NO_SHOW_MAX = 2
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const E164 = /^\+[1-9][0-9]{7,14}$/

type StepInfo = { kind: 'text_sent' | 'reminder'; label: string; summary: string }
export const STEPS: Record<Step, StepInfo> = {
  instant: { kind: 'text_sent', label: 'Welcome text', summary: 'Thanks them and says a call is coming.' },
  not_reached_d0: { kind: 'text_sent', label: 'Follow-up text, same day', summary: 'Asks for a good time to talk.' },
  not_reached_d1: { kind: 'text_sent', label: 'Follow-up text, day 1', summary: 'Asks when a quick call works.' },
  not_reached_d3: { kind: 'text_sent', label: 'Follow-up text, day 3', summary: 'Asks for a day and time that works.' },
  not_reached_d7: { kind: 'text_sent', label: 'Follow-up text, day 7', summary: 'One more check-in before the monthly texts.' },
  not_reached_monthly: { kind: 'text_sent', label: 'Monthly check-in text', summary: 'Checks in once a month until they are reached.' },
  confirm: { kind: 'reminder', label: 'Confirmation text', summary: 'Confirms the appointment time, with a reschedule link.' },
  reminder_day_before: { kind: 'reminder', label: 'Reminder text', summary: 'The day before the appointment, with a reschedule link.' },
  reminder_1h: { kind: 'reminder', label: 'Reminder text, 1 hour before', summary: 'An hour before the appointment, with a reschedule link.' },
  no_show_rebook: { kind: 'text_sent', label: 'Rebook text', summary: 'Says sorry we missed them and that a new time is coming.' },
}

const REASON_TEXT: Record<Reason, string> = {
  sms_off: 'Not sent: texting is off.',
  opt_out: 'Not sent: they opted out of texts.',
  no_phone: 'Not sent: the lead has no phone number we can text.',
  no_sender: 'Not sent: no Ohvara texting number is set.',
  quiet_hours: 'Not sent: outside their texting hours.',
  no_link: 'Not sent: no reschedule link is set.',
  draft_copy: 'Not sent: the text is still a draft.',
  stopped_reply: 'Not sent: they replied.',
  stopped_booked: 'Not sent: they booked.',
  stopped_opt_out: 'Not sent: they opted out of texts.',
  rescheduled: 'Not sent: the appointment moved.',
  appointment_passed: 'Not sent: the appointment time had passed.',
  send_failed: 'Not sent: the text did not go through.',
}

const STOP_WORDS: Record<StopReason, { why: string; label: string }> = {
  stopped_reply: { why: 'replied', label: 'Follow-up texts stopped: they replied' },
  stopped_booked: { why: 'booked', label: 'Follow-up texts stopped: they booked' },
  stopped_opt_out: { why: 'opted_out', label: 'Follow-up texts stopped: they opted out' },
}
export const STOP_STEP = 'cadence_stop'

// The not-reached cadence, from the moment it's planned.
const CADENCE: [Step, number][] = [
  ['instant', 0],
  ['not_reached_d0', 4 * HOUR],
  ['not_reached_d1', DAY],
  ['not_reached_d3', 3 * DAY],
  ['not_reached_d7', 7 * DAY],
  ['not_reached_monthly', MONTHLY_GAP_MS],
]
const isStep = (s: unknown): s is Step => typeof s === 'string' && Object.hasOwn(STEPS, s)
const stoppable = (s: Step) => s.startsWith('not_reached_')
const isReminder = (s: Step) => s === 'confirm' || s === 'reminder_day_before' || s === 'reminder_1h'

const stepOf = (e: Event) => (typeof e.detail?.step === 'string' ? e.detail.step : null)
const seqOf = (e: Event) => Number(e.detail?.seq ?? 1)
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN)
const iso = (t: number | Date) => new Date(t).toISOString()

// The first time at or after `t` that is inside the lead's texting window
// (8 AM–9 PM in every zone of their state); null when the state is unknown.
export function nextAllowed(t: Date, state: string | null): Date | null {
  if (!zonesForState(state)) return null
  if (stateWindow(t, state) === 'ok') return t
  // Window edges fall on the hour, so 5-minute steps land on them exactly.
  let m = Math.ceil(t.getTime() / (5 * MIN)) * 5 * MIN
  for (let i = 0; i < 3 * 24 * 12; i++, m += 5 * MIN) {
    if (stateWindow(new Date(m), state) === 'ok') return new Date(m)
  }
  return null
}

// The lead's appointments in the order they were made (booked / rebooked
// events, as appointmentAt() in src/lib/portalV2.js reads them), as ISO times.
export function appointments(events: Event[]): string[] {
  const out: string[] = []
  const made = events
    .filter(e => (e.kind === 'booked' || e.kind === 'rebooked') && e.state !== 'skipped')
    .sort((a, b) => ms(a.created_at ?? a.at) - ms(b.created_at ?? b.at))
  for (const e of made) {
    const raw = typeof e.detail?.appointment_at === 'string' ? e.detail.appointment_at : e.state === 'scheduled' ? e.at : null
    if (!raw || Number.isNaN(ms(raw))) continue
    const t = iso(ms(raw))
    if (out[out.length - 1] !== t) out.push(t)
  }
  return out
}

const isBooked = (lead: Lead, events: Event[]) =>
  ['booked', 'met', 'sold'].includes(lead.inbound_stage ?? '') ||
  events.some(e => (e.kind === 'booked' || e.kind === 'rebooked') && e.state !== 'skipped')

// "Fri, Oct 30, 10:00 AM" in the lead's zone (the first zone of their state).
function apptWords(at: string, state: string | null): string | null {
  const tz = zonesForState(state)?.[0]
  if (!tz) return null
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz,
  }).format(new Date(at))
}

function newRow(lead: Lead, step: Step, seq: number, at: Date, extra: Detail = {}): NewEvent {
  const s = STEPS[step]
  return {
    lead_id: lead.id, agent_id: lead.agent_id, kind: s.kind, state: 'scheduled', at: iso(at),
    label: s.label, detail: { step, seq, summary: s.summary, ...extra },
    actor_name: 'Ohvara', actor_role: 'system',
  }
}

// One lead's context for a plan or a tick. Opt-out is asked once.
function context(deps: Deps, lead: Lead, events: Event[]) {
  const phone = lead.phone ? toE164(lead.phone) : null
  let opted: Promise<boolean> | null = null
  const optedOut = () => (phone ? (opted ??= deps.optedOut(phone)) : Promise.resolve(false))
  const stopReason = async (): Promise<StopReason | null> => {
    if (await optedOut()) return 'stopped_opt_out'
    if (isBooked(lead, events)) return 'stopped_booked'
    if (events.some(e => e.kind === 'text_received') || await deps.replied(lead.id)) return 'stopped_reply'
    return null
  }
  // Updates the row and the local copy; false if another run got there first.
  const patch = async (e: Event, p: Patch, from: State) => {
    const ok = await deps.update(e.id, p, from)
    if (ok) Object.assign(e, p)
    return ok
  }
  const skip = (e: Event, reason: Reason, extra: Detail = {}) =>
    patch(e, { state: 'skipped', detail: { ...e.detail, ...extra, reason, summary: REASON_TEXT[reason] } }, 'scheduled')
  const insert = async (row: NewEvent) => {
    const ok = await deps.insert(row)
    if (ok) events.push({ id: '', ...row, created_at: iso(deps.now()) })
    return ok
  }
  // Every scheduled not_reached_* row → skipped, then one stop row.
  const stop = async (reason: StopReason) => {
    let n = 0
    for (const e of events) {
      const s = stepOf(e)
      if (e.state === 'scheduled' && isStep(s) && stoppable(s) && await skip(e, reason)) n++
    }
    if (n) {
      await insert({
        lead_id: lead.id, agent_id: lead.agent_id, kind: 'follow_up', state: 'done', at: iso(deps.now()),
        label: STOP_WORDS[reason].label,
        detail: { step: STOP_STEP, seq: 1, reason: STOP_WORDS[reason].why, summary: 'No more follow-up texts will go out.' },
        actor_name: 'Ohvara', actor_role: 'system',
      })
    }
    return n
  }
  return { phone, optedOut, stopReason, patch, skip, insert, stop }
}

// ── plan: schedule what this lead should get, once ──────────────────────────
export async function plan(deps: Deps, leadId: string): Promise<Result> {
  if (!UUID.test(leadId)) return { status: 400, body: { error: 'lead_id is required' } }
  const lead = await deps.getLead(leadId)
  if (!lead) return { status: 404, body: { error: 'Lead not found' } }
  if (lead.lead_type !== 'mortgage_protection') {
    return { status: 422, body: { error: 'Only Booked Appointments leads get these texts' } }
  }

  const now = deps.now()
  const events = await deps.events(lead.id)
  const cx = context(deps, lead, events)
  const when = (t: number) => nextAllowed(new Date(t), lead.state) ?? new Date(t)
  const planned: string[] = []
  const has = (step: Step, seq: number) => events.some(e => stepOf(e) === step && seqOf(e) === seq)
  const add = async (step: Step, seq: number, at: Date, extra?: Detail) => {
    if (has(step, seq)) return
    if (await cx.insert(newRow(lead, step, seq, at, extra))) planned.push(`${step}:${seq}`)
  }

  // Not reached: the whole cadence, once, unless something already stops it.
  const stopReason = await cx.stopReason()
  if (!stopReason && !events.some(e => CADENCE.some(([s]) => s === stepOf(e)))) {
    for (const [step, offset] of CADENCE) await add(step, 1, when(now.getTime() + offset))
  }
  const stopped = stopReason ? await cx.stop(stopReason) : 0

  // Booked: confirmation and reminders for the latest appointment (seq = which
  // appointment). Reminders still waiting for an older time are skipped.
  const appts = appointments(events)
  const latest = appts[appts.length - 1]
  if (latest) {
    for (const e of events) {
      const s = stepOf(e)
      if (e.state === 'scheduled' && isStep(s) && isReminder(s) && e.detail.appointment_at !== latest) {
        await cx.skip(e, 'rescheduled')
      }
    }
    const appt = ms(latest)
    if (appt > now.getTime()) {
      const seq = appts.length
      const extra = { appointment_at: latest }
      await add('confirm', seq, when(now.getTime()), extra)
      const dayBefore = when(appt - DAY)
      if (dayBefore.getTime() > now.getTime() && dayBefore.getTime() < appt - HOUR) {
        await add('reminder_day_before', seq, dayBefore, extra)
      }
      const hourBefore = when(appt - HOUR)
      if (hourBefore.getTime() > now.getTime() && hourBefore.getTime() < appt) {
        await add('reminder_1h', seq, hourBefore, extra)
      }
    }
  }

  // No-show: a rebook text right away, for the first NO_SHOW_MAX only.
  const noShows = events.filter(e => e.kind === 'no_show' && e.state === 'done').sort((a, b) => ms(a.at) - ms(b.at))
  for (let i = 0; i < Math.min(noShows.length, NO_SHOW_MAX); i++) {
    await add('no_show_rebook', i + 1, when(Math.max(now.getTime(), ms(noShows[i].at))), { no_show_at: noShows[i].at })
  }

  return { status: 200, body: { planned, stopped } }
}

// ── tick: run every step that is due ────────────────────────────────────────
export async function tick(deps: Deps): Promise<Result> {
  const counts = { sent: 0, skipped: 0, moved: 0, stopped: 0, failed: 0 }
  // One read per run, before anything can be sent.
  const live = await deps.smsLive()
  const central = live ? await deps.centralNumber() : null
  for (const leadId of await deps.leadsWithScheduled()) {
    const lead = await deps.getLead(leadId)
    if (!lead || lead.lead_type !== 'mortgage_protection') continue
    const events = await deps.events(leadId)
    const cx = context(deps, lead, events)
    const now = deps.now()

    // 1. Stop check: a reply, a booking or an opt-out ends the cadence.
    const stopReason = await cx.stopReason()
    if (stopReason) counts.stopped += await cx.stop(stopReason)

    const appts = appointments(events)
    const latest = appts[appts.length - 1] ?? null
    const due = events
      .filter(e => e.state === 'scheduled' && isStep(stepOf(e)) && ms(e.at) <= now.getTime())
      .sort((a, b) => ms(a.at) - ms(b.at))

    for (const e of due) {
      const step = stepOf(e) as Step
      const seq = seqOf(e)
      const skip = async (reason: Reason, extra?: Detail) => { if (await cx.skip(e, reason, extra)) counts.skipped++ }

      const appt = isReminder(step) ? String(e.detail.appointment_at ?? '') : null
      if (appt !== null) {
        if (appt !== latest) { await skip('rescheduled'); continue }
        if (ms(appt) <= now.getTime()) { await skip('appointment_passed'); continue }
      }
      if (step === 'no_show_rebook') {
        const after = ms(String(e.detail.no_show_at ?? ''))
        const rebooked = events.some(b => (b.kind === 'booked' || b.kind === 'rebooked') && b.state !== 'skipped' &&
          ms(b.created_at ?? b.at) > after)
        if (rebooked) { await skip('stopped_booked'); continue }
      }

      // 2. The gate: with sms_live off nothing below runs, so nothing is sent.
      if (!live) { await skip('sms_off'); continue }
      // 3–5. Opt-out, a phone to text, the central number.
      if (await cx.optedOut()) { await skip('opt_out'); continue }
      if (!cx.phone) { await skip('no_phone'); continue }
      if (!central || !E164.test(central)) { await skip('no_sender'); continue }
      // 6. Quiet hours: wait for the window (never text outside it).
      const win = stateWindow(now, lead.state)
      if (win === 'unknown_zone') { await skip('quiet_hours'); continue }
      if (win === 'quiet') {
        const next = nextAllowed(now, lead.state)
        if (!next || (appt && next.getTime() >= ms(appt))) { await skip('quiet_hours'); continue }
        if (await cx.patch(e, { at: iso(next) }, 'scheduled')) counts.moved++
        continue
      }
      // 7. The reschedule link, for the texts that carry it.
      const template = (deps.templates ?? TEMPLATES)[step]
      if (template.needsLink && !deps.rescheduleUrl) { await skip('no_link'); continue }
      // 8. Draft copy: the opt-out placeholder (or any unfilled bracket) never goes out.
      const body = fill(template, {
        leadFirst: firstName(lead.contact_name),
        agentFirst: firstName(lead.agent_name),
        appointment: appt ? apptWords(appt, lead.state) : null,
        link: deps.rescheduleUrl,
      })
      if (body.includes(OPT_OUT_PLACEHOLDER) || /\[(Lead first name|Agent first name|Appointment time|Reschedule link)\]/.test(body)) {
        await skip('draft_copy'); continue
      }

      // Claim the row first, so two runs can't both send it.
      if (!(await cx.patch(e, { state: 'done', at: iso(now) }, 'scheduled'))) continue
      const r = await deps.send(cx.phone, body, central)
      if (!r.ok) {
        await cx.patch(e, { state: 'skipped', detail: { ...e.detail, reason: 'send_failed', summary: REASON_TEXT.send_failed, error: r.error ?? null } }, 'done')
        counts.failed++
        continue
      }
      await cx.patch(e, { detail: { ...e.detail, twilio_sid: r.sid ?? null } }, 'done')
      counts.sent++
      if (step === 'not_reached_monthly' && seq < MONTHLY_MAX) {
        const at = new Date(now.getTime() + MONTHLY_GAP_MS)
        await cx.insert(newRow(lead, step, seq + 1, nextAllowed(at, lead.state) ?? at))
      }
    }
  }
  return { status: 200, body: counts }
}

// POST body → plan or tick.
export async function handle(deps: Deps, body: Record<string, unknown>): Promise<Result> {
  if (body.action === 'plan') return plan(deps, typeof body.lead_id === 'string' ? body.lead_id : '')
  if (body.action === 'tick') return tick(deps)
  return { status: 400, body: { error: "action must be 'plan' or 'tick'" } }
}
