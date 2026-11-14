import { AuCheck } from './AuthShell'

// P999 — the agreement on every way into a new account (Create account with email, Apple or Google, and the
// one-time step after a first Google / Apple sign-in). Same words on the website's /signup and in the app.
// DRAFT texting line: for Brayden to OK or reword.
export function TermsLine({ checked, onChange, error }) {
  return (
    <>
      <AuCheck terms checked={checked} onChange={onChange} error={error}>
        I agree to the <a className="sx-link sx-link--soft" href="https://ohvara.com/terms" target="_blank" rel="noreferrer">Terms</a> and <a className="sx-link sx-link--soft" href="https://ohvara.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
      </AuCheck>
      <p className="pa-texts">Ohvara texts you about your account, leads and appointments. Message and data rates may apply. Reply STOP to opt out.</p>
    </>
  )
}
