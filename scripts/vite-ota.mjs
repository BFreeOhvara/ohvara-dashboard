// Prompt 775 — Vite plugin: after every build, zip the built site into
// dist/ota/<version>.zip and write dist/ota/manifest.json, so the website
// deploy (Vercel) is also the phone app's over-the-air update (src/lib/ota.js).
// Skipped with OTA_SKIP=1 (the store builds in codemagic.yaml: the app
// already ships that same build inside it).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { zipSync } from 'fflate'

function walk(dir, base = dir, out = {}) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const rel = path.relative(base, full).split(path.sep).join('/')
    if (rel === 'ota') continue
    if (fs.statSync(full).isDirectory()) walk(full, base, out)
    else out[rel] = new Uint8Array(fs.readFileSync(full))
  }
  return out
}

export function otaBuildVersion() {
  // Sortable, unique per build: 1.<yyyymmdd>.<hhmmss> UTC, plus the commit when Vercel gives one.
  const d = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7)
  return `1.${d.slice(0, 8)}.${Number(d.slice(8))}${sha ? `-${sha}` : ''}`
}

export function otaBundle({ version, minNative }) {
  let outDir = 'dist'
  return {
    name: 'ohvara-ota',
    apply: 'build',
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir) },
    closeBundle() {
      if (process.env.OTA_SKIP === '1') return
      const zip = zipSync(walk(outDir), { level: 9 })
      const checksum = crypto.createHash('sha256').update(zip).digest('hex')
      const dir = path.join(outDir, 'ota')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `${version}.zip`), zip)
      const manifest = { version, bundle: `/ota/${version}.zip`, checksum, minNative, builtAt: new Date().toISOString() }
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    },
  }
}
