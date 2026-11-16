import { useState } from 'react'
import { ArrowRight, Loader2, User } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { joinName } from '../../lib/personName'
import { AuthPage, AuField, AuAlert } from './AuthShell'
import { keepSubmitVisible } from './authUtils'

// P1024 (Brayden, Nov 16): everyone has a first and last name, and nobody is shown by email. An account that signed
// up without one (older sign-ups, a Google / Apple account with no name) sees this once, at its next sign-in, before
// anything else opens. Saving writes profiles.full_name (the person's own row, the same write Settings makes).
export function NamePrompt() {
  const { profile, refreshProfile, signOut } = useAuth()
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save(e) {
    e?.preventDefault()
    if (!first.trim() || !last.trim()) return setError('Type your first and last name.')
    const name = joinName(first, last)
    if (name.includes('@')) return setError('Type your name, not an email address.')
    setError('')
    setSaving(true)
    const { error: err } = await supabase.from('profiles').update({ full_name: name }).eq('id', profile.id)
    if (err) { setSaving(false); return setError('Couldn’t save your name. Try again.') }
    await refreshProfile()
  }

  return (
    <AuthPage left={null}>
      <section className="sx-card" aria-label="Your name">
        <form onSubmit={save} onFocus={keepSubmitVisible} noValidate>
          <h2>What’s your name?</h2>
          <p className="sx-card-sub">Your team sees you by name. Add your first and last name to go on.</p>
          {error && <AuAlert>{error}</AuAlert>}
          <div className="sx-two">
            <AuField first label="First name" icon={User} name="given-name" autoComplete="given-name" autoCapitalize="words" autoFocus
              value={first} onChange={e => setFirst(e.target.value)} placeholder="First name" error={!!error && !first.trim()} />
            <AuField first label="Last name" icon={User} name="family-name" autoComplete="family-name" autoCapitalize="words"
              value={last} onChange={e => setLast(e.target.value)} placeholder="Last name" error={!!error && !last.trim()} />
          </div>
          <button type="submit" className="sx-btn" style={{ marginTop: 16 }} disabled={saving}>
            {saving ? <><Loader2 size={18} className="animate-spin" />Saving…</> : <>Continue<ArrowRight size={17} strokeWidth={2.4} /></>}
          </button>
          <div className="sx-center-note"><button type="button" className="sx-link sx-link--soft" onClick={signOut} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>Sign out</button></div>
        </form>
      </section>
    </AuthPage>
  )
}
