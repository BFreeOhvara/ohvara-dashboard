import { useState } from 'react'
import { X, Loader2, FileText, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import { supabase } from '../../lib/supabase'

const SECTIONS = ['opener', 'problem', 'solution', 'objections', 'close']
const LABELS = {
  opener:     'Opener',
  problem:    'Problem',
  solution:   'Pitch',
  objections: 'Objections',
  close:      'Close',
}

export function AIScriptPanel({ lead, onClose }) {
  const [script, setScript] = useState(null)
  const [loading, setLoading] = useState(false)
  const [activeSection, setActiveSection] = useState('opener')
  const [error, setError] = useState('')

  async function generateScript() {
    setLoading(true)
    setError('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('generate-ai-script', {
        body: {
          lead_id: lead.id,
          business_name: lead.business_name,
          contact_name: lead.contact_name,
          niche: lead.niche,
          city: lead.city,
          pain_points: lead.pain_points,
          notes: lead.notes,
        },
      })
      if (fnError) throw fnError
      setScript(data.script)
      setActiveSection('opener')
    } catch {
      setError('Failed to generate script. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 w-[400px] bg-[var(--bg-deep)] border-l border-[var(--border)] flex flex-col z-50 shadow-panel panel-slide-in">

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
                  ? 'text-indigo-300 border-b-2 border-indigo-500 bg-[var(--accent-subtle)]'
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
        {!script && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
            <div className="w-10 h-10 rounded-[10px] bg-[var(--accent-subtle)] flex items-center justify-center">
              <FileText className="text-indigo-400" size={18} />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">AI Call Script</p>
              <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                Generate a personalized script for {lead.business_name} before you dial.
              </p>
            </div>
            <Button onClick={generateScript}>Generate Script</Button>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 className="text-indigo-400 animate-spin" size={24} />
            <p className="text-xs text-[var(--text-muted)]">Writing your script…</p>
          </div>
        )}

        {error && (
          <div className="m-4 text-xs text-red-400 bg-red-500/10 border border-red-900 rounded-lg p-3">
            {error}
          </div>
        )}

        {script && !loading && (
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
          <Button variant="ghost" size="sm" onClick={generateScript} disabled={loading}>
            <RotateCcw size={12} />
            Regenerate
          </Button>
        </div>
      )}
    </div>
  )
}
