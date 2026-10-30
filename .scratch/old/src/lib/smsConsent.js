// Prompt 776 — the verbal text-consent script, word for word as registered
// with Twilio for the A2P campaign. The server stores which version the agent
// read (sms_consent_scripts, migration 157); change both together.
export const SMS_CONSENT_VERSION = 'v1'
export const SMS_CONSENT_SCRIPT =
  'Ohvara will text you at this number about your cancellation call, including reminders and a link to reschedule. Up to 4 messages per call. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Do you agree?'
