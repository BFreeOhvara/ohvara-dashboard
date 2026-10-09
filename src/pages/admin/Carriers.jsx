import { useMemo, useState } from 'react'
import { Search, RefreshCw, Pencil, ExternalLink, X } from 'lucide-react'
import { useCarriers, useLookupCarrier, useSaveCarrier } from '../../hooks/useCarriers'
import { useAppSettings, useUpdateAppSettings } from '../../hooks/useAppSettings'
import { Pill } from '../../components/agent/AgentUI'
import { DAYS, hoursSummary, normalizeName, HOURS_STATUS } from '../../lib/carriers'
import { MONO } from '../../lib/exportStyles'

// Carrier hours (Prompt 728) — admin only. Every carrier agents can pick in
// Book a call, with the policyholder line's phone and open hours that set the
// bookable times. Admins fix hours by hand (saved as Verified) or re-run the
// live lookup ("Look up again", which always runs, even with the agents'
// switch off). "Needs review" = hours found by AI or the 9–5 ET fallback.
//
// The switch at the top is app_settings.carrier_lookup_live: whether an
// agent picking a carrier with no hours triggers the live lookup. It stays
// off until the lookup's answers have been spot-checked here.

const ZONES = [
  ['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'],
  ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'],
]
const DAY_NAME = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
const STATUS_TONE = { up: 'success', info: 'info', warn: 'warning', mute: 'muted' }
const FILTERS = [['all', 'All'], ['review', 'Needs review'], ['hours', 'Has hours'], ['none', 'No hours yet']]

const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const host = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

export default function Carriers() {
  const { data: carriers = [], isLoading } = useCarriers()
  const { data: settings } = useAppSettings()
  const updateSettings = useUpdateAppSettings()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('review')
  const [editing, setEditing] = useState(null)

  const counts = useMemo(() => ({
    all: carriers.length,
    review: carriers.filter(c => c.hours_status === 'ai' || c.hours_status === 'fallback').length,
    hours: carriers.filter(c => c.hours).length,
    none: carriers.filter(c => !c.hours).length,
  }), [carriers])

  const rows = useMemo(() => {
    const nq = normalizeName(q)
    return carriers
      .filter(c => filter === 'all'
        || (filter === 'review' && (c.hours_status === 'ai' || c.hours_status === 'fallback'))
        || (filter === 'hours' && c.hours)
        || (filter === 'none' && !c.hours))
      .filter(c => !nq || normalizeName(c.name).includes(nq) || (c.aliases || []).some(a => normalizeName(a).includes(nq)))
      .sort((a, b) => (a.sort_rank ?? 1e6) - (b.sort_rank ?? 1e6) || a.name.localeCompare(b.name))
  }, [carriers, q, filter])

  const live = !!settings?.carrier_lookup_live

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="ov-card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ov-hi)' }}>
            Look up hours when an agent picks a new carrier
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 13.5, lineHeight: 1.55, color: 'var(--ov-mute)' }}>
            {live
              ? 'On. A carrier with no hours is looked up once (a few cents), then cached for 180 days.'
              : 'Off. Agents get 9–5 Eastern for carriers with no hours. Run "Look up again" on a few carriers below, check them against their source pages, then turn this on.'}
          </p>
        </div>
        <button
          type="button" role="switch" aria-checked={live} disabled={!settings || updateSettings.isPending}
          onClick={() => updateSettings.mutate({ carrier_lookup_live: !live })}
          className={live ? 'ov-solid' : 'ov-ghost'}
          style={{ height: 40, padding: '0 18px', borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          {updateSettings.isPending ? 'Saving…' : live ? 'Turn off' : 'Turn on'}
        </button>
      </section>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="ov-input" style={{ flex: '1 1 260px', minWidth: 0, height: 42 }}>
          <Search size={16} strokeWidth={1.9} style={{ flexShrink: 0 }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search carriers" aria-label="Search carriers" />
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="tablist">
          {FILTERS.map(([k, label]) => (
            <button
              key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
              className={`ov-choice${filter === k ? ' is-on' : ''}`}
              style={{ height: 38, padding: '0 14px', borderRadius: 999, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
            >
              {label} <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--ov-mute)', marginLeft: 4 }}>{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>

      <section className="ov-card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <p style={{ margin: 0, padding: 20, color: 'var(--ov-mute)', fontSize: 14 }}>Loading carriers…</p>
        ) : rows.length === 0 ? (
          <p style={{ margin: 0, padding: 20, color: 'var(--ov-mute)', fontSize: 14 }}>No carriers match.</p>
        ) : rows.map(c => (
          <CarrierRow key={c.id} c={c} editing={editing === c.id} onEdit={() => setEditing(editing === c.id ? null : c.id)} onDone={() => setEditing(null)} />
        ))}
      </section>
    </div>
  )
}

function CarrierRow({ c, editing, onEdit, onDone }) {
  const lookup = useLookupCarrier()
  const status = HOURS_STATUS[c.hours_status]
  const result = lookup.data
  return (
    <div style={{ borderBottom: '1px solid var(--ov-line)', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>{c.name}</p>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--ov-mute)', fontFamily: MONO }}>{c.service_phone || 'No phone'}</p>
        </div>
        <div style={{ flex: '2 1 260px', minWidth: 0, fontSize: 13.5, color: c.hours ? 'var(--ov-mid)' : 'var(--ov-mute)' }}>
          {c.hours ? hoursSummary(c.hours, c.hours_tz) : 'No hours yet'}
          <span style={{ display: 'block', fontSize: 12, color: 'var(--ov-mute)', marginTop: 2 }}>
            Checked {fmtDate(c.hours_checked_at)}
            {c.hours_source_url && (
              <> · <a href={c.hours_source_url} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--ov-pick)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {host(c.hours_source_url)}<ExternalLink size={11} />
              </a></>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {lookup.isPending
            ? <Pill tone="muted">Checking</Pill>
            : status ? <Pill tone={STATUS_TONE[status.tone]}>{status.label}</Pill> : null}
          <button type="button" className="ov-ghost" onClick={() => lookup.mutate(c.id)} disabled={lookup.isPending}
            style={{ height: 34, padding: '0 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={13} strokeWidth={2} />{lookup.isPending ? 'Looking up…' : 'Look up again'}
          </button>
          <button type="button" className="ov-ghost" onClick={onEdit} aria-expanded={editing}
            style={{ height: 34, padding: '0 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {editing ? <X size={13} strokeWidth={2} /> : <Pencil size={13} strokeWidth={2} />}{editing ? 'Close' : 'Edit hours'}
          </button>
        </div>
      </div>
      {(lookup.isError || result) && (
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: lookup.isError || result?.error ? 'var(--warning)' : 'var(--ov-mute)' }}>
          {lookup.isError
            ? `Lookup failed: ${lookup.error.message}`
            : result.error
              ? `Lookup didn't find hours (${result.error}).${c.hours ? ' Kept the hours it had.' : ''}`
              : `Found: ${hoursSummary(result.carrier.hours, result.carrier.hours_tz)}${result.note ? ` — ${result.note}` : ''}`}
          {result?.usage && ` · ${result.model}, ${result.usage.web_search_requests} searches`}
        </p>
      )}
      {editing && <HoursForm c={c} onDone={onDone} />}
    </div>
  )
}

function HoursForm({ c, onDone }) {
  const save = useSaveCarrier()
  const [phone, setPhone] = useState(c.service_phone || '')
  const [tz, setTz] = useState(c.hours_tz || 'America/New_York')
  const [url, setUrl] = useState(c.hours_source_url || '')
  const [days, setDays] = useState(() => Object.fromEntries(DAYS.map(d => [d, c.hours?.[d] ? { ...c.hours[d] } : null])))
  const [err, setErr] = useState('')

  const setDay = (d, v) => setDays(s => ({ ...s, [d]: v }))
  function submit() {
    setErr('')
    for (const d of DAYS) {
      const h = days[d]
      if (h && (!h.open || !h.close || h.close <= h.open)) { setErr(`${DAY_NAME[d]}: closing time must be after opening time.`); return }
    }
    if (!DAYS.some(d => days[d])) { setErr('Open at least one day.'); return }
    save.mutate({
      id: c.id, service_phone: phone.trim() || null, hours: days, hours_tz: tz, hours_source_url: url.trim() || null,
      hours_status: 'verified', hours_checked_at: new Date().toISOString(),
    }, { onSuccess: onDone, onError: e => setErr(e.message) })
  }

  const field = { height: 38, borderRadius: 10, fontSize: 14 }
  return (
    <div className="ov-note" style={{ borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--ov-mid)' }}>
          Service phone
          <span className="ov-input" style={field}><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(800) 555-0100" /></span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--ov-mid)' }}>
          Time zone
          <span className="ov-input ov-select" style={field}>
            <select value={tz} onChange={e => setTz(e.target.value)}>
              {ZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--ov-mid)' }}>
          Source page
          <span className="ov-input" style={field}><input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></span>
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {DAYS.map(d => {
          const h = days[d]
          return (
            <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minHeight: 40 }}>
              <label style={{ width: 120, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--ov-hi)' }}>
                <input type="checkbox" checked={!!h} onChange={e => setDay(d, e.target.checked ? { open: '09:00', close: '17:00' } : null)} />
                {DAY_NAME[d]}
              </label>
              {h ? (
                <>
                  <span className="ov-input" style={{ ...field, width: 130 }}>
                    <input type="time" value={h.open} onChange={e => setDay(d, { ...h, open: e.target.value })} aria-label={`${DAY_NAME[d]} opens`} />
                  </span>
                  <span style={{ color: 'var(--ov-mute)', fontSize: 13 }}>to</span>
                  <span className="ov-input" style={{ ...field, width: 130 }}>
                    <input type="time" value={h.close} onChange={e => setDay(d, { ...h, close: e.target.value })} aria-label={`${DAY_NAME[d]} closes`} />
                  </span>
                </>
              ) : <span style={{ fontSize: 13, color: 'var(--ov-mute)' }}>Closed</span>}
            </div>
          )
        })}
      </div>
      {err && <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="ov-solid" onClick={submit} disabled={save.isPending}
          style={{ height: 40, padding: '0 20px', borderRadius: 999, fontSize: 14 }}>
          {save.isPending ? 'Saving…' : 'Save as verified'}
        </button>
        <button type="button" className="ov-ghost" onClick={onDone}
          style={{ height: 40, padding: '0 18px', borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
