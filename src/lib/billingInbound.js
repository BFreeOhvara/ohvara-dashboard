// Get inbounds (top of /agent/leads): the words and sums behind the panel, the sheet and the Start cards.
// No imports, so Deno can test it too. The estimate numbers only ever become "about N a week".

export const TYPE_ORDER = ['live_call', 'booked_appointment']

export const TYPE_LABEL = { live_call: 'Live Calls', booked_appointment: 'Booked Appointments' }

export const WHAT_YOU_GET = {
  live_call: 'People who already have a policy call in. Our team qualifies them and transfers the call live to you, or books them if you’re not active.',
  booked_appointment: 'Homeowners asking about mortgage protection. Our team calls them and books them on your calendar, with reminders before the call.',
}

export const HOW_IT_WORKS = [
  ['Set a weekly amount', 'Pick an amount for Live Calls, Booked Appointments, or both.'],
  ['We send you leads', 'Our team talks to each person first, then sends them to you through the week.'],
  ['Change or pause any time', 'Every “about” number is an estimate and moves from week to week.'],
]

export function formatMoney(cents) {
  const n = (cents || 0) / 100
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
}

export const estimateCount = (cents, estimateCents) => (estimateCents > 0 && cents > 0 ? Math.floor(cents / estimateCents) : 0)

export const aboutText = count => (count >= 1 ? `about ${count} a week` : 'less than 1 a week')

export function aboutInboundsText(count) {
  if (count < 1) return 'less than 1 lead a week'
  return `about ${count} lead${count === 1 ? '' : 's'} a week`
}

// What the agent typed in the custom box, in cents. Whole dollars only; null when there's no number.
export function parseDollars(text) {
  const digits = String(text ?? '').replace(/\D/g, '')
  return digits ? Number(digits) * 100 : null
}

export const digitsOnly = text => String(text ?? '').replace(/\D/g, '').slice(0, 6)

// The two types in a fixed order, whatever the server sent.
export function orderedTypes(data) {
  const types = data?.types || []
  return TYPE_ORDER.map(type => types.find(t => t.type === type)
    || { type, label: TYPE_LABEL[type], weekly_cents: 0, paused: false, estimate_count: 0 })
}

// on = running, paused = has an amount but stopped, off = no amount yet.
export const rowKind = t => (t.weekly_cents > 0 ? (t.paused ? 'paused' : 'on') : 'off')

const running = data => orderedTypes(data).filter(t => rowKind(t) === 'on')

export const activeCents = data => running(data).reduce((sum, t) => sum + t.weekly_cents, 0)

export const activeCount = data => running(data).reduce((sum, t) => sum + (t.estimate_count || 0), 0)

export const pausedTypes = data => orderedTypes(data).filter(t => rowKind(t) === 'paused')

// Which panel shows once the data is in. Order matters: comped and not subscribed never get controls.
export function panelState(data) {
  if (!data?.configured) return 'not_open'
  if (data.comped || !data.billed) return 'comped'
  if (!data.subscribed) return 'not_subscribed'
  if (activeCents(data) > 0) return 'spending'
  return pausedTypes(data).length ? 'paused' : 'empty'
}

// The Overview and Home card: null (no card), 'start' or 'paused'. Nothing until the data is in.
export function startCardKind(data) {
  if (!data?.configured || data.comped || !data.billed || activeCents(data) > 0) return null
  return pausedTypes(data).length ? 'paused' : 'start'
}

// The amount the sheet opens on: what's saved, otherwise the preset in the middle of the list.
export function initialAmount(presets, weeklyCents) {
  const list = presets || []
  if (weeklyCents > 0) {
    return list.includes(weeklyCents)
      ? { preset: weeklyCents, custom: '' }
      : { preset: null, custom: String(Math.floor(weeklyCents / 100)) }
  }
  return { preset: list.length ? list[Math.floor(list.length / 2)] : null, custom: '' }
}

// Server messages show as-is; transport errors from the client library aren't messages for an agent.
const TRANSPORT = /unknown action|edge function|relay error|failed to fetch|request failed|load failed|networkerror/i

export const plainError = (message, fallback) => (message && !TRANSPORT.test(message) ? message : fallback)
