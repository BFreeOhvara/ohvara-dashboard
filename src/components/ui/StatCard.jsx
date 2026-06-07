import { Card } from './Card'
import { clsx } from 'clsx'

export function StatCard({ label, value, sub, trend, icon: Icon, color = 'indigo' }) {
  const colors = {
    indigo: 'text-indigo-400 bg-indigo-900/30',
    green:  'text-green-400 bg-green-900/30',
    yellow: 'text-yellow-400 bg-yellow-900/30',
    red:    'text-red-400 bg-red-900/30',
    blue:   'text-blue-400 bg-blue-900/30',
  }

  return (
    <Card className="flex items-start gap-3">
      {Icon && (
        <div className={clsx('p-2 rounded-lg flex-shrink-0', colors[color])}>
          <Icon size={18} className={colors[color].split(' ')[0]} />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-slate-100 mt-0.5">{value ?? '—'}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        {trend !== undefined && (
          <p className={clsx('text-xs mt-0.5', trend >= 0 ? 'text-green-400' : 'text-red-400')}>
            {trend >= 0 ? '+' : ''}{trend}% vs last period
          </p>
        )}
      </div>
    </Card>
  )
}
