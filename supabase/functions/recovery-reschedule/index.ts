// Prompt 696 — the client-facing half of the no-answer recovery link
// (/r/<token> on the portal). No login: the unguessable token is the
// credential, and it only ever reveals a first name and open call times.
//
//   { action: 'info', token }                       → status + open slots
//   { action: 'pick', token, at }                   → book a listed slot
//   { action: 'pick', token, asap: true }           → book the earliest slot
//
// All the rules (which slots are open, what counts as still-active) live in
// the recovery_link_* SQL functions; this just exposes them without a JWT.
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const token = String(body.token || '')
    if (!UUID.test(token)) return json({ status: 'invalid' })

    if (body.action === 'info') {
      const { data, error } = await supabase.rpc('recovery_link_info', { p_token: token })
      if (error) throw error
      return json(data)
    }

    if (body.action === 'pick') {
      const at = body.asap ? null : String(body.at || '')
      if (!body.asap && !at) return json({ ok: false, reason: 'unavailable' })
      const { data, error } = await supabase.rpc('recovery_link_pick', {
        p_token: token, p_at: at, p_asap: !!body.asap,
      })
      if (error) throw error
      return json(data)
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error('[recovery-reschedule]', err instanceof Error ? err.message : String(err))
    return json({ error: 'Something went wrong' }, 500)
  }
})
