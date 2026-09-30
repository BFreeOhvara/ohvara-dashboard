import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Geist — 400 and 500 weights ONLY (anti-rule: no 600/700)
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
// JetBrains Mono — all numbers, money, data values
import '@fontsource/jetbrains-mono/400.css'
// Playfair Display — elegant high-contrast serif, Overview clock only
// (Prompt 350, replaces Prompt 342's DSEG7 seven-segment choice — Brayden
// didn't like the digital/LCD look after living with it). On Google Fonts,
// but self-hosted via @fontsource for the same reason as the others: no
// runtime CDN dependency.
import '@fontsource/playfair-display/700.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
