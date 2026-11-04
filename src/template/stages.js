// Stage names and colours shared by the boards, the cards, the drawers and the palette.
// tone = the card fill (flow.css .is-<tone>: a stage token mixed into the surface).

export const stageLabel = { protected: ['green', 'Protected'], setting_up: ['blue', 'Setting up'], needs_attention: ['warn', 'Needs attention'], requests: ['teal', 'Request open'] }

// Client servicing order, for the drawer's stepper.
export const CLIENT_STEPS = [
  { key: 'setting_up', label: 'Setting up' }, { key: 'needs_attention', label: 'Needs you' }, { key: 'requests', label: 'Request open' }, { key: 'protected', label: 'Protected' },
]

// Lead lanes, left to right. Each lead stage belongs to one lane.
export const LANES = [
  { key: 'now', label: 'Needs you now', tone: 'warn', stages: ['ringing', 'missed', 'no_show'], empty: 'No one is waiting on you.' },
  { key: 'booked', label: 'Booked', tone: 'blue', stages: ['booked'], empty: 'No appointments booked yet.' },
  { key: 'follow', label: 'Follow up', tone: 'teal', stages: ['follow_up'], empty: 'No callbacks set.' },
  { key: 'sold', label: 'Sold', tone: 'green', stages: ['sold'], empty: 'Sales you mark show here.' },
  { key: 'closed', label: 'Not interested', tone: 'mute', stages: ['not_interested'], empty: 'Nothing closed out.' },
]
export const laneOf = stage => LANES.find(l => l.stages.includes(stage)) || LANES[1]

// The lead drawer's stepper: where a lead can be moved.
export const LEAD_STEPS = [
  { key: 'booked', label: 'Booked' }, { key: 'follow_up', label: 'Follow up' }, { key: 'sold', label: 'Sold' }, { key: 'not_interested', label: 'Not interested' },
]
