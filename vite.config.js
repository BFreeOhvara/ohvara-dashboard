import process from 'node:process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { otaBundle, otaBuildVersion } from './scripts/vite-ota.mjs'
import { joinOgPage } from './scripts/vite-join-og.mjs'

// https://vite.dev/config/
// Prompt 662 — no service worker. The installable icon comes from the static
// public/manifest.json linked in index.html (same approach as restorix-portal).
// Prompt 775 — every build also becomes the phone app's over-the-air update
// (scripts/vite-ota.mjs); __APP_BUILD__ is how the app knows which one it runs.
// Prompt 781 — dist/join.html carries the invite link preview (scripts/vite-join-og.mjs).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const version = process.env.OTA_VERSION || otaBuildVersion()

export default defineConfig({
  plugins: [react(), joinOgPage(), otaBundle({ version, minNative: pkg.ohvara?.otaMinNativeBuild ?? 1 })],
  define: { __APP_BUILD__: JSON.stringify(version) },
})
