// The Booked Appointments texts, one per step. All are DRAFTS written for this
// build: none is approved or registered with A2P, and every one ends with the
// opt-out placeholder below, which core.ts refuses to send. The final opt-out
// and consent wording is pending lawyer review and is not written here.
// No Deno APIs, so node --test can load it.

export type Step =
  | 'instant' | 'not_reached_d0' | 'not_reached_d1' | 'not_reached_d3' | 'not_reached_d7'
  | 'not_reached_monthly' | 'confirm' | 'reminder_day_before' | 'reminder_1h' | 'no_show_rebook'

export type Template = { body: string; needsLink: boolean }

// Brayden's lawyer supplies the real line. Until then core.ts skips any text
// that still holds it (reason 'draft_copy').
export const OPT_OUT_PLACEHOLDER = '[OPT-OUT LINE PLACEHOLDER: pending lawyer review]'

// DRAFT: not approved, not A2P-registered
export const DRAFT_INSTANT =
  `Hi [Lead first name], thanks for asking about mortgage protection. This is Ohvara, texting for a licensed agent. We'll call you shortly to set up a time to talk. ${OPT_OUT_PLACEHOLDER}`

// DRAFT: not approved, not A2P-registered
export const DRAFT_NOT_REACHED_D0 =
  `Hi [Lead first name], we tried to reach you about the mortgage protection info you asked for. Reply here with a good time to talk. ${OPT_OUT_PLACEHOLDER}`

// DRAFT: not approved, not A2P-registered
export const DRAFT_NOT_REACHED_D1 =
  `Hi [Lead first name], following up on your mortgage protection request. When is a good time for a quick call with a licensed agent? ${OPT_OUT_PLACEHOLDER}`

// DRAFT: not approved, not A2P-registered
export const DRAFT_NOT_REACHED_D3 =
  `Hi [Lead first name], we're still happy to help with mortgage protection. Reply with a day and time that works and we'll set it up. ${OPT_OUT_PLACEHOLDER}`

// DRAFT: not approved, not A2P-registered
export const DRAFT_NOT_REACHED_D7 =
  `Hi [Lead first name], one more check-in on your mortgage protection request. Reply any time and a licensed agent will reach out. ${OPT_OUT_PLACEHOLDER}`

// DRAFT: not approved, not A2P-registered
export const DRAFT_NOT_REACHED_MONTHLY =
  `Hi [Lead first name], checking in from Ohvara. If you still want help with mortgage protection, reply here and we'll set up a call. ${OPT_OUT_PLACEHOLDER}`

// DRAFT: not approved, not A2P-registered
export const DRAFT_CONFIRM =
  `Hi [Lead first name], you're booked with [Agent first name], a licensed agent, on [Appointment time]. Need a different time? Reschedule here: [Reschedule link] ${OPT_OUT_PLACEHOLDER}`

// DRAFT: not approved, not A2P-registered
export const DRAFT_REMINDER_DAY_BEFORE =
  `Hi [Lead first name], a reminder that your call with [Agent first name] is on [Appointment time]. Need a different time? Reschedule here: [Reschedule link] ${OPT_OUT_PLACEHOLDER}`

// DRAFT: not approved, not A2P-registered
export const DRAFT_REMINDER_1H =
  `Hi [Lead first name], your call with [Agent first name] starts in about an hour, at [Appointment time]. Need to reschedule? [Reschedule link] ${OPT_OUT_PLACEHOLDER}`

// DRAFT: not approved, not A2P-registered
export const DRAFT_NO_SHOW_REBOOK =
  `Hi [Lead first name], sorry we missed you. We'll call shortly to find a new time, or reply here with one that works for you. ${OPT_OUT_PLACEHOLDER}`

// A template with "[Reschedule link]" sets needsLink, so a missing
// LEAD_RESCHEDULE_URL skips it (reason 'no_link') instead of sending a bracket.
export const TEMPLATES: Record<Step, Template> = {
  instant: { body: DRAFT_INSTANT, needsLink: false },
  not_reached_d0: { body: DRAFT_NOT_REACHED_D0, needsLink: false },
  not_reached_d1: { body: DRAFT_NOT_REACHED_D1, needsLink: false },
  not_reached_d3: { body: DRAFT_NOT_REACHED_D3, needsLink: false },
  not_reached_d7: { body: DRAFT_NOT_REACHED_D7, needsLink: false },
  not_reached_monthly: { body: DRAFT_NOT_REACHED_MONTHLY, needsLink: false },
  confirm: { body: DRAFT_CONFIRM, needsLink: true },
  reminder_day_before: { body: DRAFT_REMINDER_DAY_BEFORE, needsLink: true },
  reminder_1h: { body: DRAFT_REMINDER_1H, needsLink: true },
  no_show_rebook: { body: DRAFT_NO_SHOW_REBOOK, needsLink: false },
}

export type FillValues = {
  leadFirst: string | null
  agentFirst: string | null
  appointment: string | null    // already worded in the lead's zone, e.g. "Fri, Oct 30 at 10:00 AM"
  link: string | null
}

const swap = (s: string, token: string, value: string) => s.split(token).join(value)

// Fill the brackets. No lead first name → "Hi, …"; no agent → "your agent".
export function fill(t: Template, v: FillValues): string {
  let s = t.body
  s = v.leadFirst ? swap(s, '[Lead first name]', v.leadFirst) : swap(s, 'Hi [Lead first name], ', 'Hi, ')
  s = swap(s, 'with [Agent first name], a licensed agent,', v.agentFirst ? `with ${v.agentFirst}, a licensed agent,` : 'with a licensed agent')
  s = swap(s, '[Agent first name]', v.agentFirst ?? 'your agent')
  if (v.appointment) s = swap(s, '[Appointment time]', v.appointment)
  if (v.link) s = swap(s, '[Reschedule link]', v.link)
  return s
}
