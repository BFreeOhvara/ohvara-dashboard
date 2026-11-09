import { useContext, useSyncExternalStore } from 'react'
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { sampleOpenMin, openMinutes } from '../lib/callOpen'

// P918 — how many minutes before a booked call its Start call turns on. Real: app_settings.va_call_open_minutes (the
// P918 migration; a missing column or a failed read is 5). Sample: the admin preview's number in this browser.
// The template previews render without the app's QueryClientProvider: there the read sits idle on its own client.
const idle = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } })

export function useCallOpenMin(real = false) {
  const qc = useContext(QueryClientContext)
  const sample = useSyncExternalStore(sampleOpenMin.subscribe, sampleOpenMin.get, sampleOpenMin.get)
  const q = useQuery({
    enabled: !!qc && real,
    queryKey: ['app-settings', 'va-call-open-minutes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('va_call_open_minutes').eq('id', 1).maybeSingle()
      return error ? null : data?.va_call_open_minutes ?? null
    },
    staleTime: 10 * 60e3,
    retry: false,
  }, qc || idle)
  return real ? openMinutes(q.data) : sample
}

// Admin: save the number (real: app_settings; sample: this browser).
export async function saveCallOpenMin(v, real) {
  const n = openMinutes(v)
  if (!real) { sampleOpenMin.set(n); return n }
  const { error } = await supabase.from('app_settings').update({ va_call_open_minutes: n }).eq('id', 1)
  if (error) throw new Error(/va_call_open_minutes/.test(error.message || '') ? 'This setting goes live once the P918 migration is applied.' : error.message)
  return n
}
