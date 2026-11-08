// P907 — the VA works in bookings. Incoming calls pop up on the phone anywhere in the portal (P882); every other call
// is a booked call on the Schedule, and nothing else. These are the call types a booking can be, the servicing kinds
// that are calls (and so get booked), and the words and colours for each. No React, no network (node tests).
// Every booking gets its time from the system (lib/callSlots nextSlot): the client's preferred window on their clock,
// a VA on shift who is free. VAs and admin can move one; the client gets the usual confirmation text.

export const CALL_TYPES = {
  handoff: { key: 'handoff', label: 'Hand-off call', sub: 'After a sale: welcome, check the details, who to call', tone: 'blue' },
  cancel_old: { key: 'cancel_old', label: 'Cancel the old policy', sub: 'With the client on the line, before the old draft', tone: 'teal' },
  save: { key: 'save', label: 'Save call', sub: 'A missed payment, a lapse notice, or a No on the monthly check', tone: 'warn' },
  change: { key: 'change', label: 'Change request', sub: 'Beneficiary, address, bank or draft date, name', tone: 'teal' },
  cancel_request: { key: 'cancel_request', label: 'Cancel request', sub: 'They asked to cancel: try to save it', tone: 'warn' },
  callback: { key: 'callback', label: 'Callback', sub: 'They asked for a call back, or we missed their call', tone: 'blue' },
  welcome: { key: 'welcome', label: 'Welcome call', sub: 'A client an agent added', tone: 'green' },
  review: { key: 'review', label: 'Yearly review', sub: 'Once a year, check the policy still fits', tone: 'green' },
}
export const TYPE_ORDER = ['handoff', 'cancel_old', 'save', 'change', 'cancel_request', 'callback', 'welcome', 'review']

// A servicing kind → its call type, or null when the step isn't a call with the client (a packet check, a
// chargeback watch, a carrier-only job): those stay on Servicing with no booking.
const KIND_TYPE = {
  handoff_call: 'handoff', lapse_save: 'save', payment_change: 'change', beneficiary_change: 'change', address_change: 'change',
  draft_date_change: 'change', name_change: 'change', change_request: 'change', cancel_request: 'cancel_request', callback: 'callback',
  welcome_call: 'welcome', annual_review: 'review', review_call: 'review',
}
export const typeOfKind = kind => KIND_TYPE[kind] || null
export const isCallKind = kind => !!KIND_TYPE[kind]
export const callType = key => CALL_TYPES[key] || CALL_TYPES.callback

// The new kinds P907 adds to the servicing words (lib/vaServicing KIND_LABEL keeps the server's list).
export const NEW_KINDS = { handoff_call: 'Hand-off call', name_change: 'Name change', change_request: 'Change request', cancel_request: 'Cancel request', callback: 'Callback' }
export const NEW_OUTCOMES = {
  handoff_call: [['welcomed', 'Done: welcomed'], ['details_fixed', 'Details fixed'], ['problem', 'Problem → agent'], ['no_answer', 'No answer']],
  cancel_request: [['saved', 'Saved'], ['client_cancelled', 'Cancelled'], ['no_answer', 'No answer']],
  callback: [['completed', 'Done'], ['no_answer', 'No answer']],
}
// Kinds whose No answer books the next try by itself (3 tries in all), like P888's save call and P891's welcome call.
export const RETRY_KINDS = ['lapse_save', 'welcome_call', 'handoff_call', 'cancel_request', 'callback']

// Why a callback was booked (the missed incoming call, a text reply that needs a person, the client asked).
export const CALLBACK_WHY = { missed_call: 'Missed their call', reply: 'Replied to a text', asked: 'Asked for a call back' }
