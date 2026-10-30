import { Phone, MapPin, ShieldCheck, MessageSquare } from 'lucide-react'
import { fullName } from '../../../lib/policyFormat'
import { digits, tabOf, stageOf, isSubmittedOnly } from '../../../lib/agentBookings'
import { US_STATES } from '../../../lib/timezones'
import { PhoneSheet } from './PhoneSheet'
import { dayTile, dayTime, untilText, zoneWord, initials, statusPhrase } from './phoneBits'

// Prompt 772 — a client as a bottom sheet (mockup Client.dc.html): name and
// status pill, the call card, Phone (with a Call button), where they live and
// the carrier they're leaving, then History. `footer` is the client's next
// step, decided by My Pipeline's ClientDetail (Change booking, Call & rebook,
// Confirm the number, or a note); the message button sits next to it.
// `picker` (re-booking) replaces the body while it's open.

const TAB_COLOR = { booked: 'booked', noAnswer: 'noanswer', needs: 'needs', cancelled: 'cancelled' }
const stateName = code => US_STATES.find(s => s.code === code)?.name || code
const whenShort = (iso, nowMs) => {
  const d = new Date(iso)
  return nowMs - d.getTime() < 6 * 864e5 && d.getTime() <= nowMs
    ? d.toLocaleDateString('en-US', { weekday: 'short' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function PhoneClientSheet({ p, now, steps, note, footer, picker, onMessage, messageLabel, onClose }) {
  const name = fullName(p)
  const first = p.client_first_name || name
  const tab = tabOf(p)
  const key = TAB_COLOR[tab]
  const tz = p.client_timezone || undefined
  const showCall = p.scheduled_call_at && stageOf(p) !== 'cancelled'
  const tile = showCall ? dayTile(p.scheduled_call_at, now, tz) : null
  const ahead = showCall && new Date(p.scheduled_call_at).getTime() > now
  const zone = zoneWord(tz)
  const place = [p.client_city, stateName(p.state)].filter(Boolean).join(', ')
  const carrier = p.current_carrier || p.carrier_name

  const head = (
    <>
      <span className="ph-ini" style={{ width: 52, height: 52, fontSize: 17, background: 'var(--ov-data-a-tint)', color: 'var(--ov-data-a)' }} aria-hidden="true">{initials(name)}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15, overflowWrap: 'anywhere' }}>{name}</span>
        <span style={{
          marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 24, padding: '2px 10px', boxSizing: 'border-box', borderRadius: 999,
          background: `var(--ov-st-${key}-tint)`, color: `var(--ov-st-${key})`, fontSize: 12, fontWeight: 700,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: `var(--ov-st-${key})`, flex: 'none' }} />
          {statusPhrase(p, now)}
        </span>
      </span>
    </>
  )

  const foot = (
    <>
      {footer && <div className="ph-foot-main">{footer}</div>}
      <button type="button" className="ph-msgbtn" onClick={onMessage} aria-label={messageLabel} style={footer ? undefined : { marginLeft: 'auto' }}>
        <MessageSquare size={20} strokeWidth={2} />
      </button>
    </>
  )

  return (
    <PhoneSheet label={name} head={head} foot={foot} onClose={onClose}>
      {picker || (
        <>
          {tile && (
            <div className="ph-callcard">
              <span className="ph-daytile" style={{ width: 50, height: 54 }}><small style={{ color: 'var(--ov-data-a)' }}>{tile.dow === 'TODAY' ? new Date(p.scheduled_call_at).toLocaleDateString('en-US', { weekday: 'short', ...(tz ? { timeZone: tz } : null) }).toUpperCase() : tile.dow}</small><b>{tile.d}</b></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ov-soft)' }}>{ahead ? `Fulfillment calls ${first}` : 'Last booked call'}</span>
                <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--ov-hi)' }}>{dayTime(p.scheduled_call_at, now, tz)}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ov-mute)' }}>
                  {[ahead && untilText(p.scheduled_call_at, now, tz), zone && `their time (${zone})`].filter(Boolean).join(' · ')}
                </span>
              </span>
            </div>
          )}

          <div className="ph-info">
            <div className="ph-info-row">
              <Phone size={18} strokeWidth={2} style={{ color: 'var(--ov-mute)', flex: 'none' }} aria-hidden="true" />
              <span style={{ flex: 1, minWidth: 0 }}><span className="ph-info-k">Phone</span><span className="ph-info-v">{p.client_phone || 'No number'}</span></span>
              {p.client_phone && <a className="ph-callbtn" href={`tel:${digits(p.client_phone)}`}><Phone size={15} strokeWidth={2.2} aria-hidden="true" />Call</a>}
            </div>
            {place && (
              <div className="ph-info-row">
                <MapPin size={18} strokeWidth={2} style={{ color: 'var(--ov-mute)', flex: 'none' }} aria-hidden="true" />
                <span style={{ flex: 1, minWidth: 0 }}><span className="ph-info-k">Lives in</span><span className="ph-info-v">{place}</span></span>
              </div>
            )}
            <div className="ph-info-row">
              <ShieldCheck size={18} strokeWidth={2} style={{ color: 'var(--ov-mute)', flex: 'none' }} aria-hidden="true" />
              <span style={{ flex: 1, minWidth: 0 }}><span className="ph-info-k">{isSubmittedOnly(p) ? 'Old policy' : 'Carrier they’re leaving'}</span><span className="ph-info-v">{isSubmittedOnly(p) ? 'None to cancel' : carrier || 'Not noted'}</span></span>
            </div>
          </div>

          {note && <p style={{ margin: '14px 2px 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ov-soft)' }}>{note}</p>}

          <div className="ph-hist-label">History</div>
          <div className="ph-hist">
            {steps.filter(s => s.done || s.next).map(s => (
              <div key={s.label} className="ph-hist-row">
                <span className="ph-hist-dot" style={s.done
                  ? { background: `var(--ov-st-${key})`, boxShadow: `0 0 0 4px var(--ov-st-${key}-tint)` }
                  : { background: 'transparent', border: '2px solid var(--ph-chev)', boxSizing: 'border-box' }} aria-hidden="true" />
                <span className="ph-hist-t" style={s.done ? undefined : { color: 'var(--ov-mute)' }}>{s.label}</span>
                {s.at && s.done && <span className="ph-hist-when">{whenShort(s.at, now)}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </PhoneSheet>
  )
}
