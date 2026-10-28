// The rules for the follow-up texts to a mortgage_protection lead, one per
// stage (just_submitted, not_reached, reached; opted_out never sends), from
// the assigned agent's own number. Pure: index.ts wires the database and
// Twilio; tests pass fakes. No Deno APIs, so node --test can load it.
import { stateWindow } from '../_shared/smsWindow.ts'
import { fill, TEMPLATES, type SendStage, type Stage, type Template } from './templates.ts'

export type { Stage } from './templates.ts'

export type Status =
  | 'sent' | 'failed' | 'skipped_gate' | 'skipped_opt_out' | 'skipped_no_phone'
  | 'skipped_no_agent' | 'skipped_no_sender' | 'skipped_no_link' | 'skipped_not_mp'
  | 'skipped_quiet_hours' | 'skipped_cap' | 'skipped_no_stage'

export type Lead = {
  id: string
  lead_type: string | null       // leads.lead_type (166_lead_types_delivery)
  status: string | null          // leads.status (the lead_status enum)
  phone: string | null
  contact_name: string | null
  state: string | null
  agent_id: string | null        // leads.assigned_rep_id
  agent_name: string | null      // the assigned agent's full name
}

// The agent's own texting number (agent_sms_senders, active rows only).
export type Sender = { from_number: string; messaging_service_sid: string | null; brand_name: string | null }

export type LogRow = {
  lead_id: string; stage: Stage | null; status: Status
  to_phone?: string | null; from_number?: string | null; twilio_sid?: string | null; error?: string | null
}

export type Deps = {
  smsLive(): Promise<boolean>
  getLead(id: string): Promise<Lead | null>
  optedOut(phone: string): Promise<boolean>             // sms_is_opted_out (157)
  sentStages(leadId: string): Promise<string[]>         // one entry per 'sent' row
  getSender(agentId: string): Promise<Sender | null>
  now(): Date
  bookingLink: string | null
  templates?: Record<SendStage, Template>                // tests only; defaults to TEMPLATES
  send(to: string, body: string, from: Sender): Promise<{ ok: boolean; sid?: string; error?: string }>
  log(row: LogRow): Promise<void>
}

export type Result = { status: number; body: { status: Status | 'duplicate'; stage?: Stage | null } | { error: string } }

export const MAX_TEXTS_PER_LEAD = 4
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function toE164(raw: string): string | null {
  const d = raw.replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d[0] === '1') return `+${d}`
  return null
}

export const firstName = (full: string | null) => (full ?? '').trim().split(/\s+/)[0] || null

// Which stage the lead is in. An opted-out number wins over every status.
export function stageFor(status: string | null, optedOut: boolean): Stage | null {
  if (optedOut) return 'opted_out'
  switch (status) {
    case 'New': return 'just_submitted'
    case 'No Answer': return 'not_reached'
    case 'Contacted': case 'Follow-Up': case 'Booked': case 'Appointment Booked': return 'reached'
  }
  return null
}

export async function handle(deps: Deps, body: Record<string, unknown>): Promise<Result> {
  const leadId = typeof body.lead_id === 'string' ? body.lead_id : ''
  if (!UUID.test(leadId)) return { status: 400, body: { error: 'lead_id is required' } }

  const lead = await deps.getLead(leadId)
  if (!lead) return { status: 404, body: { error: 'Lead not found' } }

  const phone = lead.phone ? toE164(lead.phone) : null
  let stage: Stage | null = null
  const skip = async (status: Status, error?: string): Promise<Result> => {
    await deps.log({ lead_id: leadId, stage, status, to_phone: phone, error: error ?? null })
    return { status: 200, body: { status, stage } }
  }

  if (lead.lead_type !== 'mortgage_protection') return skip('skipped_not_mp')
  stage = stageFor(lead.status, phone ? await deps.optedOut(phone) : false)
  // The gate: sms_live off means nothing is sent, and the attempt is logged.
  if (!(await deps.smsLive())) return skip('skipped_gate')
  if (stage === 'opted_out') return skip('skipped_opt_out')
  if (!stage) return skip('skipped_no_stage')

  const sent = await deps.sentStages(leadId)
  if (sent.includes(stage)) return { status: 200, body: { status: 'duplicate', stage } }
  if (sent.length >= MAX_TEXTS_PER_LEAD) return skip('skipped_cap')
  if (!phone) return skip('skipped_no_phone')
  const agentFirst = firstName(lead.agent_name)
  if (!lead.agent_id || !agentFirst) return skip('skipped_no_agent')
  const sender = await deps.getSender(lead.agent_id)
  if (!sender || !sender.from_number) return skip('skipped_no_sender')
  const win = stateWindow(deps.now(), lead.state)
  if (win !== 'ok') return skip('skipped_quiet_hours', win === 'unknown_zone' ? 'unknown_zone' : undefined)
  const template = (deps.templates ?? TEMPLATES)[stage]
  if (template.needsLink && !deps.bookingLink) return skip('skipped_no_link')

  const text = fill(template, { agentFirst, leadFirst: firstName(lead.contact_name), link: deps.bookingLink })
  const r = await deps.send(phone, text, sender)
  const status: Status = r.ok ? 'sent' : 'failed'
  await deps.log({
    lead_id: leadId, stage, status, to_phone: phone, from_number: sender.from_number,
    twilio_sid: r.sid ?? null, error: r.error ?? null,
  })
  return { status: 200, body: { status, stage } }
}
