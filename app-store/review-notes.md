# App Review notes (P928 text, extended in P953 to answer Apple's Guideline 2.1 "Information Needed")

Apple's API has no field for these, so they are pasted into App Store Connect → the app →
App Review Information → Notes (limit 4000 characters; the text below the line is about 3,000).
The same text is sent as the reply to Apple's message, with the screen recording attached.
They carry over from one version to the next; paste again only when this file changes.
Sign-in logins are NOT in git: portal → Settings → Team tools → App Review logins → Reset,
then paste both into App Review Information → Sign-in. Don't reset them while Apple is reviewing.

---

PURPOSE AND AUDIENCE
Ohvara is the work app for Ohvara's licensed life insurance agents and the virtual assistants (VAs) who work their bookings. It is not for the public: accounts are created by invitation only, so we are requesting Unlisted App Distribution (Guideline 3.2). Agents see their leads, clients, calendar and billing; VAs handle policy servicing and can make calls from the app.

SIGN IN
Two demo accounts are in the Sign-in fields: an Agent and a VA (Fulfillment). They hold sample data only; nothing they do reaches real people, calls, texts or payments.

WHERE EVERYTHING IS
Bottom bar: Home, Leads, Calendar, Messages, and your picture, which opens Account. Account holds Clients, Activity, Billing (read-only, managed on our website), Settings and Help. Sign out and Delete account are at the bottom of Settings (type DELETE to confirm). Account deletion also works on the website. It cancels the agent's plan, removes their login, name, phone, photo and device tokens, and keeps only anonymised tax and billing records we must retain.

SCREEN RECORDING
Attached to our reply: recorded on a real iPhone from app launch through login, each screen, Billing, the live-call alert and deleting a throwaway test account.

LIVE-CALL ALERT (Time Sensitive notifications)
When a caller who asked for insurance help is on the line, our team checks whether the agent can take a live transfer. The agent gets one notification with Yes / No buttons and about 30 seconds to answer, so it is marked Time Sensitive to get through Focus. We use it only for this live-call check, never for marketing or reminders. The demo accounts don't receive live calls.

NO PURCHASES IN THE APP
Billing pages are read-only. Plans are paid on our website through Stripe; the app sells nothing and uses no in-app purchase.

EXTERNAL SERVICES AND WHAT EACH DOES
- Supabase: accounts, sign-in and the app's data.
- Stripe: agent billing on the website, and payouts to VAs (Stripe Connect). No payments inside the app.
- Twilio and GoHighLevel: phone calls and text messages with leads and clients. VAs' calls use the microphone only during a call they start.
- Retell: the AI voice assistant that answers inbound calls for the agent.
- Anthropic (Claude): checks call recordings for our team.
- Apple Push Notification service, and Firebase on Android: notifications.
- Resend: account and notification emails.
- Capgo: delivers small updates to the app's own web content.
- Vercel: hosts the website and the app's web content.

REGIONAL DIFFERENCES
None in the app. It is for the United States only and is the same everywhere.

REGULATED INDUSTRY
Life insurance is regulated by each state. Every agent using the app holds their own state insurance licence (we collect their NPN and licence details when they join). Ohvara is a lead and servicing platform: it does not sell insurance, take premiums or handle policy payments in the app, and the app takes no payments of any kind.

Privacy policy: https://ohvara.com/privacy · Support: https://ohvara.com/support
