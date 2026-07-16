// Prompt 286 — platform checks for the Mobile App install flow. iOS Safari
// has no programmatic install API at all (confirmed during investigation),
// so the modal has to branch by platform rather than feature-detect a
// single install path.
export function isMobileDevice() {
  const ua = navigator.userAgent
  // iPadOS 13+ reports as "Macintosh" but exposes multi-touch, unlike a
  // real Mac trackpad/mouse — the standard sniff for telling them apart.
  const iPadOS = ua.includes('Macintosh') && navigator.maxTouchPoints > 1
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || iPadOS
}

export function isIOS() {
  const ua = navigator.userAgent
  const iPadOS = ua.includes('Macintosh') && navigator.maxTouchPoints > 1
  return /iPad|iPhone|iPod/.test(ua) || iPadOS
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}
