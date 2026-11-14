// P999 — throwaway email domains refused at sign-up. Not every one there is, just the common ones bots use; the
// email confirm link and the bot check catch the rest. Subdomains count (x.mailinator.com). No imports: node tests
// and Deno both load it.

const DOMAINS = new Set([
  '0-mail.com', '10minutemail.com', '10minutemail.net', '20minutemail.com', '33mail.com', 'anonaddy.me', 'burnermail.io',
  'byom.de', 'deadaddress.com', 'discard.email', 'discardmail.com', 'dispostable.com', 'dropmail.me', 'emailondeck.com',
  'fakeinbox.com', 'fakemail.net', 'getairmail.com', 'getnada.com', 'guerrillamail.biz', 'guerrillamail.com',
  'guerrillamail.de', 'guerrillamail.info', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com',
  'harakirimail.com', 'inboxbear.com', 'inboxkitten.com', 'incognitomail.org', 'jetable.org', 'mail-temp.com',
  'mail.tm', 'mailcatch.com', 'maildrop.cc', 'mailinator.com', 'mailinator.net', 'mailinator2.com', 'mailnesia.com',
  'mailnull.com', 'mailpoof.com', 'mailsac.com', 'mintemail.com', 'moakt.com', 'mohmal.com', 'mytemp.email',
  'mytrashmail.com', 'nada.email', 'no-spam.ws', 'nowmymail.com', 'sharklasers.com', 'spam4.me', 'spambog.com',
  'spambox.us', 'spamgourmet.com', 'spamex.com', 'tempail.com', 'tempinbox.com', 'tempmail.com', 'tempmail.dev',
  'tempmail.net', 'tempmail.plus', 'tempmailo.com', 'temp-mail.io', 'temp-mail.org', 'tempr.email', 'throwawaymail.com',
  'tmail.ws', 'tmpmail.net', 'tmpmail.org', 'trash-mail.com', 'trashmail.com', 'trashmail.de', 'trashmail.net',
  'wegwerfmail.de', 'yopmail.com', 'yopmail.fr', 'yopmail.net', 'zetmail.com', 'grr.la', 'pokemail.net', 'spamthis.co.uk',
  'emailfake.com', 'fakemailgenerator.com', 'luxusmail.org', 'tempmailaddress.com', 'mailbox.in.ua', 'cs.email',
])

export function isDisposableEmail(email: string): boolean {
  const domain = String(email || '').trim().toLowerCase().split('@').pop() || ''
  if (!domain) return false
  const parts = domain.split('.')
  for (let i = 0; i < parts.length - 1; i++) if (DOMAINS.has(parts.slice(i).join('.'))) return true
  return false
}
