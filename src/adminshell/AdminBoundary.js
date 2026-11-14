import { Component, createElement as h } from 'react'
import { recoverFrom, reloadFresh } from '../lib/chunkReload.js'

// P855 — a page of the admin shell that throws while rendering shows this panel, never a white screen. Two ways out:
// Reload, and Go to Overview (P919: the classic admin pages are gone). Plain createElement (no JSX) so a node test
// can render the panel. The classes are the global crash-card ones in index.css (the same look as the other portals').
export const OVERVIEW_HREF = '/admin'

export function AdminCrash() {
  return h('div', { className: 'ov-crash', role: 'alert' },
    h('div', { className: 'ov-card ov-crash-card' },
      h('h2', { className: 'ov-crash-title' }, 'This page ran into a problem.'),
      h('p', { className: 'ov-crash-text' }, 'Reload to try again, or go back to Overview.'),
      h('div', { className: 'ov-crash-actions' },
        h('button', { type: 'button', className: 'ov-primary', onClick: reloadFresh }, 'Reload'),
        h('a', { className: 'ov-ghost', href: OVERVIEW_HREF }, 'Go to Overview'))))
}

// resetKey: a new address clears a stuck error, so the tabs keep working after one page crashed.
// P1001 — shown instead of the panel while the page reloads onto the newest build.
export function AdminUpdating() {
  return h('div', { className: 'ov-crash', role: 'status', 'aria-live': 'polite' },
    h('p', { className: 'ov-crash-text' }, 'Updating to the latest version…'))
}

export class AdminBoundary extends Component {
  state = { error: null, checking: false }

  static getDerivedStateFromError(error) {
    return { error: error || new Error('unknown'), checking: true }
  }

  componentDidCatch(error) {
    console.error(`[admin shell crash] ${window.location.pathname}: ${error?.message || error}`)
    // A tab opened before a deploy asks for a chunk that is gone: reload once per build (cache-busted) to pick up the new
    // build; if that was already tried the panel stays up (P861). P1001: any other crash also reloads once when the site
    // is already on a newer build than this tab.
    const caught = this.state.error
    recoverFrom(error).then(reloaded => {
      if (!reloaded && this.state.error === caught) this.setState({ checking: false })
    })
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, checking: false })
  }

  render() {
    return this.state.error ? h(this.state.checking ? AdminUpdating : AdminCrash) : this.props.children
  }
}
