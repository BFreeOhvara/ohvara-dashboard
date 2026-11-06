import { ghlStatus } from '../lib/ghlStatus.js'
import { ago, bridgeDeployed } from '../lib/ghlConnect.js'

// P864 — the Engine-slot state, read through src/lib/ghlStatus.js. No row, a missing table or a switch-off all count as
// not connected, never an error. `settings` is the ghl_settings row (or a sample row); `deployed` defaults to "the
// bridge has run once" (bridgeDeployed).
export function engineState(settings, deployed) {
  const st = ghlStatus(settings || null, { deployed: deployed ?? (!!settings && bridgeDeployed(settings)) })
  const on = st.key === 'connected'
  return { on, line: on ? `Connected · last sync ${settings?.last_sync_at ? ago(settings.last_sync_at) : 'not yet'}` : 'Powered by GoHighLevel · not connected yet' }
}
