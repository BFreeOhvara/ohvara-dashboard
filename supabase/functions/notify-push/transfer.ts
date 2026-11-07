// P880 — the live-transfer pushes. Pure builders plus one fan-out, no Deno APIs, so node --test loads it.
// help-transfer sends these at once (not through the once-a-minute queue): a 30-second check can't wait.
//
//   checkPush  the Check agent alert: lead name, age, state and need, "Your client" when it is one, Yes / No
//              buttons (iOS category OHVARA_TRANSFER, Android TransferMessagingService), time-sensitive,
//              collapse id = the check, 30 s lifetime.
//   clearPush  replaces it on every phone: "Answered on your other phone", "No longer available", ...
import type { Device, Msg, Senders } from './core.ts'

export type Summary = { name?: string | null; age?: string | number | null; state?: string | null; need?: string | null; your_client?: boolean }
export type CheckRow = { id: string; summary: Summary; is_test?: boolean }

export const TRANSFER_CATEGORY = 'OHVARA_TRANSFER'
export const CHECK_SECS = 30

export function summaryLine(s: Summary) {
  return [s.age ? String(s.age) : null, s.state || null, s.need || null].filter(Boolean).join(' · ')
}

export function checkPush(c: CheckRow, seenUrl: string): Msg {
  const s = c.summary || {}
  const who = s.name || 'A lead'
  const title = c.is_test ? `Test live call: ${who}` : `${s.your_client ? 'Your client · ' : ''}Live call: ${who}`
  const line = summaryLine(s)
  return {
    title,
    body: `${line ? `${line}. ` : ''}Can you take it now? Answer in 30 seconds.`,
    link: `/agent?check=${c.id}`,
    badge: 1,
    type: 'transfer_check',
    timeSensitive: true,
    category: TRANSFER_CATEGORY,
    collapseId: c.id,
    ttlSec: CHECK_SECS,
    dataOnly: true,
    data: { check_id: c.id, seen_url: seenUrl, test: c.is_test ? '1' : '0' },
  }
}

export const CLEAR_WORDS = {
  answered_elsewhere: 'Answered on your other phone',
  gone: 'No longer available',
  lead_dropped: 'The lead hung up',
  booked: 'Booked on your calendar instead',
  expired: 'Missed. The VA is booking them on your calendar',
} as const

export function clearPush(c: CheckRow, why: keyof typeof CLEAR_WORDS): Msg {
  const who = c.summary?.name || 'Live call'
  return {
    title: `${who}: ${CLEAR_WORDS[why]}`,
    body: '',
    link: `/agent?check=${c.id}`,
    badge: 0,
    type: 'transfer_clear',
    collapseId: c.id,
    ttlSec: 120,
    dataOnly: true,
    data: { check_id: c.id, why },
  }
}

export type FanOut = { reached: number; dead: string[]; errors: string[] }

// Every phone the agent has (N-C-14). One failure never stops the others.
export async function sendAll(senders: Senders, devices: Device[], m: Msg, skip: string[] = []): Promise<FanOut> {
  const out: FanOut = { reached: 0, dead: [], errors: [] }
  for (const d of devices) {
    if (skip.includes(d.token)) continue
    const send = senders[d.platform]
    if (!send) { out.errors.push(`${d.platform}: not set up`); continue }
    try {
      const r = await send(d.token, m)
      if (r.ok) out.reached++
      else { if (r.dead) out.dead.push(d.token); out.errors.push(`${d.platform}: ${r.error || 'failed'}`) }
    } catch (e) {
      out.errors.push(`${d.platform}: ${(e as Error).message}`)
    }
  }
  return out
}
