// P961 — the live-update rules, kept free of app imports so `node --test` can check them (ota.js uses them).
const MAX_TRIES = 2

// Why a manifest is not for this app, or '' when it should be downloaded.
export function whyNot(manifest, running, nativeBuild, platform) {
  if (!manifest?.version || !manifest?.bundle || !manifest?.checksum) return 'manifest incomplete'
  if (manifest.version === running) return 'up to date'
  const min = manifest.minNativeBuild?.[platform] ?? manifest.minNative ?? 1
  if (Number(nativeBuild) < Number(min || 1)) return `needs app build ${min}`
  return ''
}
export const isNewer = (manifest, running, nativeBuild, platform) => whyNot(manifest, running, nativeBuild, platform) === ''

// A parked build to switch in at launch: downloaded, not failed, not the one running, not already tried twice.
export function shouldApply(next, running, tried = {}) {
  if (!next?.id || !next.version || next.id === 'builtin') return false
  if (next.status === 'error' || next.version === running) return false
  return ((tried || {})[next.version] || 0) < MAX_TRIES
}

const time = ms => (ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

// The two lines of "About this app" (AppAbout.jsx): store build + web build, then what the updater last did.
export function aboutLines({ version, build } = {}, running, s = {}) {
  const top = `App ${version || '?'} (${build || '?'}) · Web ${running}`
  const parts = [s.lastCheck ? `Checked ${time(s.lastCheck)}${s.result ? `: ${s.result}` : ''}` : 'Not checked yet']
  if (s.downloaded) parts.push(`Downloaded ${s.downloaded} ${time(s.downloadedAt)}`)
  if (s.applied) parts.push(`Applied ${s.applied === running ? 'this build' : s.applied} ${time(s.appliedAt)}`)
  if (s.error) parts.push(`Error: ${s.error}`)
  return [top, parts.join(' · ')]
}
