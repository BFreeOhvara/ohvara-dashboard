// P849 — the Admin side's shared words and colours (no React, so component files only export components).
// Tones are flow.css .is-<tone>: blue = sky, teal = butter, green = sage, warn = apricot, mute = stone.

// P906 — the admin lead statuses, left to right on the Leads board: Booked · No show · Follow up · Sold · Not
// interested · No answer (How Ohvara Works, "AI never hands a new lead to a VA"). A live call isn't a status: as on
// the agent side, it waits on Booked tagged "Live call · Mark result" until the agent picks how it went. A missed
// transfer bounces back and is booked, so it lands on Booked too. Leads with no agent aren't a status either: they sit
// in the Unassigned list above the board (stage 'unassigned', no agent_id) until an admin assigns them.
export const LEAD_LANES = [
  { key: 'booked', label: 'Booked', tone: 'blue', stages: ['booked'], empty: 'No appointments booked.' },
  { key: 'no_show', label: 'No show', tone: 'warn', stages: ['no_show'], empty: 'No missed appointments.' },
  { key: 'follow_up', label: 'Follow up', tone: 'teal', stages: ['follow_up'], empty: 'No follow-ups set.' },
  { key: 'sold', label: 'Sold', tone: 'green', stages: ['sold'], empty: 'No sales yet this week.' },
  { key: 'not_interested', label: 'Not interested', tone: 'mute', stages: ['not_interested'], empty: 'No one said no.' },
  { key: 'no_answer', label: 'No answer', tone: 'violet', stages: ['no_answer'], empty: 'Everyone was reached.' },
]
export const LEAD_STAGES = LEAD_LANES.map(l => l.key)
export const STAGE_WORD = { unassigned: 'No agent yet', booked: 'Booked', no_show: 'No show', follow_up: 'Follow up', sold: 'Sold', not_interested: 'Not interested', no_answer: 'No answer' }
export const stageTone = stage => LEAD_LANES.find(l => l.stages.includes(stage))?.tone || 'warn'
// No agent yet: the Unassigned list, never a lane.
export const isUnassigned = l => !l.agent_id
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
