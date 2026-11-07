import { Database } from 'lucide-react'
import { useAccount, useNote, Seg } from './kit'

// P848 — "View: Sample / Real" in the avatar menu, for admins (and the test accounts) only. It changes what this
// browser shows, never what anyone else sees. account.view = { mode, canPreview, setView, show } (useDataMode).
export default function ViewToggle() {
  const { view } = useAccount()
  const note = useNote()
  if (!view?.canPreview) return null
  const pick = v => { view.setView(v); note(v === 'real' ? 'Showing real data, for you only' : 'Showing sample data, for you only') }
  return (
    <div className="fx-mrow" role="group" aria-label="View">
      <Database size={17} aria-hidden="true" />
      <span className="tp-grow"><b>View</b><small>{view.show ? 'Everyone else sees sample data' : 'Everyone else sees real data'}</small></span>
      <Seg label="View: Sample or Real" role="radiogroup" options={[{ key: 'sample', label: 'Sample' }, { key: 'real', label: 'Real' }]} value={view.mode} onChange={pick} />
    </div>
  )
}
