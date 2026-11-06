import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { ghlKeys, readGhlSettings } from '../lib/ghlConnect.js'
import { useAccount } from '../template/kit'
import { useAdmConnect } from './data'
import { sampleGhlRow } from './engine'

// P866 — the GoHighLevel settings row for Setup and the Connect rail dot. Signed in: the real ghl_settings row (same
// query and key as the Connect page, so they share one read). The sample preview: the sample row. P855: when the
// table can't be read, ask once and keep that answer (no 60-second re-read); it counts as not connected.
export function useGhlRow() {
  const { data: c } = useAdmConnect()
  const { live } = useAccount() || {}
  const [gaveUp, setGaveUp] = useState(false)
  const q = useQuery({ queryKey: ghlKeys.settings, enabled: !!live && !gaveUp, refetchInterval: 60e3, queryFn: () => readGhlSettings(supabase) })
  if (live && q.data === null && !gaveUp) setGaveUp(true)
  return live ? q.data || null : sampleGhlRow(c)
}
