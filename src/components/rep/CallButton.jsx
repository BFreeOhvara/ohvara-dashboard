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

  // Idle state uses the premium .btn-call CSS class (accent glow + hover lift)
  // Active/busy/ended states use inline style overrides
  const idleClass = (!isActive && !isBusy && !isEnded) ? 'btn-call' : ''

  return (
    <button
      onClick={handleCall}
      disabled={isBusy || isEnded}
      className={clsx(idleClass)}
      style={
        isActive ? {
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 28, padding: '0 12px', borderRadius: 6, border: 'none',
          fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 500,
          cursor: 'pointer',
          background: 'var(--danger)', color: '#fff',
          transition: 'all 0.15s',
        } : isBusy ? {
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 28, padding: '0 12px', borderRadius: 6, border: 'none',
          fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 500,
          cursor: 'wait',
          background: 'var(--warning)', color: '#fff',
        } : isEnded ? {
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 28, padding: '0 12px', borderRadius: 6, border: 'none',
          fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 500,
          cursor: 'not-allowed',
          background: 'var(--bg-elevated)', color: 'var(--text-muted)', opacity: 0.5,
        } : undefined
      }
    >
      {isActive
        ? <PhoneOff size={11} />
        : isBusy
        ? <PhoneCall size={11} style={{ animation: 'spin 1s linear infinite' }} />
        : <Phone size={11} />
      }
      {STATUS_LABELS[status]}
    </button>
  )
}
