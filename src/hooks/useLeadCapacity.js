import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { buildCapacity, windowFor } from '../lib/leadCapacity'

// Admin Overview "Lead capacity" card. Read only: selects as the signed-in
// admin (RLS lets admin read lead_prices 176, agent_lead_balance 176,
// agent_lead_settings 161, profiles and leads). No write, no function call,
// nothing to Meta or Google. src/lib/leadCapacity.js does the counting.
const PAGE = 1000

// Every row of a select, a page at a time (PostgREST caps a response).
async function selectAll(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < PAGE) return rows
  }
}

async function rows(q) {
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export function useLeadCapacity() {
  return useQuery({
    queryKey: ['lead-capacity'],
    queryFn: async () => {
      const now = new Date()
      const win = windowFor(now)
      const [prices, settings, balances, delivered, unassigned] = await Promise.all([
        rows(supabase.from('lead_prices').select('lead_type, price_cents, active')),
        rows(supabase.from('agent_lead_settings').select('agent_id, active, daily_cap')),
        rows(supabase.from('agent_lead_balance').select('agent_id, balance_cents')),
        // Typed leads only: cancellation leads are a separate pipeline.
        selectAll(() => supabase.from('leads')
          .select('id, assigned_rep_id, lead_type, delivered_at')
          .neq('lead_type', 'cancellation')
          .gte('delivered_at', win.start.toISOString())
          .lt('delivered_at', win.end.toISOString())
          .order('id')),
        // Typed and waiting for an agent, whatever leads.status says.
        selectAll(() => supabase.from('leads')
          .select('id, assigned_rep_id, lead_type')
          .in('lead_type', ['mortgage_protection', 'policy_help', 'policy_review'])
          .is('assigned_rep_id', null)
          .order('id')),
      ])
      const ids = settings.filter(s => s.active).map(s => s.agent_id)
      const profiles = ids.length
        ? await rows(supabase.from('profiles').select('id, role, is_active').in('id', ids))
        : []
      return buildCapacity({ prices, settings, balances, profiles, delivered, unassigned, now })
    },
    staleTime: 60_000,
  })
}
