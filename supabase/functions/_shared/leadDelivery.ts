// Delivering a new lead to an agent, with the prepaid lead charge (migration
// 162). Kept free of Supabase/Deno imports so it runs against fakes; an intake
// function (lead-intake) supplies the database side.
//
//   1. assign the lead. Nobody qualifies → it stays unassigned.
//   2. price = recovery_config.price_per_lead_cents[lead_type]. Not set → no
//      charge at all, the lead is delivered as before.
//   3. price set → charge_lead(lead_id) takes it from the agent's balance.
//      'insufficient' (balance short) → the lead is unassigned again, not
//      delivered, and can be assigned later. A charge that errors also
//      unassigns, so nobody gets a paid lead without paying, then rethrows.
//   4. otherwise mark delivered.
//
// charge_lead is safe to repeat (one charge per lead), so a retry never
// double-charges. Cancellation billing is a separate system and is not here.

export type ChargeResult = 'charged' | 'already_charged' | 'no_price' | 'insufficient' | 'no_agent'

export interface DeliveryDeps {
  // Assigns the lead; returns the agent's id, or null if nobody qualifies.
  assign(leadId: string): Promise<string | null>
  // Puts the lead back to unassigned (only if it's still this agent's).
  unassign(leadId: string, agentId: string): Promise<void>
  // Whole cents for this lead_type, or null when no price is set.
  priceFor(leadType: string): Promise<number | null>
  charge(leadId: string): Promise<ChargeResult>
  markDelivered(leadId: string, at: string): Promise<void>
  now(): Date
  log(msg: string): void
}

export type Delivery =
  | { outcome: 'unassigned' }
  | { outcome: 'short_balance'; agent: string }
  | { outcome: 'delivered'; agent: string; charged: boolean }

export async function deliver(deps: DeliveryDeps, leadId: string, leadType: string): Promise<Delivery> {
  const agent = await deps.assign(leadId)
  if (!agent) return { outcome: 'unassigned' }

  let charged = false
  const price = await deps.priceFor(leadType)
  if (price != null && price > 0) {
    let r: ChargeResult
    try {
      r = await deps.charge(leadId)
    } catch (err) {
      await deps.unassign(leadId, agent)
      throw err
    }
    if (r === 'insufficient' || r === 'no_agent') {
      if (r === 'insufficient') await deps.unassign(leadId, agent)
      deps.log(`lead ${leadId} not delivered: ${r}`)
      return r === 'insufficient' ? { outcome: 'short_balance', agent } : { outcome: 'unassigned' }
    }
    charged = r === 'charged' || r === 'already_charged'
  }

  await deps.markDelivered(leadId, deps.now().toISOString())
  return { outcome: 'delivered', agent, charged }
}

// recovery_config.price_per_lead_cents (a lead_type → cents map, or null) to
// one type's price. Anything that isn't a positive whole number is no price.
export function priceFromMap(map: unknown, leadType: string): number | null {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null
  const v = (map as Record<string, unknown>)[leadType]
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
}
