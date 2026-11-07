// P878 — the licence rules (N-H-11, N-D-06). No New York agents for now (Brayden, Q61).
export const NOT_TAKING = ['NY']
export const licenceReady = l => /^\d{6,10}$/.test(l.npn || '') && l.states.length > 0 && l.states.every(s => l.attested[s])
