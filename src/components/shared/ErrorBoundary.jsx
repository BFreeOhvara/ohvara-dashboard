import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'
import { isChunkError, reloadOnceFor, failedUrl } from '../../lib/chunkReload'

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
          <button type="button" className="ov-primary" onClick={() => window.location.reload()}>Reload</button>
          {/* "/" is RoleRedirect: it lands each role on its own Overview. */}
          <a className="ov-ghost" href="/">Go to Overview</a>
        </div>
      </div>
    </div>
  )
}

export class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error(`[ErrorBoundary] ${window.location.pathname}: ${error?.message || error}`)
    // A lazy route/component whose chunk is gone (a tab opened before a
    // deploy): reload once to pick up the new build; a second failure shows
    // the fallback.
    if (isChunkError(error)) reloadOnceFor(failedUrl(error))
  }

  componentDidUpdate(prev) {
    // A new route clears a stuck error so the agent can click elsewhere.
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (this.state.error) return <CrashCard />
    return this.props.children
  }
}
