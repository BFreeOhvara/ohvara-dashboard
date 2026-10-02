// Agent training modules (Prompt 670).
//
// DRAFT CONTENT — written from what the portal itself does today (Book a
// call, My Clients, Overview), not yet reviewed by Brayden. Swap the text
// and drop in a `youtubeId` per module once real videos exist; the page
// renders a "video coming soon" frame until then. Nothing here is from the
// pre-pivot setter training (brain/training-videos.md) — that was for
// selling AI receptionists and doesn't apply to agents.
//
// Module ids are stored in training_progress.modules_completed (migration
// 110), so renaming an id resets everyone's tick for that module. Change
// titles and text freely; keep ids stable.

export const TRAINING_MODULES = [
  {
    id: 'how-it-works',
    title: 'How the service works',
    summary: 'What your clients are signing up for, and who does what.',
    youtubeId: null,
    points: [
      'Every client you work already has a policy with another carrier. The job is getting that old policy cancelled.',
      'Your part is the phone call: get the client on the line and book them a 30-minute call with Fulfillment.',
      'Fulfillment calls the client at that time and gets the old carrier on a three-way call to cancel the policy.',
      'Clients hear Fulfillment called "our Underwriting Team". Use that name with them.',
      'Every client you book shows up in My Clients, where you can follow it from Booked to Cancelled.',
    ],
    script: [],
  },
  {
    id: 'the-call',
    title: 'Getting the client on the phone',
    summary: 'Keep the call short. The goal is a booked time, not the cancellation itself.',
    youtubeId: null,
    points: [
      'Before you dial, have the client\'s name and best phone number ready.',
      'If you know which carrier they\'re leaving, note it. It helps Fulfillment, but it isn\'t required to book.',
      'You don\'t need their date of birth, address or banking details. Fulfillment gathers what it needs on its own call.',
      'Once the client says yes, book the time while they\'re still on the line.',
    ],
    script: [],
  },
  {
    id: 'booking',
    title: 'Booking the 30-minute slot',
    summary: 'Walk through Book a call from start to finish.',
    youtubeId: null,
    points: [
      'Open Book a call. Enter the client\'s first name, last name and phone, plus the carrier if you have it.',
      'Pick the day (Today and Tomorrow are one tap) and a 30-minute slot between 9:00 AM and 4:00 PM.',
      'Slots where you already have a client booked are marked. You can still use them, but check first.',
      'If you\'ve already booked someone on that phone number, or the date is more than a day out, you\'ll be asked to confirm before it books.',
    ],
    script: [
      'While booking: "We\'re going to get you booked with our Underwriting Team to get everything squared away."',
      'Before you hang up: "You\'re all set for [time]. Our Underwriting Team will give you a call right at that time to get everything squared away."',
    ],
  },
  {
    id: 'after-handoff',
    title: 'After the hand-off',
    summary: 'What each status means and when you need to step in.',
    youtubeId: null,
    points: [
      'Booked: the time is on the calendar and Fulfillment hasn\'t picked it up yet.',
      'In progress: a Fulfillment rep has it. You\'ll see "Calling carrier", "Waiting on carrier" or "Waiting on client".',
      'Cancelled: the old policy is cancelled. The carrier\'s confirmation number is on the client\'s card in My Clients.',
      'Not picked up: the booked time passed and nobody on Fulfillment took it. It\'s flagged on your Overview. Open it to move the time or give Fulfillment a heads-up.',
    ],
    script: [],
  },
]

export const TOTAL_MODULES = TRAINING_MODULES.length
