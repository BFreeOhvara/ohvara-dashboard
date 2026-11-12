// P950: the words of the read-only live status line on the admin Overview (adminshell/LiveStatus.jsx).
export function liveStatusText(s = {}, charging = false) {
  const w = on => (on ? 'on' : 'off')
  return `Live: calls ${w(s.voice_live)} · AI caller ${w(s.ai_caller_live)} · texts ${w(s.sms_live)} · charging ${w(charging)} · owner payouts ${w(s.owner_payouts_live)}`
}
