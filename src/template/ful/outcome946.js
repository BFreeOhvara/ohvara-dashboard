// No imports on purpose: it runs under node --test.
// P946: the outcome buttons wear the portal's status colours: done/reached green, no answer amber, a voicemail
// blue, a transfer or hand-off violet, do not call red.
export function outcomeTone(v) {
  const w = String(v || '').toLowerCase()
  if (w === 'cancelled' || w.startsWith('reached')) return 'green'
  if (w === 'no_answer' || w.startsWith('no answer')) return 'warn'
  if (w.includes('voicemail')) return 'blue'
  if (w.startsWith('transferred') || w.startsWith('handed')) return 'violet'
  if (w.includes('not to be called')) return 'rose'
  return 'mute'
}
