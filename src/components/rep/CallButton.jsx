import { useState } from 'react'
import { Phone, PhoneOff, PhoneCall } from 'lucide-react'
import { clsx } from 'clsx'
import { makeCall, hangUp, TWILIO_STUB_MODE } from '../../lib/twilio'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

// Status → visible label mapping
const STATUS_LABELS = {
  idle:         'Call Now',
  connecting:   'Connecting…',
  connected:    'End Call',
  disconnected: 'Call Ended',
  error:        'Call Failed',
  stub:         'End Call',
}

export function CallButton({ lead, onCallEnd, onScriptOpen }) {
  const { profile } = useAuth()
  const [status, setStatus] = useState('idle')
  const [startTime, setStartTime] = useState(null)

  async function handleCall() {
    if (status === 'connected' || status === 'stub') {
      hangUp()
      await recordCall()
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
      // See src/lib/twilio.js for full setup instructions.
      setStatus('stub')
      setStartTime(Date.now())
      return
    }

    try {
      await makeCall(lead.phone, async (newStatus) => {
        setStatus(newStatus)
        if (newStatus === 'connected') setStartTime(Date.now())
        if (newStatus === 'disconnected') {
          await recordCall()
          onCallEnd?.()
        }
      })
    } catch {
      setStatus('error')
    }
  }

  async function recordCall() {
    const duration = startTime ? Math.round((Date.now() - startTime) / 1000) : 0
    await supabase.from('calls').insert({
      lead_id: lead.id,
      rep_id: profile.id,
      duration_seconds: duration,
      outcome: null,
    })
  }

  const isActive  = status === 'connected' || status === 'stub'
  const isEnded   = status === 'disconnected' || status === 'error'
  const isBusy    = status === 'connecting'

  return (
    <button
      onClick={handleCall}
      disabled={isBusy || isEnded}
      className={clsx(
        // Base — unmissable primary action: larger touch target, bold contrast
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold',
        'transition-all focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-1)]',
        // States
        isActive
          ? 'bg-red-500 hover:bg-red-400 text-white focus-visible:ring-red-400 ring-1 ring-red-400/30'
          : isBusy
          ? 'bg-amber-500 text-white cursor-wait focus-visible:ring-amber-400'
          : isEnded
          ? 'bg-[var(--bg-3)] text-[var(--text-muted)] cursor-not-allowed opacity-50'
          : // idle — unmissable green
            'bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white focus-visible:ring-emerald-400 shadow-sm shadow-emerald-900/50'
      )}
    >
      {isActive
        ? <PhoneOff size={12} />
        : isBusy
        ? <PhoneCall size={12} className="animate-pulse" />
        : <Phone size={12} />
      }
      {STATUS_LABELS[status]}
    </button>
  )
}
