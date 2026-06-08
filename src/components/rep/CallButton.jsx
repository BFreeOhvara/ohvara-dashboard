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
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
        'transition-all focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-1)]',
        // States
        isActive
          ? 'bg-[var(--danger)] hover:bg-[#DC2626] text-white focus-visible:ring-[var(--danger)] ring-1 ring-[#EF4444]/30'
          : isBusy
          ? 'bg-[var(--warning)] text-white cursor-wait focus-visible:ring-[var(--warning)]'
          : isEnded
          ? 'bg-[var(--bg-3)] text-[var(--text-muted)] cursor-not-allowed opacity-50'
          : // idle — accent (purple) per design token
            'bg-[var(--accent)] hover:bg-[var(--accent-hover)] active:opacity-90 text-white focus-visible:ring-[var(--accent)]'
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
