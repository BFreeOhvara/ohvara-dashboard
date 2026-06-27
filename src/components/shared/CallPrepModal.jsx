/**
 * CallPrepModal — shared call-prep modal BOX used by both the setter popup
 * (CallModal.jsx) and the closer popup (AppointmentCard.jsx).
 *
 * This component renders the MODAL BOX ONLY — no backdrop, no portal.
 * Callers are responsible for the createPortal + backdrop overlay wrapper so
 * they can inject their own error boundaries, post-call cards, etc.
 *
 * Using the same render code for both call sites guarantees pixel-identical
 * output — style drift is structurally impossible.
 *
 * Props:
 *   onClose            — called when X is clicked
 *   lead               — lead object (used for business_name in header)
 *   badge              — JSX for the status badge in the header
 *   subtitle           — string shown under business name in header
 *   infoContent        — JSX at the top of the left column (Field rows, links, etc.)
 *   statusOptions      — array of { value, label?, color, dim, border, note? }
 *   status             — currently selected status value (controlled, owned by parent)
 *   statusTouched      — boolean: has the user explicitly picked a status this session?
 *   onStatusSelect     — (value) => void — called when user picks from dropdown
 *   statusNote         — string | null | undefined — overrides selected.note below the dropdown.
 *                        Pass undefined to fall back to selected.note from statusOptions.
 *   statusAddon        — JSX below the dropdown (date pickers, conditional inputs, etc.)
 *   notes              — textarea value (controlled)
 *   onNotesChange      — (e) => void
 *   callSection        — JSX for the call button at the bottom of the left column
 *   footerHint         — string shown italic-muted when !statusTouched
 *   footerWarning      — string shown warning-color when statusTouched but can't save
 *   footerError        — string shown danger-color (overrides hint/warning)
 *   onDone             — called when Done button is clicked
 *   isDoneDisabled     — boolean
 *   doneLabel          — string (default: "Done")
 *   scriptLines        — string[] | undefined — when provided, renders the built-in SAY THIS
 *                        stepper instead of children. One block, one style, both callers.
 *   scriptStep         — number — current step index (controlled by parent)
 *   onScriptStepChange — (index: number) => void
 *   children           — right column content when scriptLines is not provided (e.g. ScriptWalk)
 */

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Phone, X, StickyNote, ChevronDown, Check } from 'lucide-react'

// Exported so callers can render info rows with identical styling.
export function Field({ icon: Icon, label, value, mono = false }) {
  if (!value) return null
  return (
    <div style={{ marginBottom: 12 }}>
      <p style={{
        fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
        color: 'var(--text-muted)', margin: '0 0 3px',
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        {Icon && <Icon size={10} />} {label}
      </p>
      <p style={{
        fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55,
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        wordBreak: 'break-word',
      }}>
        {value}
      </p>
    </div>
  )
}

export function CallPrepModal({
  onClose,
  lead,
  badge,
  subtitle,
  infoContent,
  statusOptions,
  status,
  statusTouched,
  onStatusSelect,
  statusNote,
  statusAddon,
  notes,
  onNotesChange,
  callSection,
  footerHint,
  footerWarning,
  footerError,
  onDone,
  isDoneDisabled,
  doneLabel = 'Done',
  scriptLines,
  scriptStep = 0,
  onScriptStepChange,
  children,
}) {
  // All dropdown UI state lives here — parent only gets the selected value.
  const dropdownRef = useRef(null)
  const triggerRef  = useRef(null)
  const menuRef     = useRef(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [statusMenuCoords, setStatusMenuCoords] = useState(null)

  // Scroll lock — lock both <body> and <html>; locking only body still lets
  // documentElement scroll (including programmatic scrolls).
  useEffect(() => {
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [])

  // Close dropdown on outside click. Menu is portaled to document.body so we
  // check both the trigger wrapper and the portaled menu node.
  useEffect(() => {
    function onDocClick(e) {
      const inTrigger = dropdownRef.current && dropdownRef.current.contains(e.target)
      const inMenu    = menuRef.current    && menuRef.current.contains(e.target)
      if (!inTrigger && !inMenu) setStatusOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function toggleStatusMenu() {
    if (!statusOpen && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setStatusMenuCoords({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    setStatusOpen(v => !v)
  }

  function handleSelectStatus(value) {
    setStatusOpen(false)
    onStatusSelect(value)
  }

  const selected    = statusOptions.find(o => o.value === status)
  const displayNote = statusNote !== undefined ? statusNote : selected?.note
  // label || value fallback: CallModal's STATUS_OPTIONS have no label field.
  // When status exists but isn't in options (e.g. "pending" default), show it
  // capitalized instead of the generic placeholder.
  const triggerLabel = selected
    ? (selected.label || selected.value)
    : status
      ? status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : 'Pick an outcome'
  const doneLit = statusTouched && !footerWarning

  // SAY THIS stepper — derived values used in right column when scriptLines is provided.
  // scriptLines entries may be plain strings OR { text, color } objects.
  const currentEntry   = scriptLines ? (scriptLines[scriptStep] || '') : null
  const lineColor      = (currentEntry && typeof currentEntry === 'object' ? currentEntry.color : null) || 'var(--accent)'
  const scriptRawLine  = currentEntry ? (typeof currentEntry === 'object' ? currentEntry.text : currentEntry) : ''
  const scriptIsAsk    = !!scriptRawLine && scriptRawLine.startsWith('[ASK]')
  const scriptDisplay  = scriptIsAsk ? scriptRawLine.replace(/^\[ASK\]\s*/, '') : scriptRawLine
  const scriptCanNext  = !!scriptLines && scriptStep < scriptLines.length - 1
  const scriptCanBack  = !!scriptLines && scriptStep > 0

  return (
    <div style={{
      width: '100%', maxWidth: 960, maxHeight: '88vh',
      display: 'flex', flexDirection: 'column',
      background: '#0E0E1A',
      border: '0.5px solid var(--border)',
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
    }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 18px',
        borderBottom: '0.5px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: 'var(--accent-dim)',
          border: '0.5px solid var(--accent-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Phone size={16} color="var(--accent)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead.business_name}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
            {subtitle}
          </p>
        </div>
        {badge}
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 8 }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Body — two columns */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* LEFT column */}
        <div
          className="scrollbar-thin"
          style={{
            flex: '0 0 340px', minWidth: 0,
            borderRight: '0.5px solid var(--border)',
            overflowY: 'auto',
            padding: '16px 18px',
          }}
        >
          {infoContent}

          {/* Status dropdown */}
          <div style={{ marginBottom: 14 }} ref={dropdownRef}>
            <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 6px' }}>
              Status
            </p>
            <div style={{ position: 'relative' }} ref={triggerRef}>
              <button
                onClick={toggleStatusMenu}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  width: '100%', height: 40, padding: '0 12px',
                  background: selected ? selected.dim : 'var(--bg-elevated)',
                  border: `0.5px solid ${selected ? selected.border : 'var(--border)'}`,
                  borderRadius: 8, cursor: 'pointer', fontSize: 13,
                  color: selected ? selected.color : 'var(--text-secondary)',
                  fontWeight: 500,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {selected && <span style={{ width: 8, height: 8, borderRadius: '50%', background: selected.color, flexShrink: 0 }} />}
                  {triggerLabel}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ChevronDown size={14} />
                </span>
              </button>

              {statusOpen && statusMenuCoords && createPortal(
                <div ref={menuRef} style={{
                  position: 'fixed',
                  top: statusMenuCoords.top, left: statusMenuCoords.left, width: statusMenuCoords.width,
                  zIndex: 2000,
                  background: '#13131F', border: '0.5px solid var(--border)',
                  borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}>
                  {statusOptions.map(o => (
                    <button
                      key={o.value}
                      onClick={() => handleSelectStatus(o.value)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 9,
                        width: '100%', padding: '11px 12px', border: 'none',
                        background: status === o.value ? o.dim : 'transparent',
                        cursor: 'pointer', fontSize: 13, fontWeight: 500,
                        color: o.color, textAlign: 'left',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = o.dim }}
                      onMouseLeave={e => { e.currentTarget.style.background = status === o.value ? o.dim : 'transparent' }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: o.color, flexShrink: 0, marginTop: o.note ? 3 : 0, alignSelf: o.note ? 'flex-start' : 'center' }} />
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        {o.label || o.value}
                        {o.note && (
                          <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', lineHeight: 1.3 }}>
                            {o.note}
                          </span>
                        )}
                      </span>
                      {status === o.value && <Check size={12} style={{ marginLeft: 'auto', flexShrink: 0 }} />}
                    </button>
                  ))}
                </div>,
                document.body
              )}
            </div>

            {displayNote && (
              <p style={{ fontSize: 11, color: selected?.color, margin: '5px 0 0', opacity: 0.9 }}>
                {displayNote}
              </p>
            )}
          </div>

          {statusAddon}

          {/* Call notes */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <StickyNote size={10} /> Call Notes
            </p>
            <textarea
              value={notes}
              onChange={onNotesChange}
              placeholder="What happened on this call? Pain points, who answered, best time to retry…"
              rows={3}
              style={{
                width: '100%', padding: '8px 10px',
                background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                borderRadius: 8, fontSize: 13, color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)', resize: 'vertical', lineHeight: 1.5,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {callSection}
        </div>

        {/* RIGHT column — built-in SAY THIS stepper when scriptLines provided, else children */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {scriptLines ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 18px', minHeight: 0 }}>
                  <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: lineColor, fontWeight: 700, margin: '0 0 0' }}>
                Say This
              </p>
              {/* Quote box — matches ScriptWalk SayCard exactly: left-only accent border */}
              <div style={{
                background: 'var(--bg-elevated)',
                border: '0.5px solid var(--border)',
                borderLeft: `3px solid ${lineColor}`,
                borderRadius: 12, padding: '18px 20px',
              }}>
                {scriptIsAsk && (
                  <span style={{
                    display: 'inline-block', marginBottom: 8,
                    padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                    background: 'var(--accent-dim)', border: '0.5px solid var(--accent-border)',
                    color: 'var(--accent)', letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>Ask</span>
                )}
                <p style={{ fontSize: 17, color: 'var(--text-primary)', lineHeight: 1.55, margin: 0, fontWeight: 500 }}>
                  {scriptDisplay}
                </p>
              </div>
              {/* Next button — full width, accent follows section color */}
              <button
                onClick={() => onScriptStepChange(Math.min(scriptLines.length - 1, scriptStep + 1))}
                disabled={!scriptCanNext}
                style={{
                  width: '100%', height: 46,
                  background: scriptCanNext ? lineColor : 'var(--bg-elevated)',
                  border: scriptCanNext ? 'none' : '0.5px solid var(--border)',
                  borderRadius: 11, fontSize: 14.5, fontWeight: 600,
                  color: scriptCanNext ? '#0E0E1A' : 'var(--text-muted)',
                  cursor: scriptCanNext ? 'pointer' : 'not-allowed',
                  transition: 'opacity 0.15s',
                }}
              >Next →</button>
              {/* Back / Start Over / counter — separate row below Next, only when multi-line */}
              {scriptLines.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={() => onScriptStepChange(Math.max(0, scriptStep - 1))}
                    disabled={!scriptCanBack}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      background: scriptCanBack ? 'var(--accent-dim)' : 'none',
                      border: `0.5px solid ${scriptCanBack ? 'var(--accent-border)' : 'transparent'}`,
                      borderRadius: 8, cursor: scriptCanBack ? 'pointer' : 'not-allowed',
                      color: scriptCanBack ? 'var(--accent)' : 'var(--text-muted)',
                      fontSize: 12, fontWeight: 500,
                      opacity: scriptCanBack ? 1 : 0.4, padding: '5px 10px',
                    }}
                  >← Back</button>
                  <button
                    onClick={() => onScriptStepChange(0)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      background: 'none', border: '0.5px solid transparent',
                      borderRadius: 8, cursor: 'pointer',
                      color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, padding: '5px 10px',
                    }}
                  >↺ Start over</button>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 0 auto', fontFamily: 'var(--font-mono)' }}>
                    {scriptStep + 1} / {scriptLines.length}
                  </p>
                </div>
              )}
            </div>
          ) : children}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12,
        padding: '12px 18px',
        borderTop: '0.5px solid var(--border)',
        flexShrink: 0,
      }}>
        {footerError && (
          <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}>{footerError}</p>
        )}
        {!footerError && !statusTouched && footerHint && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>
            {footerHint}
          </p>
        )}
        {!footerError && statusTouched && footerWarning && (
          <p style={{ fontSize: 12, color: 'var(--warning)', margin: 0, fontStyle: 'italic' }}>
            {footerWarning}
          </p>
        )}
        <button
          onClick={onDone}
          disabled={isDoneDisabled}
          style={{
            padding: '9px 24px', borderRadius: 8,
            background: doneLit ? 'var(--accent)' : 'var(--bg-elevated)',
            border: doneLit ? 'none' : '0.5px solid var(--border)',
            fontSize: 13, fontWeight: 500,
            color: doneLit ? 'white' : 'var(--text-muted)',
            cursor: isDoneDisabled ? 'not-allowed' : 'pointer',
            opacity: isDoneDisabled ? (statusTouched ? 0.7 : 0.6) : 1,
            transition: 'all 0.15s',
          }}
        >
          {doneLabel}
        </button>
      </div>

    </div>
  )
}
