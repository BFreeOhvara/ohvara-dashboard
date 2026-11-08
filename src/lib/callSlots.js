import { inferTimezoneFromState, zonedTimeToUtcIso, SELECTABLE_TIMEZONES, SPLIT_STATES, US_STATES, timezoneAbbr } from './timezones.js'

// P854 — the one place for booking-time rules. Every picker (an agent's Book a call, a VA's booking, callback or
// Move, Pass on) reads these; nothing re-implements them.
//   1. Zones. A call time is picked on the client's clock. The client's zone comes from their state, and from the
//      city in a state that spans two zones. When it can't be told, zoneOf() says null and the booker picks the zone
//      (ZONE_CHOICES). Never a guess.
//   2. Instants. A booking is stored as one UTC instant plus the client's IANA zone, never a bare clock time. Every
//      calendar places it by that instant in the viewer's own zone. Intl does the zone maths, so DST and Arizona are
//      right on every date.
//   3. VA gap. A VA never has two calls whose starts are under 30 minutes apart. A slot is open when at least one VA
//      on shift then (not off) is free; the usual VA first, else the lightest free one; nobody free = Taken.
//   4. Agent calendar. Appointments on one agent can't overlap: nothing within the agent's appointment length plus
//      buffer of another, and (P894) never within 30 minutes of another booked call, whatever the length setting. A VA
//      or the AI can't book inside that gap: the picker greys it out and the server refuses it (migration p894).
// Sample data runs this in the browser only; the backend (P848/P852) must enforce the same rule on the server.

export const GAP_MIN = 30
export const DEFAULT_APPT_MIN = 30
export const SHIFT_MIN = { start: 8 * 60, end: 18 * 60 } // the VA shift, 8 AM to 6 PM on the VA's own clock
export const ZONE_CHOICES = SELECTABLE_TIMEZONES

const ET = 'America/New_York', CT = 'America/Chicago', MT = 'America/Denver', PT = 'America/Los_Angeles'
const AZ = 'America/Phoenix', BOISE = 'America/Boise', IND = 'America/Indiana/Indianapolis', DET = 'America/Detroit'
const AKT = 'America/Anchorage', ADAK = 'America/Adak'
const list = s => s.split(',').map(x => x.trim())

// Cities in the states that span two zones, by zone. A city not listed here is looked up (findZone), then picked.
const CITY_ZONES = {
  TX: {
    [MT]: list('el paso, socorro, horizon city, anthony, canutillo, clint, fabens, san elizario, sierra blanca, dell city'),
    [CT]: list('houston, dallas, austin, san antonio, fort worth, arlington, corpus christi, plano, laredo, lubbock, irving, garland, frisco, mckinney, amarillo, grand prairie, brownsville, killeen, pasadena, mesquite, mcallen, waco, denton, midland, odessa, round rock, tyler, beaumont, abilene, sugar land, college station, san angelo, wichita falls, edinburg, league city, allen, conroe, temple, georgetown, pflugerville, new braunfels, the woodlands, katy, pearland, carrollton, richardson, lewisville, longview, san marcos, harlingen, victoria, texarkana, galveston, bryan, cedar park, leander'),
  },
  FL: {
    [CT]: list('pensacola, panama city, panama city beach, fort walton beach, destin, crestview, navarre, milton, niceville, marianna, defuniak springs, gulf breeze, pace, lynn haven, chipley, bonifay'),
    [ET]: list('miami, tampa, orlando, jacksonville, tallahassee, st petersburg, hialeah, fort lauderdale, port st lucie, cape coral, pembroke pines, hollywood, gainesville, coral springs, clearwater, palm bay, lakeland, west palm beach, pompano beach, boca raton, sarasota, fort myers, naples, daytona beach, ocala, kissimmee, melbourne, deltona, miami beach, delray beach, boynton beach, largo, homestead, sanford, bradenton, port charlotte, the villages, apalachicola, key west, brandon, riverview, wesley chapel, spring hill, palm coast, port orange, winter haven, st augustine, vero beach, jupiter'),
  },
  TN: {
    [ET]: list('knoxville, chattanooga, johnson city, kingsport, bristol, oak ridge, cleveland, morristown, maryville, gatlinburg, sevierville, athens, elizabethton, greeneville, pigeon forge, farragut'),
    [CT]: list('nashville, memphis, clarksville, murfreesboro, franklin, jackson, smyrna, brentwood, hendersonville, collierville, bartlett, columbia, spring hill, gallatin, lebanon, cookeville, mount juliet, germantown, dyersburg, tullahoma, shelbyville, union city, paris, crossville'),
  },
  KY: {
    [ET]: list('louisville, lexington, frankfort, covington, richmond, georgetown, florence, elizabethtown, ashland, nicholasville, pikeville, winchester, danville, independence, erlanger, berea, somerset, hazard, london, morehead, shelbyville'),
    [CT]: list('bowling green, owensboro, paducah, hopkinsville, henderson, madisonville, murray, glasgow, mayfield, russellville, princeton, fort campbell'),
  },
  IN: {
    [CT]: list('gary, hammond, east chicago, merrillville, valparaiso, portage, crown point, michigan city, la porte, laporte, evansville, newburgh, mount vernon, boonville, schererville, highland, munster, hobart, chesterton, lake station'),
    [IND]: list('indianapolis, fort wayne, south bend, carmel, fishers, bloomington, lafayette, west lafayette, muncie, terre haute, kokomo, anderson, noblesville, greenwood, elkhart, mishawaka, columbus, richmond, jeffersonville, new albany, westfield, zionsville, plainfield, brownsburg, marion, goshen, jasper, vincennes'),
  },
  ND: {
    [MT]: list('dickinson, bowman, beach, hettinger, belfield, mott, new england, killdeer, medora, richardton'),
    [CT]: list('fargo, bismarck, grand forks, minot, williston, mandan, jamestown, west fargo, wahpeton, devils lake, valley city, grafton, watford city'),
  },
  SD: {
    [MT]: list('rapid city, spearfish, sturgis, belle fourche, hot springs, lead, deadwood, custer, box elder, lemmon'),
    [CT]: list('sioux falls, aberdeen, brookings, watertown, mitchell, yankton, pierre, huron, vermillion, brandon, madison, harrisburg, tea'),
  },
  NE: {
    [MT]: list('scottsbluff, gering, sidney, alliance, chadron, ogallala, kimball, mitchell'),
    [CT]: list('omaha, lincoln, bellevue, grand island, kearney, fremont, hastings, norfolk, north platte, columbus, papillion, la vista, south sioux city, beatrice, lexington, york, mccook'),
  },
  KS: {
    [MT]: list('goodland, sharon springs, tribune, syracuse'),
    [CT]: list('wichita, overland park, kansas city, olathe, topeka, lawrence, shawnee, manhattan, lenexa, salina, hutchinson, leavenworth, garden city, dodge city, hays, emporia, liberal, derby, gardner, junction city, pittsburg, newton, great bend, colby'),
  },
  ID: {
    [PT]: list("coeur d'alene, coeur dalene, lewiston, moscow, post falls, sandpoint, hayden, rathdrum, grangeville, bonners ferry, kellogg, orofino"),
    [BOISE]: list('boise, meridian, nampa, idaho falls, pocatello, caldwell, twin falls, eagle, kuna, rexburg, blackfoot, mountain home, ammon, burley, jerome, chubbuck, star, hailey, salmon, emmett, rupert, payette'),
  },
  OR: {
    [MT]: list('ontario, nyssa, vale, jordan valley, adrian'),
    [PT]: list('portland, salem, eugene, gresham, hillsboro, beaverton, bend, medford, springfield, corvallis, albany, tigard, lake oswego, keizer, grants pass, oregon city, mcminnville, redmond, tualatin, west linn, woodburn, roseburg, klamath falls, pendleton, baker city, la grande, astoria, coos bay, hood river, the dalles'),
  },
  AZ: {
    // The Navajo Nation keeps DST; the rest of Arizona (the Hopi lands inside it too) doesn't.
    [MT]: list('window rock, tuba city, chinle, kayenta, ganado, fort defiance, many farms, shonto, st michaels, lukachukai, dennehotso, rough rock, pinon, kaibeto'),
    [AZ]: list('phoenix, tucson, mesa, chandler, gilbert, glendale, scottsdale, peoria, tempe, surprise, yuma, avondale, goodyear, flagstaff, buckeye, lake havasu city, casa grande, maricopa, sierra vista, prescott, prescott valley, bullhead city, apache junction, marana, el mirage, kingman, queen creek, oro valley, sahuarita, page, holbrook, winslow, show low, sedona, payson, nogales, douglas, fountain hills, cottonwood, sun city, green valley, second mesa, kykotsmovi'),
  },
  MI: {
    [CT]: list('menominee, iron mountain, ironwood, iron river, kingsford, norway, bessemer, wakefield'),
    [DET]: list('detroit, grand rapids, warren, sterling heights, ann arbor, lansing, flint, dearborn, livonia, troy, westland, farmington hills, kalamazoo, wyoming, southfield, rochester hills, taylor, pontiac, novi, royal oak, battle creek, saginaw, kentwood, east lansing, portage, midland, muskegon, holland, bay city, jackson, marquette, sault ste marie, traverse city, escanaba'),
  },
  NV: {
    [MT]: list('west wendover, jackpot, owyhee'),
    [PT]: list('las vegas, henderson, reno, north las vegas, sparks, carson city, fernley, elko, mesquite, boulder city, fallon, winnemucca, pahrump, ely'),
  },
  AK: {
    [ADAK]: list('adak, atka, nikolski'),
    [AKT]: list('anchorage, fairbanks, juneau, wasilla, sitka, ketchikan, kenai, kodiak, bethel, palmer, homer, soldotna, nome, valdez, utqiagvik, barrow, unalaska, dutch harbor'),
  },
}
const normCity = c => String(c || '').toLowerCase().replace(/\./g, '').replace(/\bsaint\b/g, 'st').replace(/\s+/g, ' ').trim()
const CITY_INDEX = Object.fromEntries(Object.entries(CITY_ZONES).map(([st, byZone]) => [st, new Map(Object.entries(byZone).flatMap(([tz, cities]) => cities.map(c => [normCity(c), tz])))]))
const STATE_CODES = new Set(US_STATES.map(s => s.code))

// The client's IANA zone from their state (+ city in a split state), or null when it can't be told: an unknown
// state, a split state with no city, or a city that isn't listed (look it up with findZone, else the booker picks).
export function zoneOf(state, city) {
  const code = String(state || '').trim().toUpperCase()
  if (!STATE_CODES.has(code)) return null
  if (!SPLIT_STATES.has(code)) return inferTimezoneFromState(code)
  return CITY_INDEX[code]?.get(normCity(city)) || null
}

// zoneOf, then the geocoder (strict: a miss is null, not the state's usual zone). `lookup` is the network step,
// passed in so this file stays free of fetch (lib/timezones resolveClientTimezone with { strict: true }).
export async function findZone(state, city, lookup) {
  const hit = zoneOf(state, city)
  if (hit || !lookup) return hit
  const code = String(state || '').trim().toUpperCase()
  if (!SPLIT_STATES.has(code) || !String(city || '').trim()) return null
  try { return (await lookup(city, code)) || null } catch { return null }
}

// ── Instants ──────────────────────────────────────────────────────────────────────────────────────────────────
const to24 = clock => {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(clock || '').trim())
  if (!m) return null
  const h = (Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0)
  return `${String(h).padStart(2, '0')}:${m[2]}`
}
export const clockLabel = min => { const h = Math.floor(min / 60) % 24, m = min % 60; return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
export const clockMin = clock => { const t = to24(clock); if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m }
// '8:00 AM', '8:30 AM', … every `step` minutes from `from` up to and including `to` (minutes after midnight).
export const clocksBetween = (from, to, step = 30) => { const out = []; for (let m = from; m <= to; m += step) out.push(clockLabel(m)); return out }

// The UTC instant (ISO) of `clock` on `date` (YYYY-MM-DD) on the clock of `tz`.
export function instantOf(date, clock, tz) {
  const t = to24(clock)
  if (!date || !t || !tz) return null
  return zonedTimeToUtcIso(`${date}T${t}`, tz)
}
const fmts = new Map()
const fmt = (tz, opts) => {
  const key = `${tz}|${JSON.stringify(opts)}`
  if (!fmts.has(key)) fmts.set(key, new Intl.DateTimeFormat(opts.locale || 'en-US', { timeZone: tz, ...opts, locale: undefined }))
  return fmts.get(key)
}
export const clockOf = (iso, tz) => fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(/\s/g, ' ')
export const dateOf = (iso, tz) => fmt(tz, { locale: 'en-CA', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
export const minuteOf = (iso, tz) => clockMin(clockOf(iso, tz))
export const zoneAbbr = (tz, iso = Date.now()) => {
  const short = timezoneAbbr(tz)
  if (short && short !== tz) return short
  return fmt(tz, { timeZoneName: 'short', hour: 'numeric' }).formatToParts(new Date(iso)).find(p => p.type === 'timeZoneName')?.value || tz
}
const sameClock = (iso, a, b) => a === b || (clockOf(iso, a) === clockOf(iso, b) && dateOf(iso, a) === dateOf(iso, b))

// The picker's two lines: "3:00 PM ET, client's time (Tampa, FL)" and, when the booker's clock differs,
// "That's 2:00 PM CT for you".
export function timeLines(iso, clientTz, viewerTz, place = '') {
  if (!iso || !clientTz) return { client: '', mine: '' }
  const client = `${clockOf(iso, clientTz)} ${zoneAbbr(clientTz, iso)}, client's time${place ? ` (${place})` : ''}`
  const mine = viewerTz && !sameClock(iso, clientTz, viewerTz) ? `That's ${clockOf(iso, viewerTz)} ${zoneAbbr(viewerTz, iso)} for you` : ''
  return { client, mine }
}
// A calendar block's time: the viewer's clock, with the client's beside it when they differ ("2:00 PM · client 3:00 PM ET").
export function blockTime(iso, viewerTz, clientTz) {
  const mine = clockOf(iso, viewerTz)
  return clientTz && !sameClock(iso, viewerTz, clientTz) ? `${mine} · client ${clockOf(iso, clientTz)} ${zoneAbbr(clientTz, iso)}` : mine
}

// ── The VA rule ───────────────────────────────────────────────────────────────────────────────────────────────
const ms = iso => new Date(iso).getTime()
export const startsTooClose = (a, b, gap = GAP_MIN) => Math.abs(ms(a) - ms(b)) < gap * 60e3

// Is this VA free at `iso`: no other call of theirs (calls: [{ id, va_id, iso }]) starts under 30 minutes away.
export const vaFree = (vaId, iso, calls, exceptId = null) => !calls.some(k => k.va_id === vaId && k.id !== exceptId && k.iso && startsTooClose(k.iso, iso))
// Is `iso` inside this VA's shift on their own clock (va.tz)?
export const inShift = (iso, tz, shift = SHIFT_MIN) => { const m = minuteOf(iso, tz); return m >= shift.start && m < shift.end }

// Who takes a call at `iso`: team = the VAs on the rota then ([{ id, name, tz, off }], or iso => that list).
// The usual VA (prefer) when they're free, else the free VA with the lightest load (rota order on a tie), else null.
// skip = VA ids that can't take it (Pass on skips yourself).
export function freeVa({ iso, team, calls = [], prefer = null, exceptId = null, load = () => 0, skip = [] }) {
  const crew = (typeof team === 'function' ? team(iso) : team) || []
  const ok = crew.filter(v => !v.off && !skip.includes(v.id) && inShift(iso, v.tz || CT) && vaFree(v.id, iso, calls, exceptId))
  if (!ok.length) return null
  const mine = ok.find(v => v.id === prefer)
  if (mine) return mine
  return ok.slice().sort((a, b) => load(a.id, iso) - load(b.id, iso) || crew.indexOf(a) - crew.indexOf(b))[0]
}

// The slot list for a VA call on the client's `date`: [{ clock, iso, va, open, why }] where why = 'taken' (VAs are
// on shift but all busy) or 'off' (nobody is on shift then). Only open slots can be picked.
export function vaSlots({ date, clocks, clientTz, team, calls = [], prefer = null, exceptId = null, load, skip = [] }) {
  if (!clientTz) return []
  return clocks.map(clock => {
    const iso = instantOf(date, clock, clientTz)
    const crew = ((typeof team === 'function' ? team(iso) : team) || []).filter(v => !v.off && !skip.includes(v.id) && inShift(iso, v.tz || CT))
    const va = crew.length ? freeVa({ iso, team: crew, calls, prefer, exceptId, load }) : null
    return { clock, iso, va, open: !!va, why: va ? null : crew.length ? 'taken' : 'off' }
  })
}

// ── The agent rule ────────────────────────────────────────────────────────────────────────────────────────────
// Open when no appointment of this agent (appts: [{ id, iso }]) starts within length + buffer minutes of `iso`.
export const AGENT_GAP_MIN = 30
export const agentGap = (length, buffer) => Math.max(AGENT_GAP_MIN, (length || DEFAULT_APPT_MIN) + (buffer || 0))
export const agentFree = (iso, appts, { length = DEFAULT_APPT_MIN, buffer = 0, exceptId = null } = {}) =>
  !appts.some(a => a.id !== exceptId && a.iso && startsTooClose(a.iso, iso, agentGap(length, buffer)))
// Inside someone's working hours on their own clock: it starts at or after open and ends by close, on a workday.
// hours = { tz, open, close (minutes after midnight), days? (weekday numbers, 0 = Sunday) }.
export function inHours(iso, hours, length = DEFAULT_APPT_MIN) {
  const m = minuteOf(iso, hours.tz)
  const wd = new Date(`${dateOf(iso, hours.tz)}T12:00:00Z`).getUTCDay()
  return m >= hours.open && m + length <= hours.close && (!hours.days || hours.days.includes(wd))
}
// The slot list for an agent's appointment on the client's `date`. Outside the agent's hours = 'off' (not listed by
// the picker); within length + buffer of another appointment = 'taken'.
export function agentSlots({ date, clocks, clientTz, appts = [], length, buffer, exceptId = null, hours = null }) {
  if (!clientTz) return []
  return clocks.map(clock => {
    const iso = instantOf(date, clock, clientTz)
    if (hours && !inHours(iso, hours, length || DEFAULT_APPT_MIN)) return { clock, iso, open: false, why: 'off' }
    const open = agentFree(iso, appts, { length, buffer, exceptId })
    return { clock, iso, open, why: open ? null : 'taken' }
  })
}

// A slot list as Select options: taken ones greyed out and not pickable.
export const slotOptions = (slots, { mine = null } = {}) => slots.map(s => ({
  value: s.clock, label: s.clock, disabled: !s.open,
  sub: s.why === 'taken' ? 'Taken' : s.why === 'off' ? 'Nobody on shift' : s.va && mine && s.va.id !== mine ? `Goes to ${s.va.name.split(' ')[0]}` : undefined,
}))
