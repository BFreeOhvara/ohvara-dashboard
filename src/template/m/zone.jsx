import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { useZoneConfirm } from '../../hooks/useZoneConfirm'
import { SELECTABLE_TIMEZONES, DEFAULT_TIMEZONE, timezoneAbbr } from '../../lib/timezones'
import { pickableZone, phoneZone, zoneName, clockLine } from './zoneTime'
import { useTick } from '../clockTime'
import { useNote } from '../kit'
import { BottomSheet } from './AppKit'

// P989 — time zone + clock on the phone (agent, VA, admin). Every user has ONE zone (profiles.timezone), the same one
// the desktop Settings sets. The phone app sets it from the phone the first time (timezone_confirmed_at is empty),
// and if the phone later reads a different zone (travel) it asks once: "Your phone is on Eastern time. Switch Ohvara
// to Eastern?" Each app passes its own zone and its own save, so the change goes through the same path the desktop
// uses and every screen re-reads it.

export function PhoneClock({ tz }) {
  const now = useTick(60000)
  const c = clockLine(now, tz)
  return (
    <span className="ma-clock" role="timer" aria-live="off" aria-label={`${c.date}, ${c.time}, ${zoneName(tz)} time`}>
      {c.date}<i aria-hidden="true"> · </i><b className="tp-num">{c.time}</b> {c.abbr}
    </span>
  )
}


const ASKED = 'ov-zone-asked'
const asked = () => { try { return JSON.parse(localStorage.getItem(ASKED) || '{}') } catch { return {} } }
const remember = key => { try { localStorage.setItem(ASKED, JSON.stringify({ ...asked(), [key]: Date.now() })) } catch { /* private window: asks again next time */ } }

// Mounted once in each phone app's frame. `tz` = the zone saved for this user, `save(tz)` = that app's own save,
// `real` = real data (the first-time set and the "confirmed" mark touch the real profile only then).
export function PhoneZone({ tz, save, real }) {
  const mark = useZoneConfirm()
  const note = useNote()
  const phone = phoneZone()
  const saved = pickableZone(tz) || tz || DEFAULT_TIMEZONE
  const [ask, setAsk] = useState(null)
  const firstDone = useRef(false)

  const confirm = async zone => {
    await save(zone)
    if (real) await mark.confirm(zone)
  }

  // First time on real data: no zone picked yet → take the phone's, quietly.
  const first = real && mark.signedIn && !mark.confirmed && phone
  useEffect(() => {
    if (!first || firstDone.current) return
    firstDone.current = true
    remember(`${saved}>${phone}`)
    if (phone !== saved) Promise.resolve(confirm(phone)).then(() => note?.(`Time zone set to ${zoneName(phone)} from your phone`)).catch(() => {})
    else confirm(phone)?.catch?.(() => {})
  }, [first]) // eslint-disable-line react-hooks/exhaustive-deps

  // Travel: the phone reads a different zone than the one saved → ask once per (saved, phone) pair.
  useEffect(() => {
    if (first || !phone || !tz || phone === saved) return
    const key = `${saved}>${phone}`
    if (asked()[key]) return
    const t = setTimeout(() => setAsk({ key, phone, saved }), 900)
    return () => clearTimeout(t)
  }, [first, phone, tz, saved])

  const close = () => { if (ask) remember(ask.key); setAsk(null) }
  const yes = () => { const z = ask.phone; close(); Promise.resolve(confirm(z)).then(() => note?.(`Time zone: ${zoneName(z)}`)).catch(() => note?.('Could not save your time zone')) }
  return (
    <BottomSheet open={!!ask} onClose={close} label="Time zone" className="ma-zone-ask">
      {ask && (
        <div className="ma-zask">
          <h2>Your phone is on {zoneName(ask.phone)} time.</h2>
          <p>Switch Ohvara to {zoneName(ask.phone)}? Times across the app will show in {zoneName(ask.phone)} time. You can change it any time in Settings → Time zone.</p>
          <button type="button" className="ma-btn is-solid is-tall ma-press" onClick={yes}>Yes, switch to {zoneName(ask.phone)}</button>
          <button type="button" className="ma-btn is-soft is-tall ma-press" onClick={close}>Keep {zoneName(ask.saved)}</button>
        </div>
      )}
    </BottomSheet>
  )
}

// Settings → Time zone (VA and admin; the agent app keeps its own form): each zone with its time right now and a
// tick on the saved one; tapping saves at once. The phone's own zone says so.
export function ZonePicker({ tz, onPick }) {
  const now = useTick(60000)
  const phone = phoneZone()
  const saved = pickableZone(tz) || tz || DEFAULT_TIMEZONE
  return (
    <>
      <div className="ma-glass ma-list ma-set ma-rise" role="radiogroup" aria-label="Time zone">
        {SELECTABLE_TIMEZONES.map(z => (
          <button key={z.value} type="button" role="radio" aria-checked={saved === z.value} className="ma-row" onClick={() => saved !== z.value && onPick(z.value)}>
            <span className="ma-grow"><b>{z.label}</b><small>{clockLine(now, z.value).time} {timezoneAbbr(z.value)}{phone === z.value ? ' · your phone' : ''}</small></span>
            {saved === z.value && <Check size={20} strokeWidth={2.6} className="ma-tick" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <p className="ma-hint ma-set-note">Every time in Ohvara shows in this zone, here and on the desktop. One setting for you, on every device.</p>
    </>
  )
}

