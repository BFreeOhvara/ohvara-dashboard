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
    VitePWA({
      registerType: 'autoUpdate',
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
