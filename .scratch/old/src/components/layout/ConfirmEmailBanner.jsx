import { useState } from 'react'
import { MailWarning, Loader2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'

// Prompt 781 — shown in the portal until a text-invite account clicks the
// link in its "Confirm your email" mail (profiles.email_confirm_pending).
// Until then Forgot password won't mail that address.
export function ConfirmEmailBanner() {
  const { profile, session } = useAuth()
  const [state, setState] = useState({ busy: false, msg: '' })
  if (!profile?.email_confirm_pending) return null

  async function resend() {
    setState({ busy: true, msg: '' })
    const { data, error } = await supabase.functions.invoke('account-email', { body: { action: 'resend' } })
    let msg = 'Sent. Check your inbox.'
    if (error) {
      msg = 'Couldn’t send that. Try again.'
      try { msg = (await error.context?.json())?.error || msg } catch { /* keep */ }
    } else if (data?.already) msg = 'Your email is already confirmed.'
    setState({ busy: false, msg })
  }

  return (
    <div className="ov-confirm-banner" role="status">
      <MailWarning size={18} strokeWidth={2} aria-hidden="true" style={{ flex: 'none' }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong>Confirm your email.</strong> We sent a link to <span style={{ overflowWrap: 'anywhere' }}>{session?.user?.email}</span>. Password resets only work once it’s confirmed.
        {state.msg && <span aria-live="polite"> {state.msg}</span>}
      </span>
      <button type="button" className="ov-ghost ov-set-btn" onClick={resend} disabled={state.busy} style={{ flex: 'none' }}>
        {state.busy ? <Loader2 size={15} className="animate-spin" /> : 'Send again'}
      </button>
    </div>
  )
}
