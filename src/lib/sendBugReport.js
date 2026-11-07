import { supabase } from './supabase'

// P876 — Report a bug, signed in for real: the P711 saving path (the same as hooks/useBugReports useCreateBugReport,
// without needing React Query). The screenshot goes to the private bug-screenshots bucket under the sender's own
// folder; the row goes to bug_reports, and migration 090's trigger gives every admin an app notification.
export async function sendBugReport({ description, file, pageUrl }) {
  const { data: { user } = {}, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Sign in again, then send it')
  let screenshot_url = null
  if (file) {
    const path = `${user.id}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`
    const { error } = await supabase.storage.from('bug-screenshots').upload(path, file)
    if (error) throw error
    screenshot_url = path
  }
  const { data, error } = await supabase.from('bug_reports').insert({ reporter_id: user.id, description, screenshot_url, page_url: pageUrl }).select('id').single()
  if (error) throw error
  return data
}
