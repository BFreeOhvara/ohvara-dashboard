import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

// Public mortgage-protection qualifier — /mp, no login. Three short steps,
// then a thank-you. Posts to the submit-mp-lead edge function (utm_* read from
// the URL). It qualifies and routes; it never quotes rates, coverage or
// approval, and it promises no call or text date.
//
// Copy is a first draft; swap for Milo's ohvara/leads/landing-copy.md and
// Dot's mockup when they land in the repo.

// The consent wording version the server accepts (submit-mp-lead core.ts).
// CONSENT_TEXT is pending door: the legal wording is Brayden's lawyer side.
const CONSENT_VERSION = 'mp-v1'

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']

const BALANCE = ['Under $100k', '$100k–$200k', '$200k–$350k', '$350k–$500k', 'Over $500k']
const AGES = ['18–29', '30–39', '40–49', '50–59', '60–69', '70+']
const TIMES = ['Morning', 'Afternoon', 'Evening']
const STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY']

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// 10 digits (a leading 1 is dropped) → +1XXXXXXXXXX, or null when it can't be US.
function toE164(raw) {
  let d = raw.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') d = d.slice(1)
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? `+1${d}` : null
}

const field = 'w-full min-w-0 box-border rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-3 text-[16px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]'
const label = 'block text-[var(--text-sm)] font-semibold text-[var(--text-secondary)] mb-1.5'
const errText = 'mt-1.5 text-[var(--text-sm)] text-[var(--danger)]'

function Choice({ selected, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`min-w-0 rounded-[var(--radius-lg)] border px-3 py-3 text-[15px] font-semibold text-left transition-colors ${
        selected
          ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--text-primary)]'
          : 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]'
      }`}
    >
      {children}
    </button>
  )
}

function Group({ legend, error, children, cols = 2 }) {
  return (
    <fieldset className="border-0 p-0 m-0 mb-5 min-w-0">
      <legend className={label}>{legend}</legend>
      <div className={`grid gap-2 ${cols === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>{children}</div>
      {error && <p className={errText} role="alert">{error}</p>}
    </fieldset>
  )
}

// Placeholder only. The real consent wording is the door's (legal); this block
// must be replaced before the page goes live. The checkbox still has to be
// ticked so the flow can be tested end to end.
function ConsentPlaceholder({ checked, onChange, error }) {
  return (
    <div className="mb-5">
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--warning-bd)] bg-[var(--warning-dim)] p-3">
        <p className="m-0 text-[var(--text-xs)] font-bold uppercase tracking-wide text-[var(--warning)]">CONSENT_TEXT pending door</p>
        <p className="m-0 mt-1 text-[var(--text-sm)] text-[var(--text-secondary)]">
          Placeholder. Legal consent wording goes here once it is approved. Not live text.
        </p>
      </div>
      <label className="mt-3 flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
        />
        <span className="text-[var(--text-sm)] text-[var(--text-secondary)]">[Consent checkbox label pending door]</span>
      </label>
      {error && <p className={errText} role="alert">{error}</p>}
    </div>
  )
}

export default function MortgageProtection() {
  const [search] = useSearchParams()
  const utm = useMemo(() => Object.fromEntries(UTM_KEYS.map(k => [k, (search.get(k) || '').slice(0, 200) || null])), [search])

  const [step, setStep] = useState(0)
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const [errors, setErrors] = useState({})
  const [f, setF] = useState({
    homeowner: null, balance: '', age: '', smoker: null, state: '',
    first: '', last: '', phone: '', email: '', time: '', consent: false, website: '',
  })
  const top = useRef(null)

  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })) }

  function check(s) {
    const e = {}
    if (s === 0) {
      if (f.homeowner === null) e.homeowner = 'Pick one'
      if (!f.balance) e.balance = 'Pick one'
    } else if (s === 1) {
      if (!f.age) e.age = 'Pick one'
      if (f.smoker === null) e.smoker = 'Pick one'
      if (!f.state) e.state = 'Pick your state'
    } else {
      if (!f.first.trim()) e.first = 'Enter your first name'
      if (!toE164(f.phone)) e.phone = 'Enter a valid US mobile number'
      if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email or leave it blank'
      if (!f.consent) e.consent = 'Please agree to be contacted'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const go = n => { setStep(n); setServerError(''); top.current?.scrollIntoView({ block: 'start' }) }

  function next() { if (check(step)) go(step + 1) }

  async function submit(e) {
    e.preventDefault()
    if (!check(2)) return
    setSubmitting(true)
    setServerError('')
    try {
      const { data, error } = await supabase.functions.invoke('submit-mp-lead', {
        body: {
          first_name: f.first.trim(),
          last_name: f.last.trim() || null,
          phone: toE164(f.phone),
          email: f.email.trim() || null,
          state: f.state,
          age_band: f.age,
          mortgage_balance_band: f.balance,
          homeowner: f.homeowner,
          smoker: f.smoker,
          best_time: f.time || null,
          consent: true,
          consent_text_version: CONSENT_VERSION,
          website: f.website,
          ...utm,
        },
      })
      if (error) {
        let msg = 'Something went wrong. Try again.'
        try { const b = await error.context?.json(); if (b?.error) msg = b.error } catch { /* keep generic */ }
        throw new Error(msg)
      }
      if (data?.error) throw new Error(data.error)
      setDone(true)
      top.current?.scrollIntoView({ block: 'start' })
    } catch (err) {
      setServerError(err.message || 'Something went wrong. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const yesNo = (k, a = 'Yes', b = 'No') => (
    <>
      <Choice selected={f[k] === true} onClick={() => set(k, true)}>{a}</Choice>
      <Choice selected={f[k] === false} onClick={() => set(k, false)}>{b}</Choice>
    </>
  )

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[var(--bg-base)] text-[var(--text-primary)] font-[family-name:var(--font-sans)]">
      <main className="mx-auto w-full max-w-[480px] box-border px-4 py-6">
        <div ref={top} />
        {done ? (
          <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-6 text-center">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--success-bd)] bg-[var(--success-dim)] text-[var(--success)]">
              <Check size={24} strokeWidth={2.4} aria-hidden="true" />
            </span>
            <h1 className="m-0 font-[family-name:var(--font-display)] text-[24px] font-bold">Thanks, {f.first.trim()}</h1>
            <p className="mt-2 mb-0 text-[var(--text-base)] text-[var(--text-secondary)]">
              We got your answers. [Next-step line pending: confirm with Brayden.]
            </p>
          </section>
        ) : (
          <form onSubmit={submit} noValidate className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
            <p className="m-0 text-[var(--text-xs)] font-bold uppercase tracking-wide text-[var(--text-muted)]">
              Step {step + 1} of 3
            </p>
            <div className="mt-2 mb-4 flex gap-1.5" aria-hidden="true">
              {[0, 1, 2].map(i => (
                <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-[var(--accent)]' : 'bg-[var(--bg-muted)]'}`} />
              ))}
            </div>
            <h1 className="m-0 mb-1 font-[family-name:var(--font-display)] text-[22px] font-bold leading-tight">
              {['Mortgage protection', 'A little about you', 'How do we reach you?'][step]}
            </h1>
            <p className="m-0 mb-5 text-[var(--text-base)] text-[var(--text-secondary)]">
              {['Two quick questions about your home.', 'Three quick ones.', 'Last step.'][step]}
            </p>

            {step === 0 && (
              <>
                <Group legend="Do you own your home?" error={errors.homeowner}>{yesNo('homeowner')}</Group>
                <Group legend="About how much is left on your mortgage?" error={errors.balance}>
                  {BALANCE.map(b => <Choice key={b} selected={f.balance === b} onClick={() => set('balance', b)}>{b}</Choice>)}
                </Group>
              </>
            )}

            {step === 1 && (
              <>
                <Group legend="Which age range are you in?" cols={3} error={errors.age}>
                  {AGES.map(a => <Choice key={a} selected={f.age === a} onClick={() => set('age', a)}>{a}</Choice>)}
                </Group>
                <Group legend="Do you smoke or use tobacco?" error={errors.smoker}>{yesNo('smoker')}</Group>
                <div className="mb-5">
                  <label htmlFor="mp-state" className={label}>Which state do you live in?</label>
                  <select id="mp-state" value={f.state} onChange={e => set('state', e.target.value)} className={field}>
                    <option value="">Pick your state</option>
                    {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {errors.state && <p className={errText} role="alert">{errors.state}</p>}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="mb-4">
                  <label htmlFor="mp-first" className={label}>First name</label>
                  <input id="mp-first" value={f.first} onChange={e => set('first', e.target.value)} autoComplete="given-name" className={field} />
                  {errors.first && <p className={errText} role="alert">{errors.first}</p>}
                </div>
                <div className="mb-4">
                  <label htmlFor="mp-last" className={label}>Last name (optional)</label>
                  <input id="mp-last" value={f.last} onChange={e => set('last', e.target.value)} autoComplete="family-name" className={field} />
                </div>
                <div className="mb-4">
                  <label htmlFor="mp-phone" className={label}>Mobile number</label>
                  <input id="mp-phone" type="tel" inputMode="tel" value={f.phone} onChange={e => set('phone', e.target.value)} autoComplete="tel" placeholder="(555) 555-5555" className={field} />
                  {errors.phone && <p className={errText} role="alert">{errors.phone}</p>}
                </div>
                <div className="mb-4">
                  <label htmlFor="mp-email" className={label}>Email (optional)</label>
                  <input id="mp-email" type="email" inputMode="email" value={f.email} onChange={e => set('email', e.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false} className={field} />
                  {errors.email && <p className={errText} role="alert">{errors.email}</p>}
                </div>
                <Group legend="Best time to reach you? (optional)" cols={3}>
                  {TIMES.map(t => <Choice key={t} selected={f.time === t} onClick={() => set('time', f.time === t ? '' : t)}>{t}</Choice>)}
                </Group>
                {/* Honeypot: hidden from people, bots fill it. */}
                <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                  <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={e => set('website', e.target.value)} /></label>
                </div>
                <ConsentPlaceholder checked={f.consent} onChange={v => set('consent', v)} error={errors.consent} />
                {serverError && <p className={`${errText} mb-3`} role="alert">{serverError}</p>}
              </>
            )}

            <div className="flex gap-2">
              {step > 0 && (
                <button type="button" onClick={() => go(step - 1)} disabled={submitting}
                  className="flex items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-transparent px-4 py-3 text-[15px] font-semibold text-[var(--text-secondary)]">
                  <ArrowLeft size={16} aria-hidden="true" />Back
                </button>
              )}
              {step < 2 ? (
                <button type="button" onClick={next}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border-0 bg-[var(--accent)] px-4 py-3 text-[15px] font-bold text-[var(--bg-base)]">
                  Next<ArrowRight size={16} aria-hidden="true" />
                </button>
              ) : (
                <button type="submit" disabled={submitting}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border-0 bg-[var(--accent)] px-4 py-3 text-[15px] font-bold text-[var(--bg-base)] disabled:opacity-60">
                  {submitting ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" />Sending…</> : 'Submit'}
                </button>
              )}
            </div>
          </form>
        )}
      </main>
    </div>
  )
}
