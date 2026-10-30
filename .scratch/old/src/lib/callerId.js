import { supabase } from './supabase'

// Prompt 666 — agent Caller ID (Twilio). supabase.functions.invoke hides a
// non-2xx body behind error.context, so unwrap it here: callers get the
// function's own message plus its `code` (e.g. 'no_from_number') to branch on.
export async function invokeCallerId(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (!error) return data
  let payload = null
  try { payload = await error.context?.json() } catch { /* not JSON */ }
  const err = new Error(payload?.error || error.message || 'Request failed')
  err.code = payload?.code
  throw err
}

// '+16025550143' → '(602) 555-0143'
export function formatUsPhone(e164) {
  const d = String(e164 || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (e164 || '')
}

// Codes meaning "the Twilio path isn't available for this call" — Fulfillment
// falls back to dialing directly from their own phone.
export const FALLBACK_CODES = new Set(['not_configured', 'no_from_number', 'caller_id_off'])
