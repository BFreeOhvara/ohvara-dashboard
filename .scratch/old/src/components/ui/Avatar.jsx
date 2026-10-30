// Shared avatar — Prompt 407. Every avatar in the app used to be its own
// bespoke single-initial circle (13 separate call sites, several literally
// copy-pasted); this is the one place that renders a real uploaded photo, or
// falls back to a two-initial circle in one of exactly 4 colors
// (avatar_color, assigned once at signup and persisted — never re-randomized
// per render). Pass either a whole `profile` row (has full_name/avatar_url/
// avatar_color) or the three fields discretely (name/avatarUrl/avatarColor)
// for callers that only have those on hand, e.g. a chat message row.

const COLOR_TOKEN = {
  red: 'var(--danger)',
  blue: 'var(--info)',
  green: 'var(--success)',
  yellow: 'var(--warning)',
}

function getInitials(name) {
  return (name || '?').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'
}

export function Avatar({ profile, name, avatarUrl, avatarColor, size = 32, icon: Icon, ring, style }) {
  const displayName = profile ? profile.full_name : name
  const url = profile ? profile.avatar_url : avatarUrl
  const bg = COLOR_TOKEN[profile ? profile.avatar_color : avatarColor] || COLOR_TOKEN.blue

  const circle = (
    <div
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.38), fontWeight: 700, color: '#fff',
        background: url ? 'var(--bg-elevated)' : bg,
        ...(ring ? {} : style),
      }}
    >
      {url ? (
        <img
          src={url} alt={displayName || 'Avatar'}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : Icon ? (
        <Icon size={Math.round(size * 0.5)} />
      ) : (
        getInitials(displayName)
      )}
    </div>
  )

  // Optional colored ring around the circle (Performance leaderboard podium
  // borders the avatar by rank — gold/silver/bronze — independent of the
  // person's own avatar_color).
  if (!ring) return circle

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      border: `${ring.width || 2}px solid ${ring.color}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxSizing: 'border-box', ...style,
    }}>
      <Avatar profile={profile} name={name} avatarUrl={avatarUrl} avatarColor={avatarColor} size={size - (ring.width || 2) * 2 - 2} icon={Icon} />
    </div>
  )
}
