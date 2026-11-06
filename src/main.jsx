import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Prompt 669 — Restorix Portal's type stack, self-hosted (no runtime CDN):
// Space Grotesk for display headings, Manrope for UI text, JetBrains Mono for
// every number, money and data value.
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './index.css'
// Side-effect import — applies the saved theme before first paint (Prompt 669).
import './hooks/useTheme'
import App from './App.jsx'
import { reloadOnceFor, stripBust } from './lib/chunkReload'
import { isNativeApp } from './lib/native'
import { bootNative } from './lib/nativeBoot'

// Prompt 775 — the iPhone / Android app: status bar, back button, links,
// keyboard, offline, over-the-air updates. Nothing changes on the website.
if (isNativeApp()) bootNative()

// Prompt 746 — Vite fires this when a dynamic import's chunk fails to load (a
// tab opened before a deploy asks for a hash that is gone). Reload once to
// pick up the new build; if that was already tried, let the error through to
// the boundary.
// Prompt 861: once per build version, with a cache-busting query (lib/chunkReload.js); the query comes back out here.
stripBust()
window.addEventListener('vite:preloadError', e => {
  if (reloadOnceFor()) e.preventDefault()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
