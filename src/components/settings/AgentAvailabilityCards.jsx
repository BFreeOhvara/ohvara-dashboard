import { useState } from 'react'
import { Clock, PhoneIncoming, UserCheck, Phone, Check, Loader2 } from 'lucide-react'
import { useAgentSettings, useSaveAgentSettings } from '../../hooks/useAgentSettings'
import {
  WEEKDAYS, setDay, validateWeek, weekChanged, hoursPayload, phonePayload, defaultPayload,
  normalizePhone, timeOptions, saveErrorText, zoneLabel,
} from '../../lib/agentSettings'
import { formatUsPhone } from '../../lib/callerId'
import { Switch } from '../ui/Switch'
import { SettingsCard, SettingsChip, OvField, OvSelect } from '../agent/AgentUI'

// Settings → Client contact, agents only: working hours, live-transfer phone and on-duty default
// (migration 197, my_agent_settings / save_my_agent_settings). Each card saves only its own setting.
// None of them changes who is called, when, or what clients see yet: booking and live transfers
// don't read these, and each card says so. Nothing here sends anything, and the Active switch
// above (DutyCard) is untouched. While the functions aren't in the database the cards say
// Coming soon.

const errText = { margin: 0, fontSize: 13.5, color: 'var(--danger)' }
const note = { margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--ov-mute)' }
const rowLine = { borderTop: '1px solid var(--ov-line)' }

function Saved() {
  return (
    <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, color: 'var(--ov-st-cancelled)' }}>
      <Check size={15} strokeWidth={2.4} /> Saved
    </span>
  )
}

function SaveButton({ saving, disabled, onClick, cls = '' }) {
  return (
    <button type="button" className={`ov-buy ov-set-btn ${cls}`} onClick={onClick} disabled={disabled || saving}>
      {saving ? <Loader2 size={15} className="animate-spin" /> : 'Save'}
    </button>
  )
}

// What a card shows in place of its body until settings have loaded.
function Waiting({ s }) {
  if (s.soon) return null // the card's Coming soon chip says it
  if (s.failed) return <p role="alert" style={errText}>Couldn’t load your settings. Refresh to try again.</p>
  return <p style={{ ...note, fontSize: 14 }}>Loading…</p>
}

function useSavedFlash() {
  const [saved, setSaved] = useState(false)
  return [saved, () => { setSaved(true); setTimeout(() => setSaved(false), 2000) }, () => setSaved(false)]
}

export function AgentAvailabilityCards() {
  const s = useAgentSettings()
  return (
    <>
      <HoursCard s={s} />
      <PhoneCard s={s} />
      <DefaultCard s={s} />
    </>
  )
}

// ── Working hours ───────────────────────────────────────────────────────────
function HoursCard({ s }) {
  const ready = !!s.data
  const [draft, setDraft] = useState(null)   // null = nothing edited, show what the server has
  const [problem, setProblem] = useState('')
  const [saved, flash, unflash] = useSavedFlash()
  const m = useSaveAgentSettings()
  const week = draft ?? s.data?.week
  const dirty = ready && !!draft && weekChanged(draft, s.data.week)
  const zone = zoneLabel(s.data?.timezone)

  function edit(weekday, patch) {
    setProblem(''); unflash(); m.reset()
    setDraft(setDay(week, weekday, patch))
  }

  function save() {
    const bad = validateWeek(week)
    if (bad) return setProblem(bad)
    setProblem('')
    m.save(hoursPayload(week), { onSuccess: () => { setDraft(null); flash() } })
  }

  return (
    <SettingsCard icon={Clock} label="Working hours"
      title={<>Working hours{ready && <span style={{ display: 'block', marginTop: 2, fontSize: 13.5, fontWeight: 500, letterSpacing: 0, color: 'var(--ov-mute)' }}>{zone}</span>}</>}
      right={s.soon ? <SettingsChip>Coming soon</SettingsChip> : ready && <SaveButton cls="ov-hours-save" saving={m.saving} disabled={!dirty} onClick={save} />}>
      <p style={{ ...note, fontSize: 13.5 }}>Your usual week. Saved for when booking uses your hours. Booking doesn’t use them yet.</p>
      {!ready ? <Waiting s={s} /> : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {WEEKDAYS.map((d, i) => {
            const day = week[i]
            return (
              <div key={d.weekday} className="ov-hours-row" style={i ? rowLine : undefined}>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: day.open ? 'var(--ov-hi)' : 'var(--ov-mute)' }}>{d.short}</span>
                <Switch checked={day.open} onChange={on => edit(d.weekday, { open: on })} label={`${d.long}: open`} />
                {day.open ? (
                  <>
                    <OvSelect value={day.start} onChange={v => edit(d.weekday, { start: v })} options={timeOptions('start', day.start)}
                      aria-label={`${d.long} start time`} placement="auto" />
                    <span style={{ fontSize: 13, color: 'var(--ov-mute)' }}>to</span>
                    <OvSelect value={day.end} onChange={v => edit(d.weekday, { end: v })} options={timeOptions('end', day.end)}
                      aria-label={`${d.long} end time`} placement="auto" />
                  </>
                ) : (
                  <span style={{ gridColumn: '3 / -1', fontSize: 13.5, color: 'var(--ov-mute)' }}>Closed</span>
                )}
              </div>
            )
          })}
        </div>
      )}
      {(problem || m.error) && <p role="alert" style={errText}>{problem || saveErrorText(m.error)}</p>}
      {saved && <Saved />}
    </SettingsCard>
  )
}

// ── Live-transfer phone ─────────────────────────────────────────────────────
function PhoneCard({ s }) {
  const ready = !!s.data
  const [draft, setDraft] = useState(null)   // null = show the saved number
  const [problem, setProblem] = useState('')
  const [saved, flash, unflash] = useSavedFlash()
  const m = useSaveAgentSettings()
  const shown = draft ?? formatUsPhone(s.data?.phone) ?? ''
  const dirty = ready && draft !== null && draft.trim() !== formatUsPhone(s.data.phone || '')

  function save() {
    const { value, error } = normalizePhone(draft)
    if (error) return setProblem(error)
    setProblem('')
    m.save(phonePayload(value), { onSuccess: () => { setDraft(null); flash() } })
  }

  return (
    <SettingsCard icon={PhoneIncoming} title="Live-transfer phone"
      sub="The number you’d like live calls from the team to ring."
      right={s.soon ? <SettingsChip>Coming soon</SettingsChip> : null}>
      {!ready ? <Waiting s={s} /> : (
        <>
          <form noValidate onSubmit={e => { e.preventDefault(); if (dirty && !m.saving) save() }}
            style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 14, alignItems: 'end' }}>
            <OvField label="Phone number" icon={Phone} type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 010-0142"
              value={shown} error={!!problem}
              onChange={e => { setDraft(e.target.value); setProblem(''); unflash(); m.reset() }} />
            <SaveButton saving={m.saving} disabled={!dirty} onClick={save} />
          </form>
          <p style={note}>Live transfers still ring the phone on your Profile until this is switched over. Leave it empty to clear it.</p>
        </>
      )}
      {(problem || m.error) && <p role="alert" style={errText}>{problem || saveErrorText(m.error)}</p>}
      {saved && <Saved />}
    </SettingsCard>
  )
}

// ── On-duty default ─────────────────────────────────────────────────────────
// Sets the default only. It never turns the agent Active: that is the switch in the card above.
function DefaultCard({ s }) {
  const ready = !!s.data
  const [saved, flash, unflash] = useSavedFlash()
  const m = useSaveAgentSettings()
  const on = m.saving ? m.pending?.on_duty_default === true : !!s.data?.dutyDefault

  function flip(next) {
    unflash()
    m.save(defaultPayload(next), { onSuccess: flash })
  }

  return (
    <SettingsCard icon={UserCheck} title="On-duty default"
      sub="Whether you start working days Active. Saved for later: this does not turn you Active now."
      right={s.soon ? <SettingsChip>Coming soon</SettingsChip> : null}>
      {!ready ? <Waiting s={s} /> : (
        <>
          <label className="ov-box" style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 56, padding: '8px 16px', borderRadius: 14, cursor: 'pointer' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>Start Active by default</span>
            <Switch checked={on} disabled={m.saving} onChange={flip} />
          </label>
          <p style={note}>Your Active switch above is what counts today.</p>
        </>
      )}
      {m.error && <p role="alert" style={errText}>{saveErrorText(m.error)}</p>}
      {saved && <Saved />}
    </SettingsCard>
  )
}
