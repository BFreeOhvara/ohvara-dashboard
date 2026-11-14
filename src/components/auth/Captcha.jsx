import { useEffect, useRef } from 'react'

// P999 — the bot check (Cloudflare Turnstile) on sign-in, create account and forgot password. Off until the site
// key is set (VITE_TURNSTILE_SITE_KEY at build time) and Brayden turns on Supabase's bot protection with the
// matching secret: then Supabase refuses a sign-in without a token. Mostly invisible: Turnstile only shows a box
// when it isn't sure. A token works once, so the page calls reset() after each try.

const CAPTCHA_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''

let loading = null
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      s.async = true
      s.onload = () => resolve(window.turnstile)
      s.onerror = () => { loading = null; reject(new Error('captcha_load_failed')) }
      document.head.appendChild(s)
    })
  }
  return loading
}

// onToken(token | '') — '' when the token expires or the check fails. `api` gets { reset }.
export function Captcha({ onToken, api, theme = 'auto' }) {
  const box = useRef(null)
  const id = useRef(null)
  useEffect(() => {
    if (!CAPTCHA_KEY) return undefined
    let gone = false
    loadTurnstile().then(ts => {
      if (gone || !box.current || !ts) return
      id.current = ts.render(box.current, {
        sitekey: CAPTCHA_KEY, theme, appearance: 'interaction-only', size: 'flexible',
        callback: t => onToken?.(t), 'expired-callback': () => onToken?.(''), 'error-callback': () => onToken?.(''),
      })
      if (api) api.current = { reset: () => { try { ts.reset(id.current) } catch { /* gone */ } onToken?.('') } }
    }).catch(() => onToken?.(''))
    return () => { gone = true; try { if (id.current != null) window.turnstile?.remove(id.current) } catch { /* gone */ } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!CAPTCHA_KEY) return null
  return <div ref={box} className="pa-captcha" />
}
