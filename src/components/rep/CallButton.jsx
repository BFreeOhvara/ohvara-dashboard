import { useState } from 'react'
import { Phone, PhoneOff, PhoneCall } from 'lucide-react'
import { clsx } from 'clsx'
import { makeCall, hangUp, TWILIO_STUB_MODE } from '../../lib/twilio'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

const STATUS_LABELS = {
  idle:        'Call Now',
  connecting:  'Connecting…',
  connected:   'On Call',
  disconnected:'Call Ended',
  error:       'Call Failed',
  stub:        'Stub Mode',
}

export function CallButton({ lead, onCallEnd, onScriptOpen }) {
  const { profile } = useAuth()
  const [status, setStatus] = useState('idle')
  const [startTime, setStartTime] = useState(null)
  const [currentCall, setCurrentCall] = useState(null)

  async function handleCall() {
    if (status === 'connected') {
      hangUp()
      await recordCall('disconnected')
      setStatus('disconnected')
      onCallEnd?.()
      return
    }

    if (!lead.phone) {
      alert('No phone number on this lead.')
      return
    }

    setStatus('connecting')
    onScriptOpen?.()

    if (TWILIO_STUB_MODE) {
      // WIRE-THIS: Replace stub with real Twilio Voice SDK once account is provisioned.
      // See src/lib/twilio.js for setup instructions.
      setStatus('stub')
      setStartTime(Date.now())
      return
    }

    try {
      const call = await makeCall(lead.phone, async (newStatus, err) => {
        setStatus(newStatus)
        if (newStatus === 'connected') setStartTime(Date.now())
        if (newStatus === 'disconnected') {
          await recordCall(newStatus)
          onCallEnd?.()
        }
      })
      setCurrentCall(call)
    } catch {
      setStatus('error')
    }
  }

  async function recordCall(outcome) {
    const duration = startTime ? Math.round((Date.now() - startTime) / 1000) : 0
    await supabase.from('calls').insert({
      lead_id: lead.id,
      rep_id: profile.id,
      duration_seconds: duration,
      outcome: null,
    })
  }

  const isActive = status === 'connected' || status === 'stub'

  return (
    <button
      onClick={handleCall}
      disabled={status === 'connecting' || status === 'disconnected' || status === 'error'}
      className={clsx(
        'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
        isActive
          ? 'bg-red-600 hover:bg-red-500 text-white animate-pulse'
          : status === 'connecting'
          ? 'bg-yellow-600 text-white cursor-wait'
          : 'bg-green-600 hover:bg-green-500 text-white',
        (status === 'disconnected' || status === 'error') && 'opacity-50 cursor-not-allowed'
      )}
    >
      {isActive ? <PhoneOff size={14} /> : status === 'connecting' ? <PhoneCall size={14} /> : <Phone size={14} />}
      {STATUS_LABELS[status]}
    </button>
  )
}
