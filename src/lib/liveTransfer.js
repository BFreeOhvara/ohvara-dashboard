// P880 — the live transfer in the browser and the phone app, as plain logic (no React, no network here except
// callTransfer, which takes the client). The VA phone (template/ful/Phone), the agent's alert
// (components/agent/TransferAlert), the app's push actions (lib/push) and the Setup push test
// (components/settings/PushTestCard) all read these, so they say the same thing.

export const CHECK_SECS = 30
export const RING_SECS = 20

// help-transfer, with the error body unwrapped (supabase.functions.invoke hides it behind error.context).
export async function callTransfer(db, action, body = {}) {
  const { data, error } = await db.functions.invoke('help-transfer', { body: { action, ...body } })
  if (!error) return data
  let payload = null
  try { payload = await error.context?.json() } catch { /* not JSON */ }
  const err = new Error(payload?.error || error.message || 'Request failed')
  err.code = payload?.code
  throw err
}

// How far this device's clock is behind the server (ms), from a response's server_now.
export const skewOf = (serverNow, now = Date.now()) => (serverNow ? Date.parse(serverNow) - now : 0)

export function secondsLeft(row, skewMs = 0, now = Date.now()) {
  const t = now + skewMs
  if ((row?.status === 'sent' || row?.status === 'seen') && row.expires_at) return Math.max(0, Math.ceil((Date.parse(row.expires_at) - t) / 1000))
  if (row?.status === 'ringing' && row.ring_started_at) return Math.max(0, Math.ceil((Date.parse(row.ring_started_at) + RING_SECS * 1000 - t) / 1000))
  return null
}

export function statusNow(row, skewMs = 0, now = Date.now()) {
  if (!row) return null
  if ((row.status === 'sent' || row.status === 'seen') && row.expires_at && Date.parse(row.expires_at) <= now + skewMs) return 'no_answer'
  return row.status
}

const when = iso => {
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) } catch { return '' }
}

// What the agent sees for one check (the in-app alert, and the screen a push opens).
//   ask         Yes / No, with the timer
//   yes         "Ringing your phone now. Press 1 to take it" + Can't take it after all (withdraw)
//   connected   "Connected" and the lead card opens
//   over        a closing line (missed, booked, no longer available, ...)
export function agentView(row, skewMs = 0, now = Date.now()) {
  const st = statusNow(row, skewMs, now)
  const s = row?.summary || {}
  const line = [s.age, s.state, s.need].filter(v => v != null && v !== '').join(' · ')
  const base = { title: `${s.your_client ? 'Your client · ' : ''}${s.name || 'A lead'}`, line, yourClient: !!s.your_client, test: !!row?.is_test, left: secondsLeft(row, skewMs, now) }
  if (st === 'sent' || st === 'seen') return { ...base, mode: 'ask', words: row?.is_test ? 'Test live call. Tap Yes to pass the push test.' : 'Can you take this live call now?' }
  if (st === 'yes' || st === 'late_yes') return { ...base, mode: 'yes', words: st === 'late_yes' ? 'Late Yes sent. If the VA still has them, your phone rings next.' : 'Yes sent. Your phone rings next: press 1 to take it.' }
  if (st === 'ringing') return { ...base, mode: 'yes', words: 'Your phone is ringing. Answer and press 1 to take the call.' }
  if (st === 'connected') return { ...base, mode: 'connected', words: row?.is_test ? 'Test passed.' : 'Connected. Their lead card is open.' }
  const over = {
    no: 'You said No. The VA is booking them on your calendar.',
    no_answer: 'Missed. The VA is booking them on your calendar.',
    failed: 'This alert didn’t reach you in time.',
    withdrawn: 'You took it back. The VA is booking them.',
    cancelled: 'No longer available. The call ended.',
    bounced: 'You didn’t pick up in time. The call went back to the VA.',
    booked: `Already booked for ${row?.booked_for ? when(row.booked_for) : 'a time on your calendar'}.`,
  }
  return { ...base, mode: 'over', words: over[st] || 'No longer available.' }
}

// The answer to a late or second tap, as one line for the agent.
export function answerWords(res) {
  if (!res) return null
  if (res.code === 'already_booked') return `Already booked for ${res.booked_for ? when(res.booked_for) : 'a time on your calendar'}.`
  if (res.code === 'gone') return 'No longer available.'
  if (res.late && res.check?.status === 'late_yes') return 'Late Yes sent. If the VA still has them, your phone rings next.'
  if (res.already) return 'Already answered on your other phone.'
  return null
}

// A push button or the Android deep link → { check, answer }. iOS: Capacitor's actionId YES / NO / tap.
// Android: ohvara://transfer?check=…&answer=yes|no.
export function pushAction(action) {
  const d = action?.notification?.data || {}
  if (d.type !== 'transfer_check' && d.type !== 'transfer_clear') return null
  const id = action?.actionId
  return { check: d.check_id || null, answer: id === 'YES' ? 'yes' : id === 'NO' ? 'no' : null, device: null }
}
export function transferLink(url) {
  if (!url || !/^ohvara:\/\/transfer\b/.test(url)) return null
  const q = new URLSearchParams(url.split('?')[1] || '')
  const answer = q.get('answer')
  return { check: q.get('check'), answer: answer === 'yes' || answer === 'no' ? answer : null }
}

// The Setup push test: what each failure means and how to fix it (N-H-17). Appointments still come in.
export const TEST_FIX = {
  no_app: { title: 'Get the Ohvara app', steps: ['Install Ohvara from the App Store or Google Play.', 'Sign in with this account.', 'Allow notifications when it asks, then run the test from the app.'] },
  no_device: { title: 'Your phone isn’t set up for alerts', steps: ['Open the Ohvara app on your phone and sign in.', 'Allow notifications when it asks.', 'Run the test again.'] },
  denied: { title: 'Notifications are off for Ohvara', steps: ['Open your phone’s Settings → Notifications → Ohvara.', 'Turn on Allow Notifications.', 'iPhone: turn on Time Sensitive Notifications. Android: open “Live calls” and turn on Override Do Not Disturb.', 'Run the test again.'] },
  push_failed: { title: 'The test alert didn’t reach your phone', steps: ['Check your phone has signal or Wi-Fi.', 'Open the Ohvara app once so it refreshes its alert address.', 'Run the test again.'] },
  answered_no: { title: 'You tapped No', steps: ['Run the test again and tap Yes on the alert.'] },
  no_answer: { title: 'You didn’t answer the test alert', steps: ['Run the test again and tap Yes within 30 seconds.', 'If no alert showed, turn on Time Sensitive (iPhone) or Override Do Not Disturb (Android) for Ohvara.'] },
  call_no_answer: { title: 'The test call wasn’t answered', steps: ['Make sure your mobile number in Profile is right.', 'Run the test, tap Yes, then answer the call and press 1.'] },
  no_phone: { title: 'No mobile number on file', steps: ['Add your mobile number in Profile.', 'Run the test again.'] },
  call_failed: { title: 'We couldn’t call your phone', steps: ['Check your mobile number in Profile.', 'Run the test again.'] },
  voice_off: { title: 'Push test passed. The test call comes next', steps: ['Live calls start once calling is switched on for your account. We’ll ring you for the test call then.'] },
}

// The card's state from transfer_reach + transfer_readiness (+ the test check running now).
export function testState({ reach, readiness, running } = {}) {
  if (running) return { tone: 'busy', label: 'Testing', words: agentView(running).words }
  if (reach?.ready) return { tone: 'on', label: 'Ready', words: 'Live calls can reach your phone.' }
  const fail = readiness?.fail_reason || (reach?.reason === 'no_device' ? 'no_device' : reach?.reason === 'notifications_off' ? 'denied' : null)
  if (readiness?.push_ok_at && !readiness?.call_ok_at && fail === 'voice_off') return { tone: 'warn', label: 'Push passed', fix: TEST_FIX.voice_off }
  if (fail && TEST_FIX[fail]) return { tone: 'off', label: 'Not ready', fix: TEST_FIX[fail] }
  return { tone: 'off', label: 'Not tested', words: 'Run the push test before live calls can come to you. Appointments come in either way.' }
}
