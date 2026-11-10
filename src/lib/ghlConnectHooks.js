import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { ghlKeys, readGhlSettings, readGhlKeySaved, saveGhlSettings, sendGhlKey, testGhlConnection, sameForm, formFromSettings } from './ghlConnect.js'

// React Query wrappers for the admin Connect page (P853); the logic and tests are in ./ghlConnect.js.
// enabled is false on the sample preview (nobody signed in): nothing is read or written there.
// settings.data: the ghl_settings row, null when it can't be read (230 not applied, or not an admin), undefined while loading.
// keySaved.data: true / false / null (unknown).
export function useGhlConnect({ enabled = true } = {}) {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ghlKeys.settings, enabled, refetchInterval: 60e3, queryFn: () => readGhlSettings(supabase) })
  const keySaved = useQuery({ queryKey: ghlKeys.key, enabled, queryFn: () => readGhlKeySaved(supabase) })

  // Saves the IDs (only if they changed), then the key (only if one was typed). The key is passed straight
  // through and kept nowhere. Returns { settings, key } results; either is null when it was skipped.
  async function save({ form, key }) {
    const out = { settings: null, key: null }
    if (!sameForm(form, formFromSettings(settings.data))) out.settings = await saveGhlSettings(supabase, form)
    if (key && key.trim() && (out.settings === null || out.settings.ok)) out.key = await sendGhlKey(supabase, key)
    await Promise.all([qc.invalidateQueries({ queryKey: ghlKeys.settings }), qc.invalidateQueries({ queryKey: ghlKeys.key })])
    return out
  }

  // Test connection (P939): one read-only call to GoHighLevel through the server, then re-reads the bridge row.
  // Returns { ok, message }; the key is never in it.
  async function test() {
    const r = await testGhlConnection(supabase)
    readGhlSettings(supabase).then(row => qc.setQueryData(ghlKeys.settings, row)).catch(() => {})
    return r
  }

  return { settings, keySaved, save, test }
}
