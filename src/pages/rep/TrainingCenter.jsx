import { Card } from '../../components/ui/Card'
import { Play, MessageSquare, BookOpen } from 'lucide-react'

const PLACEHOLDER_VIDEOS = [
  { id: 1, title: 'Cold Call Framework', duration: '8:42', category: 'Fundamentals' },
  { id: 2, title: 'Handling "Not Interested"', duration: '5:15', category: 'Objections' },
  { id: 3, title: 'Getting Past the Gatekeeper', duration: '6:30', category: 'Techniques' },
  { id: 4, title: 'Booking the Appointment', duration: '7:18', category: 'Closing' },
]

const OBJECTIONS = [
  { q: '"I\'m not interested."', a: 'Totally understand — before I let you go, can I ask one quick question? What would make a website worth it for your business?' },
  { q: '"I already have someone for that."', a: 'That\'s great! Out of curiosity, are they getting you consistent leads, or more of a brochure site?' },
  { q: '"I don\'t have the budget."', a: 'Makes sense. Most of our clients said the same thing before they saw the ROI. What would one extra job per week be worth to you?' },
  { q: '"Just email me."', a: 'I can do that — what\'s the best email? And is tomorrow or Thursday better for a 10-minute follow-up call?' },
]

export default function TrainingCenter() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[var(--text-primary)]">Training Center</h1>
        <p className="text-[var(--text-muted)] text-sm mt-0.5">Videos, AI roleplay, and objection flashcards</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Videos */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-3">Training Videos</h2>
          <div className="space-y-2">
            {PLACEHOLDER_VIDEOS.map(v => (
              <Card key={v.id} className="flex items-center gap-4 hover:border-indigo-800 transition-colors cursor-pointer">
                <div className="w-10 h-10 rounded-lg bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                  <Play size={16} className="text-indigo-400 ml-0.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{v.title}</p>
                  <p className="text-xs text-[var(--text-muted)]">{v.category} · {v.duration}</p>
                </div>
              </Card>
            ))}
          </div>

          {/* AI Roleplay stub */}
          <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-3 mt-6">AI Roleplay</h2>
          <Card className="flex items-center gap-4 opacity-60 cursor-not-allowed">
            <div className="w-10 h-10 rounded-lg bg-purple-900/30 flex items-center justify-center flex-shrink-0">
              <MessageSquare size={16} className="text-purple-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Practice with AI Prospect</p>
              <p className="text-xs text-[var(--text-muted)]">Coming soon — AI will roleplay as a skeptical business owner</p>
            </div>
          </Card>
        </div>

        {/* Objection Flashcards */}
        <div>
          <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-3">
            <BookOpen size={13} className="inline mr-1.5" />
            Objection Flashcards
          </h2>
          <div className="space-y-3">
            {OBJECTIONS.map((o, i) => (
              <FlashCard key={i} q={o.q} a={o.a} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function FlashCard({ q, a }) {
  return (
    <details className="bg-[var(--bg-1)] border border-[var(--border)] rounded-[10px] overflow-hidden group">
      <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-[var(--text-primary)] select-none list-none flex items-center justify-between">
        {q}
        <span className="text-[var(--text-muted)] text-xs group-open:rotate-180 transition-transform inline-block">▼</span>
      </summary>
      <div className="px-4 pb-4 pt-1">
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border)] pt-3">{a}</p>
      </div>
    </details>
  )
}
