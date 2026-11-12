// P948 — "Show me how": a guided walkthrough per lesson that does something in the portal, played in the practice
// copy (lib/practice.js: the VA side at /template/fulfillment, sample info, nothing real changes). First the tour
// plays itself (a pointer moves, the page scrolls, the spot is highlighted with a caption); then "Your turn": the VA
// does the same steps with the highlights guiding them. Pure data, no imports: it runs under node --test.
//
// A tour: { start: page key (template/ful/paths FUL), steps, done: the line shown when they've got it }.
// A step: { sel: CSS for the element (or the area to search), text: a button or link whose words start with this,
//           has: an element under sel whose words include this, say: the caption, act: 'click' | 'look', wait: ms }.
// 'click' steps are clicked by the pointer (show) or by the VA (their turn); 'look' steps point at something to read.

const REC = '.fx-rec' // a call or client pop-up
const SHEET = name => `.tp-sheet[aria-label="${name}"]`
const RESULT = SHEET('Record the result')
const MOVE = SHEET('Move this call')

// Open a booked call on the Calendar by who and when (the event's words start with the name, then the time).
const openOnCalendar = (who, say) => ({ sel: '.fs-ev', text: who, say, act: 'click' })
// The servicing flow on a booked call: Start call, Record the result, pick the result, Save result.
const workIt = (pick, pickSay) => [
  { sel: REC, text: 'Start call', say: 'At the booked time, press Start call. The phone rings the client.', act: 'click' },
  { sel: '.fs-call', text: 'Slide the phone away', say: 'The phone opens with the call on. Slide it aside to see the call\'s steps. The call stays up.', act: 'click' },
  { sel: REC, text: 'Record the result', say: 'When the call is done, press Record the result.', act: 'click' },
  pick ? { sel: RESULT, text: pick, say: pickSay, act: 'click' } : { sel: `${RESULT} button:not(.fx-x):not(.tp-primary)`, say: pickSay, act: 'click' },
  { sel: RESULT, text: 'Save result', say: 'Press Save result. The client\'s next step books itself.', act: 'click' },
]
// Move a booked call: Move, another day, a time on the client's clock, Move it.
const moveIt = [
  { sel: REC, text: 'Move', say: 'They want another time? Press Move.', act: 'click' },
  { sel: `${MOVE} .fx-chip:not(:disabled):not(.is-on)`, say: 'Pick another day.', act: 'click' },
  { sel: `${MOVE} .fx-sel`, say: 'Open the times. They are on the client\'s clock.', act: 'click' },
  { sel: '.fx-selopt:not([class*="is-disable"])', say: 'Pick an open time.', act: 'click' },
  { sel: MOVE, text: 'Move it', say: 'Press Move it. The client gets a text with the new time.', act: 'click' },
]
// Open a client from the Clients page and read their card.
const openClient = (who, look) => [
  { sel: '.fx-tab', text: 'Clients', say: 'Open Clients: every client you look after.', act: 'click' },
  { sel: `[aria-label="Open ${who}"]`, say: `Open ${who}.`, act: 'click' },
  { sel: REC, say: look, act: 'look' },
  { sel: `${REC} [aria-label="Close"]`, say: 'Close the card when you\'re done. You\'re back where you were.', act: 'click' },
]

export const TOURS = {
  desk: {
    start: 'schedule',
    done: 'You clocked in. Calls can ring you now.',
    steps: [
      { sel: 'main section', has: 'Who is on shift', say: 'Who is on shift this week. Your own row says You. Check it at the start of each week.', act: 'look' },
      { sel: 'main', text: 'Clock in', say: 'Start of your shift: press Clock in, up to 15 minutes either side.', act: 'click' },
      { sel: SHEET('Quick device check'), say: 'A quick device check runs: microphone, speaker, notifications, network.', act: 'look', wait: 3600 },
      { sel: SHEET('Quick device check'), text: 'Clock in', say: 'Everything works. Press Clock in. You\'re Available.', act: 'click' },
    ],
  },
  speed: {
    start: 'overview',
    done: 'You read the brief and started the call.',
    steps: [
      { sel: '.ov946-hero', say: 'Your next call: who, why we\'re calling, the agent\'s note and a countdown.', act: 'look' },
      { sel: '.ov946-hero', text: 'Open the call', say: 'Press Open the call to read the brief before you dial.', act: 'click' },
      { sel: `${REC} .bc-box`, say: 'The brief: the old policy to cancel and by when, and what the agent said. Read it first.', act: 'look' },
      { sel: `${REC} .cp-steps`, say: 'The steps for this call, in order. You follow them on the call.', act: 'look' },
      { sel: `${REC} .fx-rec-f`, text: 'Start call', say: 'At the booked time, press Start call.', act: 'click' },
    ],
  },
  welcome: {
    start: 'calendar',
    done: 'You worked a welcome call from Start to result.',
    steps: [openOnCalendar('Maria Lopez', 'Open Maria Lopez\'s welcome call on your Calendar.'), ...workIt('Welcomed', 'She\'s welcomed and her details are right: pick Welcomed.')],
  },
  carrier: {
    start: 'calendar',
    done: 'You opened a cancel call, read the carrier\'s way and started it.',
    steps: [
      openOnCalendar('Gloria Santos', 'Open Gloria Santos\'s cancel call.'),
      { sel: `${REC} .bc-box`, say: 'Which old policy to cancel, and the draft date to beat.', act: 'look' },
      { sel: `${REC} .cp-steps`, say: 'How this carrier cancels: call Gloria, call the carrier, merge her in.', act: 'look' },
      { sel: `${REC} .fx-rec-f`, text: 'Start call', say: 'Press Start call. You ring Gloria first.', act: 'click' },
    ],
  },
  saves: {
    start: 'calendar',
    done: 'You worked a save call from Start to result.',
    steps: [openOnCalendar('Nadia Khan3:00', 'Open Nadia Khan\'s save call (a lapse notice).'), ...workIt('', 'Pick what happened on the call.')],
  },
  changes: {
    start: 'calendar',
    done: 'You worked a change request from Start to result.',
    steps: [openOnCalendar('Irene Baker8:30', 'Open Irene Baker\'s name change.'), ...workIt('', 'Pick what happened on the call.')],
  },
  callbacks: {
    start: 'calendar',
    done: 'You moved a callback to a new time.',
    steps: [openOnCalendar('Denise Walker2:30', 'Open Denise Walker\'s callback.'), ...moveIt],
  },
  packets: {
    start: 'overview',
    done: 'You opened a client and read where their policy is.',
    steps: openClient('Paul Rivera', 'Their card: where the policy is, step by step, and your work on this client.'),
  },
  payments: {
    start: 'overview',
    done: 'You opened a client with a failed draft and read their steps.',
    steps: openClient('Luis Ortega', 'A failed draft: the steps to save the policy, and the payment call already booked.'),
  },
  reminders: {
    start: 'calendar',
    done: 'You rebooked a call.',
    steps: [openOnCalendar('Harold Nguyen', 'Open Harold Nguyen\'s booked call.'), ...moveIt],
  },
  checkins: {
    start: 'calendar',
    done: 'You opened a client\'s callback and started it.',
    steps: [
      openOnCalendar('Denise Walker2:30', 'Open a client\'s callback. Lead replies go to the AI caller, so only clients reach you.'),
      { sel: `${REC} .cp-why, ${REC} .fx-rec-b`, say: 'Why they asked for a call.', act: 'look' },
      { sel: `${REC}`, text: 'Start call', say: 'Press Start call at the booked time.', act: 'click' },
    ],
  },
  fromai: {
    start: 'calendar',
    done: 'You read why a callback was booked and started it.',
    steps: [
      openOnCalendar('Denise Walker2:30', 'Open a callback on your Calendar.'),
      { sel: `${REC} .cp-why, ${REC} .fx-rec-b`, say: 'Why it was booked, in one line. Read it before you call.', act: 'look' },
      { sel: `${REC}`, text: 'Start call', say: 'Press Start call at the booked time.', act: 'click' },
    ],
  },
  inbound: {
    start: 'overview',
    done: 'You opened the phone and found your calls.',
    steps: [
      { sel: '.fs-ri-phone', say: 'The phone lives on the left rail. Open it.', act: 'click' },
      { sel: '.fs-call', has: 'To call', say: 'To call: today\'s booked calls, next first. A call that comes in rings here too.', act: 'look' },
      { sel: '.fs-call', text: 'Recent', say: 'Recent: the calls you made and took today.', act: 'click' },
      { sel: '.fs-call', text: 'Slide the phone away', say: 'Slide the phone away when you\'re done. A call stays up while you move around.', act: 'click' },
    ],
  },
  escalate: {
    start: 'overview',
    done: 'You opened a client and found their agent.',
    steps: openClient('Gloria Santos', 'Their card shows their agent. Coverage, price or advice questions go to that agent.'),
  },
  logging: {
    start: 'overview',
    done: 'You logged the result of a call.',
    steps: [
      { sel: '[aria-label="Calls and more"]', say: 'Open the + menu on the left rail.', act: 'click' },
      { sel: '[role="menu"], .fx-pop, body', text: 'Log a call', say: 'Choose Log a call.', act: 'click' },
      { sel: SHEET('Log a call'), has: 'Gloria Santos', say: 'Pick the call you just made.', act: 'click' },
      { sel: `${REC} .fx-rec-f`, text: 'No answer', say: 'Pick how it went. No answer: the next try books itself.', act: 'click' },
    ],
  },
  timeoff: {
    start: 'schedule',
    done: 'You asked for a day off and found your pay.',
    steps: [
      { sel: 'main', text: 'Request a day off', say: 'Can\'t work a day? On your Schedule, press Request a day off.', act: 'click' },
      { sel: `${SHEET('Request a day off')} .fx-chip:not(:disabled):not(.is-on)`, say: 'Pick the day.', act: 'click' },
      { sel: SHEET('Request a day off'), text: 'Book it', say: 'Press Book it. It\'s pending until an admin approves it.', act: 'click' },
      { sel: '.fx-tab', text: 'Pay', say: 'Your pay: open Pay.', act: 'click' },
      { sel: 'main section', has: 'Next payout', say: 'What you\'ve earned this week and your next payday. Days off aren\'t paid.', act: 'look' },
    ],
  },
}

export const hasTour = id => !!TOURS[id]
export const tourOf = id => TOURS[id] || null
