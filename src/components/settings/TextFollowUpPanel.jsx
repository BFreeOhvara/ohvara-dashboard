import { useEffect, useState } from 'react'
import { MessageSquareText, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useUpdateOwnProfile } from '../../hooks/useSettings'
import { useRecoveryConfig, useUpdateRecoveryConfig } from '../../hooks/useRecoveryConfig'
import { Switch } from '../ui/Switch'
import { SettingsCard, SettingsChip } from '../agent/AgentUI'

// Prompt 696 — Settings → Text follow-up. The agent's one-time consent for
// the missed-call text flow (migration 122), plus, for an admin, the switch
// that turns texting on once an SMS-capable Twilio number is registered for
// A2P 10DLC and the morning / evening send times.
// Prompt 720 — restyled into the Settings section cards (Client contact);
// consent flow, admin switch and RPCs unchanged.

const timeInput = {
  display: 'block', width: 150, height: 44, marginTop: 8, boxSizing: 'border-box', padding: '0 12px', borderRadius: 12,
  font: 'inherit', fontSize: 15, color: 'var(--ov-hi)', outline: 'none',
}

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
    <>
      <SettingsCard icon={MessageSquareText} title="Text follow-up"
        sub="If a call ends with no answer, we text your client a link to pick another time."
        right={<SettingsChip tone={optedIn ? 'on' : 'off'}>{optedIn ? 'On' : 'Off'}</SettingsChip>}>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ov-soft)', lineHeight: 1.55 }}>
          First a note that a retry is already locked for the same time tomorrow, with a link to pick another time.
          If they still don't pick up, you confirm their number and we text them once more the next morning and
          evening, then hand it back to you to call.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 16, borderTop: '1px solid var(--ov-line)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>Text clients after a missed call</p>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--ov-mute)' }}>
              {optedIn ? 'On. You agreed to this once; turn it off any time.' : 'Off. Missed calls just show as No answer.'}
            </p>
          </div>
          <Switch checked={optedIn || confirming} disabled={update.isPending} onChange={toggle} />
        </div>

        {confirming && !optedIn && (
          <div className="ov-box" style={{ padding: 16, borderRadius: 14 }}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: 'var(--ov-hi)', lineHeight: 1.5 }}>
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ marginTop: 4 }} />
              I confirm my clients have agreed to receive text messages about their calls, and I'm turning this on for
              all my bookings.
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                type="button"
                className="ov-buy ov-set-btn"
                disabled={!agreed || update.isPending}
                onClick={() => setOptIn(true)}
              >
                Turn on
              </button>
              <button type="button" className="ov-ghost ov-set-btn" onClick={() => { setConfirming(false); setAgreed(false) }}>Cancel</button>
            </div>
          </div>
        )}

        {config && !live && (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ov-mute)', lineHeight: 1.5 }}>
            Texting starts for everyone once our SMS number is approved with carriers. Your choice is saved until then.
          </p>
        )}
      </SettingsCard>

      {profile.role === 'admin' && <AdminControls config={config} />}
    </>
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
    <SettingsCard icon={Clock} title="Admin: texting" sub="The company-wide switch and send times for text follow-up."
      right={<SettingsChip tone={config.sms_live ? 'on' : 'off'}>{config.sms_live ? 'Live' : 'Off'}</SettingsChip>}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>Texting live</p>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--ov-mute)' }}>
            Off: no lead enters the flow. Turn on only after the number is registered for A2P 10DLC.
          </p>
        </div>
        <Switch checked={!!config.sms_live} disabled={save.isPending} onChange={v => save.mutate({ sms_live: v })} />
      </div>
      {/* Prompt 751 — the pop-up phone's off switch (recovery_config.voice_live). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>Calling in the portal</p>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--ov-mute)' }}>
            Off: Call client works the old way and the portal phone opens as a preview. Turn on once Ohvara's number is approved and the Twilio app is set up.
          </p>
        </div>
        <Switch checked={!!config.voice_live} disabled={save.isPending} onChange={v => save.mutate({ voice_live: v })} />
      </div>
      {/* Prompt 764 — call recording (recovery_config.recording_live + the notice). */}
      <RecordingSetting config={config} save={save} />
      {/* Prompt 771 — when a call counts as missed by us, and when the apology text goes. */}
      <MissedSetting config={config} save={save} />

      <p className="ov-box" style={{ margin: 0, padding: '12px 14px', borderRadius: 14, fontSize: 13.5, color: 'var(--ov-soft)', display: 'flex', gap: 8, alignItems: 'flex-start', lineHeight: 1.5 }}>
        <MessageSquareText size={15} style={{ flexShrink: 0, marginTop: 2 }} /> {senderText}
      </p>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mid)' }}>
          Morning text
          <input type="time" className="ov-box" value={reminder} onChange={e => setDraft(d => ({ ...d, reminder: e.target.value }))} style={timeInput} />
        </label>
        <label style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mid)' }}>
          Evening text
          <input type="time" className="ov-box" value={evening} onChange={e => setDraft(d => ({ ...d, evening: e.target.value }))} style={timeInput} />
        </label>
        <button
          type="button"
          className="ov-buy ov-set-btn"
          disabled={!dirty || !reminder || !evening || save.isPending}
          onClick={() => save.mutate({ reminder_time: reminder, evening_time: evening }, { onSuccess: () => setDraft({}) })}
        >
          Save times
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ov-mute)' }}>
        Sent in each agent's own timezone. Applies to the morning reminder on the retry day and to both follow-up texts.
      </p>
    </SettingsCard>
  )
}

// Prompt 771 — a booked call the rep hasn't started this many minutes after
// its time is "missed by us": the retry is held and the rep gets a strike.
// The first apology text goes this many minutes after the miss (texting live
// only). Limits match the database checks (5–60, 0–120).
function MissedSetting({ config, save }) {
  const [draft, setDraft] = useState({})
  const grace = draft.grace ?? String(config.missed_grace_min ?? 10)
  const delay = draft.delay ?? String(config.missed_text_delay_min ?? 15)
  const g = Number(grace), d = Number(delay)
  const valid = Number.isInteger(g) && g >= 5 && g <= 60 && Number.isInteger(d) && d >= 0 && d <= 120
  const dirty = g !== config.missed_grace_min || d !== config.missed_text_delay_min
  const field = { ...timeInput, width: 96 }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>Missed calls</p>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--ov-mute)' }}>
          A call the rep hasn't started this long after its time is missed by us: a retry is held, the rep gets a strike and the client gets a sorry text.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mid)' }}>
          Missed after (min)
          <input type="number" inputMode="numeric" min={5} max={60} className="ov-box" value={grace}
            onChange={e => setDraft(x => ({ ...x, grace: e.target.value }))} style={field} />
        </label>
        <label style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mid)' }}>
          Sorry text after (min)
          <input type="number" inputMode="numeric" min={0} max={120} className="ov-box" value={delay}
            onChange={e => setDraft(x => ({ ...x, delay: e.target.value }))} style={field} />
        </label>
        <button
          type="button"
          className="ov-buy ov-set-btn"
          disabled={!dirty || !valid || save.isPending}
          onClick={() => save.mutate({ missed_grace_min: g, missed_text_delay_min: d }, { onSuccess: () => setDraft({}) })}
        >
          Save
        </button>
      </div>
      {!valid && <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>Missed after: 5 to 60. Sorry text: 0 to 120.</p>}
    </div>
  )
}

// Prompt 764 — record Fulfillment calls (the AI checks each cancel from the
// recording) and the notice each leg hears. Off by default; turn on only after
// checking the consent rules for the states Ohvara calls.
function RecordingSetting({ config, save }) {
  const [notice, setNotice] = useState(null)
  const value = notice ?? config.recording_notice ?? 'This call may be recorded.'
  const ok = value.trim().length >= 3 && value.trim().length <= 300
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>Record calls</p>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--ov-mute)' }}>
            Records every portal call so AI can check each cancel. Off: nothing is recorded, no notice plays, and cancels wait for you to listen. Check the consent rules for your states before turning it on.
          </p>
        </div>
        <Switch checked={!!config.recording_live} disabled={save.isPending} onChange={v => save.mutate({ recording_live: v })} />
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ flex: 1, minWidth: 220, fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mid)' }}>
          Recording notice (played to the client and the carrier)
          <input className="ov-box" value={value} maxLength={300} onChange={e => setNotice(e.target.value)}
            style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 6, height: 40, padding: '0 12px', borderRadius: 12, font: 'inherit', fontWeight: 500, color: 'var(--ov-hi)' }} />
        </label>
        <button type="button" className="ov-buy ov-set-btn" disabled={notice == null || !ok || save.isPending}
          onClick={() => save.mutate({ recording_notice: value.trim() }, { onSuccess: () => setNotice(null) })}>
          Save notice
        </button>
      </div>
    </>
  )
}
