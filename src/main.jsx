import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Geist — 400 and 500 weights ONLY (anti-rule: no 600/700)
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
// JetBrains Mono — all numbers, money, data values
import '@fontsource/jetbrains-mono/400.css'
// DSEG7 Classic — seven-segment/LCD digital display, Overview clock only
// (Prompt 342). Not on Google Fonts, so self-hosted via @fontsource like the
// other custom fonts above rather than a CDN @import.
import '@fontsource/dseg7-classic/700.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
