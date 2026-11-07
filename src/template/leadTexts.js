// P873 — the texts a lead gets, word for word from the drafts the text workflow will send
// (the lead-workflow-sms templates). Leads see Deedstone, so the sender name reads Deedstone here;
// the opt-out line is still pending lawyer review, so it is left off and the timeline says so once.
// src/leadLifecycle.test.js keeps these in step with the workflow drafts. Agents see them as previews: nothing sends until
// the texting is switched on.

export const SENDER = 'Deedstone'

export const LEAD_TEXTS = {
  instant: "Hi [Lead first name], thanks for asking about mortgage protection. This is Deedstone, texting for a licensed agent. We'll call you shortly to set up a time to talk.",
  not_reached_d0: 'Hi [Lead first name], we tried to reach you about the mortgage protection info you asked for. Reply here with a good time to talk.',
  not_reached_d1: 'Hi [Lead first name], following up on your mortgage protection request. When is a good time for a quick call with a licensed agent?',
  not_reached_d3: "Hi [Lead first name], we're still happy to help with mortgage protection. Reply with a day and time that works and we'll set it up.",
  not_reached_d7: 'Hi [Lead first name], one more check-in on your mortgage protection request. Reply any time and a licensed agent will reach out.',
  not_reached_monthly: "Hi [Lead first name], checking in from Deedstone. If you still want help with mortgage protection, reply here and we'll set up a call.",
  confirm: "Hi [Lead first name], you're booked with [Agent first name], a licensed agent, on [Appointment time]. Need a different time? Reschedule here: [Reschedule link]",
  reminder_day_before: 'Hi [Lead first name], a reminder that your call with [Agent first name] is on [Appointment time]. Need a different time? Reschedule here: [Reschedule link]',
  reminder_1h: 'Hi [Lead first name], your call with [Agent first name] starts in about an hour, at [Appointment time]. Need to reschedule? [Reschedule link]',
  no_show_rebook: "Hi [Lead first name], sorry we missed you. We'll call shortly to find a new time, or reply here with one that works for you.",
  // Not in the workflow drafts yet: the one text after STOP (P873 draft, same shape as recovery-sms STOP_REPLY).
  stop_confirm: "Deedstone: You're opted out and won't get more texts. Reply START to opt back in.",
}

// P878 — new automatic texts the front end shows as previews. DRAFT wording: not in the workflow drafts yet and not
// approved (client-facing wording is Brayden's call); GoHighLevel sends them once Jordan wires the workflow.
export const DRAFT_TEXTS = {
  // No-show: the moment the agent marks it (after the short Undo), a one-tap rebook link. Replaces no_show_rebook.
  no_show_link: "Hi [Lead first name], sorry we missed you today. Pick a new time with [Agent first name] here, it takes one tap: [Rebook link]",
  // The agent can't make a booked appointment: an apology and the same rebook link.
  cant_make_it: "Hi [Lead first name], [Agent first name] can't make your call on [Appointment time] and is sorry for the change. Pick a new time here: [Rebook link]",
  // Follow up: the agent sends a link so the client books on the agent's calendar.
  booking_link: 'Hi [Lead first name], [Agent first name] here from Deedstone. Pick a time that suits you for our next call: [Booking link]',
  // The automatic replier: anything that needs a person gets a holding reply and a call task.
  holding_reply: "Thanks [Lead first name]! Someone will call you shortly.",
  holding_reply_after_hours: "Thanks [Lead first name]! We're closed for the night. Someone will call you after 8 AM tomorrow.",
  confirm_reply: "Thanks [Lead first name], you're confirmed for [Appointment time].",
  reschedule_reply: 'No problem, [Lead first name]. Pick a new time here: [Rebook link]',
  // After hours: a form lead books straight onto the calendar; a caller picks a callback time.
  after_hours_form: "Hi [Lead first name], thanks for asking about mortgage protection. We're closed for the night. Book a time with a licensed agent here: [Booking link]",
  after_hours_call: "Hi [Lead first name], sorry we missed your call. Pick a time and we'll call you back: [Callback link]",
}

// Fill the brackets for a preview. Links show as short sample links.
export function leadText(step, { lead, agent = 'Dana', appt = 'your appointment time' } = {}) {
  const body = LEAD_TEXTS[step] || DRAFT_TEXTS[step]
  if (!body) return ''
  return body
    .split('[Lead first name]').join(lead || 'there')
    .split('[Agent first name]').join(agent)
    .split('[Appointment time]').join(appt)
    .split('[Reschedule link]').join('deedstone.com/r/sample')
    .split('[Rebook link]').join('deedstone.com/r/sample')
    .split('[Booking link]').join('deedstone.com/b/sample')
    .split('[Callback link]').join('deedstone.com/c/sample')
}
export const isDraftText = step => !LEAD_TEXTS[step] && !!DRAFT_TEXTS[step]
