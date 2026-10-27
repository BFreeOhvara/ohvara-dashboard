import { useState } from 'react'
import { Inbox, CircleAlert } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useMpLeads, useUpdateMpLeadStatus, useLeadSettings, useSaveLeadSettings, LEAD_LIMIT } from '../../hooks/useMpLeads'
import { Switch } from '../../components/ui/Switch'
import { US_STATES } from '../../lib/usStates'
import { digits } from '../../lib/agentBookings'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../../lib/timezones'

// Leads — Meta mortgage-protection leads delivered to this agent (migration
// 161: mp_leads, agent_lead_settings). Call and Text are tel:/sms: links that
// open the agent's own phone; the app sends nothing. Not behind BillingGate
// (see the pass-through in BillingGate.jsx). Layout classes .ld-* in index.css.

// Status tone per the approved mockup: New = noanswer, Contacted = booked,
// Closed = cancelled (green), Bad lead = danger. No amber on this page.
const TONE = {
  new: { color: 'var(--ov-st-noanswer)', background: 'var(--ov-st-noanswer-tint)', borderColor: 'var(--ov-st-noanswer-edge)' },
  contacted: { color: 'var(--ov-st-booked)', background: 'var(--ov-st-booked-tint)', borderColor: 'var(--ov-st-booked-edge)' },
  closed: { color: 'var(--ov-st-cancelled)', background: 'var(--ov-st-cancelled-tint)', borderColor: 'var(--ov-st-cancelled-edge)' },
  bad: { color: 'var(--danger)', background: 'var(--danger-dim)', borderColor: 'var(--danger-bd)' },
}
// [value written, tone, label]. New writes 'assigned'; 'new' is never written.
const STATUSES = [['assigned', 'new', 'New'], ['contacted', 'contacted', 'Contacted'], ['closed', 'closed', 'Closed'], ['bad', 'bad', 'Bad lead']]
const statusOf = s => STATUSES.find(([v]) => v === s) || STATUSES[0]

const disp = { fontFamily: 'var(--font-display)', fontWeight: 600 }
const sub = { color: 'var(--ov-mute)', fontSize: 13.5, margin: 0 }
const chip = {
  display: 'inline-flex', alignItems: 'center', minHeight: 28, padding: '0 11px', borderRadius: 999,
  fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', border: '1px solid var(--ov-line)',
  background: 'var(--ov-data-a-tint)', color: 'var(--ov-data-a)',
}
const ghost = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', fontFamily: 'inherit' }
const grow = { flex: 1, minWidth: 0, overflowWrap: 'anywhere' }
const tile = { width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--ov-data-a-tint)', color: 'var(--ov-data-a)', flexShrink: 0 }
const errTile = { ...tile, background: 'var(--danger-dim)', color: 'var(--danger)' }
const lab = { fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mid)', margin: '0 0 8px' }
const skel = (width, height, extra) => <span style={{ display: 'block', width, height, borderRadius: 10, background: 'var(--ov-stub)', ...extra }} />
const stateName = code => US_STATES.find(s => s.code === code)?.name || code
const pill = { borderRadius: 999 }

function when(iso, tz) {
  if (!iso) return null
  const time = new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
  const day = zonedDateStr(new Date(iso).getTime(), tz)
  if (day === zonedDateStr(Date.now(), tz)) return `Today, ${time}`
  if (day === zonedDateStr(Date.now() - 864e5, tz)) return `Yesterday, ${time}`
  return `${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz })}, ${time}`
}

// Monday (YYYY-MM-DD) of this week in the agent's time zone.
function mondayStr(tz) {
  const today = new Date(`${zonedDateStr(Date.now(), tz)}T12:00:00Z`)
  today.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7))
  return today.toISOString().slice(0, 10)
}

function answers(l) {
  return [
    l.homeowner != null && (l.homeowner ? 'Homeowner' : 'Renter'),
    l.mortgage_balance_band,
    l.age_band && `Age ${l.age_band}`,
    l.smoker != null && (l.smoker ? 'Smoker' : 'Non-smoker'),
    l.best_time && `Best: ${l.best_time}`,
  ].filter(Boolean)
}

const deliveryOn = s => !!s?.active && (s.states?.length || 0) > 0
const toSettings = () => document.getElementById('lead-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

function ErrorCard({ title, body, onRetry }) {
  return (
    <section className="ov-card" role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, padding: '26px 22px' }}>
      <span style={errTile}><CircleAlert size={20} /></span>
      <h3 className="ld-title" style={{ ...disp, fontSize: 19, margin: 0 }}>{title}</h3>
      <p style={sub}>{body}</p>
      <button type="button" className="ov-ghost ld-btn" style={ghost} onClick={onRetry}>Try again</button>
    </section>
  )
}

function Hero({ settings, settingsLoading, leads, tz }) {
  if (settingsLoading) {
    return (
      <section className="ov-hero" aria-busy="true" style={{ padding: 24 }}>
        {skel(110, 14, { opacity: 0.6 })}{skel(180, 44, { margin: '16px 0 12px', opacity: 0.6 })}{skel('70%', 14, { opacity: 0.6 })}
      </section>
    )
  }
  const on = deliveryOn(settings)
  const monday = mondayStr(tz)
  const week = leads.filter(l => l.assigned_at && zonedDateStr(new Date(l.assigned_at).getTime(), tz) >= monday).length
  const fresh = leads.filter(l => l.status === 'new' || l.status === 'assigned').length
  const chips = on ? [
    fresh > 0 && `${fresh} new to call`,
    settings.states.join(' · '),
    settings.daily_cap != null && `Up to ${settings.daily_cap} a day`,
  ].filter(Boolean) : []
  return (
    <section className="ov-hero" aria-label="This week" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--ov-hero-soft)', fontSize: 13.5, fontWeight: 600 }}>
          <i style={{ width: 8, height: 8, borderRadius: '50%', background: on ? 'var(--ov-hero-dot)' : 'var(--ov-hero-soft)', opacity: on ? 1 : 0.5 }} />
          {on ? 'Delivery on' : 'Delivery off'}
        </span>
        <button type="button" className="ov-hero-chip ld-hero-btn" onClick={toSettings} style={{ height: 'auto', padding: '0 16px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600 }}>Lead settings</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', margin: '14px 0 12px' }}>
        <b className="ld-num" style={{ ...disp, fontSize: 52, lineHeight: 1, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums' }}>{week}</b>
        <span className="ld-num-label" style={{ ...disp, fontSize: 19 }}>{week === 1 ? 'lead' : 'leads'} this week</span>
      </div>
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {chips.map(c => <span key={c} className="ov-hero-chip" style={{ height: 'auto', minHeight: 28, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{c}</span>)}
        </div>
      )}
      <p style={{ ...sub, color: 'var(--ov-hero-soft)' }}>
        {on ? 'The week runs Monday to Sunday in your time zone.' : 'You won’t get new leads until you turn delivery on.'}
      </p>
    </section>
  )
}

function LeadCard({ lead, tz }) {
  const update = useUpdateMpLeadStatus()
  const [failed, setFailed] = useState(null) // { to, from } of the last failed change
  const [value, tone, label] = statusOf(lead.status)
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unnamed lead'
  const num = digits(lead.phone)
  const chips = answers(lead)
  const busy = update.isPending
  const set = to => {
    if (busy || to === value) return
    const from = value
    setFailed(null)
    update.mutate({ id: lead.id, status: to, from: lead.status }, { onError: () => setFailed({ to, from }) })
  }
  return (
    <article className="ov-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={grow}>
          <h3 className="ld-title" style={{ ...disp, fontSize: 19, lineHeight: 1.25, letterSpacing: '-0.01em', margin: 0 }}>{name}</h3>
          <p style={{ ...sub, marginTop: 2 }}>{[lead.state && stateName(lead.state), when(lead.assigned_at || lead.created_at, tz)].filter(Boolean).join(' · ')}</p>
        </div>
        <span style={{ ...chip, ...TONE[tone], flexShrink: 0 }}>{label}</span>
      </div>
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chips.map(c => <span key={c} style={chip}>{c}</span>)}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        {num ? (
          <div className="ld-contact">
            <a className="ov-ghost ld-btn" href={`tel:${num}`} style={ghost}>Call</a>
            <a className="ov-ghost ld-btn" href={`sms:${num}`} style={ghost}>Text</a>
          </div>
        ) : <p style={{ flex: '1 1 200px', color: 'var(--ov-faint)', fontSize: 13.5, minHeight: 40, display: 'flex', alignItems: 'center', margin: 0 }}>No phone number</p>}
        <div className="ld-seg" role="group" aria-label="Lead status" aria-busy={busy}>
          {STATUSES.map(([v, t, text]) => (
            <button key={v} type="button" aria-pressed={v === value} disabled={busy} onClick={() => set(v)}
              style={v === value ? TONE[t] : undefined}>{text}</button>
          ))}
        </div>
      </div>
      {busy && <p style={{ fontSize: 12.5, color: 'var(--ov-mute)', margin: 0 }}>Saving…</p>}
      {failed && !busy && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 6px 6px 12px', borderRadius: 14, border: '1px solid var(--danger-bd)', background: 'var(--danger-dim)', color: 'var(--danger)', fontSize: 13.5, fontWeight: 600 }}>
          <span style={{ flex: '1 1 200px', minWidth: 0 }}>Couldn’t mark this lead {statusOf(failed.to)[2]}. It’s back to {statusOf(failed.from)[2]}.</span>
          <button type="button" onClick={() => set(failed.to)} style={{ minHeight: 44, padding: '0 10px', border: 0, background: 'transparent', color: 'inherit', fontFamily: 'inherit', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>Try again</button>
        </div>
      )}
    </article>
  )
}

function SettingsHead({ active, onToggle, disabled }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={tile}><Inbox size={20} /></span>
      <div style={grow}>
        <h3 className="ld-title" style={{ ...disp, fontSize: 18, margin: 0 }}>Lead settings</h3>
        <p style={sub}>Receive new leads</p>
      </div>
      <Switch checked={active} disabled={disabled} onChange={onToggle} label="Receive new leads" />
    </div>
  )
}

function SettingsForm({ saved, tz }) {
  const save = useSaveLeadSettings()
  const [draft, setDraft] = useState({ active: !!saved?.active, states: saved?.states || [], daily_cap: saved?.daily_cap ?? null })
  const [picking, setPicking] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const edit = patch => { setSavedAt(null); save.reset(); setDraft(d => ({ ...d, ...patch })) }
  const toggleState = code => edit({ states: draft.states.includes(code) ? draft.states.filter(s => s !== code) : [...draft.states, code].sort() })
  const cap = draft.daily_cap
  const onSave = () => save.mutate({ values: draft, exists: !!saved }, {
    onSuccess: () => setSavedAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })),
  })
  const pending = save.isPending

  return (
    <section className="ov-card" aria-label="Lead settings" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <SettingsHead active={draft.active} disabled={pending} onToggle={on => edit({ active: on })} />
      {!deliveryOn(draft) && (
        <p style={{ fontSize: 13.5, color: 'var(--ov-mid)', padding: '10px 12px', borderRadius: 14, background: 'var(--bg-muted)', border: '1px solid var(--ov-line)', margin: 0 }}>
          Turn this on and pick your states to start getting leads.
        </p>
      )}
      <div>
        <p style={lab}>States</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {draft.states.map(code => (
            <span key={code} className="ld-chip" style={{ ...chip, minHeight: 36, gap: 2, padding: '0 2px 0 12px', fontSize: 13.5 }}>
              {stateName(code)}
              <button type="button" className="ld-chip-x" aria-label={`Remove ${stateName(code)}`} disabled={pending} onClick={() => toggleState(code)}
                style={{ border: 0, background: 'transparent', borderRadius: '50%', cursor: 'pointer', color: 'var(--ov-mute)', fontSize: 16, lineHeight: 1 }}>×</button>
            </span>
          ))}
          <button type="button" className="ov-ghost ld-chip" aria-expanded={picking} onClick={() => setPicking(p => !p)}
            style={{ ...ghost, minHeight: 36, padding: '0 14px', fontSize: 13.5 }}>
            {picking ? 'Done' : '+ Add state'}
          </button>
        </div>
        {picking && (
          <div role="group" aria-label="Pick states" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))', gap: 6, marginTop: 10, paddingTop: 12, borderTop: '1px solid var(--ov-line)' }}>
            {US_STATES.map(s => {
              const on = draft.states.includes(s.code)
              return (
                <button key={s.code} type="button" className="ov-ghost" aria-pressed={on} aria-label={s.name} disabled={pending} onClick={() => toggleState(s.code)}
                  style={{ minHeight: 44, borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ov-mid)', ...(on ? { background: 'var(--ov-data-a-tint)', color: 'var(--ov-data-a)', borderColor: 'var(--ov-data-a)' } : {}) }}>
                  {s.code}
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div>
        <p style={lab}>Daily cap</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="ov-ghost" aria-label="Fewer" style={{ ...ghost, width: 44, height: 44, padding: 0, fontSize: 20 }}
            disabled={pending || !cap} onClick={() => edit({ daily_cap: Math.max(0, cap - 1) })}>−</button>
          <b className="ld-cap" style={{ ...disp, fontSize: 30, letterSpacing: '-0.02em', minWidth: 52, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{cap ?? '—'}</b>
          <button type="button" className="ov-ghost" aria-label="More" style={{ ...ghost, width: 44, height: 44, padding: 0, fontSize: 20 }}
            disabled={pending || (cap ?? 0) >= 1000} onClick={() => edit({ daily_cap: (cap ?? 0) + 1 })}>+</button>
          <span style={sub}>leads per day</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ov-faint)', margin: '6px 0 0' }}>0 pauses delivery for the day. Up to 1,000.</p>
      </div>
      <div className="ld-foot" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingTop: 16, borderTop: '1px solid var(--ov-line)' }}>
        <button type="button" className="ov-hero ld-save" disabled={pending} onClick={onSave}
          style={{ ...pill, minHeight: 44, padding: '0 22px', fontSize: 14.5, fontWeight: 700, fontFamily: 'inherit', cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.6 : 1 }}>
          {pending ? 'Saving…' : 'Save settings'}
        </button>
        {savedAt && !pending && <span role="status" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mid)' }}>✓ Saved at {savedAt}</span>}
        {save.isError && <span role="alert" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--danger)', minWidth: 0 }}>Couldn’t save. Your changes are still here, try again.</span>}
      </div>
    </section>
  )
}

function SettingsCard({ query, tz }) {
  if (query.isLoading) {
    return (
      <section className="ov-card" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <SettingsHead active={false} disabled onToggle={() => {}} />
        <div style={{ display: 'flex', gap: 8 }}>{skel(76, 36, pill)}{skel(76, 36, pill)}</div>
        {skel(150, 44, pill)}
      </section>
    )
  }
  if (query.isError) {
    return <ErrorCard title="We couldn’t load your lead settings" body="Nothing was changed. Try again in a moment." onRetry={() => query.refetch()} />
  }
  return <SettingsForm saved={query.data} tz={tz} />
}

function LeadSkeleton({ chips }) {
  return (
    <div className="ov-card" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {skel('60%', 18)}{skel('40%', 12)}
      {chips && <div style={{ display: 'flex', gap: 6 }}>{skel(80, 28, pill)}{skel(96, 28, pill)}{skel(70, 28, pill)}</div>}
      {skel('100%', 40, pill)}
    </div>
  )
}

export default function Leads() {
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const leadsQ = useMpLeads()
  const settingsQ = useLeadSettings()
  const leads = leadsQ.data || []
  const on = deliveryOn(settingsQ.data)

  return (
    <div className="ld-grid">
      <div className="ld-main">
        <Hero settings={settingsQ.data} settingsLoading={settingsQ.isLoading} leads={leads} tz={tz} />
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, margin: '6px 4px -4px' }}>
          <h2 className="ld-title" style={{ ...disp, fontSize: 19, margin: 0 }}>Delivered leads</h2>
          <span style={sub}>Newest first</span>
        </div>
        {leadsQ.isLoading && <><LeadSkeleton chips /><LeadSkeleton /></>}
        {leadsQ.isError && (
          <ErrorCard title="We couldn’t load your leads" body="Your leads are safe. Check your connection and try again." onRetry={() => leadsQ.refetch()} />
        )}
        {leadsQ.isSuccess && leads.length === 0 && (
          on || settingsQ.isLoading || settingsQ.isError ? (
            <section className="ov-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, padding: '26px 22px' }}>
              <h3 className="ld-title" style={{ ...disp, fontSize: 19, margin: 0 }}>No leads yet</h3>
              <p style={sub}>New ones show up here as soon as they’re delivered. You don’t need to refresh.</p>
            </section>
          ) : (
            <section className="ov-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, padding: '26px 22px' }}>
              <h3 className="ld-title" style={{ ...disp, fontSize: 19, margin: 0 }}>Delivery is off</h3>
              <p style={sub}>Turn it on and pick your states to start getting leads.</p>
              <button type="button" className="ov-ghost ld-btn" style={ghost} onClick={toSettings}>Open lead settings</button>
            </section>
          )
        )}
        {leads.map(l => <LeadCard key={l.id} lead={l} tz={tz} />)}
        {leads.length >= LEAD_LIMIT && (
          <p style={{ textAlign: 'center', color: 'var(--ov-faint)', fontSize: 13, padding: '4px 0', margin: 0 }}>Showing your {LEAD_LIMIT} newest leads.</p>
        )}
      </div>
      <div className="ld-side" id="lead-settings">
        <SettingsCard query={settingsQ} tz={tz} />
      </div>
    </div>
  )
}
