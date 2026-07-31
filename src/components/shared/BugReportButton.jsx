import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { Bug, X, CheckCircle2, Paperclip } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import {
  useCreateBugReport, useBugReports, useUnresolvedBugReportCount,
  useResolveBugReport, useBugScreenshotUrl,
} from '../../hooks/useBugReports'

// Floating "Report a bug" button (Prompt 381) — Eterna-style: a small
// circular icon button fixed bottom-right on every authenticated page.
// Behavior branches on role, not just copy: non-admins get a submit form
// (description + optional screenshot -> one bug_reports row, no email/tab,
// just the DB row per Brayden's ask); admins get the company-wide inbox
// instead, with an unresolved-count badge on the button itself so he
// notices without opening it.
// Prompt 394: 390 doubled this from 44 to 88, too big — Brayden wants
// halfway between the original and the doubled size, so 66 (~1.5x original),
// not a straight revert to 44.
const BTN_SIZE = 66

const buttonBase = {
  position: 'fixed', bottom: 24, right: 24, zIndex: 9998,
  width: BTN_SIZE, height: BTN_SIZE, borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#13131F', border: '0.5px solid var(--border)',
  color: 'var(--text-secondary)', cursor: 'pointer',
  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
}

export function BugReportButton() {
  const { profile } = useAuth()
  if (!profile) return null
  return profile.role === 'admin'
    ? <AdminInbox />
    : <ReportForm profile={profile} />
}

// ── Non-admin: submit form ───────────────────────────────────────────────────
function ReportForm({ profile }) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [file, setFile] = useState(null)
  const [sent, setSent] = useState(false)
  const create = useCreateBugReport()

  function submit() {
    if (!description.trim()) return
    create.mutate(
      { reporterId: profile.id, description: description.trim(), screenshotFile: file, pageUrl: pathname },
      {
        onSuccess: () => {
          setDescription(''); setFile(null); setOpen(false); setSent(true)
          setTimeout(() => setSent(false), 4000)
        },
      }
    )
  }

  return (
    <>
      <button onClick={() => setOpen(true)} style={buttonBase} title="Report a bug">
        <Bug size={27} />
      </button>

      {sent && (
        <div style={{
          position: 'fixed', bottom: 24 + BTN_SIZE + 12, right: 24, zIndex: 9998,
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
          background: '#13131F', border: '0.5px solid var(--border)', borderRadius: 8,
          fontSize: 12.5, color: 'var(--text-primary)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        }}>
          <CheckCircle2 size={14} style={{ color: 'var(--success)' }} /> Bug report sent — thanks!
        </div>
      )}

      {open && createPortal(
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 340, background: '#13131F', border: '0.5px solid var(--border)',
              borderRadius: 10, padding: 18, boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>Report a bug</span>
              <button onClick={() => setOpen(false)} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>

            <textarea
              autoFocus
              rows={4}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What went wrong?"
              style={{
                width: '100%', resize: 'vertical', background: 'var(--bg-elevated)',
                border: 'var(--border-w) solid var(--border)', borderRadius: 6,
                padding: '8px 10px', fontSize: 12.5, color: 'var(--text-primary)', marginBottom: 10,
              }}
            />

            <label style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5,
              color: 'var(--text-muted)', cursor: 'pointer', marginBottom: 14,
            }}>
              <Paperclip size={12} />
              {file ? file.name : 'Attach a screenshot (optional)'}
              <input
                type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => setFile(e.target.files?.[0] || null)}
              />
            </label>

            <button
              onClick={submit}
              disabled={!description.trim() || create.isPending}
              style={{
                width: '100%', height: 34, border: 'none', borderRadius: 6,
                background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700,
                opacity: !description.trim() || create.isPending ? 0.6 : 1,
              }}
            >
              {create.isPending ? 'Sending…' : 'Submit'}
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// ── Admin: inbox ─────────────────────────────────────────────────────────────
function AdminInbox() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef(null)
  const btnRef = useRef(null)
  const { data: reports = [] } = useBugReports()
  const { data: unresolvedCount = 0 } = useUnresolvedBugReportCount()
  const resolve = useResolveBugReport()

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        panelRef.current && !panelRef.current.contains(e.target)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <>
      <button ref={btnRef} onClick={() => setOpen(v => !v)} style={{ ...buttonBase, position: 'fixed' }} title="Bug reports">
        <Bug size={27} />
        {unresolvedCount > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            minWidth: 17, height: 17, padding: '0 4px', borderRadius: 9,
            background: 'var(--danger)', color: '#fff', fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'JetBrains Mono',monospace", boxShadow: '0 0 6px var(--danger)',
          }}>
            {unresolvedCount}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed', bottom: 24 + BTN_SIZE + 12, right: 24, zIndex: 9998,
            width: 380, maxHeight: 480, display: 'flex', flexDirection: 'column',
            background: '#13131F', border: '0.5px solid var(--border)', borderRadius: 10,
            overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderBottom: '0.5px solid var(--border)', background: 'var(--bg-elevated)',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Bug reports</span>
            <button onClick={() => setOpen(false)} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
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
      )}
    </>
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
