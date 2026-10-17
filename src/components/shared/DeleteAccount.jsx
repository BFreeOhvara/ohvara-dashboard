import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X, Trash2, Loader2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useDeleteAccount } from '../../hooks/useAccount'

// Prompt 775 — Delete my account, in the app and on the website (Apple
// guideline 5.1.1(v)). Type DELETE, press the button; the delete-account
// function cancels an agent's plan, removes the login and personal details,
// and keeps only the records the law makes us keep (pay records for tax
// forms, call recordings for their retention time) under an anonymous id.
// What's deleted vs kept: brain/Account Deletion.md in the vault.
// Admins can't delete themselves here (another admin removes an admin).

const KEPT = {
  agent: 'Your plan is cancelled right away. Bookings you made stay on the calls Fulfillment already handled, without your name.',
  fulfillment: 'Pay records stay for tax forms (1099s) and call recordings stay until they expire, without your name.',
}

export function DeleteAccountDialog({ onClose }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const del = useDeleteAccount()
  const [text, setText] = useState('')
  const field = useRef(null)
  const admin = profile?.role === 'admin'
  const ready = text.trim() === 'DELETE' && !del.isPending

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !del.isPending) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, del.isPending])

  useEffect(() => { if (!admin) field.current?.focus({ preventScroll: true }) }, [admin])

  function submit(e) {
    e.preventDefault()
    if (!ready) return
    del.mutate('DELETE', {
      onSuccess: async () => {
        // Sign-in shows "Your account was deleted" once (a query string would
        // be lost to the signed-out redirect).
        try { sessionStorage.setItem('ohvara-deleted', '1') } catch { /* private mode */ }
        await signOut().catch(() => {})
        navigate('/login', { replace: true })
      },
    })
  }

  return createPortal(
    <>
      <div className="ov-scrim" onClick={() => !del.isPending && onClose()} aria-hidden="true" />
      <div className="ov-invite-wrap" onClick={e => { if (e.target === e.currentTarget && !del.isPending) onClose() }}>
        <form className="ov-card ov-invite" role="dialog" aria-modal="true" aria-labelledby="del-title" onSubmit={submit} noValidate>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h2 id="del-title" className="ov-invite-title">Delete my account</h2>
              <p className="ov-invite-sub">
                {admin
                  ? 'Admin accounts can’t be deleted from here. Ask another admin to remove yours from People.'
                  : 'This can’t be undone. Your login, name, phone, email, photo, messages and settings are deleted, and you’re signed out everywhere.'}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="ov-invite-x" disabled={del.isPending}>
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          {!admin && (
            <>
              {KEPT[profile?.role] && (
                <div className="ov-note ov-invite-note"><p style={{ margin: 0 }}>{KEPT[profile.role]}</p></div>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className="ov-invite-label">Type DELETE to confirm</span>
                <span className="ov-input ov-invite-field">
                  <input
                    ref={field} value={text} onChange={e => { del.reset(); setText(e.target.value) }}
                    autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="DELETE"
                    disabled={del.isPending} aria-describedby={del.error ? 'del-err' : undefined}
                  />
                </span>
              </label>
              {del.error && <p id="del-err" role="alert" style={{ margin: 0, fontSize: 13.5, color: 'var(--ov-live)' }}>{del.error.message}</p>}
            </>
          )}

          <div className="ov-invite-actions">
            <button type="button" className="ov-ghost ov-invite-btn" onClick={onClose} disabled={del.isPending}>{admin ? 'Close' : 'Keep my account'}</button>
            {!admin && (
              <button type="submit" className="ov-invite-btn" disabled={!ready} aria-disabled={!ready}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: 'none', borderRadius: 999, fontWeight: 700, padding: '0 22px', cursor: ready ? 'pointer' : 'not-allowed', background: 'var(--ov-live)', color: 'var(--ov-on-kind)', opacity: ready ? 1 : 0.45 }}>
                {del.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} strokeWidth={2.2} aria-hidden="true" />}
                {del.isPending ? 'Deleting…' : 'Delete my account'}
              </button>
            )}
          </div>
        </form>
      </div>
    </>,
    document.body,
  )
}
