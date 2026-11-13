// P979 — Practice: a guided walkthrough per lesson that does something in the portal, run in the practice copy
// (lib/practice.js: the VA side at /template/fulfillment, sample info, nothing real changes). Nothing plays itself:
// for each step the spotlight and pointer move to the spot, the caption shows, Mark's voice reads the line, and the
// step waits for the VA to click that exact spot. Practice is part of the lesson: a lesson with a tour only counts
// as done once its Practice is finished (model.js). Pure data, no imports: it runs under node --test.
//
// A tour: { start: page key (template/ful/paths FUL), open: optional path under that page (a call's drawer), steps
//           (3 or 4), done: the line on the end card }.
// A step: { sel: CSS for the element (or the area to search), text: a button or link whose words (or label) start
//           with this, has: an element under sel whose words include this, say: the caption (**bold** = the thing
//           to click), voice: what Mark says (pre-rendered, ./practiceVoice.json), then: a second click in the same
//           step (e.g. open a list, then pick from it; no new line), act: 'click' (default) | 'type' (field: the
//           box that needs text before the button counts) }.

const REC = '.fx-rec' // a call or client pop-up
const SHEET = name => `.tp-sheet[aria-label="${name}"]`
const RESULT = SHEET('Record the result')
const MOVE = SHEET('Move this call')
const TAB = name => ({ sel: '.fx-tab', text: name })

// The servicing flow on a booked call whose pop-up is already open: Start call, Record the result, the result, Save.
const workIt = (intro, pick, pickSay, pickVoice) => [
  { sel: REC, text: 'Start call', say: 'Click **Start call**', voice: `${intro} At the booked time, click Start call.` },
  { sel: REC, text: 'Record the result', say: 'When the call is done, click **Record the result**', voice: 'When the call is done, click Record the result.' },
  pick
    ? { sel: RESULT, text: pick, say: pickSay, voice: pickVoice }
    : { sel: `${RESULT} button:not(.fx-x):not(.tp-primary)`, say: pickSay, voice: pickVoice },
  { sel: RESULT, text: 'Save result', say: 'Click **Save result**', voice: 'Then click Save result.' },
]
// Move a booked call whose pop-up is open: Move, another day, a time (open the list, pick), Move it.
const moveIt = intro => [
  { sel: REC, text: 'Move', say: 'Click **Move**', voice: `${intro} Click Move.` },
  { sel: `${MOVE} .fx-chip:not(:disabled):not(.is-on)`, say: 'Pick **another day**', voice: 'Pick another day.' },
  {
    sel: `${MOVE} .fx-sel`, say: 'Open **Pick a time** and choose an open time', voice: 'Open the times and pick one that\'s open. They\'re on the client\'s clock.',
    then: { sel: '.fx-selopt:not([class*="is-disable"])', say: 'Pick an **open time**' },
  },
  { sel: MOVE, text: 'Move it', say: 'Click **Move it**', voice: 'Click Move it. The call moves to the new time.' },
]

export const TOURS = {
  desk: {
    start: 'overview',
    done: 'You clocked in. Calls can ring you now.',
    steps: [
      { ...TAB('Schedule'), say: 'Click **Schedule** at the top', voice: 'Start of your shift. Click Schedule, up top.' },
      { sel: 'main', text: 'Clock in', say: 'Click **Clock in**', voice: 'This is your week. Click Clock in to start your shift.' },
      { sel: SHEET('Quick device check'), text: 'Clock in', say: 'When the check is done, click **Clock in**', voice: 'A quick device check runs. When it\'s done, click Clock in.' },
    ],
  },
  speed: {
    start: 'overview',
    done: 'You opened your next call, read the brief and started it.',
    steps: [
      { sel: '.ov946-hero', text: 'Open the call', say: 'Click **Open the call**', voice: 'Your next call is at the top of your Overview. Click Open the call.' },
      { sel: `${REC} .fx-rec-f`, text: 'Start call', say: 'Read the brief, then click **Start call**', voice: 'This is the brief: who, why, and the agent\'s note. Read it, then click Start call.' },
      { sel: '.fs-call', text: 'Slide the phone away', say: 'Click **Slide the phone away**', voice: 'The phone opens with the call on. Slide it away to see the call\'s steps. The call stays up.' },
    ],
  },
  welcome: {
    start: 'calendar', open: 'st-13?day=2026-11-05',
    done: 'You worked a welcome call from Start to result.',
    steps: workIt('Maria Lopez\'s welcome call is open.', 'Welcomed', 'Pick **Welcomed**', 'She\'s welcomed and her details are right, so pick Welcomed.'),
  },
  carrier: {
    start: 'calendar', open: 'cl-8?day=2026-11-05',
    done: 'You rang the client, then added her old carrier to the call.',
    steps: [
      { sel: REC, text: 'Start call', say: 'Click **Start call**', voice: 'Gloria Santos\'s cancel call is open. You ring Gloria first. Click Start call.' },
      { sel: '.fs-call', text: 'Add a carrier', say: 'Click **Add** to bring in the carrier', voice: 'Gloria\'s on the line. Now click Add, to bring in her old carrier.' },
      { sel: '.fs-call', text: 'Globe Life', say: 'Pick **Globe Life**', voice: 'Pick Globe Life, the carrier of the policy she\'s cancelling.' },
    ],
  },
  saves: {
    start: 'calendar', open: 'st-12?day=2026-11-05',
    done: 'You worked a save call from Start to result.',
    steps: workIt('Nadia Khan\'s lapse save call is open.', '', 'Pick **what happened** on the call', 'Pick what happened on the call.'),
  },
  changes: {
    start: 'calendar', open: 'st-16?day=2026-11-06',
    done: 'You worked a change request from Start to result.',
    steps: workIt('Irene Baker\'s name change call is open.', '', 'Pick **what happened** on the call', 'Pick what happened on the call.'),
  },
  callbacks: {
    start: 'calendar', open: 'cb-1?day=2026-11-05',
    done: 'You moved a callback to a new time.',
    steps: moveIt('Denise Walker\'s callback is open. Need another time?'),
  },
  packets: {
    start: 'overview',
    done: 'You opened a client and their policy packet check.',
    steps: [
      { ...TAB('Clients'), say: 'Click **Clients** at the top', voice: 'Click Clients, up top. It\'s every client you look after.' },
      { sel: '[aria-label="Open Renee Ortiz"]', say: 'Open **Renee Ortiz**', voice: 'Open Renee Ortiz.' },
      { sel: REC, text: 'Policy packet check', say: 'Click **Policy packet check**', voice: 'Her card lists her steps. Click Policy packet check.' },
    ],
  },
  payments: {
    start: 'overview',
    done: 'You opened a client with a failed draft and their payment call.',
    steps: [
      { ...TAB('Clients'), say: 'Click **Clients** at the top', voice: 'Click Clients, up top.' },
      { sel: '[aria-label="Open Luis Ortega"]', say: 'Open **Luis Ortega**', voice: 'Open Luis Ortega. His draft failed.' },
      { sel: REC, text: 'Payment change', say: 'Click **Payment change**', voice: 'His payment call is already booked. Click Payment change to open it.' },
    ],
  },
  reminders: {
    start: 'calendar', open: 'cl-9?day=2026-11-05',
    done: 'You rebooked a call.',
    steps: moveIt('Harold Nguyen\'s call is open. Need to rebook it?'),
  },
  inbound: {
    start: 'overview',
    done: 'You found your calls on the phone and brought it back.',
    steps: [
      { sel: '.fs-ri-phone', say: 'Click **Phone** on the left rail', voice: 'Your phone lives on the left rail. Click Phone to open it.' },
      { sel: '.fs-call', text: 'Recent', say: 'Click **Recent**', voice: 'Click Recent: the calls you made and took today.' },
      { sel: '.fs-call', text: 'To call', say: 'Click **To call**', voice: 'Click To call: today\'s booked calls. A call that comes in rings here too.' },
      { sel: '.fs-call', text: 'Slide the phone away', say: 'Click **Slide the phone away**', voice: 'Click Slide the phone away. A call stays up while you move around.' },
    ],
  },
  escalate: {
    start: 'overview',
    done: 'You opened a client and found their agent.',
    steps: [
      { ...TAB('Clients'), say: 'Click **Clients** at the top', voice: 'Click Clients, up top.' },
      { sel: '[aria-label="Open Gloria Santos"]', say: 'Open **Gloria Santos**', voice: 'Open Gloria Santos.' },
      { sel: `${REC} [aria-label="Close"]`, say: 'Her card shows her agent. Click **Close**', voice: 'Her card shows her agent. Questions about coverage, price or advice go to that agent. Click Close when you\'re done.' },
    ],
  },
  logging: {
    start: 'overview',
    done: 'You logged the result of a call.',
    steps: [
      { sel: '[aria-label="Calls and more"]', say: 'Click the **+** on the left rail', voice: 'After a call, click the plus on the left rail.' },
      { sel: '[role="menu"], .fx-pop, body', text: 'Log a call', say: 'Click **Log a call**', voice: 'Click Log a call.' },
      { sel: SHEET('Log a call'), has: 'Gloria Santos', say: 'Pick **Gloria Santos**', voice: 'Pick the call you just made: Gloria Santos.' },
      { sel: `${REC} .fx-rec-f`, text: 'No answer', say: 'Pick **No answer**', voice: 'Pick how it went. Here, No answer.' },
    ],
  },
  timeoff: {
    start: 'schedule',
    done: 'You booked a day off and found your pay.',
    steps: [
      { sel: 'main', text: 'Request a day off', say: 'Click **Request a day off**', voice: 'Can\'t work a day? On your Schedule, click Request a day off.' },
      { sel: `${SHEET('Request a day off')} .fx-chip:not(:disabled):not(.is-on)`, say: 'Pick **the day**', voice: 'Pick the day.' },
      { sel: SHEET('Request a day off'), text: 'Book it', say: 'Click **Book it**', voice: 'Click Book it.' },
      { ...TAB('Pay'), say: 'Click **Pay** at the top', voice: 'Your pay is on Pay. Click it to see this week and your next payday.' },
    ],
  },
}

// Shared lines: the end of every Practice, and the help step when the phone covers the spot.
export const FINISH = { key: 'finish', say: 'That\'s it, you\'ve got it', voice: 'That\'s it, you\'ve got it.' }
export const PHONE_AWAY = { key: 'phone', sel: '.fs-call', text: 'Slide the phone away', say: 'The phone is in the way. Click **Slide the phone away**', voice: 'The phone is in the way. Slide it aside first.' }

export const hasTour = id => !!TOURS[id]
export const tourOf = id => TOURS[id] || null
export const clipKey = (id, i) => `${id}-${i + 1}`

// Every line Mark says, keyed like ./practiceVoice.json, for the clip generator and the tests.
export function voiceLines() {
  const out = []
  for (const [id, t] of Object.entries(TOURS)) t.steps.forEach((s, i) => out.push({ key: clipKey(id, i), text: s.voice }))
  out.push({ key: FINISH.key, text: FINISH.voice }, { key: PHONE_AWAY.key, text: PHONE_AWAY.voice })
  return out
}
// A short fingerprint of a line, so a changed line without a new clip is caught (FNV-1a, hex).
export function lineHash(s) {
  let h = 0x811c9dc5
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}
