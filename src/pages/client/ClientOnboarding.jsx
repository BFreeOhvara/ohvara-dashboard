import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, Loader2 } from 'lucide-react'
import { useMyClient, useMyOnboarding, useSubmitOnboarding } from '../../hooks/useClientPortal'
import ohvaraLogo from '../../assets/ohvara-logo.png'

// Ported from the standalone ohvara-client-portal's Onboarding.jsx — same
// one-question-at-a-time flow, restyled onto this app's design tokens
// (dark purple-indigo theme) instead of hardcoded hex. No clientId URL param:
// the client is matched via their own login (clients.profile_id = auth.uid()),
// fixing the old "anon-key-by-UUID reads return nothing under RLS" gap.
export default function ClientOnboarding() {
  const navigate = useNavigate()
  const { data: client, isLoading: clientLoading } = useMyClient()
  const { data: onboarding, isLoading: obLoading } = useMyOnboarding(client?.id)
  const submit = useSubmitOnboarding()
  const [answers, setAnswers] = useState({})
  const [step, setStep] = useState(0)

  const loading = clientLoading || obLoading

  if (loading) {
    return <Centered><Loader size={14} /> Loading your setup…</Centered>
  }

  if (!client || !onboarding) {
    return <Centered error>Couldn't load your onboarding — contact brayden@ohvara.com</Centered>
  }

  if (onboarding.status === 'completed') {
    return (
      <Centered>
        <SuccessCard clientName={client.business_name} onContinue={() => navigate('/client')} />
      </Centered>
    )
  }

  const questions = onboarding.questions || []
  const q = questions[step]
  if (!q) return <Centered error>No onboarding questions found — contact brayden@ohvara.com</Centered>

  function setAnswer(id, val) {
    setAnswers(prev => ({ ...prev, [id]: val }))
  }

  function canAdvance() {
    if (!q.required) return true
    const val = answers[q.id]
    return val && String(val).trim().length > 0
  }

  async function handleNext() {
    if (step < questions.length - 1) {
      setStep(s => s + 1)
      return
    }
    await submit.mutateAsync({ clientId: client.id, answers: { ...answers, business_name: client.business_name } })
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && canAdvance()) {
      e.preventDefault()
      handleNext()
    }
  }

  const progress = (step + 1) / questions.length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 20px' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <Brand name={client.business_name} />

        <div style={{ height: 3, background: 'var(--bg-elevated)', borderRadius: 2, marginBottom: 6 }}>
          <div style={{ height: '100%', width: `${progress * 100}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 0.3s ease' }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', marginBottom: 32, fontFamily: 'var(--font-mono)' }}>
          {step + 1} of {questions.length}
        </div>

        <div key={step} style={{ animation: 'fadeIn 0.2s ease' }}>
          <p style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 28 }}>
            {q.question}
          </p>

          {q.type === 'select' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} role="group">
              {(q.options || []).map(opt => {
                const selected = answers[q.id] === opt
                return (
                  <div
                    key={opt}
                    role="button"
                    tabIndex={0}
                    onClick={() => setAnswer(q.id, opt)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setAnswer(q.id, opt) }}
                    style={{
                      display: 'flex', alignItems: 'center', padding: '14px 16px',
                      background: selected ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                      border: `0.5px solid ${selected ? 'var(--accent-border)' : 'var(--border)'}`,
                      borderRadius: 10, cursor: 'pointer', fontSize: 15,
                      color: selected ? 'var(--accent)' : 'var(--text-primary)',
                      transition: 'all 0.12s',
                    }}
                  >
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginRight: 12,
                      border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                      background: selected ? 'var(--accent)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {selected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                    </span>
                    {opt}
                  </div>
                )
              })}
            </div>
          ) : q.type === 'textarea' ? (
            <textarea
              autoFocus
              value={answers[q.id] || ''}
              onChange={e => setAnswer(q.id, e.target.value)}
              placeholder="Type your answer…"
              style={{
                width: '100%', boxSizing: 'border-box', background: 'var(--bg-elevated)',
                border: '0.5px solid var(--border)', borderRadius: 12, padding: 16,
                fontSize: 16, color: 'var(--text-primary)', outline: 'none', resize: 'none', minHeight: 120,
                fontFamily: 'inherit',
              }}
            />
          ) : (
            <input
              autoFocus
              type={q.type === 'phone' ? 'tel' : q.type === 'email' ? 'email' : q.type === 'number' ? 'number' : 'text'}
              value={answers[q.id] || ''}
              onChange={e => setAnswer(q.id, e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your answer…"
              style={{
                width: '100%', boxSizing: 'border-box', height: 54, background: 'var(--bg-elevated)',
                border: '0.5px solid var(--border)', borderRadius: 12, padding: '0 16px',
                fontSize: 16, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit',
              }}
            />
          )}
        </div>

        <button
          onClick={handleNext}
          disabled={!canAdvance() || submit.isPending}
          style={{
            width: '100%', height: 52, marginTop: 20,
            background: (!canAdvance() || submit.isPending) ? 'var(--accent-dim)' : 'var(--accent)',
            color: (!canAdvance() || submit.isPending) ? 'var(--text-muted)' : '#fff',
            border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 500,
            cursor: (!canAdvance() || submit.isPending) ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          {submit.isPending ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Setting up…</> : step === questions.length - 1 ? "Let's go →" : 'Next →'}
        </button>

        {!q.required && (
          <button
            onClick={handleNext}
            style={{ width: '100%', height: 36, marginTop: 8, background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}
          >
            Skip for now
          </button>
        )}
      </div>

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}

function Brand({ name }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
      <img
        src={ohvaraLogo}
        alt="Ohvara"
        style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }}
      />
      {name && <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{name}</span>}
    </div>
  )
}

function Loader({ size }) {
  return <Loader2 size={size} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />
}

function Centered({ children, error }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <p style={{ fontSize: 14, color: error ? 'var(--danger)' : 'var(--text-muted)', textAlign: 'center', display: 'flex', alignItems: 'center' }}>
        {children}
      </p>
    </div>
  )
}

function SuccessCard({ clientName, onContinue }) {
  return (
    <div style={{ textAlign: 'center', maxWidth: 380 }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%', background: 'var(--success-dim)',
        border: '0.5px solid rgba(34,197,94,0.25)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', margin: '0 auto 20px',
      }}>
        <CheckCircle size={28} style={{ color: 'var(--success)' }} />
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>You're all set!</h1>
      <p style={{ fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
        {clientName ? `${clientName}'s` : 'Your'} AI receptionist is being built now. We'll notify you as soon as your number is ready.
      </p>
      <button
        onClick={onContinue}
        style={{ height: 44, padding: '0 24px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
      >
        Go to your dashboard →
      </button>
    </div>
  )
}
