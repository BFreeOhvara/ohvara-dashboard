import { useState } from 'react'
import { Phone } from 'lucide-react'
import { CallModal } from './CallModal'

export function CallButton({ lead }) {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <button
        onClick={e => { e.stopPropagation(); setModalOpen(true) }}
        className="btn-call"
      >
        <Phone size={11} />
        Call Now
      </button>

      {modalOpen && (
        <CallModal
          lead={lead}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  )
}
