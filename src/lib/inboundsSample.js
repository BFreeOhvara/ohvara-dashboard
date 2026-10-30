// SAMPLE-FIXTURE-INB: made-up people for looking at the Inbounds page before real inbounds exist.
// Names are invented, numbers are 555-010-01xx, there are no emails. The page loads this file only
// through a dynamic import inside an import.meta.env.DEV branch with ?sample=1 in the URL, so a
// production build never contains it. It is never put in the query cache: the page uses it instead of
// the hook's data, which keeps the sidebar badge and the real queries clean.
//
// Same shapes as agent_inbounds() rows and inbound_events rows (migration 180). Times are built from
// `now`, so "Today" and "Yesterday" stay true whenever the page is opened.

const MIN = 6e4
const DAY = 864e5

export function buildSample(now = Date.now()) {
  const at = (d = 0, m = 0) => new Date(now - d * DAY - m * MIN).toISOString()
  const ahead = (d = 0, m = 0) => new Date(now + d * DAY + m * MIN).toISOString()

  const leads = []
  const events = new Map()
  let n = 0
  const add = (name, phone, product, stage, extra = {}, evs = []) => {
    n += 1
    const id = `sample-inb-${String(n).padStart(2, '0')}`
    leads.push({
      lead_id: id, lead_type: product === 'live_call' ? 'policy_help' : 'mortgage_protection',
      inbound_product: product, inbound_stage: stage, outcome: null, outcome_at: null, live_call_result: null,
      contact_name: name, phone, city: null, state: null, lead_source: null, qualifier_answers: null,
      transfer_status: null, transferred_at: null, va_outcome: null, booking_id: null, client_policy_id: null,
      delivered_at: null, created_at: at(), ...extra,
    })
    events.set(id, evs.map((e, i) => ({
      id: `${id}-e${i}`, lead_id: id, state: 'scheduled', label: null, detail: null, actor_name: null, actor_role: null, created_at: at(), ...e,
    })))
  }
  const booked = 'booked_appointment'
  const live = 'live_call'

  // Booked appointments, one or more in every column.
  add('Nadia Brooks', '(555) 010-0101', booked, 'new', { delivered_at: at(0, 13) })
  add('Caleb Reyes', '(555) 010-0102', booked, 'new', { delivered_at: at(0, 36) },
    [{ kind: 'va_call', at: ahead(0, 36), label: 'Second call' }])

  add('Hannah Lowe', '(555) 010-0103', booked, 'contacting', { delivered_at: at(1, 18) },
    [{ kind: 'va_call', at: ahead(0, 125), label: 'Day 1 call and text' }])
  add('Victor Salas', '(555) 010-0104', booked, 'contacting', { delivered_at: at(3, 5) },
    [{ kind: 'va_call', at: ahead(0, 245), label: 'Day 3 call and text' }])
  add('Ruth Okafor', '(555) 010-0105', booked, 'contacting', { delivered_at: at(36, 0) },
    [{ kind: 'va_call', at: ahead(25, 0), label: 'Monthly check-in' }])

  add('Elena Marsh', '(555) 010-0106', booked, 'booked', { delivered_at: at(2, 0) },
    [{ kind: 'booked', at: ahead(0, 210) }, { kind: 'reminder', at: ahead(0, 150), label: 'Reminder text' }])
  add('Jerome Walsh', '(555) 010-0107', booked, 'booked', { delivered_at: at(2, 90) },
    [{ kind: 'booked', at: ahead(1, 0) }, { kind: 'reminder', at: ahead(0, 360), label: 'Reminder text' }])
  add('Sofia Lind', '(555) 010-0108', booked, 'booked', { delivered_at: at(3, 0) },
    [{ kind: 'booked', at: ahead(3, 0) }])

  add('Paul Nguyen', '(555) 010-0109', booked, 'met', { delivered_at: at(2, 0) },
    [{ kind: 'booked', state: 'done', at: at(0, 120), detail: { appointment_at: at(0, 120) } }])
  add('Irene Cho', '(555) 010-0110', booked, 'met', { delivered_at: at(4, 0) },
    [{ kind: 'booked', state: 'done', at: at(1, 0), detail: { appointment_at: at(1, 0) } }])

  add('Theo Grant', '(555) 010-0111', booked, 'sold', { delivered_at: at(8, 0), outcome: 'sold', outcome_at: at(2, 0) })
  add('Mina Patel', '(555) 010-0112', booked, 'sold', { delivered_at: at(9, 0), outcome: 'sold', outcome_at: at(4, 0) })
  add('Owen Burke', '(555) 010-0113', booked, 'follow_up', { delivered_at: at(7, 0), outcome: 'follow_up', outcome_at: at(3, 0) },
    [{ kind: 'follow_up', at: ahead(4, 0) }])
  add('June Vega', '(555) 010-0114', booked, 'lost', { delivered_at: at(10, 0), outcome: 'not_interested', outcome_at: at(8, 0) })

  // Live calls, one of each result and each outcome.
  add('Kevin Tran', '(555) 010-0118', live, 'new', { delivered_at: at(0, 5) })
  add('Marcus Bell', '(555) 010-0142', live, 'new', { delivered_at: at(0, 42), live_call_result: 'transferred', transfer_status: 'connected' })
  add('Tasha Greene', '(555) 010-0176', live, 'booked', { delivered_at: at(0, 109), live_call_result: 'booked', va_outcome: 'booked' },
    [{ kind: 'booked', at: ahead(0, 420) }])
  add('Luis Herrera', '(555) 010-0133', live, 'new', { delivered_at: at(0, 143), live_call_result: 'missed', transfer_status: 'dropped' })
  add('Grace Whitlock', '(555) 010-0191', live, 'sold', { delivered_at: at(1, 5), live_call_result: 'transferred', outcome: 'sold', outcome_at: at(1, 0) })
  add('Omar Haddad', '(555) 010-0127', live, 'follow_up', { delivered_at: at(1, 200), live_call_result: 'transferred', outcome: 'follow_up', outcome_at: at(1, 150) })
  add('Denise Fowler', '(555) 010-0164', live, 'lost', { delivered_at: at(2, 0), live_call_result: 'transferred', outcome: 'not_interested', outcome_at: at(2, 0) })

  leads.sort((a, b) => new Date(b.delivered_at) - new Date(a.delivered_at))
  return { leads, events }
}
