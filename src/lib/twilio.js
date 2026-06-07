// ============================================================
// TWILIO VOICE SDK — Browser Dialer
// WIRE-THIS: Twilio account not yet provisioned.
//
// Steps to enable:
// 1. Create a Twilio account at twilio.com
// 2. Purchase a phone number with Voice capability
// 3. Create a TwiML App — set the Voice Request URL to:
//      https://<your-supabase-project>.supabase.co/functions/v1/twilio-voice
// 4. Note the TwiML App SID
// 5. Add to .env:
//      VITE_TWILIO_TWIML_APP_SID=<TwiML App SID>
//      TWILIO_ACCOUNT_SID=<Account SID>         (server-side only)
//      TWILIO_AUTH_TOKEN=<Auth Token>           (server-side only)
//      TWILIO_PHONE_NUMBER=<Your Twilio number> (server-side only)
// 6. Deploy the `twilio-voice` Edge Function (see supabase/functions/twilio-voice/)
// 7. Remove the STUB_MODE flag below and uncomment Device init
// ============================================================

export const TWILIO_STUB_MODE = true

let device = null

export async function initTwilioDevice(accessToken) {
  if (TWILIO_STUB_MODE) return null

  // Uncomment when Twilio is provisioned:
  // const { Device } = await import('@twilio/voice-sdk')
  // device = new Device(accessToken, { logLevel: 1 })
  // await device.register()
  // return device
}

export async function makeCall(toNumber, onStatusChange) {
  if (TWILIO_STUB_MODE) {
    onStatusChange('stub')
    return null
  }

  if (!device) throw new Error('Twilio Device not initialized')
  const call = await device.connect({ params: { To: toNumber } })
  call.on('accept', () => onStatusChange('connected'))
  call.on('disconnect', () => onStatusChange('disconnected'))
  call.on('error', (err) => onStatusChange('error', err))
  return call
}

export function hangUp() {
  if (TWILIO_STUB_MODE || !device) return
  device.disconnectAll()
}
