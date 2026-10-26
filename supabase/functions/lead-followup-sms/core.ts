// The rules for the instant first text to a new mortgage_protection lead.
// Pure: index.ts wires the database and Twilio; tests pass fakes.

export type Status =
  | 'sent' | 'failed' | 'skipped_gate' | 'skipped_opt_out' | 'skipped_no_phone'
  | 'skipped_no_agent' | 'skipped_no_link' | 'skipped_not_mp'

export type Lead = {
  id: string
  lead_type: string
  phone: string | null
  contact_name: string | null
  agent_name: string | null        // the assigned agent's full name
}

export type Deps = {
  smsLive(): Promise<boolean>
  getLead(id: string): Promise<Lead | null>
  optedOut(phone: string): Promise<boolean>
  alreadySent(leadId: string): Promise<boolean>
  bookingLink: string | null
  send(to: string, body: string): Promise<{ ok: boolean; sid?: string; error?: string }>
  log(row: { lead_id: string; status: Status; to_phone?: string | null; twilio_sid?: string | null; error?: string | null }): Promise<void>
}

export type Result = { status: number; body: { status: Status | 'duplicate' } | { error: string } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function toE164(raw: string): string | null {
  const d = raw.replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d[0] === '1') return `+${d}`
  return null
}

export const firstName = (full: string | null) => (full ?? '').trim().split(/\s+/)[0] || null

// Nothing here is agent data: the name and link come in as arguments.
export function compose(agentFirst: string, link: string, leadFirst: string | null): string {
  const hi = leadFirst ? `Hi ${leadFirst}, ` : 'Hi, '
  return `Ohvara: ${hi}this is ${agentFirst} about the mortgage protection info you asked for. Pick a time to talk here: ${link}. Reply STOP to opt out.`
}

export async function handle(deps: Deps, body: Record<string, unknown>): Promise<Result> {
  const leadId = typeof body.lead_id === 'string' ? body.lead_id : ''
  if (!UUID.test(leadId)) return { status: 400, body: { error: 'lead_id is required' } }

  const lead = await deps.getLead(leadId)
  if (!lead) return { status: 404, body: { error: 'Lead not found' } }
  const skip = async (status: Status, phone?: string | null): Promise<Result> => {
    await deps.log({ lead_id: leadId, status, to_phone: phone ?? null })
    return { status: 200, body: { status } }
  }

  if (lead.lead_type !== 'mortgage_protection') return skip('skipped_not_mp')
  // The gate: sms_live off means nothing is sent, and the attempt is logged.
  if (!(await deps.smsLive())) return skip('skipped_gate')
  if (await deps.alreadySent(leadId)) return { status: 200, body: { status: 'duplicate' } }

  const phone = lead.phone ? toE164(lead.phone) : null
  if (!phone) return skip('skipped_no_phone')
  if (await deps.optedOut(phone)) return skip('skipped_opt_out', phone)
  const agent = firstName(lead.agent_name)
  if (!agent) return skip('skipped_no_agent', phone)
  if (!deps.bookingLink) return skip('skipped_no_link', phone)

  const r = await deps.send(phone, compose(agent, deps.bookingLink, firstName(lead.contact_name)))
  const status: Status = r.ok ? 'sent' : 'failed'
  await deps.log({ lead_id: leadId, status, to_phone: phone, twilio_sid: r.sid ?? null, error: r.error ?? null })
  return { status: 200, body: { status } }
}
