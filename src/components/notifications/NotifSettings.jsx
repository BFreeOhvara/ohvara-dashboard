import { Lock } from 'lucide-react'
import { Switch } from '../../template/kit'
import { useNotifPrefs } from '../../hooks/useBell'
import { whereWords } from '../../lib/notifications'
import './bell1023.css'

// P1023 — Settings › Notifications for every role (desktop): exactly the role's list, where each one arrives, and a
// switch that mutes the phone alert (and email) of any non-urgent one. Muted ones still land in the bell. The urgent
// ones (live transfer, incoming call, payment failed, booked call not started…) say "Always on".
export function NotifSettings({ role }) {
  const { rows, setMuted } = useNotifPrefs(role)
  return (
    <ul className="nb-set" aria-label="Notifications">
      {rows.map(r => (
        <li key={r.type}>
          <span className="nb-grow"><b>{r.label}</b><small>{r.muted ? 'Bell only (muted)' : whereWords(r)}</small></span>
          {r.can_mute
            ? <Switch on={!r.muted} label={`${r.label} alerts`} onChange={on => setMuted(r.type, !on)} />
            : <span className="nb-lock"><Lock size={12} aria-hidden="true" /> Always on</span>}
        </li>
      ))}
    </ul>
  )
}
