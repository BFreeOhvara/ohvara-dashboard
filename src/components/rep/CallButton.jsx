import { useState } from 'react'
import { Phone } from 'lucide-react'
import { CallModal } from './CallModal'

export function CallButton({ lead, onCallEnd, onScriptOpen }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [called, setCalled]       = useState(false)

  function handleOpen() {
    onScriptOpen?.()
    setModalOpen(true)
  }

  function handleLogged({ outcome } = {}) {
    setCalled(true)
    onCallEnd?.({ outcome })
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="btn-call"
        style={called ? {
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 28, padding: '0 12px', borderRadius: 6,
          fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 500,
          cursor: 'pointer',
          background: 'var(--bg-elevated)', color: 'var(--success)',
          border: '0.5px solid rgba(34,197,94,0.3)',
        } : undefined}
      >
        <Phone size={11} />
        {called ? 'Called' : 'Call Now'}
      </button>

      {modalOpen && (
        <CallModal
          lead={lead}
          onClose={() => setModalOpen(false)}
          onCallLogged={handleLogged}
        />
      )}
    </>
  )
}
