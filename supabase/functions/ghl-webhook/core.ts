// ghl-webhook logic (Prompt 850), with the database and keys passed in so
// tests run without Supabase or the network. No Deno APIs, so node --test
// loads it. BUILT, NOT DEPLOYED.
//
// Who may call it (checked on the raw body, before anything is parsed):
//   1. A HighLevel app webhook signed with X-GHL-Signature: Ed25519, base64,
//      over the raw body, checked with GHL's published public key
//      (https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide;
//      the RSA X-WH-Signature header was retired 2026-09-01, so it is not accepted).
//   2. A GHL workflow "Custom Webhook" action carrying the header
//      x-ohvara-ghl-secret = the Supabase secret GHL_WEBHOOK_SECRET.
//   Anything else -> 401, nothing read or written.
//
// What it handles (payload shapes: fixtures/*.json, from GHL's webhook docs):
//   InboundMessage  (SMS)  STOP/START words -> sms_set_opt(source 'GHL');
//                          any other text -> lead_sms_replies (183), saved once
//                          per GHL message ID (twilio_sid = 'ghl:<messageId>'),
//                          so the VA queue, contact log (199) and activity feed
//                          (202) show it like a Twilio reply.
//   OutboundMessage (SMS)  a text GHL sent -> inbound_events text_sent via
//                          ghl_log_text (once per message ID; a later webhook
//                          for the same message only updates its status).
//   ContactDndUpdate       SMS DND turned on -> sms_set_opt(opted out, 'GHL').
//                          Turning DND off does NOT opt back in: only a START
//                          text does (consent is never restored silently).
//   Workflow webhook       { ohvara_event: 'reply' | 'opt_out', ... } in the
//                          action's custom data (see the README for the fields).
//                          'lead_created' (P858): the Deedstone page / Meta form
//                          lead with the hidden agent_id, lead_type and
//                          meta_option -> ghl_intake_lead (migration 232), saved
//                          once per delivery and routed to that agent, or to
//                          admin's Unassigned when the ID is unknown or missing.
//                          P915: agent_id may be the short DS-XXXX code or the
//                          full ID; is_test (Meta's lead testing tool) is kept.
//                          'campaign_created' (P915): GoHighLevel made an agent's
//                          campaign -> ghl_campaign_created (migration 253) saves
//                          its campaign IDs on the agent (one of the launch checks).
//                          'campaign_state' (P915): what GoHighLevel did with an
//                          on/off push -> ghl_campaign_state.
// The switch: while ghl_settings.enabled is off, only opt-outs are recorded
// (a STOP is always honoured); everything else is answered 200 and dropped.
// A webhook for another location is ignored. Database errors answer 500 so
// GHL retries (it retries non-2xx up to 12 times). Logs carry error text only,
// never a phone, name or message body.
import { inboundIntent } from '../recovery-sms/core.ts'

// GHL's Ed25519 webhook public key (SPKI, from the integration guide above).
export const GHL_ED25519_PUBLIC_KEY =
  'MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg='
export const SECRET_HEADER = 'x-ohvara-ghl-secret'
export const MAX_BODY = 1600
export const MAX_REQUEST = 64 * 1024

type DbError = { message: string; code?: string } | null

export type ReplyRow = { twilio_sid: string; from_phone: string; body: string; lead_id: string | null }

export type Settings = { enabled: boolean; location_id: string | null }

export type LeadMatch = { lead_id: string; agent_id: string | null; is_sample: boolean }

export type Deps = {
  sharedSecret: string | undefined
  publicKey: string                     // base64 SPKI of the Ed25519 key
  settings(): PromiseLike<{ data: Settings | null; error: DbError }>
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }>
  insertReply(row: ReplyRow): PromiseLike<{ error: DbError }>
  log(msg: string): void
}

// ── auth ────────────────────────────────────────────────────────────────────
const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

export async function verifyGhlSignature(raw: string, signature: string | null, publicKeyB64: string) {
  if (!signature || signature === 'N/A') return false
  try {
    const key = await crypto.subtle.importKey('spki', b64(publicKeyB64), { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, b64(signature.trim()), new TextEncoder().encode(raw))
  } catch {
    return false
  }
}

// Constant-time compare of two strings via SHA-256 digests (equal length).
export async function sameSecret(a: string | null, b: string | undefined) {
  if (!a || !b) return false
  const enc = new TextEncoder()
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const u = new Uint8Array(x), v = new Uint8Array(y)
  let diff = 0
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i]
  return diff === 0
}

export async function authorised(req: Request, raw: string, deps: Pick<Deps, 'sharedSecret' | 'publicKey'>) {
  const sig = req.headers.get('x-ghl-signature')
  if (sig) return verifyGhlSignature(raw, sig, deps.publicKey)
  return sameSecret(req.headers.get(SECRET_HEADER), deps.sharedSecret)
}

// ── what the payload means ──────────────────────────────────────────────────
export type Action =
  | { kind: 'opt'; phone: string; optedOut: boolean; locationId: string | null }
  | { kind: 'reply'; messageId: string; phone: string; contactId: string | null; body: string; locationId: string | null }
  | { kind: 'sent'; messageId: string; phone: string | null; contactId: string | null; body: string; status: string | null; at: string | null; locationId: string | null }
  | { kind: 'lead'; lead: IntakeLead; locationId: string | null }
  | { kind: 'campaign'; campaign: CampaignCreated; locationId: string | null }
  | { kind: 'campaignState'; state: CampaignState; locationId: string | null }
  | { kind: 'ignore'; why: string }

// P858: the lead the Deedstone page / Meta form posted, as ghl_intake_lead (migration 232) takes it.
export type IntakeLead = {
  intake_key: string; agent_id: string | null; lead_type: 'booked_appointment' | 'live_call'; meta_option: 'form_page' | 'page_only' | null
  first_name: string | null; last_name: string | null; phone: string; email: string | null; state: string | null; postal_code: string | null
  campaign_id: string | null; adset_id: string | null; ad_id: string | null; contact_id: string | null; page_url: string | null
  consent_at: string | null; consent_text_version: string | null; is_test: boolean
}

// P915: GoHighLevel → Ohvara when it creates an agent's campaign from the template (ghl_campaign_created, 253).
export type CampaignCreated = {
  agent_id: string; campaign_id: string | null; fb_campaign_id: string | null; campaign_name: string | null; lead_type: string | null
}
// P915: what GoHighLevel did with an on/off push (ghl_campaign_state → campaign_control_confirm).
export type CampaignState = { agent_id: string; lead_type: string | null; state: string }
const truthy = (v: string | null) => !!v && ['true', 't', '1', 'yes', 'y'].includes(v.toLowerCase())
const LEAD_TYPES: Record<string, IntakeLead['lead_type']> = {
  booked_appointment: 'booked_appointment', appointment: 'booked_appointment', booked: 'booked_appointment',
  live_call: 'live_call', live: 'live_call', call: 'live_call',
}
const META_OPTIONS: Record<string, IntakeLead['meta_option']> = { form_page: 'form_page', form: 'form_page', page_only: 'page_only', page: 'page_only' }

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const isSms = (p: any) => {
  const t = String(p?.messageType ?? p?.messageTypeString ?? '').toUpperCase()
  return t === 'SMS' || t === 'TYPE_SMS'
}

async function sha256Hex(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('')
}

// deno-lint-ignore no-explicit-any
export async function classify(p: any, raw: string): Promise<Action> {
  if (!p || typeof p !== 'object') return { kind: 'ignore', why: 'not json' }
  const locationId = str(p.locationId) ?? str(p.location?.id) ?? str(p.location_id)

  // HighLevel app webhooks carry a `type` naming the event.
  if (typeof p.type === 'string') {
    if (p.type === 'InboundMessage' || p.type === 'OutboundMessage') {
      if (!isSms(p)) return { kind: 'ignore', why: 'not sms' }
      const messageId = str(p.messageId)
      const body = String(p.body ?? '').slice(0, MAX_BODY)
      if (p.type === 'InboundMessage') {
        const phone = str(p.from) ?? str(p.phone)
        if (!phone) return { kind: 'ignore', why: 'no sender' }
        const intent = inboundIntent(body)
        if (intent === 'stop' || intent === 'start') return { kind: 'opt', phone, optedOut: intent === 'stop', locationId }
        if (!messageId) return { kind: 'ignore', why: 'no message id' }
        return { kind: 'reply', messageId, phone, contactId: str(p.contactId), body, locationId }
      }
      if (!messageId) return { kind: 'ignore', why: 'no message id' }
      return {
        kind: 'sent', messageId, phone: str(p.to) ?? str(p.phone), contactId: str(p.contactId), body,
        status: str(p.status), at: str(p.dateAdded), locationId,
      }
    }
    if (p.type === 'ContactDndUpdate') {
      const phone = str(p.phone)
      const smsDnd = p.dndSettings?.SMS?.status === 'active' || (p.dnd === true && !p.dndSettings)
      if (!phone || !smsDnd) return { kind: 'ignore', why: 'not an sms opt-out' }
      return { kind: 'opt', phone, optedOut: true, locationId }
    }
    return { kind: 'ignore', why: `event ${p.type}` }
  }

  // A workflow Custom Webhook: Jordan's action sends the contact's standard
  // fields plus custom data { ohvara_event, message_id?, body? }.
  const cd = p.customData ?? p.custom_data ?? {}
  const event = str(cd.ohvara_event) ?? str(p.ohvara_event)
  const phone = str(p.phone) ?? str(p.contact?.phone)
  const contactId = str(p.contact_id) ?? str(p.contactId) ?? str(p.contact?.id)
  if (event === 'lead_created') {
    if (!phone) return { kind: 'ignore', why: 'no phone' }
    // The hidden agent ID rides in the ad link (utm or a form field); custom data wins over the contact's fields.
    const pick = (...keys: string[]) => { for (const k of keys) { const v = str(cd[k]) ?? str(p[k]); if (v) return v } return null }
    const typeWord = (pick('lead_type') ?? '').toLowerCase()
    const lead_type = LEAD_TYPES[typeWord]
    if (typeWord && !lead_type) return { kind: 'ignore', why: 'unknown lead type' }
    const metaWord = (pick('meta_option') ?? '').toLowerCase()
    // The intake key: the engine's own delivery ID, else the raw body's hash, so a retry of the same delivery saves once.
    const intake_key = pick('intake_id', 'event_id') ?? `wf-${(await sha256Hex(raw)).slice(0, 32)}`
    return {
      kind: 'lead', locationId,
      lead: {
        intake_key, agent_id: pick('agent_id', 'ohvara_agent_id', 'utm_agent'), lead_type: lead_type ?? 'booked_appointment',
        meta_option: META_OPTIONS[metaWord] ?? null, first_name: pick('first_name'), last_name: pick('last_name'), phone,
        email: pick('email'), state: pick('state'), postal_code: pick('postal_code', 'zip'), campaign_id: pick('campaign_id', 'utm_campaign_id'),
        adset_id: pick('adset_id'), ad_id: pick('ad_id', 'utm_content'), contact_id: contactId, page_url: pick('page_url'),
        consent_at: pick('consent_at'), consent_text_version: pick('consent_text_version'),
        is_test: truthy(pick('is_test', 'test_lead')),
      },
    }
  }
  if (event === 'campaign_created' || event === 'campaign_state') {
    const pick = (...keys: string[]) => { for (const k of keys) { const v = str(cd[k]) ?? str(p[k]); if (v) return v } return null }
    const agent_id = pick('agent_id', 'agent_ref', 'ohvara_agent_id')
    if (!agent_id) return { kind: 'ignore', why: 'no agent id' }
    if (event === 'campaign_state') {
      const state = pick('state', 'engine_state', 'status')
      if (!state) return { kind: 'ignore', why: 'no state' }
      return { kind: 'campaignState', locationId, state: { agent_id, lead_type: pick('lead_type'), state: state.slice(0, 60) } }
    }
    const campaign_id = pick('campaign_id', 'ghl_campaign_id')
    const fb_campaign_id = pick('fb_campaign_id', 'meta_campaign_id')
    if (!campaign_id && !fb_campaign_id) return { kind: 'ignore', why: 'no campaign id' }
    return {
      kind: 'campaign', locationId,
      campaign: { agent_id, campaign_id, fb_campaign_id, campaign_name: pick('campaign_name', 'name'), lead_type: pick('lead_type') },
    }
  }
  if (event === 'opt_out') {
    if (!phone) return { kind: 'ignore', why: 'no phone' }
    return { kind: 'opt', phone, optedOut: true, locationId }
  }
  if (event === 'reply') {
    if (!phone) return { kind: 'ignore', why: 'no phone' }
    const body = String(cd.body ?? p.message?.body ?? '').slice(0, MAX_BODY)
    const intent = inboundIntent(body)
    if (intent === 'stop' || intent === 'start') return { kind: 'opt', phone, optedOut: intent === 'stop', locationId }
    // No message ID from a workflow: the raw body's hash, so a GHL retry of
    // the same delivery saves nothing twice.
    const messageId = str(cd.message_id) ?? `wf-${(await sha256Hex(raw)).slice(0, 32)}`
    return { kind: 'reply', messageId, phone, contactId, body, locationId }
  }
  return { kind: 'ignore', why: 'unknown payload' }
}

// ── handler ─────────────────────────────────────────────────────────────────
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const retry = () => json({ error: 'retry' }, 500)

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const raw = await req.text()
  if (raw.length > MAX_REQUEST) return new Response('Too large', { status: 413 })
  if (!(await authorised(req, raw, deps))) return new Response('Unauthorized', { status: 401 })

  let payload: unknown = null
  try { payload = JSON.parse(raw) } catch { payload = null }
  const action = await classify(payload, raw)
  if (action.kind === 'ignore') return json({ ignored: action.why })

  const { data: s, error } = await deps.settings()
  if (error) {
    deps.log(`[ghl-webhook] settings ${error.message}`)
    return retry()
  }
  if (action.locationId && s?.location_id && action.locationId !== s.location_id) {
    return json({ ignored: 'other location' })
  }

  if (action.kind === 'opt') {
    // Opt-outs count even with the switch off; an opt-in only while it is on.
    if (!action.optedOut && !s?.enabled) return json({ skipped: 'off' })
    const r = await deps.rpc('sms_set_opt', { p_phone: action.phone, p_opted_out: action.optedOut, p_source: 'GHL' })
    if (r.error) {
      deps.log(`[ghl-webhook] sms_set_opt ${r.error.message}`)
      return retry()
    }
    return json({ ok: action.optedOut ? 'opted_out' : 'opted_in' })
  }

  if (!s?.enabled) return json({ skipped: 'off' })

  if (action.kind === 'lead') {
    // P858: one Ohvara lead per delivery, routed by the agent ID in the ad link (migration 232).
    const r = await deps.rpc('ghl_intake_lead', { p: action.lead })
    if (r.error) {
      // A refused payload (bad phone, bad type: 22xxx) will never save, so don't make GHL retry it 12 times.
      if (r.error.code?.startsWith('22')) return json({ ignored: 'bad lead' })
      deps.log(`[ghl-webhook] ghl_intake_lead ${r.error.message}`)
      return retry()
    }
    const out = (r.data ?? {}) as { routing?: string; duplicate?: boolean }
    return json({ ok: out.duplicate ? 'duplicate' : 'lead_saved', routing: out.routing ?? null })
  }

  if (action.kind === 'campaign' || action.kind === 'campaignState') {
    // P915: the campaign ID lands on the agent (a launch check), or the engine confirms an on/off push.
    const fn = action.kind === 'campaign' ? 'ghl_campaign_created' : 'ghl_campaign_state'
    const r = await deps.rpc(fn, { p: action.kind === 'campaign' ? action.campaign : action.state })
    if (r.error) {
      // Unknown agent or a bad field (22xxx): retrying won't fix it.
      if (r.error.code?.startsWith('22')) return json({ ignored: r.error.message === 'unknown agent' ? 'unknown agent' : 'bad campaign' })
      deps.log(`[ghl-webhook] ${fn} ${r.error.message}`)
      return retry()
    }
    return json({ ok: action.kind === 'campaign' ? 'campaign_saved' : 'state_saved' })
  }

  const match = await deps.rpc('ghl_lead_for_contact', { p_contact_id: action.contactId, p_phone: action.phone })
  if (match.error) {
    deps.log(`[ghl-webhook] ghl_lead_for_contact ${match.error.message}`)
    return retry()
  }
  const lead = (Array.isArray(match.data) ? match.data[0] : match.data) as LeadMatch | undefined

  if (action.kind === 'reply') {
    const { error: e } = await deps.insertReply({
      twilio_sid: `ghl:${action.messageId}`, from_phone: action.phone, body: action.body, lead_id: lead?.lead_id ?? null,
    })
    // 23505: this message is already saved (a GHL retry), so it's done.
    if (e && e.code !== '23505') {
      deps.log(`[ghl-webhook] save reply ${e.message}`)
      return retry()
    }
    if (e) return json({ ok: 'duplicate', matched: !!lead })
    // P924: a client's text becomes a pod task (or a save call) and a drafted reply (client_text_intake, 258). The
    // reply is not sent from here: GoHighLevel sends it once the workflow is wired. A failure is logged, not retried
    // (the text itself is saved).
    const intake = await deps.rpc('client_text_intake', { p_phone: action.phone, p_body: action.body, p_message_id: `ghl:${action.messageId}` })
    if (intake.error) deps.log(`[ghl-webhook] client_text_intake ${intake.error.message}`)
    return json({ ok: 'reply_saved', matched: !!lead, client: (intake.data as { intent?: string } | null)?.intent ?? null })
  }

  // sent
  if (!lead) return json({ ignored: 'no lead' })
  const r = await deps.rpc('ghl_log_text', {
    p_lead: lead.lead_id, p_agent: lead.agent_id, p_message_id: action.messageId, p_body: action.body,
    p_status: action.status, p_at: action.at, p_is_sample: lead.is_sample,
  })
  if (r.error) {
    deps.log(`[ghl-webhook] ghl_log_text ${r.error.message}`)
    return retry()
  }
  return json({ ok: r.data })
}
