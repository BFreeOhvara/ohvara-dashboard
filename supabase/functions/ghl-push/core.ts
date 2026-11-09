// ghl-push logic (Prompt 850), with the database and GHL passed in so tests
// run without Supabase or the network. No Deno APIs, so node --test loads it.
//
// Called by cron (x-ohvara-cron, checked by the caller) with {"action":"run"}.
// Order: switch off -> no-op (nothing claimed, nothing sent). Not configured
// (no GHL_API_KEY or no location ID) -> note it and stop. Otherwise claim due
// outbox rows and, per row: upsert the GHL contact, set its Ohvara tags, add
// it to the event's workflow when one is set, then mark the row done.
// Logs carry error text only, never a phone, email or name.
//
// P902: two more events. call_outcome (the speed-to-lead call's one outcome): sets the contact's custom fields
// (detail, keys in ../_shared/leadFlows.js GHL_OUTCOME_FIELDS), one ohvara-call-<outcome> tag, and adds the contact
// to the no-answer workflow when text_flow is no_answer (the booked texts ride on the stage → appointment_reminder
// event that follows). flow_stop: anything the lead did stopped the no-answer flow, so the contact leaves that
// workflow and gets ohvara-flow-stopped.
//
// P915: campaign on/off. After the outbox, the same run claims agent_campaign_control rows that changed since they
// were last sent (ghl_claim_controls, migration 253), POSTs each to Jordan's GoHighLevel Inbound Webhook (the URL is
// the Supabase secret GHL_CONTROL_WEBHOOK_URL; only https://services.leadconnectorhq.com/hooks/… is accepted) and
// settles it with ghl_control_result: a good answer marks it pushed; a failure is logged and retried after 1, 2, 4…
// minutes (admins hear after 5 failures). With no URL set, the rows wait (nothing claimed).
import { GhlError, type GhlClient } from './api.ts'
import { OUTCOME_TAGS, outcomeTag, GHL_OUTCOME_FIELDS } from '../_shared/leadFlows.js'

export const STAGES = ['new', 'contacting', 'booked', 'met', 'sold', 'follow_up', 'lost'] as const
export const BATCH = 25

type DbError = { message: string; code?: string } | null

export type Settings = {
  enabled: boolean
  location_id: string | null
  workflow_new_inbound: string | null
  workflow_appointment_reminder: string | null
  workflow_no_show: string | null
  workflow_opt_out: string | null
  workflow_no_answer?: string | null // P902
}

export type OutboxRow = {
  id: number
  event: 'new_inbound' | 'stage' | 'appointment_reminder' | 'no_show' | 'opt_out' | 'call_outcome' | 'flow_stop'
  lead_id: string | null
  stage: string | null
  contact_id: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  state: string | null
  detail?: Record<string, unknown> | null // P902: call_outcome / flow_stop fields
}

export type ControlRow = {
  agent_id: string; lead_type: 'appts' | 'live'; run: boolean; daily_budget_cents: number; cap_cents: number; reason: string
  split_form_pct: number | null; schedule: Record<string, unknown> | null; changed_at: string; attempt: number
  agent_code: string | null; agent_name: string | null; campaign_id: string | null; fb_campaign_id: string | null
}

export type PostResult = { ok: boolean; status: number }

export type Deps = {
  apiKey: string | undefined
  controlUrl?: string | undefined                                  // P915: GHL_CONTROL_WEBHOOK_URL
  post?(url: string, body: unknown): Promise<PostResult>           // P915: one JSON POST (index.ts: fetch, 10 s timeout)
  ghl(apiKey: string): GhlClient
  settings(): PromiseLike<{ data: Settings | null; error: DbError }>
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }>
  log(msg: string): void
}

export const WORKFLOW_FOR: Record<OutboxRow['event'], keyof Settings | null> = {
  new_inbound: 'workflow_new_inbound',
  appointment_reminder: 'workflow_appointment_reminder',
  no_show: 'workflow_no_show',
  opt_out: 'workflow_opt_out',
  stage: null,
  call_outcome: null, // P902: workflow_no_answer only when detail.text_flow is no_answer (workflowFor below)
  flow_stop: null,
}

export function workflowFor(row: OutboxRow): keyof Settings | null {
  if (row.event === 'call_outcome') return row.detail?.text_flow === 'no_answer' ? 'workflow_no_answer' : null
  return WORKFLOW_FOR[row.event]
}

// P902: the call_outcome fields as GoHighLevel custom fields (by key; Jordan makes one custom field per key).
export function customFieldsFor(row: OutboxRow) {
  if (row.event !== 'call_outcome' || !row.detail) return []
  return GHL_OUTCOME_FIELDS.map(([key]) => [key, row.detail![key]] as const)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([key, v]) => ({ key, field_value: String(v) }))
}

export const stageTag = (s: string) => `ohvara-stage-${s.replace(/_/g, '-')}`

// Tags to add and to remove for one row. Every pushed contact carries `ohvara`;
// a lead carries exactly one stage tag.
export function tagsFor(row: OutboxRow) {
  const add = ['ohvara']
  const remove: string[] = []
  if (row.event === 'opt_out') add.push('ohvara-opted-out')
  if (row.event === 'no_show') add.push('ohvara-no-show')
  if (row.event === 'call_outcome' && typeof row.detail?.first_call_outcome === 'string') {
    const tag = outcomeTag(row.detail.first_call_outcome)
    add.push(tag)
    remove.push(...OUTCOME_TAGS.filter(t => t !== tag))
  }
  if (row.event === 'flow_stop') add.push('ohvara-flow-stopped')
  if (row.stage && (STAGES as readonly string[]).includes(row.stage)) {
    add.push(stageTag(row.stage))
    remove.push(...STAGES.filter(s => s !== row.stage).map(stageTag))
  }
  return { add, remove }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export async function pushRow(row: OutboxRow, s: Settings, api: GhlClient): Promise<string> {
  if (!row.phone && !row.email) throw new GhlError('no phone or email to match a GHL contact', 400)
  const contactId = await api.upsertContact({
    locationId: s.location_id!,
    name: row.contact_name,
    phone: row.phone,
    email: row.email,
    state: row.state,
    dndSms: row.event === 'opt_out',
    customFields: customFieldsFor(row),
  })
  const { add, remove } = tagsFor(row)
  if (remove.length) await api.removeTags(contactId, remove)
  await api.addTags(contactId, add)
  // flow_stop: out of the no-answer workflow (GoHighLevel stops its remaining texts).
  if (row.event === 'flow_stop' && s.workflow_no_answer) await api.removeFromWorkflow(contactId, s.workflow_no_answer)
  const key = workflowFor(row)
  const workflowId = key ? (s[key] as string | null) : null
  if (workflowId) await api.addToWorkflow(contactId, workflowId)
  return contactId
}

// P915: only GoHighLevel's own inbound-webhook host, so a typo can never send agents' budgets elsewhere.
export const CONTROL_URL = /^https:\/\/services\.leadconnectorhq\.com\/hooks\/[A-Za-z0-9_\-/]{8,300}$/
export const controlUrlOk = (u: string | undefined | null): u is string => !!u && CONTROL_URL.test(u)

// What GoHighLevel's workflow receives per agent and side (form ads = appts, call ads = live). Money in cents and
// dollars; schedule = the call-ads hours ({ tz, hours: { Mon: { on, start, end } … } }, null = any time).
export function controlBody(r: ControlRow) {
  return {
    ohvara_event: 'campaign_control',
    agent_id: r.agent_id, agent_code: r.agent_code, agent_name: r.agent_name, lead_type: r.lead_type,
    run: r.run, state: r.run ? 'on' : 'off', reason: r.reason,
    daily_budget_cents: r.daily_budget_cents, daily_budget: Math.round(r.daily_budget_cents) / 100,
    spend_cap_cents: r.cap_cents, split_form_pct: r.split_form_pct, schedule: r.schedule,
    campaign_id: r.campaign_id, fb_campaign_id: r.fb_campaign_id, changed_at: r.changed_at,
  }
}

export async function runControls(deps: Deps): Promise<{ claimed: number; sent: number; failed: number; skipped?: string }> {
  if (!controlUrlOk(deps.controlUrl) || !deps.post) {
    if (deps.controlUrl) deps.log('[ghl-push] GHL_CONTROL_WEBHOOK_URL is not a services.leadconnectorhq.com/hooks/ address')
    return { claimed: 0, sent: 0, failed: 0, skipped: 'not_configured' }
  }
  const claim = await deps.rpc('ghl_claim_controls', { p_limit: BATCH })
  if (claim.error) {
    deps.log(`[ghl-push] claim controls ${claim.error.message}`)
    return { claimed: 0, sent: 0, failed: 0, skipped: 'claim' }
  }
  const rows = (claim.data as ControlRow[] | null) ?? []
  let sent = 0, failed = 0
  for (const r of rows) {
    const body = controlBody(r)
    let ok = false, status: number | null = null, error: string | null = null
    try {
      const res = await deps.post(deps.controlUrl, body)
      ok = res.ok; status = res.status
      if (!ok) error = `GHL hook: HTTP ${res.status}`
    } catch (e) {
      error = `GHL hook: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)
    }
    const fin = await deps.rpc('ghl_control_result', {
      p_agent: r.agent_id, p_type: r.lead_type, p_changed_at: r.changed_at, p_ok: ok, p_status: status, p_error: error,
      p_sent: { run: body.run, daily_budget_cents: body.daily_budget_cents, spend_cap_cents: body.spend_cap_cents, reason: body.reason },
    })
    if (fin.error) deps.log(`[ghl-push] control result ${fin.error.message}`)
    if (ok) sent++
    else { failed++; deps.log(`[ghl-push] control ${r.lead_type} attempt ${r.attempt}: ${error}`) }
  }
  return { claimed: rows.length, sent, failed }
}

export async function run(deps: Deps): Promise<Response> {
  const { data: s, error } = await deps.settings()
  if (error) {
    deps.log(`[ghl-push] settings ${error.message}`)
    return json({ error: 'settings' }, 500)
  }
  if (!s?.enabled) return json({ skipped: 'off' })
  if (!deps.apiKey || !s.location_id) {
    await deps.rpc('ghl_note_sync', { p_status: 'not_configured', p_error: !deps.apiKey ? 'GHL_API_KEY not set' : 'location ID not set' })
    return json({ skipped: 'not_configured' })
  }

  const claim = await deps.rpc('ghl_claim_outbox', { p_limit: BATCH })
  if (claim.error) {
    deps.log(`[ghl-push] claim ${claim.error.message}`)
    await runControls(deps)
    return json({ error: 'claim' }, 500)
  }
  const rows = (claim.data as OutboxRow[] | null) ?? []
  const api = deps.ghl(deps.apiKey)
  let sent = 0, failed = 0, lastError: string | null = null

  for (const row of rows) {
    try {
      const contactId = await pushRow(row, s, api)
      await deps.rpc('ghl_finish_outbox', { p_id: row.id, p_ok: true, p_contact_id: contactId, p_error: null, p_final: false })
      sent++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const final = e instanceof GhlError && e.final
      deps.log(`[ghl-push] row ${row.id} ${row.event}: ${msg}`)
      await deps.rpc('ghl_finish_outbox', { p_id: row.id, p_ok: false, p_contact_id: null, p_error: msg, p_final: final })
      failed++
      lastError = msg
      if (e instanceof GhlError && e.auth) break   // the rest would fail the same way
    }
  }
  const controls = await runControls(deps)
  const anyFail = failed || controls.failed
  if (rows.length || controls.claimed) {
    await deps.rpc('ghl_note_sync', { p_status: anyFail ? 'error' : 'ok', p_error: lastError ?? (controls.failed ? 'campaign on/off: a send failed (retrying)' : null) })
  }
  return json({ claimed: rows.length, sent, failed, ...(controls.skipped ? {} : { controls }) })
}

export async function handle(req: Request, deps: Deps & { isCron(req: Request): Promise<boolean> }): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!(await deps.isCron(req))) return new Response('Forbidden', { status: 403 })
  let body: any = null
  try { body = await req.json() } catch { body = null }
  if (body?.action !== 'run') return json({ error: 'unknown action' }, 400)
  return run(deps)
}
