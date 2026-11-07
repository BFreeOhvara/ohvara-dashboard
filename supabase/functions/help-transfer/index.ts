// help-transfer — P880, the live transfer (Check agent → push → cold transfer → bounce-back). The logic is
// core.ts; this file wires Deno: secrets, the service-role store, Twilio's REST API and the push senders.
// transfer-voice imports the same store (wiring.ts).
//
// Deploy WITH jwt verification (called by a signed-in VA or agent; core.ts still checks who):
//   npx.cmd supabase functions deploy help-transfer --project-ref jjextitmbptoaolacocs
//
// Secrets: CALLER_ID_TWILIO_ACCOUNT_SID, CALLER_ID_TWILIO_AUTH_TOKEN (the ones help-voice uses),
// HELP_TRACKING_NUMBER (the agent leg's From), and the push keys notify-push uses (APNS_*, FCM_SERVICE_ACCOUNT).
// Needs the P880 migration (transfer_checks, transfer_readiness, transfer_reach_for) and transfer-voice deployed.
import { handle } from './core.ts'
import { store, twilio, env } from './wiring.ts'

Deno.serve(req => handle(req, store, twilio, env))
