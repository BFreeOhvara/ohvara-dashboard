// On duty for live transfers (Goal 7). An agent flips their own row in
// public.agent_duty from Settings → Client contact; an admin sees who is on
// duty through public.on_duty_agents() on the Admin Overview (migration 172).

// Off until migration 172 is applied and p_agent_duty.sql passes; then flip to true.
export const DUTY_LIVE = false

// True when the table or function isn't in the database yet (PostgREST
// PGRST205 / PGRST202, Postgres 42P01 / 42883), so the card and the list
// render nothing instead of an error.
export const isDutyMissing = e =>
  !!e && ['PGRST205', 'PGRST202', '42P01', '42883'].includes(e.code)

// "3:15 PM" today, "Oct 27, 3:15 PM" on an earlier day; always Central.
const TZ = 'America/Chicago'
export function dutySince(iso, now = new Date()) {
  if (!iso) return ''
  const d = new Date(iso)
  const day = x => x.toLocaleDateString('en-US', { timeZone: TZ })
  const time = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
  return day(d) === day(now) ? time : `${d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' })}, ${time}`
}
