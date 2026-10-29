// The texting window, for code that can't call sms_check (migration 157).
// sms_check takes a policies row and holds a text unless the client's local
// time is 08:00 (inclusive) to 21:00 (exclusive):
//   if lt::time < time '08:00' or lt::time >= time '21:00' then ... 'defer'
// This is the same rule in TypeScript, for leads, which have a state but no
// time zone. A state that spans more than one zone must be inside the window
// in every one of them; a state we don't know means no text (never guess).
// No Deno APIs, so node --test can load it.

export const WINDOW_START_MIN = 8 * 60    // 8:00 AM, inclusive
export const WINDOW_END_MIN = 21 * 60     // 9:00 PM, exclusive

// US states, DC and territories → every IANA zone used inside them.
const STATE_ZONES: Record<string, string[]> = {
  AL: ['America/Chicago'], AK: ['America/Anchorage', 'America/Adak'], AZ: ['America/Phoenix'],
  AR: ['America/Chicago'], CA: ['America/Los_Angeles'], CO: ['America/Denver'],
  CT: ['America/New_York'], DE: ['America/New_York'], DC: ['America/New_York'],
  FL: ['America/New_York', 'America/Chicago'], GA: ['America/New_York'], HI: ['Pacific/Honolulu'],
  ID: ['America/Boise', 'America/Los_Angeles'], IL: ['America/Chicago'],
  IN: ['America/Indiana/Indianapolis', 'America/Chicago'], IA: ['America/Chicago'],
  KS: ['America/Chicago', 'America/Denver'], KY: ['America/New_York', 'America/Chicago'],
  LA: ['America/Chicago'], ME: ['America/New_York'], MD: ['America/New_York'],
  MA: ['America/New_York'], MI: ['America/Detroit', 'America/Menominee'], MN: ['America/Chicago'],
  MS: ['America/Chicago'], MO: ['America/Chicago'], MT: ['America/Denver'],
  NE: ['America/Chicago', 'America/Denver'], NV: ['America/Los_Angeles'], NH: ['America/New_York'],
  NJ: ['America/New_York'], NM: ['America/Denver'], NY: ['America/New_York'],
  NC: ['America/New_York'], ND: ['America/Chicago', 'America/Denver'], OH: ['America/New_York'],
  OK: ['America/Chicago'], OR: ['America/Los_Angeles', 'America/Boise'], PA: ['America/New_York'],
  RI: ['America/New_York'], SC: ['America/New_York'], SD: ['America/Chicago', 'America/Denver'],
  TN: ['America/Chicago', 'America/New_York'], TX: ['America/Chicago', 'America/Denver'],
  UT: ['America/Denver'], VT: ['America/New_York'], VA: ['America/New_York'],
  WA: ['America/Los_Angeles'], WV: ['America/New_York'], WI: ['America/Chicago'],
  WY: ['America/Denver'], PR: ['America/Puerto_Rico'], VI: ['America/St_Thomas'],
  GU: ['Pacific/Guam'], MP: ['Pacific/Saipan'], AS: ['Pacific/Pago_Pago'],
}

// Every zone for a state code ('tx', ' TX ' → TX); null when unknown.
export function zonesForState(state: string | null | undefined): string[] | null {
  const code = (state ?? '').trim().toUpperCase()
  return STATE_ZONES[code] ?? null
}

// Minutes since local midnight in `tz`.
export function localMinutes(now: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz })
    .formatToParts(now)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? NaN)
  return get('hour') * 60 + get('minute')
}

export function inWindow(now: Date, tz: string): boolean {
  const m = localMinutes(now, tz)
  return m >= WINDOW_START_MIN && m < WINDOW_END_MIN
}

// 'ok' to text now, 'quiet' outside 8 AM–9 PM in any of the state's zones,
// 'unknown_zone' when the state isn't one we know.
export function stateWindow(now: Date, state: string | null | undefined): 'ok' | 'quiet' | 'unknown_zone' {
  const zones = zonesForState(state)
  if (!zones) return 'unknown_zone'
  return zones.every(tz => inWindow(now, tz)) ? 'ok' : 'quiet'
}
