// P1027 — admin "Needs a look": forwarded carrier notices we couldn't match to one client, or couldn't tell what they
// are. Never dropped: each waits here (an Overview to-do) until an admin picks the client (→ the save call opens, the
// agent gets "Client's payment failed: Our team is on it") or sets it aside. Real: admin_payment_emails_to_match,
// va_payment_intake_match, va_payment_intake_dismiss (238/888, 284). Sample: one notice, kept in memory.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const WHY = { no_policy: 'no client found', several_policies: 'fits more than one client', unclear: 'not clear what it is' }
export const noticeWhy = w => WHY[w] || 'needs a look'

const SAMPLE = [{
  id: 'n-sample-1', agent_id: 'a-dana', agent: 'Dana Walker', received_at: new Date().toISOString(), from: 'Ethos <notifications@ethoslife.example>',
  subject: 'Returned payment', excerpt: 'The bank returned the premium draft for policy owner Reyes. Please contact your client.',
  parsed: { category: 'returned', client_name: 'Reyes', carrier: 'Ethos' }, why: 'several_policies',
  policies: [{ id: 'p-1', name: 'Ann Reyes', carrier: 'Americo', number: 'AM-77-1' }, { id: 'p-2', name: 'Sam Reyes', carrier: 'Ethos', number: 'ETH-5000-01' }],
}]
let sampleList = SAMPLE

export function useAdmNotices(src) {
  const [list, setList] = useState(src === 'real' ? [] : sampleList)
  const refresh = useCallback(async () => {
    if (src !== 'real') { setList(sampleList); return }
    const { data, error } = await supabase.rpc('admin_payment_emails_to_match')
    setList(error ? [] : data || [])
  }, [src])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh() }, [refresh])
  const match = async (id, policy, due) => {
    if (src !== 'real') { sampleList = sampleList.filter(n => n.id !== id); return refresh() }
    const { error } = await supabase.rpc('va_payment_intake_match', { p_intake: id, p_policy: policy, p_due: due || null })
    if (error) throw new Error(error.message || 'Couldn’t match it.')
    return refresh()
  }
  const dismiss = async id => {
    if (src !== 'real') { sampleList = sampleList.filter(n => n.id !== id); return refresh() }
    const { error } = await supabase.rpc('va_payment_intake_dismiss', { p_intake: id })
    if (error) throw new Error(error.message || 'Couldn’t set it aside.')
    return refresh()
  }
  return { list, refresh, match, dismiss }
}

