// P913 — how a lead finds its agent (How Ohvara Works, "Matching"). Two ways, in order:
//   1. the agent ID riding hidden in the ad link (agentRef 'DS-XXXX', or the agent's own id), else
//   2. the Meta campaign ID the lead came from (one campaign per agent, saved on the agent when GoHighLevel creates it).
// Only if both are missing, or neither points at an agent, does the lead need a person: it raises the admin alert
// "1 lead couldn't be matched to an agent. Pick one." It should almost never happen. Pure, so node --test reads it;
// the database twin is ghl_intake_lead in supabase/migrations/p913_campaign_match.sql.
const clean = v => (v == null ? '' : String(v).trim())

export function matchAgent(lead = {}, agents = []) {
  const ref = clean(lead.agentRef ?? lead.agent_ref)
  const camp = clean(lead.campaignId ?? lead.campaign_id)
  const byRef = ref && agents.find(a => a.agentRef === ref || a.id === ref)
  if (byRef) return { agent_id: byRef.id, by: 'link', why: '' }
  const byCamp = camp && agents.find(a => clean(a.campaignId) === camp)
  if (byCamp) return { agent_id: byCamp.id, by: 'campaign', why: '' }
  const why = !ref && !camp ? 'missing' : 'unknown'
  return { agent_id: null, by: null, why }
}

export const UNMATCHED_WHY = {
  missing: 'No agent ID in the ad link and no Meta campaign ID.',
  unknown: 'The agent ID and the campaign ID match no agent.',
}

// The alert's headline: "1 lead couldn't be matched to an agent. Pick one."
export const unmatchedLine = n => `${n} ${n === 1 ? 'lead' : 'leads'} couldn't be matched to an agent. ${n === 1 ? 'Pick one.' : 'Pick one for each.'}`
