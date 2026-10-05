import { useEffect, useState } from 'react'
import { MessageSquareText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useUpdateOwnProfile } from '../../hooks/useSettings'
import { useRecoveryConfig, useUpdateRecoveryConfig } from '../../hooks/useRecoveryConfig'
import { Switch } from '../ui/Switch'
import { card, cardTitle, control, primaryBtn, ghostBtn } from '../../lib/exportStyles'

// Prompt 696 — Settings → Text follow-up. The agent's one-time consent for
// the missed-call text flow (migration 122), plus, for an admin, the switch
// that turns texting on once an SMS-capable Twilio number is registered for
// A2P 10DLC and the morning / evening send times.

const hhmm = t => (t || '').slice(0, 5)

export function TextFollowUpPanel({ profile }) {
  const { refreshProfile } = useAuth()
  const update = useUpdateOwnProfile()
  const { data: config } = useRecoveryConfig()
  const [confirming, setConfirming] = useState(false)
  const [agreed, setAgreed] = useState(false)

  const optedIn = !!profile.no_answer_sms_opt_in
  const live = !!config?.sms_live

  async function setOptIn(next) {
    await update.mutateAsync({ profileId: profile.id, updates: { no_answer_sms_opt_in: next } })
    await refreshProfile()
    setConfirming(false); setAgreed(false)
  }

  function toggle(next) {
    if (next) { setConfirming(true); return }
    if (confirming) { setConfirming(false); setAgreed(false); return }
    setOptIn(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card }}>
        <p style={cardTitle}>Text follow-up</p>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          When a call to one of your clients ends with no answer, we can text them: first a note that a retry is
          already locked for the same time tomorrow, with a link to pick another time. If they still don't pick up,
          you confirm their number and we text them once more the next morning and evening, then hand it back to you
          to call.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: 'var(--border-w) solid var(--border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Text clients after a missed call</p>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
              {optedIn ? 'On. You agreed to this once; turn it off any time.' : 'Off. Missed calls just show as No answer.'}
            </p>
          </div>
          <Switch checked={optedIn || confirming} disabled={update.isPending} onChange={toggle} />
        </div>

        {confirming && !optedIn && (
          <div style={{ padding: 16, borderRadius: 10, border: 'var(--border-w) solid var(--border)', background: 'var(--bg-base)' }}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5 }}>
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ marginTop: 4 }} />
              I confirm my clients have agreed to receive text messages about their calls, and I'm turning this on for
              all my bookings.
            </label>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                disabled={!agreed || update.isPending}
                onClick={() => setOptIn(true)}
                style={{ ...primaryBtn, opacity: !agreed || update.isPending ? 0.5 : 1 }}
              >
                Turn on
              </button>
              <button onClick={() => { setConfirming(false); setAgreed(false) }} style={{ ...ghostBtn, height: 40 }}>Cancel</button>
            </div>
          </div>
        )}

        {config && !live && (
          <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Texting isn't switched on for Ohvara yet. It starts once our SMS number is approved with carriers.
            Your choice is saved and takes effect then.
          </p>
        )}
      </div>

      {profile.role === 'admin' && <AdminControls config={config} />}
    </div>
  )
}

function AdminControls({ config }) {
  const save = useUpdateRecoveryConfig()
  // Edits live in `draft` until saved; untouched fields read straight from config.
  const [draft, setDraft] = useState({})
  const [sender, setSender] = useState(null)

  useEffect(() => {
    supabase.functions.invoke('recovery-sms', { body: { action: 'status' } })
      .then(({ data, error }) => setSender(error ? { error: true } : data))
      .catch(() => setSender({ error: true }))
  }, [])

  if (!config) return null
  const reminder = draft.reminder ?? hhmm(config.reminder_time)
  const evening = draft.evening ?? hhmm(config.evening_time)
  const dirty = reminder !== hhmm(config.reminder_time) || evening !== hhmm(config.evening_time)

  const senderText = !sender ? 'Checking the sending number…'
    : sender.error ? "Couldn't check the sending number."
      : !sender.configured ? `No sending number set (missing: ${(sender.missing || []).join(', ')}). Set RECOVERY_TWILIO_FROM_NUMBER, or the Caller ID number, in Supabase secrets.`
        : sender.owned === false ? `${sender.from} is a verified caller ID, not a Twilio number we own, so it can't send texts. Buy an SMS-capable number.`
          : sender.sms_capable === false ? `${sender.from} can't send texts. Use an SMS-capable number.`
            : sender.sms_capable ? `${sender.from} can send texts. It still needs A2P 10DLC registration before carriers will deliver them.`
              : `Couldn't confirm ${sender.from} can send texts.`

  return (
    <div style={{ ...card }}>
      <p style={cardTitle}>Admin: texting</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 0 14px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Texting live</p>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
            Off: no lead enters the flow. Turn on only after the number is registered for A2P 10DLC.
          </p>
        </div>
        <Switch checked={!!config.sms_live} disabled={save.isPending} onChange={v => save.mutate({ sms_live: v })} />
      </div>

      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 8, alignItems: 'flex-start', lineHeight: 1.5 }}>
        <MessageSquareText size={15} style={{ flexShrink: 0, marginTop: 2 }} /> {senderText}
      </p>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Morning text
          <input type="time" value={reminder} onChange={e => setDraft(d => ({ ...d, reminder: e.target.value }))} style={{ ...control, width: 140, marginTop: 6, display: 'block' }} />
        </label>
        <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Evening text
          <input type="time" value={evening} onChange={e => setDraft(d => ({ ...d, evening: e.target.value }))} style={{ ...control, width: 140, marginTop: 6, display: 'block' }} />
        </label>
        <button
          disabled={!dirty || !reminder || !evening || save.isPending}
          onClick={() => save.mutate({ reminder_time: reminder, evening_time: evening }, { onSuccess: () => setDraft({}) })}
          style={{ ...primaryBtn, opacity: !dirty || save.isPending ? 0.5 : 1 }}
        >
          Save times
        </button>
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
        Sent in each agent's own timezone. Applies to the morning reminder on the retry day and to both follow-up texts.
      </p>
    </div>
  )
}
