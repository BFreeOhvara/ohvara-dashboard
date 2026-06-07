import { useState } from 'react'
import { X, Loader2, ChevronRight, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import { supabase } from '../../lib/supabase'

const SECTIONS = ['opener', 'problem', 'solution', 'objections', 'close']
const LABELS = {
  opener:     'Opener',
  problem:    'Problem Framing',
  solution:   'Solution Pitch',
  objections: 'Objection Handlers',
  close:      'Close / CTA',
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
    } catch (err) {
      setError('Failed to generate script. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-[#0c0f16] border-l border-[#2a3347] flex flex-col z-50 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a3347]">
        <div>
          <p className="text-sm font-semibold text-slate-100">{lead.business_name}</p>
          <p className="text-xs text-slate-500">{lead.contact_name || 'Unknown contact'} · {lead.niche}</p>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* Section tabs */}
      {script && (
        <div className="flex border-b border-[#2a3347] overflow-x-auto scrollbar-thin">
          {SECTIONS.map(s => (
            <button
              key={s}
              onClick={() => setActiveSection(s)}
              className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
                activeSection === s
                  ? 'text-indigo-300 border-b-2 border-indigo-500'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {LABELS[s]}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
        {!script && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-12 h-12 rounded-full bg-indigo-900/30 flex items-center justify-center">
              <ChevronRight className="text-indigo-400" size={24} />
            </div>
            <div>
              <p className="text-slate-200 font-medium">AI Call Script</p>
              <p className="text-slate-500 text-sm mt-1">
                Generate a personalized script for {lead.business_name} before you dial.
              </p>
            </div>
            <Button onClick={generateScript} size="md">
              Generate Script
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 className="text-indigo-400 animate-spin" size={28} />
            <p className="text-slate-400 text-sm">Writing your script…</p>
          </div>
        )}

        {error && (
          <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg p-3 mb-4">
            {error}
          </div>
        )}

        {script && !loading && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">{LABELS[activeSection]}</p>
            <div className="prose prose-sm prose-invert max-w-none">
              {script[activeSection]?.split('\n').map((line, i) => (
                line ? (
                  <p key={i} className="text-slate-200 text-sm leading-relaxed mb-2">{line}</p>
                ) : <br key={i} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {script && (
        <div className="px-5 py-3 border-t border-[#2a3347]">
          <Button variant="ghost" size="sm" onClick={generateScript} disabled={loading}>
            <RotateCcw size={14} />
            Regenerate
          </Button>
        </div>
      )}
    </div>
  )
}
