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

export type Deps = {
  apiKey: string | undefined
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
  if (rows.length) await deps.rpc('ghl_note_sync', { p_status: failed ? 'error' : 'ok', p_error: lastError })
  return json({ claimed: rows.length, sent, failed })
}

export async function handle(req: Request, deps: Deps & { isCron(req: Request): Promise<boolean> }): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!(await deps.isCron(req))) return new Response('Forbidden', { status: 403 })
  let body: any = null
  try { body = await req.json() } catch { body = null }
  if (body?.action !== 'run') return json({ error: 'unknown action' }, 400)
  return run(deps)
}
