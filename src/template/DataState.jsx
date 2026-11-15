import { RefreshCw, CloudOff } from 'lucide-react'
import './p848.css'
import { Loader } from '../components/shared/Loader'

// P848 — the real portal's loading and error states, in the shell style. Sample data never shows either.
// P1020: slow page data shows the loading screen over the page area (not the top bar), only past 300 ms.
export function DataLoading() {
  return <div className="tp-page fx-page dz-load"><Loader area /></div>
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
