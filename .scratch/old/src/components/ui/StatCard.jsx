import { clsx } from 'clsx'

const ICON_STYLES = {
  indigo: 'text-[var(--accent)] bg-[var(--accent-subtle)]',
  green:  'text-[#22C55E] bg-[#22C55E]/10',
  yellow: 'text-[#F59E0B] bg-[#F59E0B]/10',
  red:    'text-[#EF4444] bg-[#EF4444]/10',
  blue:   'text-[#3B82F6] bg-[#3B82F6]/10',
  purple: 'text-purple-400 bg-purple-500/10',
}

export function StatCard({ label, value, sub, trend, icon: Icon, color = 'indigo' }) {
  const iconStyle = ICON_STYLES[color] || ICON_STYLES.indigo
  const [iconColor] = iconStyle.split(' ')

  return (
    <div className="glass p-4 transition-colors duration-150 hover:bg-[var(--bg-elevated)]/40">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className={clsx('p-2 rounded-md flex-shrink-0', iconStyle)}>
            <Icon size={15} className={iconColor} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="section-label mb-2">{label}</p>
          <p className="stat-value">{value ?? '—'}</p>
          {sub && <p className="text-xs text-[var(--text-muted)] mt-1.5">{sub}</p>}
          {trend !== undefined && (
            <p className={clsx('text-xs mt-1.5 font-medium', trend >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]')}>
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
