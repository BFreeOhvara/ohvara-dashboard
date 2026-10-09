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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
