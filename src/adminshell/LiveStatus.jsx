import { Radio } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAdmSettings, useAdmSource } from './data'
import { liveStatusText } from './liveStatusText'

// P950 (Brayden, Nov 10): no live switches in the portal. This is the read-only line the admin Overview shows instead:
// what is on right now, as words, never a button. Everything is built and off; Ohvara (CC) turns each piece on at launch
// with Brayden's yes (brain/ohvara/Go Live Runbook.md). Live charging is read from billing_settings (readable by any
// signed-in user, writable only by the server role); a read that fails counts as off.
export default function LiveStatus() {
  const { data: s } = useAdmSettings()
  const real = useAdmSource() === 'real'
  const { data: charging } = useQuery({
    queryKey: ['live-charging-status'],
    enabled: real,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('billing_settings').select('live_charging').limit(1).maybeSingle()
      return !!data?.live_charging
    },
  })
  const sw = s?.switches || {}
  return (
    <p className="adm-livestatus" role="status" aria-label="Live status" data-testid="live-status">
      <Radio size={13} aria-hidden="true" />
      <span>{liveStatusText(sw, real && !!charging)}</span>
    </p>
  )
}
