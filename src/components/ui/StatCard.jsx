import { clsx } from 'clsx'

const ICON_STYLES = {
  indigo: 'text-indigo-400 bg-indigo-500/10',
  green:  'text-green-400 bg-green-500/10',
  yellow: 'text-amber-400 bg-amber-500/10',
  red:    'text-red-400 bg-red-500/10',
  blue:   'text-blue-400 bg-blue-500/10',
  purple: 'text-purple-400 bg-purple-500/10',
}

export function StatCard({ label, value, sub, trend, icon: Icon, color = 'indigo' }) {
  const iconStyle = ICON_STYLES[color] || ICON_STYLES.indigo

  return (
    <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-xl p-4 shadow-card">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className={clsx('p-2 rounded-lg flex-shrink-0', iconStyle)}>
            <Icon size={16} className={iconStyle.split(' ')[0]} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="section-label mb-1">{label}</p>
          <p className="stat-value">{value ?? '—'}</p>
          {sub && <p className="text-xs text-[var(--text-muted)] mt-1">{sub}</p>}
          {trend !== undefined && (
            <p className={clsx('text-xs mt-1', trend >= 0 ? 'text-green-400' : 'text-red-400')}>
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last period
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
