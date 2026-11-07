import { AGENT_STATUSES, CLOSED_STATUS, agentStatusOf, agentStatus } from './agentView.js'

// Stage names and colours shared by the boards, the cards, the drawers and the palette.
// tone = the card fill (flow.css .is-<tone>: a stage token mixed into the surface).

export const stageLabel = { protected: ['green', 'Protected'], setting_up: ['blue', 'Setting up'], needs_attention: ['warn', 'Needs attention'], requests: ['teal', 'Request open'] }

// Client servicing order, for the drawer's stepper.
export const CLIENT_STEPS = [
  { key: 'setting_up', label: 'Setting up' }, { key: 'needs_attention', label: 'Needs you' }, { key: 'requests', label: 'Request open' }, { key: 'protected', label: 'Protected' },
]

// P878: the agent's Leads board is the five agent statuses (agentView.js), left to right; Closed sits under a filter.
// The VA and admin portals keep every stage (leadLifecycle.js LEAD_LANES).
export const LANES = AGENT_STATUSES
export const CLOSED_LANE = CLOSED_STATUS
// The status (with its tone) of a lead, or of a bare stage (treated as a lead at that stage).
export const laneOf = leadOrStage => agentStatus(agentStatusOf(typeof leadOrStage === 'string' ? { stage: leadOrStage } : leadOrStage || { stage: 'new' }))

// The lead drawer's stepper: where a lead can be moved.
export const LEAD_STEPS = [
  { key: 'booked', label: 'Booked' }, { key: 'follow_up', label: 'Follow up' }, { key: 'sold', label: 'Sold' }, { key: 'not_interested', label: 'Not interested' },
]
