// P952 — the reactivation opener (src/lib/reactivation.js REACT_OPENER says the same; src/lib/reactivation.test.js
// checks they match). Plain JS so Deno and node --test both load it. The rest of the call is the P940 script.
export const REACT_OPENER = 'Hey {first}, this is Max with Deedstone Insurance. A while back you’d asked about mortgage protection, I’m just following up to see if that’s still something you’re looking into.'
export const reactOpener = first => REACT_OPENER.replace('{first}', String(first || '').trim() || 'there')
