import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Phone, MessageSquare, Inbox, PhoneCall, BadgeCheck, Ban, ChevronRight, SlidersHorizontal, X, Check, Mail, TriangleAlert } from 'lucide-react'
import { useMpLeads, useUpdateMpLeadStatus, useLeadSettings, useSaveLeadSettings } from '../../hooks/useMpLeads'
import { ClientDrawer, InfoTile, LoadError, OvSelect, IconChip } from '../../components/agent/AgentUI'
import { Switch } from '../../components/ui/Switch'
import { US_STATES } from '../../lib/usStates'
import { digits, useNow } from '../../lib/agentBookings'
import { initialsOf } from '../../lib/fulfillmentCall'

// Leads (P810) — Meta mortgage-protection leads delivered to this agent
// (migration 161: mp_leads, agent_lead_settings). My Pipeline's layout (P726):
// a rail with the lead delivery hero and the "Your leads" summary, then the
// status tabs + list box, one drawer per lead. Call and Text are tel:/sms:
// links that open the agent's own phone; the app sends nothing. Agents change
// only a lead's status; "New" writes 'assigned' (they can't send a lead back
// to the pool). Not behind BillingGate (see its pass-through).

const TABS = ['new', 'contacted', 'closed', 'bad']
const TAB = {
  new: { label: 'New', sub: 'Call first', icon: Inbox, write: 'assigned' },
  contacted: { label: 'Contacted', sub: 'Reached out', icon: PhoneCall, write: 'contacted' },
  closed: { label: 'Closed', sub: 'Policy written', icon: BadgeCheck, write: 'closed' },
  bad: { label: 'Bad lead', sub: 'Not a fit', icon: Ban, write: 'bad' },
}
const tabOf = l => (l.status === 'new' || l.status === 'assigned' ? 'new' : TAB[l.status] ? l.status : 'new')
const colours = t => ({ '--c': `var(--ld-${t})`, '--tint': `var(--ld-${t}-tint)`, '--edge': `var(--ld-${t}-edge)` })
const stateName = code => US_STATES.find(s => s.code === code)?.name || code
const nameOf = l => [l.first_name, l.last_name].filter(Boolean).join(' ') || 'No name given'
const OV_NUM = { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontVariantNumeric: 'tabular-nums' }

// "12 min ago" inside the hour, then "Today, 9:14 AM" / "Yesterday, …" / "Oct 22, …".
function delivered(iso, now) {
  const d = new Date(iso)
  const mins = Math.floor((now - d.getTime()) / 60e3)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const today = new Date(now), yest = new Date(now)
  yest.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`
  if (d.toDateString() === yest.toDateString()) return `Yesterday, ${time}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}
const isToday = (iso, now) => new Date(iso).toDateString() === new Date(now).toDateString()
const yesNo = (v, yes, no) => (v == null ? 'Not given' : v ? yes : no)

function StatusTag({ tab }) {
  return (
    <span style={{
      ...colours(tab), display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 999,
      background: 'var(--tint)', color: 'var(--c)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--c)' }} />
      {TAB[tab].label}
    </span>
  )
}

// Rail box 1: is delivery on, where, how many a day, and today's count.
function DeliveryHero({ settings, loading, saving, today, onToggle, onEdit }) {
  const active = !!settings?.active
  const states = settings?.states || []
  const cap = settings?.daily_cap
  const shown = states.slice(0, 4)
  const title = !settings ? 'Not set up yet' : active ? (states.length ? 'Receiving leads' : 'Pick your states') : 'Paused'
  const sub = !settings
    ? 'Pick the states you’re licensed in and turn it on. Leads from our ads go to you.'
    : active
      ? states.length ? 'New leads from our ads in your states come straight to you.' : 'You’re on, but no leads can reach you until you add a state.'
      : 'You won’t get new leads until you turn this back on.'
  return (
    <section className="ov-hero ld-hero" aria-label="Lead delivery">
      <div className="ld-hero-top">
        <div style={{ minWidth: 0 }}>
          <div className="ld-hero-lbl">Lead delivery</div>
          <h2 className="ld-hero-h">{title}</h2>
        </div>
        <Switch checked={active} disabled={loading || saving} onChange={onToggle} label="Receive new leads" />
      </div>
      <p className="ld-hero-sub">{sub}</p>
      {settings && (
        <div className="ld-hero-chips">
          {shown.map(s => <span key={s} className="ov-hero-chip" title={stateName(s)}>{s}</span>)}
          {states.length > shown.length && <span className="ov-hero-chip">+{states.length - shown.length} more</span>}
          <span className="ov-hero-chip">{cap == null ? 'No daily limit' : `Up to ${cap} a day`}</span>
        </div>
      )}
      {active && cap != null && cap > 0 && today != null && (
        <div className="ld-meter" aria-label={`${today} of ${cap} leads today`}>
          <div className="ld-meter-hd"><span>Today</span><span><b>{today}</b> of {cap}</span></div>
          <div className="ld-meter-track"><div className="ld-meter-fill" style={{ width: `${Math.min(100, (today / cap) * 100)}%` }} /></div>
        </div>
      )}
      <button type="button" className="ov-hero-btn" onClick={onEdit} style={active && cap && today != null ? null : { marginTop: 'auto' }}>
        <SlidersHorizontal size={16} strokeWidth={2} aria-hidden="true" />{settings ? 'States and daily limit' : 'Set up lead delivery'}
      </button>
    </section>
  )
}

// Rail box 2: totals by status and the newest lead.
function LeadSummary({ leads, counts, tab, now, onOpen, failed }) {
  const total = leads.length
  const week = leads.filter(l => now - new Date(l.created_at).getTime() < 7 * 864e5).length
  const pct = n => (total ? Math.round((n / total) * 100) : 0)
  const newest = leads.find(l => tabOf(l) === 'new')
  return (
    <section className="ov-card pl-pipe ld-pipe">
      <div className="pl-lbl">Your leads</div>
      <div className="pl-total">{failed ? <><b>—</b>Couldn’t load</> : <><b>{total}</b>lead{total === 1 ? '' : 's'} · {week} this week</>}</div>
      <div style={{ marginTop: 14, display: 'flex', height: 6, gap: 3, borderRadius: 999, overflow: 'hidden', background: 'var(--ov-stub)' }}>
        {TABS.filter(t => counts[t]).map(t => (
          <span key={t} style={{ flex: counts[t], background: `var(--ld-${t})`, opacity: t === tab ? 1 : 0.55 }} />
        ))}
      </div>
      <div className="pl-rows">
        {TABS.map(t => (
          <div key={t} className="pl-row2">
            <i style={{ background: `var(--ld-${t})` }} />
            <span className="l">{TAB[t].label}</span>
            <span className="c">{failed ? '—' : counts[t]}</span>
            <span className="p">{failed ? '' : `${pct(counts[t])}%`}</span>
          </div>
        ))}
      </div>
      <div className="pl-next">
        {newest ? (
          <>
            <span className="ld-av" style={{ ...colours('new'), width: 44, height: 44 }}>{initialsOf(nameOf(newest))}</span>
            <span className="k">Newest to call<b>{nameOf(newest)}</b></span>
            <button type="button" className="ov-ghost" onClick={() => onOpen(newest.id)}>Open</button>
          </>
        ) : (
          <>
            <span className="pl-ntile">{failed ? <TriangleAlert size={18} strokeWidth={2} style={{ color: 'var(--ov-faint)' }} /> : <Check size={18} strokeWidth={2} style={{ color: 'var(--ld-closed)' }} />}</span>
            <span className="k">Newest to call<b>{failed ? 'Not loaded' : 'Nobody waiting'}</b></span>
          </>
        )}
      </div>
    </section>
  )
}

function LeadList({ tab, onTab, counts, list, now, activeId, onOpen, loading, failed, settings }) {
  const refs = useRef({})
  const onKeyDown = e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = TABS[(TABS.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    onTab(next)
    refs.current[next]?.focus()
  }
  const Icon = TAB[tab].icon
  const empty = failed ? 'Your leads didn’t load. Use Try again above.' : tab === 'new'
    ? settings?.active ? 'No new leads right now. New ones show up here the moment they come in.' : 'Turn on lead delivery to start getting leads.'
    : tab === 'contacted' ? 'Leads you’ve reached out to show up here.'
      : tab === 'closed' ? 'Leads you’ve written a policy for show up here.' : 'Nothing marked as a bad lead.'
  return (
    <section className="ov-card pl-list">
      <div role="tablist" aria-label="Lead status" className="pl-tabs hidden sm:grid grid-cols-2 lg:grid-cols-4" onKeyDown={onKeyDown}>
        {TABS.map(t => {
          const on = t === tab
          const I = TAB[t].icon
          return (
            <button key={t} ref={el => { refs.current[t] = el }} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
              onClick={() => !on && onTab(t)} className={`ov-tab pl-tab${on ? ' is-sel' : ''}${counts[t] ? '' : ' is-zero'}`} style={colours(t)}>
              <span className="ic" aria-hidden="true"><I size={18} strokeWidth={2} /></span>
              <span style={{ minWidth: 0 }}><b className="nm">{TAB[t].label}</b><small>{TAB[t].sub}</small></span>
              <span className="n" style={{ ...OV_NUM, color: on ? 'var(--ov-hi)' : 'var(--c)' }}>{failed ? '—' : counts[t]}</span>
            </button>
          )
        })}
      </div>
      <div className="sm:hidden"><div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
        <div role="tablist" aria-label="Lead status" className="ov-chips flex -mx-4 px-4" style={{ gap: 8, overflowX: 'auto' }}>
          {TABS.map(t => {
            const I = TAB[t].icon
            return (
              <button key={t} type="button" role="tab" aria-selected={t === tab} onClick={() => onTab(t)}
                className={`ov-tab pl-chip${t === tab ? ' is-sel' : ''}`} style={colours(t)}>
                <I size={16} strokeWidth={2} aria-hidden="true" />{TAB[t].label}
                <span style={OV_NUM}>{failed ? '—' : counts[t]}</span>
              </button>
            )
          })}
        </div>
        <span style={{ padding: '0 2px', fontSize: 13, color: 'var(--ov-mute)' }}>{TAB[tab].sub}</span>
      </div></div>
      <div className="pl-body">
        {loading ? <div className="pl-empty ov-card"><p style={{ margin: 0, color: 'var(--ov-mute)' }}>Loading leads…</p></div>
          : !list.length ? (
            <div className="pl-empty ov-card">
              <IconChip icon={failed ? TriangleAlert : Icon} color={`var(--ld-${tab})`} tint={`var(--ld-${tab}-tint)`} size={44} radius={13} iconSize={20} />
              <p style={{ margin: 0, fontSize: 14, color: 'var(--ov-mute)', maxWidth: 340 }}>{empty}</p>
            </div>
          ) : (
            <>
              <div className="ld-cols" aria-hidden="true">
                <span>Lead</span><span>Mortgage</span><span>Best time to call</span><span>Delivered</span><span />
              </div>
              <div className="ld-list">
                {list.map(l => {
                  const name = nameOf(l)
                  const fresh = tab === 'new' && now - new Date(l.created_at).getTime() < 3600e3
                  return (
                    <div key={l.id} role="button" tabIndex={0} aria-label={`Open ${name}`} className={`ld-row${l.id === activeId ? ' is-active' : ''}`}
                      onClick={() => onOpen(l.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(l.id) } }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                        <span className="ld-av" style={colours(tab)}>{initialsOf(name)}</span>
                        <span style={{ minWidth: 0 }}>
                          <span className="ld-nm">{name}</span>
                          <span className="ld-sm">{[l.state && stateName(l.state), l.age_band && `Age ${l.age_band}`].filter(Boolean).join(' · ') || l.phone || 'No details'}</span>
                        </span>
                      </span>
                      <span className="ld-cell ld-wide">{l.mortgage_balance_band || '—'}</span>
                      <span className="ld-cell ld-wide">{l.best_time || 'Any time'}</span>
                      <span className="ld-cell" style={{ fontSize: 13.5 }}>{fresh && <i className="ld-fresh" />}{delivered(l.created_at, now)}</span>
                      <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--ov-faint)', justifySelf: 'end' }} aria-hidden="true" />
                    </div>
                  )
                })}
              </div>
            </>
          )}
      </div>
    </section>
  )
}

function LeadDrawer({ lead, now, onClose, onStatus, busy, error }) {
  const tab = tabOf(lead)
  const name = nameOf(lead)
  const num = digits(lead.phone)
  const btn = { height: 46, borderRadius: 999, fontSize: 14.5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden' }
  return (
    <ClientDrawer
      p={lead} name={name} onClose={onClose}
      header={{
        style: { background: `radial-gradient(ellipse 90% 80% at 100% 0%, var(--ld-${tab}-tint) 0%, transparent 70%)` },
        title: <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }}>Lead</span>,
        body: (
          <>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
              <span className="ld-av" style={{ ...colours(tab), width: 56, height: 56, fontSize: 15 }}>{initialsOf(name)}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15, color: 'var(--ov-hi)', overflowWrap: 'anywhere' }}>{name}</div>
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <StatusTag tab={tab} />
                  <span style={{ fontSize: 13.5, color: 'var(--ov-mute)' }}>Delivered {delivered(lead.created_at, now).replace(/^(Today|Yesterday)/, s => s.toLowerCase())}</span>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              {num ? (
                <>
                  <a href={`tel:${num}`} className="ov-solid" style={btn}><Phone size={16} strokeWidth={2.2} style={{ flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.phone}</span></a>
                  <a href={`sms:${num}`} className="ov-ghost" style={{ ...btn, fontWeight: 600 }}><MessageSquare size={16} strokeWidth={2} style={{ flexShrink: 0 }} />Text</a>
                </>
              ) : <span className="ov-ghost" style={{ ...btn, gridColumn: '1 / -1', fontWeight: 600, opacity: 0.6 }}>No phone number</span>}
            </div>
          </>
        ),
      }}
      footer={(
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)', marginBottom: 10 }}>Where is this lead?</div>
          <div className="ld-seg" role="group" aria-label="Lead status">
            {TABS.map(t => {
              const I = TAB[t].icon
              return (
                <button key={t} type="button" className="ov-ghost" aria-pressed={t === tab} disabled={busy}
                  onClick={() => t !== tab && onStatus(lead.id, TAB[t].write)} style={colours(t)}>
                  <I size={16} strokeWidth={2} aria-hidden="true" />{TAB[t].label}
                </button>
              )
            })}
          </div>
          {error && <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--danger, var(--ov-live))' }}>Couldn’t update this lead. Try again.</p>}
        </div>
      )}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <InfoTile label="State" value={lead.state ? stateName(lead.state) : 'Not given'} />
        <InfoTile label="Age" value={lead.age_band || 'Not given'} />
        <InfoTile label="Mortgage balance" value={lead.mortgage_balance_band || 'Not given'} />
        <InfoTile label="Best time to call" value={lead.best_time || 'Any time'} />
        <InfoTile label="Homeowner" value={yesNo(lead.homeowner, 'Yes', 'No, renting')} />
        <InfoTile label="Smoker" value={yesNo(lead.smoker, 'Yes', 'No')} />
      </div>
      {lead.email && (
        <a href={`mailto:${lead.email}`} className="ov-tile" style={{ padding: '14px 16px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', minWidth: 0 }}>
          <Mail size={16} strokeWidth={2} style={{ color: 'var(--ov-mute)', flexShrink: 0 }} />
          <span style={{ fontSize: 14, color: 'var(--ov-hi)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.email}</span>
        </a>
      )}
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--ov-mute)' }}>
        From our mortgage-protection ad. They asked to be contacted about coverage. Call and Text use your own phone.
      </p>
    </ClientDrawer>
  )
}

function SettingsDrawer({ settings, onClose, put, saving, error }) {
  const active = !!settings?.active
  const states = settings?.states || []
  const cap = settings?.daily_cap
  const left = US_STATES.filter(s => !states.includes(s.code)).map(s => ({ value: s.code, label: s.name }))
  const label = { fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)', marginBottom: 10 }
  return (
    <ClientDrawer
      name="Lead settings" onClose={onClose}
      header={{ title: <span style={{ flex: 1, fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 600, color: 'var(--ov-hi)' }}>Lead settings</span> }}
    >
      <div className="ov-tile" style={{ padding: '16px 18px', borderRadius: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ov-hi)' }}>Receive new leads</div>
          <div style={{ marginTop: 2, fontSize: 13, color: 'var(--ov-mute)' }}>{active ? 'On. Leads in your states come to you.' : 'Off. You won’t get new leads.'}</div>
        </div>
        <Switch checked={active} disabled={saving} onChange={on => put({ active: on })} label="Receive new leads" />
      </div>
      <div>
        <div style={label}>States you’re licensed in</div>
        {states.length > 0 && (
          <div className="ld-states" style={{ marginBottom: 12 }}>
            {states.map(code => (
              <button key={code} type="button" className="ld-state" disabled={saving} aria-label={`Remove ${stateName(code)}`}
                onClick={() => put({ states: states.filter(s => s !== code) })}>
                {stateName(code)}<X size={14} strokeWidth={2.2} style={{ color: 'var(--ov-mute)' }} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        <OvSelect value="" placeholder="Add a state" aria-label="Add a state" options={left}
          onChange={code => code && put({ states: [...states, code].sort() })} />
      </div>
      <div>
        <div style={label}>Most leads a day</div>
        <div className="ld-step">
          <button type="button" className="ov-ghost" aria-label="Fewer" disabled={saving || !cap} onClick={() => put({ daily_cap: cap - 1 })}>−</button>
          <b>{cap ?? '—'}</b>
          <button type="button" className="ov-ghost" aria-label="More" disabled={saving || (cap ?? 0) >= 1000} onClick={() => put({ daily_cap: (cap ?? 0) + 1 })}>+</button>
          {cap != null && (
            <button type="button" className="ov-link" onClick={() => put({ daily_cap: null })}
              style={{ width: 'auto', height: 'auto', borderRadius: 0, border: 'none', background: 'none', fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mute)', textDecoration: 'underline' }}>
              No limit
            </button>
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ov-mute)' }}>{cap == null ? 'No limit: every lead in your states can come to you.' : `At most ${cap} new lead${cap === 1 ? '' : 's'} a day.`}</div>
      </div>
      <div aria-live="polite" style={{ fontSize: 13, color: error ? 'var(--ov-live)' : 'var(--ov-mute)' }}>
        {error ? 'Couldn’t save. Try again.' : saving ? 'Saving…' : 'Changes save as you make them.'}
      </div>
    </ClientDrawer>
  )
}

export default function Leads() {
  const now = useNow()
  const [params, setParams] = useSearchParams()
  const { data: leads = [], isLoading, isError, refetch } = useMpLeads()
  const { data: settings, isLoading: settingsLoading } = useLeadSettings()
  const save = useSaveLeadSettings()
  const update = useUpdateMpLeadStatus()
  const [editing, setEditing] = useState(false)

  const tab = TABS.includes(params.get('stage')) ? params.get('stage') : 'new'
  const openId = params.get('open')
  const set = (key, value) => {
    const next = new URLSearchParams(params)
    if (value == null) next.delete(key); else next.set(key, value)
    setParams(next, { replace: true })
  }
  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t, leads.filter(l => tabOf(l) === t).length])), [leads])
  const list = useMemo(() => leads.filter(l => tabOf(l) === tab), [leads, tab])
  const today = leads.filter(l => isToday(l.assigned_at || l.created_at, now)).length
  const open = openId ? leads.find(l => l.id === openId) : null
  const put = patch => save.mutate({ patch, exists: !!settings })

  return (
    <>
      {isError && <div style={{ marginBottom: 16 }}><LoadError what="your leads" onRetry={() => refetch()} /></div>}
      <div className="pl-page">
        <div className="pl-rail">
          <DeliveryHero settings={settings} loading={settingsLoading} saving={save.isPending} today={isError ? null : today}
            onToggle={on => put({ active: on })} onEdit={() => setEditing(true)} />
          <LeadSummary leads={leads} counts={counts} tab={tab} now={now} onOpen={id => set('open', id)} failed={isError} />
        </div>
        <LeadList tab={tab} onTab={t => set('stage', t === 'new' ? null : t)} counts={counts} list={list} now={now}
          activeId={openId} onOpen={id => set('open', id)} loading={isLoading} failed={isError} settings={settings} />
      </div>
      {open && (
        <LeadDrawer key={open.id} lead={open} now={now} onClose={() => set('open', null)} busy={update.isPending} error={update.isError}
          onStatus={(id, status) => update.mutate({ id, status })} />
      )}
      {editing && <SettingsDrawer settings={settings} onClose={() => setEditing(false)} put={put} saving={save.isPending} error={save.isError} />}
    </>
  )
}
