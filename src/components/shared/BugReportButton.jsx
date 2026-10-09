import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { Bug, X, CheckCircle2, Paperclip } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { eyebrow } from '../../lib/exportStyles'
import {
  useCreateBugReport, useBugReports,
  useResolveBugReport, useBugScreenshotUrl,
} from '../../hooks/useBugReports'

// Bug reports (Prompt 381 → 711 → 722). Prompt 722 removed the sidebar's round
// bug button: both halves now open from the account menu (AccountMenu.jsx) as
// controlled pieces. Non-admins get the submit form as a centred modal
// (description + optional screenshot -> one bug_reports row); admins get the
// company-wide inbox panel instead. What gets saved, and the useBugReports
// hooks, are unchanged.

// Mount while open; `onClose` unmounts it.
export function BugReportModal({ onClose }) {
  const { profile } = useAuth()
  if (!profile) return null
  return <ReportForm profile={profile} onClose={onClose} />
}

// Admin inbox panel, pinned to the bottom of the viewport `anchorLeft` px from
// the left (just right of the sidebar). Mount while open.
export function BugReportInbox({ onClose, anchorLeft = 268 }) {
  return <AdminInbox anchorLeft={anchorLeft} onClose={onClose} />
}

// ── Non-admin: submit form ───────────────────────────────────────────────────
function ReportForm({ profile, onClose }) {
  const { pathname } = useLocation()
  const [description, setDescription] = useState('')
  const [file, setFile] = useState(null)
  const [sent, setSent] = useState(false)
  const create = useCreateBugReport()

  const close = onClose

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function submit() {
    if (!description.trim()) return
    create.mutate(
      { reporterId: profile.id, description: description.trim(), screenshotFile: file, pageUrl: pathname },
      { onSuccess: () => setSent(true) }
    )
  }

  const disabled = !description.trim() || create.isPending

  return createPortal(
        <div
          onClick={close}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 440, background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
              borderRadius: 12, padding: 20, boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>Report a problem</span>
              <button onClick={close} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>

            {sent ? (
              <>
                <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
                  <CheckCircle2 size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />
                  Thanks — this has been sent to the admin team.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
                  <button onClick={close} style={{ height: 34, padding: '0 16px', border: 'none', borderRadius: 6, background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700 }}>
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <label style={{ ...eyebrow, display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>What happened?</label>
                <textarea
                  autoFocus
                  rows={5}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Describe what you were doing and what went wrong..."
                  style={{
                    width: '100%', resize: 'none', background: 'var(--bg-elevated)',
                    border: 'var(--border-w) solid var(--border)', borderRadius: 8,
                    padding: '10px 12px', fontSize: 13, color: 'var(--text-primary)', marginBottom: 10,
                  }}
                />

                <label style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5,
                  color: 'var(--text-muted)', cursor: 'pointer', marginBottom: 16,
                }}>
                  <Paperclip size={12} />
                  {file ? file.name : 'Attach a screenshot (optional)'}
                  <input
                    type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => setFile(e.target.files?.[0] || null)}
                  />
                </label>

                {create.isError && (
                  <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--danger)' }}>
                    Could not submit: {create.error?.message || 'something went wrong. Try again.'}
                  </p>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button
                    onClick={close}
                    style={{ height: 34, padding: '0 16px', border: 'var(--border-w) solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 700 }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submit}
                    disabled={disabled}
                    style={{
                      height: 34, padding: '0 16px', border: 'none', borderRadius: 6,
                      background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700,
                      opacity: disabled ? 0.6 : 1,
                    }}
                  >
                    {create.isPending ? 'Sending…' : 'Submit'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
  )
}

// ── Admin: inbox ─────────────────────────────────────────────────────────────
function AdminInbox({ anchorLeft, onClose }) {
  const panelRef = useRef(null)
  const { data: reports = [] } = useBugReports()
  const resolve = useResolveBugReport()

  useEffect(() => {
    function onDown(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
    }
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed', bottom: 24, left: anchorLeft, zIndex: 9998,
            width: 380, maxWidth: `calc(100vw - ${anchorLeft + 12}px)`, maxHeight: 480, display: 'flex', flexDirection: 'column',
            background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 10,
            overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderBottom: '0.5px solid var(--border)', background: 'var(--bg-elevated)',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Bug reports</span>
            <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <X size={15} />
            </button>
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }} className="scrollbar-thin">
            {reports.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                <Bug size={20} style={{ color: 'var(--text-muted)', margin: '0 auto 8px' }} />
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No bug reports yet</p>
              </div>
            ) : (
              reports.map(r => (
                <BugReportRow key={r.id} report={r} onResolve={() => resolve.mutate(r.id)} resolving={resolve.isPending} />
              ))
            )}
          </div>
        </div>,
        document.body
  )
}

function fmtTime(iso) {
  const d = new Date(iso)
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function BugReportRow({ report, onResolve, resolving }) {
  const [expanded, setExpanded] = useState(false)
  const { data: screenshotUrl } = useBugScreenshotUrl(expanded ? report.screenshot_url : null)

  return (
    <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
            {report.reporter?.full_name || 'Unknown'}
            {report.status === 'new' && (
              <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: 'var(--danger)', background: 'var(--danger-dim)', padding: '1px 5px', borderRadius: 3 }}>
                NEW
              </span>
            )}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 10.5, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono',monospace" }}>
            {report.page_url || '—'} · {fmtTime(report.created_at)}
          </p>
        </div>
        {report.status !== 'resolved' && (
          <button
            onClick={onResolve}
            disabled={resolving}
            style={{ flexShrink: 0, height: 24, padding: '0 8px', border: '1px solid var(--border)', borderRadius: 5, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontSize: 10.5, fontWeight: 700 }}
          >
            Mark resolved
          </button>
        )}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        {report.description}
      </p>
      {report.screenshot_url && (
        expanded ? (
          screenshotUrl && (
            <a href={screenshotUrl} target="_blank" rel="noreferrer">
              <img src={screenshotUrl} alt="Screenshot" style={{ marginTop: 8, maxWidth: '100%', maxHeight: 160, borderRadius: 6, border: 'var(--border-w) solid var(--border)' }} />
            </a>
          )
        ) : (
          <button
            onClick={() => setExpanded(true)}
            style={{ marginTop: 8, border: 'none', background: 'transparent', color: 'var(--accent)', fontSize: 11, fontWeight: 700, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Paperclip size={11} /> View screenshot
          </button>
        )
      )}
    </div>
  )
}
