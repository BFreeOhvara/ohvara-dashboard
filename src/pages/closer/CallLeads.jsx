import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Phone, PhoneCall, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAllLeads } from '../../hooks/useLeads'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { Badge } from '../../components/ui/Badge'
import { CallButton } from '../../components/rep/CallButton'
import { CallModal } from '../../components/rep/CallModal'
import { AIScriptPanel } from '../../components/rep/AIScriptPanel'
import { Button } from '../../components/ui/Button'

const UNBOOKED_STATUSES = ['New', 'Contacted', 'Voicemail', 'No Answer', 'Interested']

function useRequestLeads() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ closerId, count }) => {
      const { data, error } = await supabase.rpc('request_closer_leads', {
        p_closer_id: closerId,
        p_count: count,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}

export default function CallLeads() {
  const { profile } = useAuth()
  const { data: allLeads, isLoading } = useAllLeads()
  const [scriptLead, setScriptLead] = useState(null)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const requestLeads = useRequestLeads()

  const currentLeadCount = allLeads?.length ?? 0
  const maxRequestable = Math.max(0, 500 - currentLeadCount)

  const leads = useMemo(() => {
    if (!allLeads) return []
    return allLeads.filter(l => UNBOOKED_STATUSES.includes(l.status))
  }, [allLeads])

  const filtered = useMemo(() => {
    if (!search.trim()) return leads
    const q = search.toLowerCase()
    const qDigits = q.replace(/\D/g, '')
    return leads.filter(l =>
      l.business_name?.toLowerCase().includes(q) ||
      l.niche?.toLowerCase().includes(q) ||
      l.city?.toLowerCase().includes(q) ||
      (qDigits && (l.phone || '').replace(/\D/g, '').includes(qDigits))
    )
  }, [leads, search])

  async function handleRequest(count) {
    if (!profile?.id || requestLeads.isPending) return
    return requestLeads.mutateAsync({ closerId: profile.id, count })
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Main panel — shrinks when script panel opens */}
      <div style={{
        flex: 1, minWidth: 0,
        marginRight: scriptLead ? 420 : 0,
        transition: 'margin-right 180ms cubic-bezier(0.16,1,0.3,1)',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
              My Leads
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              Unbooked leads across all reps —{' '}
              <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                {leads.length}
              </span>{' '}
              available
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Request Leads */}
            <button
              onClick={() => setModalOpen(true)}
              disabled={maxRequestable === 0}
              style={{
                height: 30, padding: '0 12px', borderRadius: 6, border: 'none',
                cursor: maxRequestable === 0 ? 'not-allowed' : 'pointer',
                background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 500,
                opacity: maxRequestable === 0 ? 0.5 : 1,
              }}
            >
              Request Leads
            </button>
            {maxRequestable === 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>At capacity (500)</span>
            )}
            {/* Search */}
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search business, niche, city, phone…"
              className="w-full sm:w-[220px]"
              style={{
                height: 30, padding: '0 10px',
                background: 'var(--bg-elevated)',
                border: '0.5px solid var(--border)',
                borderRadius: 6, fontSize: 12,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Table — glass surface with internally-scrollable rows. Desktop
            keeps the fixed-column table; mobile switches to self-labeling
            stacked cards inside LeadRow (Prompt 298 — the fixed `flex:'0 0
            Npx'` columns totaled 620px+ and were clipped by this container's
            `overflow:'hidden'`, unreachable on a phone; same fix pattern
            already shipped on the rep side's My Leads). */}
        <div className="glass" style={{ overflow: 'hidden', borderRadius: 10 }}>
          {/* Header row — desktop only; mobile cards are self-labeling */}
          <div className="hidden md:flex" style={{
            alignItems: 'center',
            background: 'var(--bg-elevated)',
            borderBottom: '0.5px solid var(--border)',
          }}>
            <div style={{ flex: '1 1 0', padding: '8px 16px' }} className="section-label">Business</div>
            <div style={{ flex: '0 0 110px', padding: '8px 8px' }} className="section-label">Niche</div>
            <div style={{ flex: '0 0 120px', padding: '8px 8px' }} className="section-label">Phone</div>
            <div style={{ flex: '0 0 140px', padding: '8px 8px' }} className="section-label">City</div>
            <div style={{ flex: '0 0 110px', padding: '8px 8px' }} className="section-label">Status</div>
            <div style={{ flex: '0 0 140px', padding: '8px 16px 8px 0', textAlign: 'right' }} className="section-label">Action</div>
          </div>

          {/* Rows — fixed scroll box */}
          <div className="scrollbar-thin" style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
            {isLoading ? (
              <div>
                {[...Array(8)].map((_, i) => (
                  <div key={i} style={{ height: 44, borderBottom: '0.5px solid var(--border)' }}>
                    <div style={{ margin: '14px 16px', height: 12, width: `${35 + (i % 4) * 12}%`, background: 'var(--bg-elevated)', borderRadius: 4, animation: 'pulse 2s infinite' }} />
                  </div>
                ))}
              </div>
            ) : !filtered.length ? (
              <div style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                padding: '48px 16px', textAlign: 'center',
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'var(--bg-elevated)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 12,
                }}>
                  <PhoneCall size={18} color="var(--text-muted)" />
                </div>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', margin: 0 }}>
                  {search ? 'No leads match that search' : 'No unbooked leads right now'}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {search ? 'Try a different search term.' : 'All leads are already booked or not interested.'}
                </p>
              </div>
            ) : (
              filtered.map(lead => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  onScriptOpen={() => setScriptLead(lead)}
                />
              ))
            )}
          </div>
        </div>

        {/* Row count */}
        {filtered.length > 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
            Showing {filtered.length} of {leads.length} unbooked leads
          </p>
        )}
      </div>

      {/* AI Script Panel */}
      {scriptLead && (
        <AIScriptPanel
          lead={scriptLead}
          onClose={() => setScriptLead(null)}
        />
      )}

      {/* Request Leads Modal */}
      {modalOpen && (
        <RequestLeadsModal
          currentCount={currentLeadCount}
          maxRequestable={maxRequestable}
          isPending={requestLeads.isPending}
          onClose={() => setModalOpen(false)}
          onRequest={handleRequest}
        />
      )}
    </div>
  )
}

function RequestLeadsModal({ currentCount, maxRequestable, isPending, onClose, onRequest }) {
  const [count, setCount] = useState(Math.min(50, maxRequestable))
  const [result, setResult] = useState(null)

  async function handleSubmit() {
    const assigned = await onRequest(count)
    setResult(assigned)
  }

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(8,8,16,0.85)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: '100%', maxWidth: 400,
        background: '#0E0E1A',
        border: '0.5px solid var(--border)',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '0.5px solid var(--border)' }}>
          <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>Request Leads</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20 }}>
          {result !== null ? (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <p style={{ fontSize: 28, fontWeight: 600, color: 'var(--success)', margin: '0 0 6px', fontFamily: 'var(--font-mono)' }}>
                +{result}
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 20px' }}>leads added to your queue</p>
              <Button onClick={onClose} style={{ width: '100%' }}>Done</Button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
                You currently hold{' '}
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 500 }}>{currentCount}</span>
                {' '}leads.{' '}
                {maxRequestable > 0
                  ? <>You can request up to <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 500 }}>{maxRequestable}</span> more.</>
                  : <span style={{ color: 'var(--danger)' }}>You're at the 500-lead cap.</span>
                }
              </p>

              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, margin: '0 0 6px' }}>
                  How many?
                </p>
                <input
                  type="number"
                  min={1}
                  max={maxRequestable}
                  value={count}
                  onChange={e => setCount(Math.min(maxRequestable, Math.max(1, Number(e.target.value) || 1)))}
                  disabled={maxRequestable === 0}
                  style={{
                    width: '100%', height: 38, padding: '0 12px', boxSizing: 'border-box',
                    background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                    borderRadius: 8, fontSize: 14, color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)', outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  onClick={handleSubmit}
                  disabled={isPending || maxRequestable === 0 || count < 1}
                  style={{ flex: 1 }}
                >
                  {isPending ? 'Requesting…' : `Request ${count}`}
                </Button>
                <Button variant="secondary" onClick={onClose} style={{ flex: '0 0 auto' }}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function LeadRow({ lead, onScriptOpen }) {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <div
        className="table-row-animated"
        style={{
          borderBottom: '0.5px solid var(--border)',
          transition: 'background-color 100ms',
          cursor: 'pointer',
        }}
        onClick={() => setModalOpen(true)}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        {/* Desktop table row — unchanged at md+ */}
        <div className="hidden md:flex" style={{ alignItems: 'center', minHeight: 44 }}>
          {/* Business */}
          <div style={{ flex: '1 1 0', minWidth: 0, padding: '10px 16px' }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lead.business_name}
            </p>
            {lead.city && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                {lead.city}{lead.state ? `, ${lead.state}` : ''}
              </p>
            )}
          </div>

          {/* Niche */}
          <div style={{ flex: '0 0 110px', padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead.niche || '—'}
          </div>

          {/* Phone */}
          <div style={{ flex: '0 0 120px', padding: '10px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead.phone || '—'}
          </div>

          {/* City */}
          <div style={{ flex: '0 0 140px', padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead.city || '—'}
          </div>

          {/* Status */}
          <div style={{ flex: '0 0 110px', padding: '10px 8px' }}>
            <Badge label={lead.status} />
          </div>

          {/* Action — stopPropagation so button click doesn't also fire the row onClick */}
          <div
            style={{ flex: '0 0 140px', padding: '8px 16px 8px 0', display: 'flex', justifyContent: 'flex-end' }}
            onClick={e => e.stopPropagation()}
          >
            <CallButton
              lead={lead}
              onScriptOpen={onScriptOpen}
              onCallEnd={() => {}}
            />
          </div>
        </div>

        {/* Mobile card — below md, self-labeling (Prompt 298, same pattern as
            the rep side's My Leads) */}
        <div className="flex md:hidden" style={{ flexDirection: 'column', gap: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                {lead.business_name}
              </p>
              {lead.city && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                  {lead.city}{lead.state ? `, ${lead.state}` : ''}
                </p>
              )}
            </div>
            <div style={{ flexShrink: 0 }}>
              <Badge label={lead.status} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lead.niche || '—'}
            </div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lead.phone || '—'}
            </div>
          </div>

          <div onClick={e => e.stopPropagation()}>
            <CallButton
              lead={lead}
              onScriptOpen={onScriptOpen}
              onCallEnd={() => {}}
            />
          </div>
        </div>
      </div>

      {modalOpen && <CallModal lead={lead} onClose={() => setModalOpen(false)} />}
    </>
  )
}
