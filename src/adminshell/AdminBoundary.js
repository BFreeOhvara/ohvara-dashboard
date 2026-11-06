import { Component, createElement as h } from 'react'
import { isChunkError, reloadOnceFor, reloadFresh } from '../lib/chunkReload.js'

// P855 — a page of the admin shell that throws while rendering shows this panel, never a white screen. Two ways out:
// Reload, and "Open the classic admin" (today's admin pages, ?classic=1). Plain createElement (no JSX) so a node test
// can render the panel. The classes are the global crash-card ones in index.css (the same look as the other portals').
export const CLASSIC_HREF = '/admin?classic=1'

export function AdminCrash() {
  return h('div', { className: 'ov-crash', role: 'alert' },
    h('div', { className: 'ov-card ov-crash-card' },
      h('h2', { className: 'ov-crash-title' }, 'This page ran into a problem.'),
      h('p', { className: 'ov-crash-text' }, 'Reload to try again, or open the classic admin pages.'),
      h('div', { className: 'ov-crash-actions' },
        h('button', { type: 'button', className: 'ov-primary', onClick: reloadFresh }, 'Reload'),
        h('a', { className: 'ov-ghost', href: CLASSIC_HREF }, 'Open the classic admin'))))
}

// resetKey: a new address clears a stuck error, so the tabs keep working after one page crashed.
export class AdminBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error: error || new Error('unknown') }
  }

  componentDidCatch(error) {
    console.error(`[admin shell crash] ${window.location.pathname}: ${error?.message || error}`)
    // A tab opened before a deploy asks for a chunk that is gone: reload once per build (cache-busted) to pick up the new
    // build; if that was already tried the panel stays up (P861).
    if (isChunkError(error)) reloadOnceFor()
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    return this.state.error ? h(AdminCrash) : this.props.children
  }
}
