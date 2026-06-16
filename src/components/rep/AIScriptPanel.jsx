import { useState } from 'react'
import { X, FileText, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import { buildCallScript, DISCOVERY_SCRIPT } from '../../lib/discoveryScript'

// Derived from the shared decision tree so this panel never drifts from the
// rep's Call Now script: one tab per block (Opener, branches A–E, Close).
const SECTIONS = DISCOVERY_SCRIPT.map(s => s.id)
const LABELS = Object.fromEntries(DISCOVERY_SCRIPT.map(s => [s.id, s.short]))

export function AIScriptPanel({ lead, onClose }) {
  const [script, setScript] = useState(null)
  const [activeSection, setActiveSection] = useState('opener')

  // The ONE universal script with this lead's real details filled in — fully
  // deterministic, no AI call, no pain_points. Ready the instant it's clicked.
  function generateScript() {
    setScript(buildCallScript(lead))
    setActiveSection('opener')
  }

  return (
    <div className="fixed inset-y-0 right-0 w-[400px] bg-[var(--bg-surface)] border-l border-[var(--border)] flex flex-col z-50 panel-slide-in">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border)]">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">{lead.business_name}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
            {lead.contact_name || 'Unknown contact'}
            {lead.niche && ` · ${lead.niche}`}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 rounded"
        >
          <X size={16} />
        </button>
      </div>

      {/* Section tabs — only visible once script is loaded */}
      {script && (
        <div className="flex border-b border-[var(--border)] overflow-x-auto scrollbar-thin">
          {SECTIONS.map(s => (
            <button
              key={s}
              onClick={() => setActiveSection(s)}
              className={[
                'px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors flex-1',
                activeSection === s
                  ? 'text-[var(--accent)] border-b-2 border-[var(--accent)] bg-[var(--accent-dim)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
              ].join(' ')}
            >
              {LABELS[s]}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!script && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
            <div className="w-10 h-10 rounded-[10px] bg-[var(--accent-subtle)] flex items-center justify-center">
              <FileText className="text-[var(--accent)]" size={18} />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Call Script</p>
              <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                Build the script for {lead.business_name} before you dial.
              </p>
            </div>
            <Button onClick={generateScript}>Generate Script</Button>
          </div>
        )}

        {script && (
          <div className="p-4">
            <p className="section-label mb-3">{LABELS[activeSection]}</p>
            <div className="space-y-2">
              {script[activeSection]?.split('\n').map((line, i) =>
                line
                  ? <p key={i} className="text-sm text-[var(--text-secondary)] leading-relaxed">{line}</p>
                  : <div key={i} className="h-2" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {script && (
        <div className="px-4 py-3 border-t border-[var(--border)]">
          <Button variant="ghost" size="sm" onClick={generateScript}>
            <RotateCcw size={12} />
            Rebuild
          </Button>
        </div>
      )}
    </div>
  )
}
