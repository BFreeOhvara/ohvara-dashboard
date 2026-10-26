import { useState } from 'react'
import { useMpLeads, useUpdateMpLeadStatus, useLeadSettings, useSaveLeadSettings } from '../../hooks/useMpLeads'
import { Switch } from '../../components/ui/Switch'
import { US_STATES } from '../../lib/usStates'
import { digits } from '../../lib/agentBookings'

// Leads — Meta mortgage-protection leads delivered to this agent (migration
// 161: mp_leads, agent_lead_settings). Call and Text are tel:/sms: links that
// open the agent's own phone; the app sends nothing. Not behind BillingGate
// (see the pass-through in BillingGate.jsx).

const STATUS_TONE = {
  new: ['New', 'booked'], assigned: ['New', 'booked'],
  contacted: ['Contacted', 'needs'], closed: ['Closed', 'won'], bad: ['Bad lead', 'noanswer'],
}
const TONE_VAR = {
  booked: 'var(--ov-st-booked)', needs: 'var(--ov-st-needs)', won: 'var(--ov-st-cancelled)', noanswer: 'var(--ov-st-noanswer)',
}
const SET_STATUS = [['contacted', 'Contacted'], ['closed', 'Closed'], ['bad', 'Bad']]

const chipBase = {
  display: 'inline-flex', alignItems: 'center', minHeight: 26, padding: '0 10px', borderRadius: 999,
  fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', border: '1px solid var(--ov-line)',
  background: 'var(--ov-data-a-tint)', color: 'var(--ov-data-a)',
}
const sub = { color: 'var(--ov-mute)', fontSize: 13.5 }
const stateName = code => US_STATES.find(s => s.code === code)?.name || code

const TZ = 'America/Chicago'
const ymd = d => d.toLocaleDateString('en-CA', { timeZone: TZ })
const TYPES = [['all', 'All'], ['cancellation', 'Cancellations'], ['mortgage_protection', 'Mortgage protection']]
const TYPE_LABEL = { cancellation: 'Cancellation', mortgage_protection: 'Mortgage protection' }

function when(iso) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
  const now = new Date()
  if (ymd(d) === ymd(now)) return `Today, ${time}`
  if (ymd(d) === ymd(new Date(now.getTime() - 864e5))) return `Yesterday, ${time}`
  return `${d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' })}, ${time}`
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

function Detail({ lead }) {
  const rows = [
    ['Homeowner', lead.homeowner != null && (lead.homeowner ? 'Yes' : 'No')],
    ['Mortgage balance', lead.mortgage_balance_band],
    ['Age', lead.age_band],
    ['Smoker', lead.smoker != null && (lead.smoker ? 'Yes' : 'No')],
    ['Best time to call', lead.best_time],
    ['Delivered', lead.delivered_at && when(lead.delivered_at)],
  ].filter(([, v]) => v)
  if (!rows.length) return null
  return (
    <dl style={{ margin: '0 0 12px', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', minWidth: 0 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={sub}>{k}</dt>
          <dd style={{ margin: 0, fontSize: 14, minWidth: 0, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' }}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function SettingsCard() {
  const { data: settings, isLoading } = useLeadSettings()
  const save = useSaveLeadSettings()
  const [picking, setPicking] = useState(false)
  const exists = !!settings
  const active = !!settings?.active
  const states = settings?.states || []
  const cap = settings?.daily_cap
  const put = patch => save.mutate({ patch, exists })
  const toggleState = code => put({ states: states.includes(code) ? states.filter(s => s !== code) : [...states, code].sort() })
  const stepper = { padding: 0, width: 44 }

  return (
    <section className="ov-card" aria-label="Lead settings">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Lead settings</h2>
          <div style={sub}>Receive new leads</div>
        </div>
        <Switch checked={active} disabled={isLoading || save.isPending} onChange={on => put({ active: on })} label="Receive new leads" />
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={sub}>States</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
          {states.map(code => (
            <button key={code} type="button" onClick={() => toggleState(code)} disabled={save.isPending}
              aria-label={`Remove ${stateName(code)}`} style={{ ...chipBase, minHeight: 32, cursor: 'pointer' }}>
              {stateName(code)} ×
            </button>
          ))}
          <button type="button" className="ov-ghost" onClick={() => setPicking(p => !p)} aria-expanded={picking}
            style={{ minHeight: 44, padding: '0 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {picking ? 'Done' : '+ Add'}
          </button>
        </div>
        {picking && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {US_STATES.map(s => {
              const on = states.includes(s.code)
              return (
                <button key={s.code} type="button" onClick={() => toggleState(s.code)} disabled={save.isPending}
                  aria-pressed={on} aria-label={s.name}
                  style={{
                    ...chipBase, minHeight: 44, minWidth: 44, justifyContent: 'center', cursor: 'pointer',
                    ...(on ? {} : { background: 'transparent', color: 'var(--ov-mid)', borderColor: 'var(--ov-line)' }),
                  }}>
                  {s.code}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={sub}>Daily cap</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
          <button type="button" className="ov-ghost" aria-label="Fewer" style={stepper}
            disabled={save.isPending || !cap} onClick={() => put({ daily_cap: Math.max(0, cap - 1) })}>−</button>
          <b style={{ fontSize: 22, fontWeight: 600, minWidth: 40, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{cap ?? '—'}</b>
          <button type="button" className="ov-ghost" aria-label="More" style={stepper}
            disabled={save.isPending || (cap ?? 0) >= 1000} onClick={() => put({ daily_cap: (cap ?? 0) + 1 })}>+</button>
          <span style={sub}>leads per day</span>
        </div>
      </div>
      {save.isError && <p role="alert" style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--ov-st-needs)' }}>Couldn’t save. Try again.</p>}
    </section>
  )
}

function LeadCard({ lead, onStatus, busy }) {
  const [open, setOpen] = useState(false)
  const [label, tone] = STATUS_TONE[lead.status] || STATUS_TONE.new
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unnamed lead'
  const num = digits(lead.phone)
  const chips = answers(lead)
  const btn = { minHeight: 44, borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: 'pointer', textDecoration: 'none' }
  return (
    <article className="ov-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>{name}</h2>
          <div style={{ ...sub, fontVariantNumeric: 'tabular-nums' }}>{[lead.state && stateName(lead.state), when(lead.created_at)].filter(Boolean).join(' · ')}</div>
        </div>
        <span style={{ ...chipBase, color: TONE_VAR[tone], background: `var(--ov-st-${tone}-tint)`, borderColor: `var(--ov-st-${tone}-edge)` }}>{label}</span>
      </div>
      <div style={{ margin: '8px 0 0' }}>
        <span style={chipBase}>{TYPE_LABEL[lead.lead_type] || TYPE_LABEL.mortgage_protection}</span>
      </div>
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0 12px' }}>
          {chips.map(c => <span key={c} style={chipBase}>{c}</span>)}
        </div>
      )}
      <button type="button" className="ov-ghost" aria-expanded={open} onClick={() => setOpen(o => !o)}
        style={{ ...btn, width: '100%', marginBottom: 8, fontSize: 13 }}>
        {open ? 'Hide details' : 'Details'}
      </button>
      {open && <Detail lead={lead} />}
      {num ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <a className="ov-ghost" href={`tel:${num}`} style={{ ...btn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Call</a>
          <a className="ov-ghost" href={`sms:${num}`} style={{ ...btn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Text</a>
        </div>
      ) : <div style={sub}>No phone number</div>}
      <div role="group" aria-label="Set status" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
        {SET_STATUS.map(([key, text]) => (
          <button key={key} type="button" className="ov-ghost" disabled={busy} aria-pressed={lead.status === key}
            onClick={() => lead.status !== key && onStatus(lead.id, key)}
            style={{ ...btn, padding: '0 6px', fontSize: 13, ...(lead.status === key ? { borderColor: 'var(--ov-data-b)', color: 'var(--ov-data-b)' } : {}) }}>
            {text}
          </button>
        ))}
      </div>
    </article>
  )
}

export default function Leads() {
  const { data: leads = [], isLoading, isError } = useMpLeads()
  const update = useUpdateMpLeadStatus()
  const [type, setType] = useState('all')
  const shown = type === 'all' ? leads : leads.filter(l => (l.lead_type || 'mortgage_protection') === type)
  const weekAgo = Date.now() - 7 * 864e5
  const thisWeek = shown.filter(l => new Date(l.created_at).getTime() >= weekAgo).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560, minWidth: 0 }}>
      <SettingsCard />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 4px 0' }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Delivered leads</h2>
        <span style={{ ...sub, fontVariantNumeric: 'tabular-nums' }}>{thisWeek} this week</span>
      </div>
      <div role="group" aria-label="Lead type" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {TYPES.map(([key, text]) => (
          <button key={key} type="button" aria-pressed={type === key} onClick={() => setType(key)}
            style={{
              ...chipBase, minHeight: 44, padding: '0 14px', cursor: 'pointer',
              ...(type === key ? {} : { background: 'transparent', color: 'var(--ov-mid)' }),
            }}>
            {text}
          </button>
        ))}
      </div>
      {isLoading && <p style={sub}>Loading…</p>}
      {isError && <p role="alert" style={{ ...sub, color: 'var(--ov-st-needs)' }}>Couldn’t load your leads. Try again.</p>}
      {!isLoading && !isError && shown.length === 0 && (
        <section className="ov-card"><div style={sub}>{leads.length ? 'No leads of this type.' : 'No leads yet. Turn on lead settings and pick your states.'}</div></section>
      )}
      {update.isError && <p role="alert" style={{ ...sub, color: 'var(--ov-st-needs)' }}>Couldn’t update that lead. Try again.</p>}
      {shown.map(l => (
        <LeadCard key={l.id} lead={l} busy={update.isPending} onStatus={(id, status) => update.mutate({ id, status })} />
      ))}
    </div>
  )
}
