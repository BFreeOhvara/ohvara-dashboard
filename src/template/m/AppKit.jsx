import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Phone } from 'lucide-react'
import { useSampleActions, useSampleAppointments, useSampleSettings, useSampleBilling } from '../data'
import { useNote } from '../kit'
import { useExit, still } from '../motion'
import { resultsFor, followUpPick } from '../agentView'
import { whenLabel, clockNow } from '../leadLifecycle'
import { OutcomeDrawer } from '../LeadOutcome'
import { DeedstoneCallButton } from '../DeedstoneCall'
import { telOf } from '../phoneMask'
import { paths } from '../paths'
import { useProducts } from '../useProducts'
import { RESULT, RESULT_ORDER, initialsOf } from './appModel'
import { useSheetDrag } from './useBackSwipe'

// P967 — the pieces every screen of the phone app shares. The frame (MobileFrame) provides the app's navigation
// through AppCtx: open a page or a small sub-screen over the current tab, go back, switch tabs.
export const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

// A sub-screen (P971, P972): a header pinned at the top (back, title, a line, buttons on the right) that is clear at
// rest and only blurs once the page scrolls under it, so the page's backdrop runs to the very top of the screen. The
// page scrolls under the header and the status bar. `big` (Search, Notifications, the Account screens) is the iOS
// large title: a plain back arrow on top, the big title in the page that scrolls away, and a small title that fades
// into the header once it has. Notifications passes `close` for its arrow on the right instead of Back.
export function SubPage({ title, line, foot, children, className = '', right, close, big = false, left }) {
  const app = useApp()
  const head = useRef(null)
  const onScroll = e => {
    const h = head.current
    if (!h) return
    const y = e.currentTarget.scrollTop
    h.classList.toggle('is-scrolled', y > 2)
    if (big) h.classList.toggle('is-titled', y > 44)
  }
  const arrow = (label, flip) => big
    ? <button type="button" className="ma-back ma-press" aria-label={label} onClick={app.back}><ChevronLeft size={30} strokeWidth={2.1} aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined} /></button>
    : <button type="button" className="ma-round ma-press" aria-label={label} onClick={app.back}><ChevronLeft size={22} aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined} /></button>
  return (
    <div className={`ma-subpage${big ? ' is-big' : ''} ${className}`}>
      <div className="ma-scroll ma-sub-scroll" data-ma-scroll onScroll={onScroll}>
        <div className="ma-sub-b">
          {big && <div className="ma-bigt"><h1>{title}</h1>{line && <small>{line}</small>}</div>}
          {children}
        </div>
      </div>
      <header className="ma-sub-h" ref={head}>
        {left}
        {!close && arrow('Back')}
        <span className="ma-sub-t" aria-hidden={big || undefined}><b>{title}</b>{line && !big && <small>{line}</small>}</span>
        {right}
        {close && arrow(close, true)}
      </header>
      {foot && <div className="ma-foot">{foot}</div>}
    </div>
  )
}

// The mockup's switch: 52 x 32, white knob, the track fills in blue (or the colour given).
export function Toggle({ on, label, onChange, small = false, tone, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} disabled={disabled}
      className={`ma-switch${small ? ' is-sm' : ''}${on ? ' is-on' : ''}${tone ? ` is-${tone}` : ''}`} onClick={() => onChange(!on)}>
      <span aria-hidden="true" />
    </button>
  )
}

export const Ini = ({ name, tone, size = 46, className = '' }) => (
  <span className={`ma-ini${tone ? ` is-${tone}` : ''} ${className}`} style={{ '--s': `${size}px` }} aria-hidden="true">{initialsOf(name)}</span>
)

// A row in a glass list: something on the left, a title and a line, a chevron. A link, a button or plain.
export function Row({ to, onClick, lead, title, sub, right, chev = true, className = '', state, label }) {
  const inner = <>{lead}<span className="ma-grow"><b>{title}</b>{sub && <small>{sub}</small>}</span>{right}{chev && <ChevronRight size={18} className="ma-chev" aria-hidden="true" />}</>
  const cls = `ma-row ${className}`
  if (to) return <Link to={to} state={state} className={cls} aria-label={label}>{inner}</Link>
  if (onClick) return <button type="button" className={cls} onClick={onClick} aria-label={label}>{inner}</button>
  return <div className={cls}>{inner}</div>
}

// Call: through Deedstone when we know who (lib/deedstoneCall targetOf), else plain tap-to-call.
export function CallButton({ phone, to, label = 'Call', className = 'ma-btn is-solid', children }) {
  if (!phone && !to?.phone) return null
  const inner = children || <><Phone size={18} aria-hidden="true" />{label}</>
  if (to) return <DeedstoneCallButton target={{ ...to, phone: to.phone || phone }} className={`${className} ma-press`} label={label} stop>{inner}</DeedstoneCallButton>
  return <a href={telOf(phone)} className={`${className} ma-press`} aria-label={label} onClick={e => e.stopPropagation()}>{inner}</a>
}

function useEsc(open, onClose) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
}

// A sheet that slides up from the bottom over a dimmed page (the result sheet, a calendar day). P972: pull it down
// by the handle or the body (when scrolled to its top) to close it; it springs back if the pull is short.
export function BottomSheet({ open, onClose, label, children, tall = false }) {
  const [shown, leaving] = useExit(open)
  const sheet = useRef(null)
  const scrim = useRef(null)
  useEsc(open, onClose)
  useSheetDrag({ sheetRef: sheet, scrimRef: scrim, onClose, on: shown && !leaving })
  if (!shown) return null
  return createPortal(
    <div className={`tp fx ma-layer${leaving ? ' is-leaving' : ''}`} role="presentation">
      <button type="button" className="ma-scrim" aria-label="Close" onClick={onClose} ref={scrim} />
      <section className={`ma-sheet${tall ? ' is-tall' : ''}`} role="dialog" aria-modal="true" aria-label={label} ref={sheet}>
        <i className="ma-grab" aria-hidden="true" />
        {children}
      </section>
    </div>,
    document.body,
  )
}

// ── How did it go? ────────────────────────────────────────────────────────────────────────────────────────────
// One tap per result (P967): Sold, Not sold, No show and Follow up move the lead at once and say so in a toast.
// Follow up books the system's pick (the lead's best window, 30 minutes clear, agentView followUpPick); "Pick a day"
// opens the full picker. No show keeps its 10-second Undo (the frame shows it). Sold asks about servicing next.
export function useMark() {
  const { moveLead, markNoShow } = useSampleActions()
  const { data: appts } = useSampleAppointments()
  const { data: settings } = useSampleSettings()
  const note = useNote()
  const app = useApp()
  return useCallback((lead, k) => {
    const first = lead.first_name
    if (!resultsFor(lead).includes(k)) return false
    if (k === 'no_show') { markNoShow(lead.id); app.undoFor(lead.id); return true }
    if (k === 'booked') { moveLead(lead.id, 'booked'); note(`${first} is back on Booked`); return true }
    if (k === 'not_interested') { moveLead(lead.id, 'not_interested', { niAt: clockNow() }); note(`${first} marked not sold`); return true }
    if (k === 'sold') { moveLead(lead.id, 'sold'); note(`${first} marked sold`); app.soldFor(lead); return true }
    if (k === 'follow_up') {
      const slot = followUpPick(lead, { appts, settings })
      if (!slot || slot.free === false) { app.pickFollow(lead); return true }
      moveLead(lead.id, 'follow_up', { follow: whenLabel(slot.at), followAt: slot.at, followAuto: !slot.picked, slotIso: slot.iso })
      note(`Follow up on your calendar: ${whenLabel(slot.at)}`)
      return true
    }
    return false
  }, [moveLead, markNoShow, appts, settings, note, app])
}

export function ResultSheet({ lead, onClose }) {
  const mark = useMark()
  const app = useApp()
  const allowed = lead ? RESULT_ORDER.filter(k => resultsFor(lead).includes(k)) : []
  return (
    <BottomSheet open={!!lead} onClose={onClose} label="How did it go?">
      {lead && <>
        <p className="ma-sheet-t">How did it go with {lead.first_name}?</p>
        <p className="ma-sheet-s">One tap. Our team handles what comes next.</p>
        {allowed.map(k => {
          const r = RESULT[k]
          return (
            <button key={k} type="button" className="ma-pick" data-result={k} onClick={() => { onClose(); mark(lead, k) }}>
              <span className={`ma-pick-ic is-${r.tone}`} aria-hidden="true">{r.sym}</span>
              <span className="ma-grow"><b>{r.label}</b><small>{r.sub}</small></span>
            </button>
          )
        })}
        {allowed.includes('follow_up') && <button type="button" className="ma-link-btn" onClick={() => { onClose(); app.pickFollow(lead) }}>Follow up on a day you pick</button>}
        {!allowed.length && <p className="ma-sheet-s">Nothing to mark on this lead.</p>}
      </>}
    </BottomSheet>
  )
}

// After Sold: submit it for servicing (or how to get servicing). Mirrors LeadOutcome's "Marked sold".
export function SoldSheet({ lead, onClose }) {
  const { data: billing } = useSampleBilling()
  const { serve } = useProducts()
  const plan = billing.servicing?.status === 'active'
  return (
    <BottomSheet open={!!lead} onClose={onClose} label="Marked sold">
      {lead && <>
        <p className="ma-sheet-t">Nice work.</p>
        {!serve
          ? <p className="ma-sheet-s">{lead.first_name} stays on Leads under Sold. Want us to keep these on the books? Add Servicing in Billing.</p>
          : plan
            ? <p className="ma-sheet-s">Submit the policy and our team takes it from there: the review call, the carrier and every change after. {lead.first_name}{'’'}s details fill in for you.</p>
            : <p className="ma-sheet-s">Your plan doesn’t include policy servicing yet. Turn it on in Billing and our team handles {lead.first_name}{'’'}s policy.</p>}
        <div className="ma-two">
          <button type="button" className="ma-btn is-soft ma-press" onClick={onClose}>Later</button>
          {serve && plan
            ? <Link to={paths.submit(lead.id)} className="ma-btn is-solid ma-press" onClick={onClose}>Submit for servicing</Link>
            : <Link to={`${paths.billing()}${serve ? '' : '?add=servicing'}`} className="ma-btn is-solid ma-press" onClick={onClose}>{serve ? 'Turn on servicing' : 'Add Servicing'}</Link>}
        </div>
      </>}
    </BottomSheet>
  )
}

// Follow up at a time the agent picks: the portal's own picker (days, times, the reminder texts).
export const FollowPicker = ({ lead, onClose }) => <OutcomeDrawer lead={lead} kind={lead ? 'follow_up' : null} onClose={onClose} />

// Staggered rise: each child section gets the next delay (the mockup's .rise, .03 s apart).
export const rise = i => ({ animationDelay: `${0.03 + i * 0.035}s` })

// Pointer helper: true while a finger moved enough to be a swipe, so the click that ends it is dropped.
export function useDragGuard() {
  const moved = useRef(false)
  const start = useRef(null)
  const onPointerDown = e => { start.current = [e.clientX, e.clientY]; moved.current = false }
  const onPointerMove = e => { if (start.current && Math.abs(e.clientX - start.current[0]) > 10) moved.current = true }
  const onClickCapture = e => { if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false } }
  return { onPointerDown, onPointerMove, onClickCapture }
}

// Reduced motion: no slide, no stagger (the CSS reads .is-still on the frame too).
export const useStill = () => { const [s] = useState(() => still()); return s }
