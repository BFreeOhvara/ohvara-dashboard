// P872 — VA training: one lesson per job, versioned data in the repo (P852 moves progress, and edits, to the database).
// Each lesson: the steps in order, the words to say, do's and don'ts, what to click (a picture of that screen with
// numbered spots, from ./shots.json), and a 3-5 question check. Drafted from Atlas (the Playbook decisions, the System
// Map, the servicing spec, va-shifts.md, P868 carrier hours, P871's Portal Map). Words a client hears carry approve: true
// (listed in admin Settings > Wording to approve; no draft marker on screen since P924). P976: VAs only talk to sold
// clients, so the lead lessons (transfer, booking, fromai, checkins) are gone. Legal wording is Brayden's call. No imports on purpose: it runs under node --test.
//
// P877: a lesson ends in a quiz (quiz: true, only where a mistake costs money or breaks a rule) or in a Try it (tryIt:
// do the task once on sample data; it completes when the VA presses tryIt.button on that page).
//
// P948: LESSONS is in the order of a VA's real day: start of shift, the next call and its brief, each call type (most
// common first), calls that come in, coverage questions to the agent, after the call, time off and pay, and last what to
// steer clear of. Lessons with a portal task also have a "Show me how" walkthrough (./tours.js).
//
// Bump TRAINING_VERSION when a lesson's check changes, so a VA's old pass is shown as "updated, take the check again".

export const TRAINING_VERSION = '2026-11-12.1' // P976: lead lessons gone; text matches the re-voiced videos (no lead content, no promises, portal facts checked). Before: P948: lessons in the order of the job (start of shift first, what to steer clear of last); 'desk' split into Start of your shift and Time off and pay. Before: P932: the carrier's way on every change (e-sign their form, or a merge call), do it now or book their next open time, the AI front desk's summary. Before: P931: you only talk to sold clients; no-show rebooks are the AI caller's; the cancel call merges the client in; no identity checks on booked calls. Before: P924: saves end with the agent or Closed; clients call our team. P907: speed is now Working in bookings; callbacks, check-ins, fromai, reminders follow the bookings
export const PASS_MARK = 0.8 // 4 of 5, 4 of 4, 3 of 3: a check passes at 80% or better

const say = (text, o = {}) => ({ who: 'You', text, ...o })
const hear = text => ({ who: 'Them', text })
const tip = text => ({ who: 'Note', text })
const ok = (q, options, answer, why) => ({ q, options, answer, why })

export const LESSONS = [
  {
    // P948: the first lesson is the start of a shift (the day-off part moved to 'timeoff', near the end).
    id: 'desk',
    tryIt: { path: ['schedule'], do: 'On your Schedule, press Clock in, let the device check run, then press Clock in.', button: 'Clock in' },
    title: 'Start of your shift',
    job: 'When you work, who else is on, and clocking in so calls can ring you.',
    minutes: 3,
    why: 'Clients call during carrier hours. If nobody is clocked in, a call waits, and a waiting client gets let down.',
    steps: [
      'Shifts run 8:00 AM to 6:00 PM Central, the hours the carriers are open.',
      'Two or three VAs are on each day. It is a rotation, so it is not always the same people. Check the Schedule for who is on with you.',
      'Clock in on your Schedule, up to 15 minutes either side of your shift. A quick device check runs (microphone, speaker, notifications, network), then you are Available and calls can ring you.',
      'Two missed rings in a row set you to Away. Set yourself back to Available when you are back at the desk.',
      'Clock out when you finish.',
      'Something urgent mid-shift? Message the team first, then step away. Never just disappear from the desk.',
    ],
    script: null,
    dos: ['Clock in at the start, clock out at the end', 'Check the Schedule at the start of each week', 'Tell the team before you step away'],
    donts: ['Don\'t leave the desk without telling the team'],
    portal: { shot: 'schedule', clicks: [{ spot: 'onshift', text: 'Who is on shift today, beside your own shift' }] },
    check: [
      ok('What are the shift hours?', ['9 AM to 5 PM your time', '8 AM to 6 PM Central', 'Whenever you are online', '7 AM to 7 PM Eastern'], 1, 'Shifts follow carrier hours: 8 AM to 6 PM Central.'),
      ok('How do you go "on duty" at the start of a shift?', ['Press Clock in on your Schedule', 'Nothing: if you are on the rota, you are on', 'Message the agent', 'Wait for the first call'], 0, 'Clock in, up to 15 minutes either side of your shift.'),
      ok('You miss two rings in a row. What happens?', ['Nothing', 'You are set to Away', 'You are clocked out', 'The call is dropped for good'], 1, 'Two missed rings set you to Away. Set yourself back to Available.'),
    ],
  },
  {
    // P907: VAs don't do speed to lead any more (the AI caller does). The lesson keeps its id (its video, the "?" map)
    // and now teaches working in bookings.
    id: 'speed',
    tryIt: { path: ['overview'], do: 'On your Overview, press Start call in the Next call box when it turns on.', button: 'Start call' },
    title: 'Working in bookings',
    job: 'Everything you do is a booked call, at the time the system set.',
    minutes: 4,
    why: 'Your time goes to sold clients, each at a time that suits them.',
    steps: [
      'Start call turns on 5 minutes before the booked time and stays on until the call is done or moved. Before that it shows the time. Calls that come in always ring.',
      'Everything you do is a booked call on your Calendar: hand-off calls after a sale, cancelling the old policy, saves, change and cancel requests, callbacks, welcome calls and yearly reviews.',
      'The system books each call itself: the next open time in the client\'s window (morning, afternoon or evening, on their clock) with a VA who is free.',
      'A hand-off call or a cancel call opens with a box at the top: whether an old policy has to be cancelled and by when, and anything the agent said our team should know. Read it before you dial.',
      'Your Overview shows the next call with a countdown, why we\'re calling, the agent\'s note, the carrier and Start call. Today\'s calls lists the rest of the day, each in its status colour.',
      'Call at the booked time. No answer: log it, and the system books the next try for the next business day.',
      'The client wants another time? Open the call and press Move. They get a text with the new time.',
      'On the Calendar, click a call (in the week, or in a day\'s list on the right): its details open in a pop-up in the middle of the screen. X closes it and you\'re back where you were.',
      'You call only from the phone on the left rail: Start call when a call is due, or a call that comes in. There is no Call button on Clients.',
    ],
    script: {
      title: 'Opening a booked call',
      lines: [
        say('Hi [first name], this is [your first name] with Deedstone, calling at the time we set up. Is now still a good time?', { approve: true }),
        hear('Yes, go ahead.'),
        tip('Then the reason for the call: the hand-off, the old policy, the change they asked for.'),
      ],
    },
    dos: ['Call at the booked time', 'Move a call when the client asks', 'Check Today\'s calls on your Overview'],
    donts: ['Don\'t call a client outside their booking unless they ask', 'Don\'t text a client from your own phone'],
    portal: { shot: 'schedule', clicks: [{ spot: 'cal', text: 'Your booked calls: every one has its time already' }] },
    check: [
      ok('Which of these is a booked call on your Calendar?', ['A packet check', 'A save call with a client', 'A chargeback watch', 'The agent\'s own appointments'], 1, 'Saves, changes, callbacks, welcomes, reviews, hand-offs and cancels are booked calls. Packet checks and watches are not calls.'),
      ok('Who picks the time of a booked call?', ['You', 'The system: the next open time in the client\'s window', 'The client, by text', 'The agent'], 1, 'The system books it, on the client\'s clock.'),
      ok('A client asks for another time. You:', ['Tell them to text in', 'Open the call, press Move and pick a new time', 'Call them whenever you can', 'Pass it to the agent'], 1, 'Move it. They get a text with the new time.'),
      ok('No answer on a booked call. What happens?', ['You call five times in a row', 'Log it. The system books the next try', 'It is dropped', 'You text them from your phone'], 1, 'Log it; the next try books itself.'),
    ],
  },
  {
    // P897: the Welcome call step (P891): clients an agent brings from their own book.
    id: 'welcome',
    tryIt: { path: ['calendar'], do: 'Open Maria Lopez\'s welcome call, press Start, then Record the result and Save result.', button: 'Save result' },
    title: 'Welcome calls for clients an agent added',
    job: 'An agent hands us a client from their own book. Say hello, check the details, ask about texts.',
    minutes: 3,
    why: 'These clients have never heard of us. A warm first call, with their details right, is why they pick up the next time we call.',
    steps: [
      'When an agent adds clients from their own book, each one gets a Welcome call on your Calendar.',
      'Open it and read who added them and the agent\'s note. Press Start, then Call.',
      'Say who you are: their agent\'s client care team at Deedstone.',
      'Read every detail back (name, phone, email, policy, draft day). Anything wrong: note it and pick Details fixed.',
      'Ask about text updates, word for word. Yes: press Yes, texts are fine (it logs their consent). No: press No texts.',
      'A wrong policy, a payment problem or a coverage question: pick Problem → agent and say what in your note.',
      'Record the result: Welcomed, Details fixed, Problem → agent, or No answer (it comes back the next business day, up to three tries).',
    ],
    script: {
      title: 'Saying hello',
      lines: [
        say('Hi [first name], this is [your first name] with [agent]\'s client care team at Deedstone. [Agent] asked us to look after your [carrier] policy from now on: payments, changes, your yearly review. Do you have two minutes so I can check we have your details right?', { approve: true }),
        tip('Then read each detail back, and ask the text question word for word, from the step.'),
      ],
    },
    dos: ['Read every detail back', 'Ask the text question word for word', 'Record the result'],
    donts: ['Don\'t turn texts on for someone who said no', 'Don\'t answer coverage questions', 'Don\'t skip recording the result'],
    portal: { shot: 'servicing', clicks: [{ spot: 'card', text: 'Open the Welcome call, then Start' }] },
    check: [
      ok('Who gets a welcome call?', ['Every new caller', 'Clients an agent added from their own book', 'Clients who cancelled', 'Agents'], 1, 'Clients an agent brings from their own book.'),
      ok('The client says no to text updates. You:', ['Press Yes anyway', 'Press No texts', 'Ask again next week', 'Tell the agent to turn texts on'], 1, 'Never turn texts on for someone who said no.'),
      ok('Their email on the step is wrong. You:', ['Ignore it', 'Note it and pick Details fixed', 'Cancel the policy', 'Change the cover'], 1, 'Note what was wrong and pick Details fixed.'),
    ],
  },
  {
    id: 'carrier',
    quiz: true,
    title: 'Cancelling the old policy',
    job: 'Call the client, call the old carrier, merge the client in. The client does the talking.',
    minutes: 4,
    why: 'Closing the old policy once the new one is issued means the client never pays for both.',
    steps: [
      'Cancel calls are on your Calendar. The box at the top says which old policy and the draft date to beat, plus the agent\'s note.',
      'Until the new policy is issued, Start call waits. Carriers are only called while they are open.',
      'The call shows how that carrier cancels. E-sign: text the client the form, send it once signed, and a follow-up checks the carrier processed it. No call to the carrier.',
      'New carrier: we learn it on this call. Afterwards press Save what you learned.',
      'Merge call: call the client first: "We\'re cancelling your old policy today. Stay near your phone. You can hold, or hang up and I\'ll ring you back when I reach the carrier."',
      'Call the old carrier and hold as long as it takes.',
      'When they answer: "I\'m helping my friend, who\'s on the other line, cancel their policy." Then merge the client in.',
      'The client does the talking. You stay on to help.',
      'When it\'s cancelled, press Cancelled. No confirmation number needed, a note is optional. No luck: No answer with a note.',
    ],
    script: {
      title: 'The cancel call',
      lines: [
        say('Hi [first name], it\'s [your first name] with Deedstone. We\'re cancelling your old [old carrier] policy today. Stay near your phone. You can hold, or hang up and I\'ll ring you back when I reach [old carrier].', { approve: true }),
        tip('Call the old carrier and hold. When they answer:'),
        say('I\'m helping my friend, who\'s on the other line, cancel their policy.', { approve: true }),
        tip('Merge the client in. They do the talking; you stay on.'),
      ],
    },
    dos: ['Call the client first', 'Hold as long as it takes', 'Let the client do the talking'],
    donts: ['Never suggest cancelling', 'Don\'t cancel without the client on the line', 'Don\'t press Cancelled before it\'s done'],
    portal: { shot: 'call', clicks: [{ spot: 'start', text: 'Start call: ring the client first' }, { spot: 'cancelled', text: 'Cancelled, once it\'s done (no confirmation number)' }] },
    check: [
      ok('Who do you call first?', ['The old carrier', 'The client', 'The agent', 'The new carrier'], 1, 'The client first, so they\'re ready when the carrier answers.'),
      ok('The call says the old carrier takes an e-signed form. You:', ['Call the carrier anyway', 'Text the client the e-sign link, then send it once signed', 'Mail a letter', 'Ask the agent'], 1, 'E-sign: no call to the carrier. A follow-up checks it was processed.'),
      ok('The carrier answers. You say:', ['"I\'m cancelling a policy for a client."', '"I\'m helping my friend, who\'s on the other line, cancel their policy."', '"Please cancel policy 123."', '"Can I speak to a manager?"'], 1, 'Then merge the client in.'),
      ok('Who does the talking with the carrier?', ['You', 'The client', 'The agent', 'Nobody'], 1, 'The client. You stay on to help.'),
      ok('What do you need to press Cancelled?', ['A confirmation number', 'Nothing. A note is optional', 'The agent\'s OK', 'A photo of the policy'], 1, 'No confirmation number needed.'),
    ],
  },
  {
    id: 'saves',
    tryIt: { path: ['calendar'], do: 'Open a save step, press Start, then Record the result and Save result.', button: 'Save result' },
    title: 'Cancellation saves',
    job: 'A client wants to cancel or is about to lapse: find out why, and get them to their agent.',
    minutes: 4,
    why: 'Some cancellations have a reason we can fix. A save keeps the client covered and the agent paid.',
    steps: [
      'A save call shows as a booked call on your Calendar: the day after a draft the agent said No to "Still on the books?", a lapse, or a client asking to cancel. Do it within one business day.',
      'Listen first. Ask what\'s behind it: money, a payment problem, or a question about the policy.',
      'Payment problem: fix it as in Failed payments, then record Saved (or Fixing it).',
      'Anything else (price, cover, "I don\'t need it"): press Check agent and hand them over live. If the agent can\'t take it, book the agent\'s calendar. Record Transferred to agent or Booked with agent.',
      'Never pressure. If it can\'t be saved, record Can\'t be saved and pick why. The client moves to Closed on the agent\'s side with that reason.',
    ],
    script: {
      title: 'Opening a save call',
      lines: [
        say('Hi [first name], it\'s [your first name] with Deedstone. I saw you might want to cancel your [carrier] policy. Can I ask what\'s going on? Sometimes there\'s an easy fix.', { approve: true }),
      ],
    },
    dos: ['Listen before anything else', 'Fix payment problems on the spot', 'Hand them to their agent live, or book the agent'],
    donts: ['Never pressure or scare', 'Don\'t offer a different price or policy', 'Don\'t argue'],
    portal: { shot: 'servicing', clicks: [{ spot: 'card', text: 'Open the save step' }] },
    check: [
      ok('A client wants to cancel because it\'s too expensive. You:', ['Offer a cheaper policy', 'Check agent and hand them over, or book the agent', 'Cancel it for them', 'Tell them it\'s worth it'], 1, 'Price and cover talks are the agent\'s.'),
      ok('It can\'t be saved. You record:', ['Nothing', 'Can\'t be saved, with the reason', 'Saved', 'No answer'], 1, 'The client moves to Closed with that reason.'),
      ok('How fast is a save step done?', ['Within one business day', 'Within a month', 'At renewal', 'Whenever'], 0, 'Within one business day.'),
      ok('What do you do first?', ['Listen and ask why', 'Read the cancellation rules', 'Transfer to the carrier', 'Quote the cost of no cover'], 0, 'Listen first.'),
    ],
  },
  {
    id: 'changes',
    tryIt: { path: ['calendar'], do: 'Open a change step (beneficiary, address or draft date), press Start, then Record the result and Save result.', button: 'Save result' },
    title: 'Policy changes',
    job: 'Beneficiary, address, payment method or draft date changes, done with the carrier.',
    minutes: 4,
    why: 'Small changes done right stop big problems later, like a claim paid to the wrong person.',
    steps: [
      'The agent or client asks for a change. It shows as a booked call on your Calendar.',
      'The call shows that carrier\'s way for this change: e-sign their form, or the owner on a merge call. Plus their line, hours, the form and what the client needs ready.',
      'E-sign: text the client the link (it\'s prefilled) and send it to the carrier once signed. A follow-up checks it was processed, then the client gets a "done" text.',
      'Merge call: if the carrier is open and the client says yes, do it now. Closing soon, closed or the weekend: book one of the next open times shown.',
      'Not sure how a carrier does it? Edit the card after the call. Every edit is logged.',
      'Record the result: Done, or Couldn\'t finish with a note saying why.',
      'Anything that changes cover, or any advice ("who should my beneficiary be?"), goes to the agent: Send to agent.',
    ],
    script: {
      title: 'Starting a change call',
      lines: [
        say('Hi [first name], it\'s [your first name] with Deedstone. [Agent] asked me to help you update your [beneficiary / address / draft date] with [carrier]. Is now a good time?', { approve: true }),
      ],
    },
    dos: ['Use the carrier\'s easiest way shown on the call', 'Record the exact result'],
    donts: ['Don\'t advise who to name as beneficiary', 'Don\'t change cover amounts'],
    portal: { shot: 'task', clicks: [{ spot: 'move', text: 'Move the call to a time inside carrier hours' }, { spot: 'sendagent', text: 'Send to agent: anything about cover or advice' }] },
    check: [
      ok('A client asks who they should name as beneficiary. You:', ['Suggest their spouse', 'Send to agent', 'Pick their children', 'Skip it'], 1, 'That is advice. It goes to the agent.'),
      ok('A change call is a call we booked. Do you check who they are?', ['Yes, date of birth first', 'No. Only an unknown caller gets one light check', 'Ask for their SSN', 'Ask the agent'], 1, 'No checks on calls we booked.'),
      ok('Where is the change made?', ['In your notes only', 'With the carrier: their e-sign form, or a call with the client on the line', 'By text only', 'By the agent later'], 1, 'The card says which way that carrier takes it.'),
      ok('A bank change, and the carrier closes in 15 minutes. You:', ['Rush it now', 'Book one of the next open times shown', 'Skip it', 'Text the carrier'], 1, 'Closing soon: book their next open time.'),
    ],
  },
  {
    id: 'callbacks',
    tryIt: { path: ['calendar'], do: 'Open a callback on your Calendar, press Move, pick an open time on their clock and press Move it.', button: 'Move it' },
    title: 'Callbacks',
    job: 'A callback is a booked call: the system sets it in their time, you call on time.',
    minutes: 3,
    why: 'A callback is a promise. Calling late, or in the wrong time zone, breaks trust.',
    steps: [
      'Callbacks book themselves: someone asked us to call back, a call to us was missed, or a text reply needs a person.',
      'The system takes the next open time in their window, on their clock, with a VA who is free. It lands on that VA\'s Calendar.',
      'Yours show on your Calendar and in Today\'s calls on your Overview. Call at that time.',
      'They want another time? Press Move and pick one on their clock. A time within 30 minutes of a VA\'s calls goes to another VA; greyed out means every VA is busy. They get a text with the new time.',
      'Reached: carry on as a normal call. No answer: log it, and the next try is booked for the next business day.',
    ],
    script: {
      title: 'Calling back',
      lines: [
        say('Hi [first name], it\'s [your first name] with Deedstone, calling back like you asked. Is now still a good time?', { approve: true }),
      ],
    },
    dos: ['Call at the booked time', 'Move it when they ask', 'Say you are calling back like they asked'],
    donts: ['Don\'t call late without a note', 'Don\'t move a callback without telling them'],
    portal: { shot: 'schedule', clicks: [{ spot: 'cal', text: 'Callbacks sit on your Calendar at their booked time' }] },
    check: [
      ok('Where does a callback show?', ['In your email', 'On your Calendar, at its booked time', 'On Pay', 'Nowhere'], 1, 'On your Calendar, and in Today\'s calls on your Overview.'),
      ok('Whose clock is a callback booked on?', ['Yours', 'The person\'s own', 'The agent\'s', 'Central'], 1, 'Always their own time.'),
      ok('How close can a callback be to your other calls?', ['Any time', 'Not within 30 minutes', 'Not within 2 hours', 'Not the same day'], 1, 'Callbacks keep 30 minutes clear.'),
    ],
  },
  {
    id: 'packets',
    tryIt: { path: ['calendar'], do: 'Open Clients, open Paul Rivera, read where his policy is, step by step, then Close the card.', button: 'Close' },
    title: 'Sending packets',
    job: 'Make sure the client actually has their policy packet.',
    minutes: 4,
    why: 'A client with no packet worries, and a worried client may cancel.',
    steps: [
      'A packet check is not a booked call: it is on the client\'s card, under Your work on this client. Work the overdue ones first.',
      'Open the client, start the packet check, then call them: has the packet arrived, by mail or email?',
      'Arrived: record Delivered. Not arrived: ask the carrier (inside their hours) to resend it, tell the client what the carrier said about timing, write that in the notes and record Not delivered.',
      'Questions about what the policy covers go to the agent: Send to agent.',
    ],
    script: {
      title: 'Packet check',
      lines: [
        say('Hi [first name], it\'s [your first name] with Deedstone. Quick check: has your policy packet from [carrier] arrived yet, by mail or email?', { approve: true }),
      ],
    },
    dos: ['Check mail AND email', 'Resend through the carrier', 'Tell the client what the carrier said'],
    donts: ['Don\'t explain what the policy covers', 'Don\'t send policy documents from your own email'],
    portal: { shot: 'servicing', clicks: [{ spot: 'lane0', text: 'Overdue steps first' }, { spot: 'card', text: 'Open a step, then Start' }] },
    check: [
      ok('Where do you find a packet check?', ['On your Calendar, as a booked call', 'On the client\'s card, under Your work on this client', 'In Messages', 'The agent emails it'], 1, 'It is not a call: it is on the client\'s card.'),
      ok('The packet hasn\'t arrived. You:', ['Email them your copy', 'Ask the carrier to resend it, and tell the client when to expect it', 'Tell them to wait a month', 'Cancel the policy'], 1, 'The carrier resends it.'),
      ok('The client asks what their policy covers. You:', ['Explain it', 'Send to agent', 'Read them the packet', 'Guess'], 1, 'Coverage questions go to the agent.'),
    ],
  },
  {
    id: 'payments',
    tryIt: { path: ['calendar'], do: 'Open Clients, open Luis Ortega (his draft failed), read the steps to save his policy, then Close the card.', button: 'Close' },
    title: 'Failed payments',
    job: 'A draft failed: help the client fix it fast, before the policy lapses.',
    minutes: 5,
    why: 'A lapsed policy leaves the client without cover, and the agent can lose their commission.',
    steps: [
      'A failed draft shows as a payment call, and as the next step on the client\'s card.',
      'Call the client within one business day. Be calm: it is usually a changed card or low balance.',
      'Help them choose: retry the draft, change the draft date, or update the payment method with the carrier.',
      'Payment details go straight to the carrier, on a three-way call. Never write card or bank numbers down or in notes.',
      'Record the result. If the client wants to stop the policy, don\'t argue: Send to agent.',
      'After a fix, the policy is watched for 12 months for any missed payment.',
    ],
    script: {
      title: 'Failed payment call',
      lines: [
        say('Hi [first name], it\'s [your first name] with Deedstone. I\'m calling because your [carrier] payment didn\'t go through on [date]. These things happen. I can help you sort it out with them now.', { approve: true }),
      ],
    },
    dos: ['Call within one business day', 'Keep the carrier on the line for payment changes', 'Note what was changed, never the numbers'],
    donts: ['Never take or write down card or bank numbers', 'Don\'t blame the client', 'Don\'t advise on whether to keep the policy'],
    portal: { shot: 'task-on', clicks: [{ spot: 'record', text: 'Once started: record the result' }, { spot: 'sendagent', text: 'Send to agent, if they want to stop the policy' }] },
    check: [
      ok('How fast do you call about a failed draft?', ['Within one business day', 'Within a month', 'At the next renewal', 'Only if they call us'], 0, 'One business day.'),
      ok('The client reads you their new card number. You:', ['Write it in the notes', 'Stop them, and connect the carrier to take it directly', 'Text it to the agent', 'Type it into the portal'], 1, 'Card and bank details go straight to the carrier.'),
      ok('The client wants to stop the policy. You:', ['Talk them out of it', 'Send to agent', 'Cancel it', 'Ignore it'], 1, 'Agent decisions go to the agent.'),
    ],
  },
  {
    id: 'reminders',
    tryIt: { path: ['calendar'], do: 'Rebook someone: open a booked call on your Calendar, press Move, pick an open time and press Move it.', button: 'Move it' },
    title: 'Reminders and moving calls',
    job: 'Reminder texts go out by themselves. Unanswered calls rebook themselves. You move your own calls.',
    minutes: 3,
    why: 'You only ever talk to clients whose policy is sold. Knowing what runs by itself keeps your Calendar for them.',
    steps: [
      'Reminder texts go out by themselves: a confirmation when booked, then before the call. You don\'t send them.',
      'One of your own booked calls not answered? The system books the next try for the next business day, in the client\'s window.',
      'A client asks for another time: open the call, press Move, pick an open time on their clock and press Move it. They get a text with the new time.',
    ],
    script: null,
    dos: ['Move a client\'s call when they ask', 'Let reminder texts go by themselves'],
    donts: ['Don\'t send reminders by hand', 'Don\'t text a client from your own phone'],
    portal: { shot: 'schedule', clicks: [{ spot: 'cal', text: 'Your Calendar: every booked call in one place' }] },
    check: [
      ok('Who sends reminder texts?', ['You, by hand', 'They go out by themselves', 'The agent', 'Nobody'], 1, 'They go out by themselves.'),
      ok('One of your booked calls isn\'t answered. What happens?', ['You call again every hour', 'The next try books itself for the next business day', 'It is dropped', 'The agent calls them'], 1, 'Log No answer; the next try books itself, in the client\'s window.'),
      ok('A client asks to move their call. You:', ['Tell them to call back', 'Press Move and pick an open time on their clock', 'Text the agent', 'Cancel it'], 1, 'Move it. They get a text with the new time.'),
    ],
  },
  {
    id: 'inbound',
    quiz: true,
    title: 'Answering a call that comes in',
    job: 'A call rings in: answer as Deedstone, find out what they need, and route it.',
    minutes: 6,
    why: 'The first ten seconds decide whether a caller trusts us. A clear, warm greeting keeps them on the line.',
    steps: [
      'A call rings in the phone on the left rail. It slides open by itself. Answer quickly: after 15 seconds it rings the next free VA.',
      'Clients call our team, not their agent. A call rings the VA who last talked with that caller first, then the VAs on that Deedstone number, then any free VA. Nobody free: a callback is booked.',
      'Greet with the Deedstone greeting and your first name.',
      'Find out what they need. A payment, a change or a packet is yours to help with.',
      'Coverage or price question: press Check agent and hand them over live (a warm hand-off). If the agent can\'t take it, book the agent\'s calendar.',
      'Log the result straight after (see Logging every call).',
      'Sliding the phone away never ends a call: it tucks into the left rail with a green timer. Hang up is always the red button.',
    ],
    script: {
      title: 'The greeting',
      lines: [
        say('Thanks for calling Deedstone, this is [your first name]. How can I help you today?', { approve: true }),
        hear('My payment didn\'t go through this month.'),
        say('I can help with that. Let me pull up your policy.', { approve: true }),
      ],
    },
    dos: ['Smile, slow down, say your name', 'Use their first name once you have it', 'Write notes as you go'],
    donts: ['Don\'t say Ohvara', 'Don\'t quote or advise', 'Don\'t put a caller on hold without asking first'],
    portal: { shot: 'phone-ring', clicks: [{ spot: 'answer', text: 'Answer. The call keeps its time and notes here' }, { spot: 'opencall', text: 'Open the call, to see the full record' }] },
    check: [
      ok('How do you answer a call that comes in?', ['"Hello?"', '"Thanks for calling Deedstone, this is [name]. How can I help you today?"', '"Ohvara insurance, go ahead"', '"Who is this?"'], 1, 'Deedstone, your first name, and an open question.'),
      ok('You slide the phone away during a call. What happens?', ['The call ends', 'The call keeps going. The phone tucks into the left rail with a green timer', 'The caller is put on hold', 'The call moves to another VA'], 1, 'Sliding it away never hangs up. The red button does.'),
      ok('The caller has a question about their existing policy. Next step?', ['Answer it yourself', 'Add caller, pick their agent, then Merge: a warm hand-off', 'Tell them to call the carrier', 'Take a message and forget it'], 1, 'Policy questions are the agent\'s. Bring them onto the call.'),
      ok('A call rings you and you don\'t answer. What happens?', ['It rings until you answer', 'After 15 seconds it rings the next free VA', 'The caller gets voicemail at once', 'The call is dropped'], 1, 'After 15 seconds it moves to the next free VA.'),
    ],
  },
  {
    id: 'escalate',
    quiz: true,
    title: 'When to escalate, and to whom',
    job: 'Know who to bring in, and when.',
    minutes: 4,
    why: 'Getting the right person fast fixes problems while they\'re small.',
    steps: [
      'Coverage, price, advice, or "should I…?" questions: the client\'s agent, with Send to agent or a message on the client.',
      'Agents talk to you on the client\'s thread in Messages. Agents don\'t call VAs, and you don\'t call agents\' personal numbers.',
      'Wording, consent, a phone or text problem, a bug, or anything legal: the Ohvara team (Brayden or Jordan, both admins). Message the team or email support.',
      'An upset caller who asks for a manager: stay calm, take their details, and message the team straight away.',
      'Anything that sounds like a threat, a complaint to a regulator, or a legal claim: stop, note exactly what was said, and tell the team at once.',
    ],
    script: {
      title: 'An upset caller',
      lines: [
        say('I\'m sorry this has been frustrating. I want to get this to the right person. Can I take your number, so the right person can call you back?', { approve: true }),
      ],
    },
    dos: ['Coverage to the agent, everything else to the team', 'Write down exactly what was said', 'Escalate the same day'],
    donts: ['Don\'t argue with an upset caller', 'Don\'t promise what someone else will do', 'Don\'t sit on a complaint'],
    portal: { shot: 'messages', clicks: [{ spot: 'thread', text: 'Each client has a thread with their agent' }] },
    check: [
      ok('A client asks if they have enough cover. Who answers?', ['You', 'Their agent', 'Brayden', 'The carrier'], 1, 'Coverage questions go to the agent.'),
      ok('A caller says they\'re reporting us to the state. You:', ['Hang up', 'Note exactly what was said and tell the team at once', 'Offer a discount', 'Ignore it'], 1, 'Legal or regulator: tell the team at once.'),
      ok('Who are the admins you can escalate to?', ['Only Brayden', 'Brayden and Jordan', 'Any agent', 'The carrier'], 1, 'Jordan is a full admin, same as Brayden.'),
      ok('How do agents reach you about a client?', ['They call your cell', 'On the client\'s thread in Messages', 'By email only', 'They don\'t'], 1, 'On the client\'s thread.'),
    ],
  },
  {
    id: 'logging',
    tryIt: { path: ['calendar'], do: 'Open the + menu, choose Log a call, pick the call you made and choose how it went: No answer.', button: 'No answer' },
    title: 'Logging every call',
    job: 'Every call gets a result and a note, straight after it ends.',
    minutes: 4,
    why: 'Agents see your notes on their client\'s timeline, and nobody can follow up on a call that was never logged.',
    steps: [
      'After every call, the phone asks How did it go? Pick the result first: the phone can\'t be closed until you do (it shakes and marks How did it go? in red). The buttons wear the status colours: green for done, amber for no answer. Then press Save · Available. A wrap-up timer counts down, and you are free for the next call once it is saved.',
      'For a cancellation call: press Cancelled once the carrier confirms. A note is optional. No answer can carry a short note.',
      'Write notes an agent can act on: what they asked, what you agreed, what happens next. Facts, not opinions.',
      'Missed something? Use Log a call in the + menu to add the result to one of today\'s calls.',
      'Calls dialed from your own phone while portal calling is off still get logged here: the call screen keeps the time and your notes.',
    ],
    script: null,
    dos: ['Log before the next call', 'Write who, what and next step'],
    donts: ['Don\'t batch your logging at the end of the day', 'Don\'t write guesses as facts', 'Don\'t put prices or advice in notes'],
    portal: { shot: 'phone', clicks: [{ spot: 'phone', text: 'The phone on the left rail. After a call it asks How did it go? and stays open until you pick' }, { spot: 'plus', text: 'The + menu: Log a call, for a call you have not logged yet' }] },
    check: [
      ok('When do you log a call?', ['At the end of the shift', 'Straight after it, before the next call', 'Only if it went well', 'Once a week'], 1, 'Log before your next call.'),
      ok('You mark a cancellation call Cancelled. What must you add?', ['The client\'s birthday', 'Nothing. A note is optional', 'The new premium', 'A photo of the policy'], 1, 'Nothing is required. Add a note if something was unusual.'),
      ok('Which note is best?', ['"Nice guy"', '"Wants a call back Tue after 3 PM their time about beneficiary form"', '"Call later"', '"Probably will buy"'], 1, 'Who, what and the next step, as facts.'),
    ],
  },
  {
    // P948: new. Time off and pay, after the calls (it was half of the old first lesson, 'desk').
    id: 'timeoff',
    tryIt: { path: ['schedule'], do: 'Open Request a day off, pick a day and press Book it. Then open Pay and find your next payday.', button: 'Book it' },
    title: 'Time off and pay',
    job: 'Ask for a day off the right way, and see what you have earned and when you are paid.',
    minutes: 3,
    why: 'A day off asked for early means the team can cover your shift. Knowing your pay means no surprises on payday.',
    steps: [
      'You get 3 days off a month. The team covers your shift.',
      'Can\'t work a day? On your Schedule, press Request a day off (it is also in the + menu and your avatar menu), pick the day and press Book it. Do it as early as you can.',
      'It is booked at once while you have days left.',
      'You can only ask off your own shifts, not past days, and only shifts in the next two weeks. Changed your mind? Press Take it back while the day is still ahead.',
      'Pay is by the hour, on your scheduled hours. Days off aren\'t paid.',
      'Pay shows this week\'s hours, what you have earned so far and your next payout. Pay goes out in Monday\'s run, after an admin checks the week.',
    ],
    script: null,
    dos: ['Ask for days off early', 'Check Pay each week'],
    donts: ['Don\'t just hope someone will cover', 'Don\'t text another VA to swap'],
    portal: { shot: 'schedule', clicks: [{ spot: 'dayoff', text: 'Request a day off (also in the + menu and your avatar menu)' }] },
    check: [
      ok('You can\'t work Friday. What do you do?', ['Nothing, someone will cover', 'Request a day off as early as you can', 'Switch yourself to Away on Friday', 'Text another VA to swap'], 1, 'Request a day off, as early as you can. It is booked at once.'),
      ok('Which day-off request is NOT allowed?', ['One for next week', 'One for last Monday', 'One for your shift next week', 'One you later take back'], 1, 'Past days can\'t be requested.'),
      ok('When is pay sent?', ['Every day', 'In Monday\'s run, after an admin checks the week', 'Once a month', 'When you ask'], 1, 'Monday\'s run, after an admin checks the week.'),
    ],
  },
  {
    id: 'optout',
    quiz: true,
    title: 'Opt-outs and do-not-call',
    job: 'Someone says stop: every call and text stops, at once.',
    minutes: 4,
    why: 'Stop means stop: every call and every text, at once.',
    steps: [
      'If anyone says stop, don\'t call, take me off, or unsubscribe, in any words: stop at once.',
      'On a call: thank them, confirm they won\'t hear from us again, and end the call politely.',
      'Mark them before you hang up: on the call, press Do not call. It stops every call and text to that number at once: booked calls, callbacks and texts.',
      'Someone you can\'t find in the portal asks to stop? Tell the team.',
      'If they text STOP, the system opts them out by itself and sends one confirmation text. Do not text them again.',
      'Never opt someone back in: not you, not an admin, not the agent.',
    ],
    script: {
      title: 'When someone asks you to stop',
      lines: [
        hear('Please stop calling me.'),
        say('Of course. I\'ve taken you off our list, and you won\'t hear from us again. Have a good day.', { approve: true }),
        tip('Then press Do not call before you hang up. Don\'t argue and don\'t try to save it.'),
        tip('The STOP confirmation text is sent by the system. Its wording is set with the phone line.'),
      ],
    },
    dos: ['Stop the moment they ask', 'Press Do not call before you hang up', 'Tell the team if someone you can\'t find in the portal asks to stop'],
    donts: ['Don\'t try to change their mind', 'Don\'t text "are you sure?"', 'Never opt anyone back in'],
    portal: { shot: 'phone', clicks: [{ spot: 'phone', text: 'The phone: on a call, Do not call stops every call and text' }] },
    check: [
      ok('A client says "don\'t call me again" halfway through the call. You:', ['Finish your questions first', 'Ask if they\'re sure', 'Confirm they won\'t hear from us, press Do not call, end politely', 'Book them anyway'], 2, 'Stop at once, confirm, and press Do not call.'),
      ok('A client texted STOP last week and now asks you on a call to text them. You:', ['Turn texts back on in the portal', 'Ask an admin to turn them on', 'Don\'t: never opt anyone back in', 'Ask the agent to'], 2, 'Never opt anyone back in.'),
      ok('Someone you can\'t find in the portal asks you to stop. You:', ['Ignore it', 'Tell the team straight away', 'Text them to confirm', 'Wait a week'], 1, 'Tell the team straight away.'),
    ],
  },
  {
    // P948: the last lesson (what to steer clear of comes after everything you do).
    id: 'never',
    quiz: true,
    title: 'What to steer clear of',
    job: 'Last: the lines a VA never crosses. No coverage advice, no promises, and the never-say list.',
    minutes: 5,
    why: 'You are not a licensed agent. Saying the wrong thing can cost a client their cover, put us at risk, or lose us an agent.',
    steps: [
      'Never quote a price, a premium or a rate. Prices come from the licensed agent only.',
      'Never promise anything: not approval, not a price, not a date a policy will start.',
      'Never give advice. Which policy, how much cover, whether to keep or drop a policy: all of that goes to the agent.',
      'Never tell anyone to drop or stop paying a policy.',
      'To clients we are Deedstone. Never name Ohvara to a client.',
      'When a question is outside your role, say so kindly and pass it to the agent (Send to agent).',
    ],
    script: {
      title: 'When they ask something only the agent can answer',
      lines: [
        hear('How much more would it cost to raise my cover?'),
        say('Good question. That\'s one for your agent, because it depends on the cover you pick. I\'ll pass that to your agent, so they can go over it with you.', { approve: true }),
        hear('Should I cancel my old policy?'),
        say('That\'s one for your licensed agent, so you get the right answer for you. I\'ll pass that to your agent, so they can go over it with you.', { approve: true }),
      ],
    },
    dos: ['Say "I\'ll pass that to your agent"', 'Use Send to agent for coverage or advice questions', 'Say Deedstone to clients'],
    donts: ['No prices or "around about" numbers', 'No promises of approval or start dates', 'Never tell someone to drop a policy', 'Never name Ohvara to a client'],
    portal: { shot: 'task', clicks: [{ spot: 'sendagent', text: 'Send to agent: for any coverage, price or advice question' }] },
    check: [
      ok('A client asks roughly how much more cover would cost. You say:', ['"Usually about $40 a month"', '"That\'s one for your agent. I\'ll pass it to them."', '"It\'s cheaper than your current one"', '"I can\'t tell you that"'], 1, 'Never quote, even roughly. Pass it to the agent kindly.'),
      ok('What company name do clients hear from you?', ['Ohvara', 'Deedstone', 'The carrier\'s name', 'Your agent\'s agency'], 1, 'Clients only ever hear Deedstone.'),
      ok('A client asks if they should stop paying their old policy. You:', ['Tell them yes, to save money', 'Tell them no', 'Pass it to their agent with Send to agent', 'Hang up'], 2, 'Advice goes to the licensed agent. Never tell anyone to drop a policy.'),
      ok('Which of these is fine to say?', ['"You\'re sure to be approved"', '"Your policy starts Monday"', '"I\'ll pass that to your agent, so they can go over it with you"', '"This is the best policy for you"'], 2, 'No promises and no advice. Passing it on is always fine.'),
    ],
  },
]

// Which lesson a "?" opens, per task in the VA portal (phone, booking, calendar, schedule). P907: no Queue. P918: no Servicing.
export const HELP = {
  bookings: 'speed', callback: 'callbacks', handoff_call: 'speed', cancel_request: 'saves', closeout: 'optout',
  dialer: 'logging', answer: 'inbound', logging: 'logging',
  calendar: 'speed', schedule: 'desk', dayoff: 'timeoff', pay: 'timeoff',
  servicing: 'packets', packet_check: 'packets', review_call: 'packets', chargeback_watch: 'payments', payment_change: 'payments',
  draft_date_change: 'changes', beneficiary_change: 'changes', address_change: 'changes', lapse_save: 'saves', conversion: 'escalate',
  annual_review: 'changes', claim_help: 'escalate', carrier_call: 'carrier',
  welcome_call: 'welcome', // P897
}
