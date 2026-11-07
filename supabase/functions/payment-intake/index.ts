// payment-intake — P885, forwarded carrier missed-payment / lapse emails → payment_intake_receive(). Logic: core.ts.
//
// Each agent forwards carrier emails to their own address, pay+<token>@<payment_settings.intake_domain>. An inbound
// email service (Postmark Inbound recommended: plus-addressing arrives as MailboxHash) posts each email here as JSON.
// Deploy with --no-verify-jwt (the mail service has no JWT; core.ts checks the shared secret on every request):
//   npx.cmd supabase functions deploy payment-intake --no-verify-jwt --project-ref jjextitmbptoaolacocs
// Secret: PAYMENT_INTAKE_SECRET (header x-ohvara-intake, Basic auth password, or ?key=).
// Needs the P885 migration (payment_intake_receive).
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type Store } from './core.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const store: Store = {
  async receive(token, messageId, from, subject, body, parsed) {
    const { data, error } = await admin.rpc('payment_intake_receive', {
      p_token: token, p_message_id: messageId, p_from: from, p_subject: subject, p_body: body, p_parsed: parsed,
    })
    if (error) throw error
    return data
  },
}

Deno.serve(req => handle(req, store, Deno.env.get('PAYMENT_INTAKE_SECRET')))
