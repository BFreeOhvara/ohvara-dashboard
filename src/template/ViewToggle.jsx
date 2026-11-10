import { Database } from 'lucide-react'
import { useAccount, useNote, Switch } from './kit'

// P848 — the admin's own view of the data, in the avatar menu. It changes what this browser shows, never what anyone
// else sees. account.view = { mode, canPreview, setView, show } (useDataMode).
// P934 (Brayden, Nov 10): one compact pill toggle, "Sample info", the same pill as Preferences' toggles and the height
// of one menu row (no two-option Sample / Real control). Admins only (canPreview, lib/dataMode.js): agents and VAs
// have no view control. On = this admin sees the sample data; off = real data. It is not the company-wide
// "Show sample data" switch in Settings › Go live, and it never turns sample data on for agents or VAs.
export default function ViewToggle() {
  const { view } = useAccount()
  const note = useNote()
  if (!view?.canPreview) return null
  const on = view.mode !== 'real'
  const flip = v => { view.setView(v ? 'sample' : 'real'); note(v ? 'Showing sample info, for you only' : 'Showing real data, for you only') }
  return (
    <div className="fx-mrow fx-mrow-sw" role="group" aria-label="Sample info">
      <Database size={17} aria-hidden="true" />
      <b className="tp-grow">Sample info</b>
      <Switch on={on} label="Sample info" onChange={flip} />
    </div>
  )
}
