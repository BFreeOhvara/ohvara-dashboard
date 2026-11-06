// ghl-push logic (Prompt 850), with the database and GHL passed in so tests
// run without Supabase or the network. No Deno APIs, so node --test loads it.
//
// Called by cron (x-ohvara-cron, checked by the caller) with {"action":"run"}.
// Order: switch off -> no-op (nothing claimed, nothing sent). Not configured
// (no GHL_API_KEY or no location ID) -> note it and stop. Otherwise claim due
// outbox rows and, per row: upsert the GHL contact, set its Ohvara tags, add
// it to the event's workflow when one is set, then mark the row done.
// Logs carry error text only, never a phone, email or name.
import { GhlError, type GhlClient } from './api.ts'

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
}

export type OutboxRow = {
  id: number
  event: 'new_inbound' | 'stage' | 'appointment_reminder' | 'no_show' | 'opt_out'
  lead_id: string | null
  stage: string | null
  contact_id: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  state: string | null
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
}

export const stageTag = (s: string) => `ohvara-stage-${s.replace(/_/g, '-')}`

// Tags to add and to remove for one row. Every pushed contact carries `ohvara`;
// a lead carries exactly one stage tag.
export function tagsFor(row: OutboxRow) {
  const add = ['ohvara']
  let remove: string[] = []
  if (row.event === 'opt_out') add.push('ohvara-opted-out')
  if (row.event === 'no_show') add.push('ohvara-no-show')
  if (row.stage && (STAGES as readonly string[]).includes(row.stage)) {
    add.push(stageTag(row.stage))
    remove = STAGES.filter(s => s !== row.stage).map(stageTag)
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
  })
  const { add, remove } = tagsFor(row)
  if (remove.length) await api.removeTags(contactId, remove)
  await api.addTags(contactId, add)
  const key = WORKFLOW_FOR[row.event]
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
