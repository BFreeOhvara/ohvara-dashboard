import { useState } from 'react'
import { Smartphone, Trash2, ChevronRight } from 'lucide-react'
import { GetAppModal } from '../layout/GetAppModal'
import { DeleteAccountDialog } from './DeleteAccount'
import { isNativeApp } from '../../lib/native'

// Prompt 775 — two rows every role's More page ends its menu with: Get the
// phone app (not shown inside the app itself) and Delete my account.

export function AccountRows() {
  const [open, setOpen] = useState(null) // 'app' | 'delete'
  return (
    <>
      {!isNativeApp() && (
        <button type="button" className="ph-mrow" onClick={() => setOpen('app')}>
          <span className="ph-mrow-icon" style={{ background: 'var(--ov-data-b-tint)', color: 'var(--ov-data-b)' }}><Smartphone size={18} strokeWidth={2} aria-hidden="true" /></span>
          <span className="ph-mrow-label">Get the phone app</span>
          <ChevronRight size={15} strokeWidth={2.2} className="ph-chev" aria-hidden="true" />
        </button>
      )}
      <button type="button" className="ph-mrow" onClick={() => setOpen('delete')}>
        <span className="ph-mrow-icon" style={{ background: 'color-mix(in srgb, var(--ov-live) 14%, transparent)', color: 'var(--ov-live)' }}><Trash2 size={18} strokeWidth={2} aria-hidden="true" /></span>
        <span className="ph-mrow-label" style={{ color: 'var(--ov-live)' }}>Delete my account</span>
        <ChevronRight size={15} strokeWidth={2.2} className="ph-chev" aria-hidden="true" />
      </button>
      {open === 'app' && <GetAppModal onClose={() => setOpen(null)} />}
      {open === 'delete' && <DeleteAccountDialog onClose={() => setOpen(null)} />}
    </>
  )
}
