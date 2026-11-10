// P849 — the Admin side's shared words and colours (no React, so component files only export components).
// Tones are flow.css .is-<tone>: blue = sky, teal = butter, green = sage, warn = apricot, mute = stone.

// P913 — the admin lead statuses, left to right on the Leads board: Booked · No show · Follow up · Sold · Not
// interested (Brayden's walk-through, Nov 8). No answer is gone: a lead the AI or the no-answer texts are still trying
// is a Follow up owned by Our team; a callback the agent set is a Follow up owned by the Agent (owner tag on the card).
// Agents never see Our team follow-ups. No two statuses share a colour: No show is grey, Not interested took No
// show's old apricot. A live call isn't a status: it waits on Booked tagged "Mark result". A lead that matched no agent
// (no agent ID in the ad link and no Meta campaign ID that points at one) is not on the board at all: it raises an
// admin alert with Assign (Unmatched913.jsx).
// P942: the first status reads Delivered (an appointment or a live call that reached the agent, as the agent's
// "Delivered this week", P923); the stage key stays 'booked'.
export const LEAD_LANES = [
  { key: 'booked', label: 'Delivered', tone: 'blue', stages: ['booked'], empty: 'Nothing delivered yet.' },
  { key: 'no_show', label: 'No show', tone: 'mute', stages: ['no_show'], empty: 'No missed appointments.' },
  { key: 'follow_up', label: 'Follow up', tone: 'teal', stages: ['follow_up'], empty: 'No follow-ups set.' },
  { key: 'sold', label: 'Sold', tone: 'green', stages: ['sold'], empty: 'No sales yet.' },
  { key: 'not_interested', label: 'Not interested', tone: 'warn', stages: ['not_interested'], empty: 'No one said no.' },
]
export const LEAD_STAGES = LEAD_LANES.map(l => l.key)
export const STAGE_WORD = { unassigned: 'Not matched', booked: 'Delivered', no_show: 'No show', follow_up: 'Follow up', sold: 'Sold', not_interested: 'Not interested' }
export const stageTone = stage => LEAD_LANES.find(l => l.stages.includes(stage))?.tone || 'warn'
// Who owns a Follow up: 'team' (the AI or the no-answer cadence is still trying) or 'agent' (their own callback).
export const FOLLOW_OWNER = { team: 'Our team', agent: 'Agent' }
export const followOwner = l => (l.stage !== 'follow_up' ? null : l.owner === 'team' || l.kind === 'none' ? 'team' : 'agent')
// No agent matched: an admin alert, never a lane.
export const isUnassigned = l => !l.agent_id
// How a lead found its agent: the agent ID in the ad link, or the Meta campaign ID (one campaign per agent).
export const MATCH_WORD = { link: 'Agent ID in the ad link', campaign: 'Meta campaign ID', admin: 'Assigned by an admin' }
// A live call the agent took, still waiting for its result (on Booked, tagged).
export const awaitsResult = l => l.kind === 'live' && l.stage === 'booked'
export const KIND_WORD = { appointment: 'Appointment', live: 'Live call', none: 'Not reached' }

// P906 — client statuses (P899): Working · Needs attention · Protected · Closed. A request is a tag, not a status.
export const CLIENT_STAGE = { working: ['blue', 'Working'], needs_attention: ['warn', 'Needs attention'], protected: ['green', 'Protected'], closed: ['mute', 'Closed'] }
export const CLIENT_ORDER = ['needs_attention', 'working', 'protected']

// The desk: a cancellation call's status.
export const CALL_WORD = { cancelled: 'Cancelled', no_answer: 'No answer', live: 'On a call', booked: 'To call', late: 'Past its time' }
export const CALL_TONE = { cancelled: 'green', no_answer: 'warn', live: 'teal', booked: 'blue', late: 'warn' }

// Billing.
export const BILL_WORD = { current: ['Paid up', 'green'], past_due: ['Past due', 'warn'], comped: ['Comped', 'teal'] }
export const PAY_WORD = { verified: ['Verified', 'green'], checking: ['Checking', 'blue'], needs_listen: ['Needs a listen', 'warn'] }
export const BANK_WORD = { ready: ['Bank ready', 'green'], none: ['No bank yet', 'warn'], held: ['Held over the cap', 'teal'] }

// Connect.
export const CAMPAIGN_WORD = { approved: ['Approved', 'green'], in_review: ['In review', 'blue'], rejected: ['Rejected', 'warn'], not_started: ['Not started', 'mute'] }
export const AD_WORD = { live: ['Spending', 'green'], waiting: ['Waits for the bridge', 'blue'], not_set: ['Not set up', 'mute'] }

// Time zones for the live clock (the browser's own zone names).
export const ZONES = [
  ['America/New_York', 'Eastern', 'ET'], ['America/Chicago', 'Central', 'CT'], ['America/Denver', 'Mountain', 'MT'],
  ['America/Phoenix', 'Arizona', 'MST'], ['America/Los_Angeles', 'Pacific', 'PT'],
]
export const zoneShort = tz => ZONES.find(z => z[0] === tz)?.[2] || 'CT'
