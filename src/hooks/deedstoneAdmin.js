// P916 — admin Settings → Deedstone numbers, the real side (migration 255). Not applied yet → the page says so and
// shows nothing real, never an error.
import { supabase } from '../lib/supabase'

const fail = (error, fallback) => new Error(error?.message?.replace(/^.*?: /, '') || fallback)

export async function loadPool() {
  const { data, error } = await supabase.rpc('admin_deedstone_numbers')
  if (error) return { missing: true }
  return data
}
export async function saveNumber({ id = null, phone, label = null, caller_name = null, provider_number_id = null, active = true }) {
  const { data, error } = await supabase.rpc('admin_deedstone_number_save', {
    p_id: id, p_phone: phone, p_label: label, p_caller_name: caller_name, p_provider_number_id: provider_number_id, p_active: active,
  })
  if (error) throw fail(error, 'Couldn’t save the number.')
  return data
}
export async function savePoolSettings(limit, estimate) {
  const { data, error } = await supabase.rpc('admin_deedstone_settings', { p_limit: limit, p_estimate: estimate })
  if (error) throw fail(error, 'Couldn’t save.')
  return data
}
// Every Deedstone number's Voice URL in Twilio (calls in, and the agent-call bridge).
export const VOICE_URL = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/help-voice`

// P924 — the VA pod on each number (258): who answers clients who call or text it.
export async function loadPods() {
  const { data, error } = await supabase.from('deedstone_number_vas').select('number_id, va_id, sort').order('sort')
  if (error) return {}
  return (data || []).reduce((m, r) => ({ ...m, [r.number_id]: [...(m[r.number_id] || []), r.va_id] }), {})
}
export async function savePod(numberId, vaIds) {
  const { error } = await supabase.rpc('admin_set_number_pod', { p_number: numberId, p_vas: vaIds })
  if (error) throw fail(error, 'Couldn’t save the VAs on this number.')
}
