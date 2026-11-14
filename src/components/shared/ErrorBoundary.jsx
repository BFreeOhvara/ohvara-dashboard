import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'
import { recoverFrom, reloadFresh } from '../../lib/chunkReload'

// Prompt 746 — a page that throws while rendering used to unmount the whole
// React tree (no boundary anywhere): a completely blank screen. Two of these
// now exist: one outermost in App.jsx (so even a layout crash shows
// something) and one around the routed content inside DashboardLayout (so the
// sidebar and header stay and the agent can click elsewhere).

export function CrashCard() {
  return (
    <div className="ov-crash" role="alert">
      <div className="ov-card ov-crash-card">
        <div className="ov-crash-icon" aria-hidden="true"><AlertTriangle size={22} strokeWidth={2} /></div>
        <h2 className="ov-crash-title">This page ran into a problem.</h2>
        <p className="ov-crash-text">Reload to try again.</p>
        <div className="ov-crash-actions">
          <button type="button" className="ov-primary" onClick={reloadFresh}>Reload</button>
          {/* "/" is RoleRedirect: it lands each role on its own Overview. */}
          <a className="ov-ghost" href="/">Go to Overview</a>
        </div>
      </div>
    </div>
  )
}

// P1001 — shown instead of the crash card while the page reloads onto the newest build.
function Updating() {
  return (
    <div className="ov-crash" role="status" aria-live="polite">
      <p className="ov-crash-text">Updating to the latest version…</p>
    </div>
  )
}

export class ErrorBoundary extends Component {
  // checking: a crash is being matched against the live build before anything shows.
  state = { error: null, checking: false }

  static getDerivedStateFromError(error) {
    return { error, checking: true }
  }

  componentDidCatch(error) {
    console.error(`[ErrorBoundary] ${window.location.pathname}: ${error?.message || error}`)
    // P1001 — a tab opened before a deploy: a gone chunk reloads at once; any other crash reloads if the site is
    // already on a newer build. Once per build (lib/chunkReload), so a real bug still shows the crash card.
    const caught = error
    recoverFrom(error).then(reloaded => {
      if (!reloaded && this.state.error === caught) this.setState({ checking: false })
    })
  }

  componentDidUpdate(prev) {
    // A new route clears a stuck error so the agent can click elsewhere.
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, checking: false })
  }

  render() {
    if (this.state.error) return this.state.checking ? <Updating /> : <CrashCard />
    return this.props.children
  }
}
