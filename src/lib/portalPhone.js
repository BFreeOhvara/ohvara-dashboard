// Prompt 751 — the pop-up phone's look, worked out from the call's outside
// legs (fulfillment_voice_legs: the client and the carrier, each ringing /
// live / ended, on hold or not). Pure, so the harness and the panel share it.
//
// The five designed stages (media/fulfillment-my-calls/phone.dc.html):
//   talking   with the client; tip "Ready for the carrier?" → Ring {carrier}
//   waiting   the carrier is on the line, the client isn't talking (on hold,
//             or hung up for a call back): amber "On hold" while the rep sits
//             in the carrier's queue; tip "Someone picked up?"
//   two       one talking, one on hold; tip "Both on the line" → Merge
//   merged    all three on, green; End reads "End all"
//   result    How did it go? (the panel, not this file)
// plus the in-between ones the mockup didn't draw: connecting, ringing, and
// everyone on hold.

const state = l => (!l ? 'none' : l.status === 'ended' ? 'gone' : l.status === 'ringing' ? 'ringing' : l.on_hold ? 'held' : 'talking')

export const isOpenLeg = l => l && l.status !== 'ended'

// 754 → "12:34"; 3_700 → "1:01:40".
export function clock(sec) {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const since = (iso, now) => (iso ? (now - new Date(iso).getTime()) / 1000 : 0)

const initials = name => (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'

// The newest leg per party.
export function latestLegs(legs) {
  const by = {}
  for (const l of legs || []) {
    const had = by[l.party]
    if (!had || new Date(l.started_at) >= new Date(had.started_at)) by[l.party] = l
  }
  return { client: by.client || null, carrier: by.carrier || null }
}

/**
 * @param legs        this call's legs (started after the rep joined)
 * @param names       { client, carrier } display names
 * @param answered    the rep said someone at the carrier picked up (Swap,
 *                    Merge or the tip) — a carrier "on the line" is a person,
 *                    not the hold queue
 * @param canRingCarrier  the carrier has a phone on file
 * @param muted / now
 */
export function phoneView({ legs, names, answered = false, canRingCarrier = true, muted = false, now = Date.now() }) {
  const { client: c, carrier: k } = latestLegs(legs)
  const cs = state(c)
  const ks = state(k)
  const client = names.client || 'Client'
  const carrier = names.carrier || 'Carrier'
  const clientFirst = client.split(/\s+/)[0]
  const AV = {
    client: { key: 'client', t: initials(client), tone: 'client' },
    carrier: { key: 'carrier', t: initials(carrier), tone: 'carrier' },
  }
  const callBack = cs === 'gone'

  const otherLine = (party, leg, st) => {
    if (party === 'client' && st === 'gone') return { name: client, state: 'waiting for a call back', dot: 'wait' }
    if (st === 'held') return { name: party === 'client' ? client : carrier, state: `on hold · ${clock(since(leg.hold_since, now))}`, dot: party === 'client' ? 'wait' : 'hold' }
    if (st === 'ringing') return { name: party === 'client' ? client : carrier, state: 'ringing', dot: 'wait' }
    return null
  }

  let v
  if (cs === 'talking' && ks === 'talking') {
    const start = Math.min(...[c.answered_at, k.answered_at].filter(Boolean).map(t => new Date(t).getTime()), now)
    v = {
      stage: 'merged', bg: 'green', avatars: [AV.client, { ...AV.carrier, overlap: true }], timer: clock((now - start) / 1000),
      name: `${clientFirst} & ${carrier}`, sub: 'Merged · all three on', subTone: 'merged', other: null, tip: null, shown: 'both',
    }
  } else if ((cs === 'talking' && ks === 'held') || (ks === 'talking' && cs === 'held' && answered)) {
    const talkingClient = cs === 'talking'
    const leg = talkingClient ? c : k
    v = {
      stage: 'two', bg: 'navy', avatars: [talkingClient ? AV.client : AV.carrier], timer: clock(since(leg.answered_at, now)),
      name: talkingClient ? client : carrier,
      sub: talkingClient ? `Client · ${carrier} is holding` : `Carrier · ${clientFirst} is holding`, subTone: 'plain',
      other: talkingClient ? otherLine('carrier', k, ks) : otherLine('client', c, cs),
      tip: { title: 'Both on the line', text: 'Merge to bring the client in.', btn: 'Merge', act: 'merge' },
      shown: talkingClient ? 'client' : 'carrier',
    }
  } else if (ks === 'talking') {
    const other = otherLine('client', c, cs)
    let tip = null
    if (cs === 'held') tip = { title: 'Someone picked up?', text: `Merge to bring ${clientFirst} in.`, btn: 'Merge', act: 'merge' }
    else if (cs !== 'ringing') tip = { title: 'Someone picked up?', text: 'Say “one moment, adding the policyholder.”', btn: 'Ring client', act: 'ring_client' }
    v = answered && cs !== 'held'
      ? { stage: 'carrier', bg: 'navy', avatars: [AV.carrier], timer: clock(since(k.answered_at, now)), name: carrier, sub: 'Carrier', subTone: 'plain', other, tip: cs === 'ringing' ? null : { ...tip, title: 'Ready for the client?' }, shown: 'carrier' }
      : { stage: 'waiting', bg: 'amber', avatars: [AV.carrier], timer: clock(since(k.answered_at, now)), name: carrier, sub: 'On hold', subTone: 'hold', bars: true, other, tip, shown: 'carrier' }
  } else if (ks === 'ringing') {
    v = { stage: 'ringing', bg: 'navy', avatars: [AV.carrier], timer: clock(since(k.started_at, now)), name: carrier, sub: 'Ringing…', subTone: 'plain', other: otherLine('client', c, cs), tip: null, shown: 'carrier' }
  } else if (cs === 'ringing') {
    v = { stage: 'ringing', bg: 'navy', avatars: [AV.client], timer: clock(since(c.started_at, now)), name: client, sub: 'Ringing…', subTone: 'plain', other: otherLine('carrier', k, ks), tip: null, shown: 'client' }
  } else if (cs === 'talking') {
    v = {
      stage: 'talking', bg: 'navy', avatars: [AV.client], timer: clock(since(c.answered_at, now)), name: client, sub: 'Client', subTone: 'plain',
      other: null, shown: 'client',
      tip: canRingCarrier && ks !== 'held' ? { title: 'Ready for the carrier?', text: 'Ask them to stay on, or offer a call back.', btn: `Ring ${carrier}`, act: 'ring_carrier' } : null,
    }
  } else if (cs === 'held' || ks === 'held') {
    const both = cs === 'held' && ks === 'held'
    const party = cs === 'held' ? 'client' : 'carrier'
    const leg = party === 'client' ? c : k
    v = {
      stage: 'held', bg: 'navy', avatars: [AV[party]], timer: clock(since(leg.hold_since, now)), name: party === 'client' ? client : carrier,
      sub: both ? 'Both on hold' : 'On hold', subTone: 'plain', other: both ? otherLine('carrier', k, ks) : null, tip: null, shown: party,
    }
  } else {
    const over = cs === 'gone' || ks === 'gone'
    v = { stage: over ? 'over' : 'connecting', bg: 'navy', avatars: [AV.client], timer: '00:00', name: client, sub: over ? 'Call ended' : 'Connecting…', subTone: 'plain', other: null, tip: null, shown: null }
  }

  const live = [c, k].filter(l => l && (l.status === 'live'))
  const talking = live.filter(l => !l.on_hold)
  const held = live.filter(l => l.on_hold)
  const shownLeg = v.shown === 'client' ? c : v.shown === 'carrier' ? k : null
  const shownHeld = shownLeg?.status === 'live' && shownLeg.on_hold

  // The fourth key: Ring carrier while with the client, Ring client while
  // with the carrier and the client isn't on, otherwise a faded "Ring".
  let ring = { label: 'Ring', act: null }
  if (!k || ks === 'gone') ring = { label: 'Ring carrier', act: canRingCarrier && cs !== 'ringing' ? 'ring_carrier' : null }
  else if (!c || cs === 'gone') ring = { label: 'Ring client', act: ks === 'talking' || ks === 'held' ? 'ring_client' : null }

  const keys = {
    mute: { label: 'Mute', on: muted, act: 'mute' },
    keypad: { label: 'Keypad', off: ks !== 'talking', act: ks === 'talking' ? 'keypad' : null },
    // Merged: Hold parks the carrier (a word with the client alone).
    hold: v.stage === 'merged'
      ? { label: 'Hold', on: false, act: 'hold', party: 'carrier' }
      : { label: 'Hold', on: held.length > 0, off: !shownLeg || shownLeg.status !== 'live', act: shownLeg?.status === 'live' ? (shownHeld ? 'resume' : 'hold') : null, party: v.shown },
    ring: { ...ring, off: !ring.act },
    swap: { label: 'Swap', off: !(talking.length === 1 && held.length === 1), act: talking.length === 1 && held.length === 1 ? 'swap' : null },
    merge: { label: 'Merge', on: v.stage === 'merged', off: !(live.length === 2 && held.length > 0), act: live.length === 2 && held.length > 0 ? 'merge' : null },
  }
  return {
    ...v,
    bars: !!v.bars,
    callBack,
    keys,
    endLabel: v.stage === 'merged' ? 'End all' : 'End',
    end: v.stage === 'merged' || !shownLeg ? { act: 'end_all' } : { act: 'end', party: v.shown },
    shownLeg,
  }
}

// True once the call had someone on it and now nobody is left (no live or
// ringing leg): the moment the panel moves to "How did it go?".
export function everyoneGone(legs) {
  return (legs || []).length > 0 && !(legs || []).some(isOpenLeg)
}
