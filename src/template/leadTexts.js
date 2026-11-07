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

// Fill the brackets for a preview. The reschedule link shows as a short sample link.
export function leadText(step, { lead, agent = 'Dana', appt = 'your appointment time' } = {}) {
  const body = LEAD_TEXTS[step]
  if (!body) return ''
  return body
    .split('[Lead first name]').join(lead || 'there')
    .split('[Agent first name]').join(agent)
    .split('[Appointment time]').join(appt)
    .split('[Reschedule link]').join('deedstone.com/r/sample')
}
