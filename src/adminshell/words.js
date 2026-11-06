// P849 — the Admin side's shared words and colours (no React, so component files only export components).
// Tones are flow.css .is-<tone>: blue = sky, teal = butter, green = sage, warn = apricot, mute = stone.

// Lead stages, left to right on the Leads board. "Needs routing" holds leads with no agent and missed transfers.
export const LEAD_LANES = [
  { key: 'route', label: 'Needs routing', tone: 'warn', stages: ['unassigned', 'missed'], empty: 'Every lead has an agent.' },
  { key: 'booked', label: 'Booked', tone: 'blue', stages: ['booked'], empty: 'No appointments booked.' },
  { key: 'transferred', label: 'Transferred', tone: 'teal', stages: ['transferred'], empty: 'No live transfers yet.' },
  { key: 'sold', label: 'Sold', tone: 'green', stages: ['sold'], empty: 'No sales yet this week.' },
  { key: 'not_sold', label: 'Not sold', tone: 'mute', stages: ['not_sold'], empty: 'Nothing closed out.' },
]
export const STAGE_WORD = { unassigned: 'No agent yet', missed: 'Missed transfer', booked: 'Booked', transferred: 'Transferred', sold: 'Sold', not_sold: 'Not sold' }
export const stageTone = stage => LEAD_LANES.find(l => l.stages.includes(stage))?.tone || 'blue'
export const KIND_WORD = { appointment: 'Appointment', live: 'Live call' }

// Client servicing stages (the agent side's src/template/stages.js stageLabel words and colours).
export const CLIENT_STAGE = { protected: ['green', 'Protected'], setting_up: ['blue', 'Setting up'], needs_attention: ['warn', 'Needs attention'], requests: ['teal', 'Request open'] }

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
