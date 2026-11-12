import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useOnce } from '../../hooks/useOneAtATime'
import { useAdmSource } from '../data'
import { useNote } from '../../template/kit'

// P962 — the App Review logins back on admin Settings (the P934/P950 cleanup left them only on the old /settings page,
// with nothing linking there). Same tool as P775: Reset makes the two sample accounts if they're missing, sets new
// passwords and re-seeds their sample data (app-review-logins function). The passwords show once here, to copy into
// App Store Connect and Google Play. On the sample side (preview, sample data) nothing is called.
const Head = ({ title, sub }) => <header className="fx-form-h"><h2>{title}</h2><p>{sub}</p></header>

export function AppReviewLogins() {
  const real = useAdmSource() === 'real'
  const note = useNote()
  const once = useOnce()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [logins, setLogins] = useState(null)
  const [sure, setSure] = useState(false)

  const reset = once(async () => {
    if (!real) { setSure(false); note('Reset works once you sign in for real'); return }
    setBusy(true); setError('')
    const { data, error: e } = await supabase.functions.invoke('app-review-logins', { body: { action: 'reset' } })
    setBusy(false); setSure(false)
    if (e || !data?.ok) { setError(data?.error || 'Couldn’t reset the logins. Try again.'); return }
    setLogins([['Agent', data.agent], ['VA (Fulfillment)', data.fulfillment]])
  })
  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); note(`${what} copied`) } catch { note('Couldn’t copy. Select it and copy by hand.') }
  }

  return (
    <>
      <Head title="App Review logins" sub="A sample agent and a sample VA for Apple and Google to test the phone app. They only ever see sample data: no real calls, texts, emails, charges or pay." />
      {logins ? (
        <>
          <p role="status" className="tp-sub">Copy these now. The passwords aren’t shown again (reset any time for new ones).</p>
          <ul className="tp-list">{logins.flatMap(([who, l]) => [
            <li key={`${who}e`} className="fx-mrow"><span className="tp-grow"><small>{who} email</small><b className="tp-num">{l.email}</b></span><button type="button" className="fx-pillbtn" onClick={() => copy(l.email, `${who} email`)}>Copy</button></li>,
            <li key={`${who}p`} className="fx-mrow"><span className="tp-grow"><small>{who} password</small><b className="tp-num" style={{ overflowWrap: 'anywhere' }}>{l.password}</b></span><button type="button" className="fx-pillbtn" onClick={() => copy(l.password, `${who} password`)}>Copy</button></li>,
          ])}</ul>
          <footer className="fx-form-f"><span className="tp-grow" /><button type="button" className="tp-primary fx-accent" onClick={() => setLogins(null)}>Done</button></footer>
        </>
      ) : (
        <>
          <ul className="tp-list">
            <li className="fx-mrow"><span className="tp-grow"><small>Agent</small><b>app-review-agent@ohvara.com</b></span></li>
            <li className="fx-mrow"><span className="tp-grow"><small>VA (Fulfillment)</small><b>app-review-fulfillment@ohvara.com</b></span></li>
          </ul>
          <p className="tp-sub">Reset gives both new passwords, so the ones Apple or Google have stop working. Don’t reset while a review is in progress.</p>
          <footer className="fx-form-f">
            {sure && <button type="button" className="tp-btn ov-ghost" onClick={() => setSure(false)} disabled={busy}>Cancel</button>}
            <button type="button" className="tp-primary fx-accent" disabled={busy} onClick={sure ? reset : () => setSure(true)}>
              {busy ? 'Resetting…' : sure ? 'Yes, reset both' : 'Reset the logins'}
            </button>
          </footer>
        </>
      )}
      {error && <p className="adm-warn" role="alert">{error}</p>}
    </>
  )
}
