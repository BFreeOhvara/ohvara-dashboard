import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Search, Download, Globe, AlertTriangle, CheckCircle, Loader2, Database } from 'lucide-react'

// ── Config ────────────────────────────────────────────────────────────────────

// Locked 7-setter lineup (vet + 6 trades) + the two still-undecided 7th-slot
// candidates (Plumbing, Pest Control). HIPAA-relevant and dropped niches are
// intentionally excluded.
const INDEED_NICHES = [
  'Veterinary', 'HVAC', 'Electrical', 'Roofing',
  'Landscaping', 'Pressure Washing', 'Plumbing', 'Pest Control',
]

// Columns that actually exist on the `leads` table. Scraper results carry
// display-only extras (already_in_db, no_website, website, rating,
// review_count, compensation, hourly_*, location) that PostgREST would
// reject on insert — whitelist before importing.
const LEAD_COLUMNS = [
  'source', 'business_name', 'contact_name', 'phone', 'email',
  'city', 'state', 'niche', 'status', 'notes', 'pain_points',
  'job_title', 'monthly_labor_cost', 'place_id',
  'posting_title', 'posting_snippet', 'source_url',
]

function toLeadRow(result) {
  const row = {}
  for (const col of LEAD_COLUMNS) {
    if (result[col] !== undefined) row[col] = result[col]
  }
  return row
}

// ── Shared components ─────────────────────────────────────────────────────────

function NicheGrid({ niches, selected, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {niches.map(niche => {
        const active = selected.includes(niche)
        return (
          <button
            key={niche}
            onClick={() => onChange(
              active
                ? selected.filter(n => n !== niche)
                : [...selected, niche]
            )}
            style={{
              padding: '4px 10px',
              borderRadius: 4, fontSize: 12, fontWeight: 500,
              border: '0.5px solid',
              cursor: 'pointer', transition: 'all 100ms',
              background: active ? 'var(--accent-dim)' : 'transparent',
              borderColor: active ? 'var(--accent-border)' : 'var(--border)',
              color: active ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            {niche}
          </button>
        )
      })}
      <button
        onClick={() => onChange(niches)}
        style={{
          padding: '4px 10px',
          borderRadius: 4, fontSize: 11, fontWeight: 500,
          border: '0.5px solid var(--border)',
          cursor: 'pointer', transition: 'all 100ms',
          background: 'transparent', color: 'var(--text-muted)',
        }}
      >
        Select All
      </button>
      <button
        onClick={() => onChange([])}
        style={{
          padding: '4px 10px',
          borderRadius: 4, fontSize: 11, fontWeight: 500,
          border: '0.5px solid var(--border)',
          cursor: 'pointer', transition: 'all 100ms',
          background: 'transparent', color: 'var(--text-muted)',
        }}
      >
        Clear
      </button>
    </div>
  )
}

function ResultsTable({ results, selectedIds, onToggle, onToggleAll }) {
  if (!results.length) return null

  const allSelected = results.length > 0 && selectedIds.size === results.filter(r => !r.already_in_db).length

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border)',
      borderRadius: 8, overflow: 'hidden',
      marginTop: 16,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center',
        borderBottom: '0.5px solid var(--border)',
        background: 'var(--bg-elevated)',
      }}>
        <div style={{ flex: '0 0 36px', padding: '8px 8px 8px 12px', display: 'flex', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => onToggleAll(allSelected)}
            style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
          />
        </div>
        <div style={{ flex: '1 1 0', padding: '8px 8px' }} className="section-label">Business</div>
        <div style={{ flex: '0 0 110px', padding: '8px 8px' }} className="section-label">Niche</div>
        <div style={{ flex: '0 0 100px', padding: '8px 8px' }} className="section-label">City</div>
        <div style={{ flex: '0 0 130px', padding: '8px 8px' }} className="section-label">Est. Monthly Cost</div>
        <div style={{ flex: '0 0 120px', padding: '8px 8px' }} className="section-label">Phone</div>
        <div style={{ flex: '0 0 80px', padding: '8px 16px 8px 8px', textAlign: 'right' }} className="section-label">Status</div>
      </div>

      {/* Rows */}
      <div style={{ maxHeight: 480, overflowY: 'auto' }} className="scrollbar-thin">
        {results.map((r, i) => {
          const isNew      = !r.already_in_db
          const isSelected = selectedIds.has(i)

          return (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center',
                borderBottom: i < results.length - 1 ? '0.5px solid var(--border)' : 'none',
                background: isSelected ? 'var(--accent-dim)' : 'transparent',
                opacity: r.already_in_db ? 0.5 : 1,
                transition: 'background-color 100ms',
              }}
              onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-elevated)' }}
              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ flex: '0 0 36px', padding: '10px 8px 10px 12px', display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={r.already_in_db}
                  onChange={() => onToggle(i)}
                  style={{ cursor: isNew ? 'pointer' : 'not-allowed', accentColor: 'var(--accent)' }}
                />
              </div>

              <div style={{ flex: '1 1 0', minWidth: 0, padding: '10px 8px' }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.business_name}
                </p>
                {r.no_website && (
                  <p style={{ fontSize: 10, color: 'var(--warning)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Globe size={9} /> No website
                  </p>
                )}
              </div>

              <div style={{ flex: '0 0 110px', padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.niche}
              </div>

              <div style={{ flex: '0 0 100px', padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.city || '—'}
              </div>

              <div style={{ flex: '0 0 130px', padding: '10px 8px', fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: r.monthly_labor_cost ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {r.monthly_labor_cost ? `$${r.monthly_labor_cost.toLocaleString()}/mo` : (r.review_count ? `${r.review_count} reviews` : '—')}
              </div>

              <div style={{ flex: '0 0 120px', padding: '10px 8px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.phone || '—'}
              </div>

              <div style={{ flex: '0 0 80px', padding: '10px 16px 10px 8px', display: 'flex', justifyContent: 'flex-end' }}>
                {r.already_in_db ? (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Database size={9} /> In DB
                  </span>
                ) : (
                  <span style={{ fontSize: 10, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <CheckCircle size={9} /> New
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Indeed tab ────────────────────────────────────────────────────────────────

function IndeedTab() {
  const [selectedNiches, setSelectedNiches] = useState(['HVAC', 'Plumbing', 'Roofing'])
  const [location,    setLocation]    = useState('Dallas, TX')
  const [minPay,      setMinPay]      = useState('12')
  const [loading,     setLoading]     = useState(false)
  const [results,     setResults]     = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [importing,   setImporting]   = useState(false)
  const [importMsg,   setImportMsg]   = useState('')
  const [error,       setError]       = useState('')

  async function handleScrape() {
    if (!selectedNiches.length) { setError('Select at least one niche.'); return }
    setLoading(true); setResults([]); setSelectedIds(new Set()); setError(''); setImportMsg('')
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('indeed-scraper', {
        body: {
          niches:       selectedNiches,
          location,
          minHourlyPay: parseFloat(minPay) || 12,
          maxResults:   25,
        },
      })
      if (fnErr) throw fnErr
      setResults(data.results || [])
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setLoading(false)
    }
  }

  function toggleRow(i) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  function toggleAll(allSelected) {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      const newIds = new Set(
        results.map((r, i) => (!r.already_in_db ? i : null)).filter(i => i !== null)
      )
      setSelectedIds(newIds)
    }
  }

  async function handleImport(subset) {
    const toImport = subset ?? results.filter((_, i) => selectedIds.has(i))
    const newLeads = toImport.filter(r => !r.already_in_db)
    if (!newLeads.length) { setImportMsg('No new leads to import.'); return }
    setImporting(true); setImportMsg('')
    try {
      // Whitelist to real `leads` columns — strips display-only extras
      // (already_in_db, no_website, website, rating, review_count, etc.).
      const { error: insErr } = await supabase.from('leads').insert(
        newLeads.map(toLeadRow)
      )
      if (insErr) throw insErr
      setImportMsg(`✅ Imported ${newLeads.length} leads.`)
      setSelectedIds(new Set())
    } catch (err) {
      setImportMsg(`❌ Import failed: ${err?.message || err}`)
    } finally {
      setImporting(false)
    }
  }

  const newCount = results.filter(r => !r.already_in_db).length

  return (
    <div>
      {/* Config panel */}
      <div style={{
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border)',
        borderRadius: 8, padding: '16px', marginBottom: 16,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, marginBottom: 16 }}>
          <div>
            <p className="section-label" style={{ marginBottom: 6 }}>Location</p>
            <input
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="Dallas, TX"
              style={{
                width: '100%', height: 32, padding: '0 10px',
                background: 'var(--bg-base)', border: '0.5px solid var(--border)',
                borderRadius: 6, fontSize: 13, color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)',
              }}
            />
          </div>
          <div>
            <p className="section-label" style={{ marginBottom: 6 }}>Min Hourly Pay ($)</p>
            <input
              type="number"
              value={minPay}
              onChange={e => setMinPay(e.target.value)}
              min={0}
              style={{
                width: '100%', height: 32, padding: '0 10px',
                background: 'var(--bg-base)', border: '0.5px solid var(--border)',
                borderRadius: 6, fontSize: 13, color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button onClick={handleScrape} disabled={loading || !selectedNiches.length} size="md">
              {loading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={13} />}
              {loading ? 'Scraping…' : 'Run Scrape'}
            </Button>
          </div>
        </div>

        <div>
          <p className="section-label" style={{ marginBottom: 8 }}>Niches</p>
          <NicheGrid niches={INDEED_NICHES} selected={selectedNiches} onChange={setSelectedNiches} />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', borderRadius: 6,
          background: 'var(--danger-dim)', border: '0.5px solid var(--danger)',
          fontSize: 13, color: 'var(--danger)', marginBottom: 12,
        }}>
          <AlertTriangle size={13} />
          {error}
        </div>
      )}

      {/* Results header */}
      {results.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            Found <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{results.length}</span> results ·{' '}
            <span style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>{newCount}</span> new
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {importMsg && (
              <span style={{ fontSize: 12, color: importMsg.startsWith('✅') ? 'var(--success)' : 'var(--danger)' }}>
                {importMsg}
              </span>
            )}
            <Button
              variant="secondary" size="sm"
              onClick={() => handleImport(results.filter(r => !r.already_in_db))}
              disabled={importing || newCount === 0}
            >
              <Download size={12} />
              Import All New ({newCount})
            </Button>
            <Button
              variant="primary" size="sm"
              onClick={() => handleImport(null)}
              disabled={importing || selectedIds.size === 0}
            >
              <Download size={12} />
              Import Selected ({selectedIds.size})
            </Button>
          </div>
        </div>
      )}

      <ResultsTable results={results} selectedIds={selectedIds} onToggle={toggleRow} onToggleAll={toggleAll} />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LeadScraper() {
  return (
    <div className="page-enter">
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          Lead Scraper
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          Indeed — find businesses hiring receptionists and dispatchers, your warmest leads
        </p>
      </div>

      <IndeedTab />
    </div>
  )
}
