// Canonical role → display label map (Prompt 299). The stored/coded role
// value ('rep', 'closer', 'admin', 'client' — DB rows, rep_id/repId columns,
// role === 'rep' checks, hook names like useReps()) is untouched and stays
// 'rep' everywhere internally; only use this when a role needs to render as
// user-visible text, where the house term for 'rep' is "Setter".
export const ROLE_LABELS = {
  rep: 'Setter',
  closer: 'Closer',
  admin: 'Admin',
  client: 'Client',
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role
}
