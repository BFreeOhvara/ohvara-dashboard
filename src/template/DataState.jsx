import { RefreshCw, CloudOff } from 'lucide-react'
import './p848.css'
import { Loader, PageWait } from '../components/shared/Loader'
import { isBooted } from '../lib/loader'

// P848 — the real portal's loading and error states, in the shell style. Sample data never shows either.
// P1026: one loader until the page is ready. The first time the portal opens, the full-screen loading screen covers
// the window (the header and menus stay hidden behind it) until the data is in, then the whole page comes up at once.
// After that, a slow page keeps the page on screen with a slim teal line along the top of the window (PageWait), and
// only past two seconds falls back to the full-screen loader. Never a box inside the page.
export function DataLoading() {
  return isBooted() ? <PageWait /> : <Loader hold />
}

export function DataError({ onRetry }) {
  return (
    <div className="tp-page fx-page">
      <section className="fx-tile dz-err" role="alert">
        <CloudOff size={22} aria-hidden="true" />
        <b>We couldn{'’'}t load this page</b>
        <span>Your data is safe. Check your connection and try again. If it keeps happening, message the team from Help.</span>
        <button type="button" className="tp-primary fx-accent" onClick={onRetry}><RefreshCw size={15} />Try again</button>
      </section>
    </div>
  )
}

// A first-time empty page: what will show here and how the first one gets here.
export function FirstRun({ icon: Icon, title, sub, children }) {
  return (
    <section className="fx-tile dz-first">
      {Icon && <span className="dz-first-ic"><Icon size={20} aria-hidden="true" /></span>}
      <b>{title}</b>
      <span>{sub}</span>
      {children}
    </section>
  )
}
