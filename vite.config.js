import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Prompt 286 — installable app manifest + service worker. registerType
    // 'autoUpdate' means a new deploy silently swaps in on next navigation,
    // no user-facing "update available" prompt (matches how the SPA already
    // ships — no version-pinning concerns here).
    // Prompt 420 — injectRegister disabled here; main.jsx registers the SW
    // itself via the `virtual:pwa-register` module so it can force open
    // tabs to actually reload once a new service worker takes over (see
    // main.jsx comment for why the plain auto-injected registration wasn't
    // enough).
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['ohvara-favicon.png'],
      manifest: {
        name: 'Ohvara',
        short_name: 'Ohvara',
        description: 'Ohvara rep, closer, and admin dashboard',
        theme_color: '#6C63FF',
        background_color: '#080810',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
