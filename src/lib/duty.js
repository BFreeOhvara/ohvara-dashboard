// Live transfers ring an agent inside their live-call hours (set on Billing). An admin sees who
// is inside them through public.on_duty_agents().

// True when the table or function isn't in the database yet (PostgREST
// PGRST205 / PGRST202, Postgres 42P01 / 42883), so the card and the list
// render nothing instead of an error.
export const isDutyMissing = e =>
  !!e && ['PGRST205', 'PGRST202', '42P01', '42883'].includes(e.code)

// "3:15 PM" today, "Oct 27, 3:15 PM" on an earlier day; Central unless the agent's zone is given.
export function dutySince(iso, now = new Date(), tz = 'America/Chicago') {
  if (!iso) return ''
  const d = new Date(iso)
  const day = x => x.toLocaleDateString('en-US', { timeZone: tz })
  const time = d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
  return day(d) === day(now) ? time : `${d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })}, ${time}`
}
