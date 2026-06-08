import { useCountUp } from '../../hooks/useCountUp'

/**
 * KPICard — animated counting number, glass morphism surface.
 *
 * Props:
 *   label         string   — ALL-CAPS label above the number
 *   value         number   — numeric value to count up to
 *   prefix        string   — prepend (e.g. '$')
 *   suffix        string   — append (e.g. '%')
 *   delta         string   — trend label shown below (e.g. '+12% vs last week')
 *   deltaPositive bool     — green if true, red if false
 *   accent        bool     — use accent glass treatment
 *   icon          component — Lucide icon to show in label row
 *   sub           string   — secondary line below the number (plain text, no countup)
 *   subColor      string   — CSS color for sub text
 */
export function KPICard({
  label,
  value = 0,
  prefix = '',
  suffix = '',
  delta,
  deltaPositive,
  accent = false,
  icon: Icon,
  sub,
  subColor,
}) {
  const animated = useCountUp(typeof value === 'number' ? value : 0)

  // If value is a string (like '40%'), skip countup and render directly
  const isNumeric = typeof value === 'number'
  const displayValue = isNumeric
    ? `${prefix}${animated.toLocaleString()}${suffix}`
    : value

  return (
    <div
      className={accent ? 'glass-accent' : 'glass'}
      style={{ padding: '18px 20px', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      {/* Label row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {Icon && <Icon size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
        <span style={{
          fontSize: 9,
          fontWeight: 500,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
        }}>
          {label}
        </span>
      </div>

      {/* Main value */}
      <div
        className="count-up"
        style={{
          fontSize: 32,
          fontWeight: 500,
          lineHeight: 1,
          letterSpacing: '-0.02em',
          color: accent ? '#9C8FFF' : 'var(--text-primary)',
        }}
      >
        {displayValue}
      </div>

      {/* Sub line */}
      {sub && (
        <div style={{ fontSize: 11, color: subColor || 'var(--text-muted)', marginTop: 4 }}>
          {sub}
        </div>
      )}

      {/* Delta */}
      {delta && (
        <div style={{
          fontSize: 10,
          marginTop: 4,
          color: deltaPositive ? 'var(--success)' : 'var(--danger)',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {deltaPositive ? '↑' : '↓'} {delta}
        </div>
      )}
    </div>
  )
}
