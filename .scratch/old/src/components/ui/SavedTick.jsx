import { Check } from 'lucide-react'

// Shared "Saved" confirmation tick — used by Settings and Profile save
// buttons (Prompt 338 split them into separate pages, this stayed common).
export function SavedTick({ show }) {
  if (!show) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--success)' }}>
      <Check size={13} /> Saved
    </span>
  )
}
