import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Prompt 662 — no service worker. The installable icon comes from the static
// public/manifest.json linked in index.html (same approach as restorix-portal).
export default defineConfig({
  plugins: [react()],
})
