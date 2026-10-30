import { supabase } from './supabase'

// Prompt 751 — the rep's side of a portal call: a Twilio Voice Device joined to
// the policy's conference (fulfillment-voice answers it). Kept behind this
// small interface so the panel never touches the SDK and the harness can hand
// it a fake. The SDK is loaded only when a call starts.

async function token() {
  const { data, error } = await supabase.functions.invoke('twilio-token', { body: {} })
  if (error || !data?.token) throw new Error('Couldn\'t connect your phone line. Try again.')
  return data.token
}

const label = d => (d?.label || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '') || 'Default'

/**
 * Join the call for `policyId`. Resolves once Twilio has the call; `onAccept`
 * fires when the rep is in the conference, `onEnd` when the rep's line drops.
 */
export async function connectVoice({ policyId, onAccept, onEnd, onError }) {
  const { Device } = await import('@twilio/voice-sdk')
  const device = new Device(await token(), { codecPreferences: ['opus', 'pcmu'], closeProtection: true, logLevel: 'error' })
  device.on('tokenWillExpire', async () => { try { device.updateToken(await token()) } catch { /* the call keeps its media */ } })
  device.on('error', e => onError?.(e))
  const call = await device.connect({ params: { policy_id: policyId } })
  call.on('accept', () => onAccept?.())
  for (const ev of ['disconnect', 'cancel', 'reject']) call.on(ev, () => onEnd?.())
  call.on('error', e => onError?.(e))

  return {
    mute: on => call.mute(on),
    hangUp: () => { try { call.disconnect() } catch { /* already gone */ } },
    destroy: () => { try { device.destroy() } catch { /* already gone */ } },
    devices() {
      const a = device.audio
      if (!a) return { inputs: [], outputs: [], input: null, output: null, label: 'Headset' }
      const inputs = [...a.availableInputDevices.values()].map(d => ({ id: d.deviceId, label: label(d) }))
      const outputs = a.isOutputSelectionSupported ? [...a.availableOutputDevices.values()].map(d => ({ id: d.deviceId, label: label(d) })) : []
      const input = a.inputDevice?.deviceId || 'default'
      const output = [...(a.speakerDevices.get() || [])][0]?.deviceId || 'default'
      return { inputs, outputs, input, output, label: label(a.inputDevice || a.availableInputDevices.get('default')) }
    },
    setInput: id => device.audio?.setInputDevice(id),
    setOutput: id => device.audio?.speakerDevices.set(id),
  }
}

// The first time: ask for the mic. Returns 'granted' | 'prompt' | 'denied'.
export async function micState() {
  try {
    const s = await navigator.permissions?.query({ name: 'microphone' })
    return s?.state || 'prompt'
  } catch { return 'prompt' }
}

export async function askForMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  stream.getTracks().forEach(t => t.stop())
}
