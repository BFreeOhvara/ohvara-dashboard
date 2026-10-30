// Prompt 781 — helpers the signed-out pages share (kept out of AuthShell.jsx
// so that file only exports components).

export const SUPPORT_EMAIL = 'support@ohvara.com'

// Phones: when a field gets focus and the on-screen keyboard opens, nudge the
// page so the form's submit button stays above the keyboard too (as long as
// the focused field still fits on screen). Use as a <form onFocus>.
export function keepSubmitVisible(e) {
  if (!(e.target instanceof HTMLInputElement) || window.innerWidth >= 768) return
  const field = e.target
  const btn = e.currentTarget.querySelector('button[type="submit"]')
  setTimeout(() => {
    const vv = window.visualViewport
    if (!btn || !vv || document.activeElement !== field) return
    const fieldTop = field.getBoundingClientRect().top - vv.offsetTop
    const over = btn.getBoundingClientRect().bottom - vv.offsetTop + 12 - vv.height
    if (over > 0 && fieldTop - over > 8) window.scrollBy({ top: over, behavior: 'smooth' })
  }, 350)
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
