import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Bug reporting (Prompt 381) — floating button behind every authenticated
// page. `screenshot_url` holds the storage OBJECT PATH inside the private
// `bug-screenshots` bucket, not a public URL (the bucket is private, per the
// prompt's ask) — callers resolve a viewable URL on demand via
// `useBugScreenshotUrl` below.

export function useCreateBugReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ reporterId, description, screenshotFile, pageUrl }) => {
      let screenshot_url = null
      if (screenshotFile) {
        const path = `${reporterId}/${Date.now()}-${screenshotFile.name}`
        const { error: uploadError } = await supabase.storage
          .from('bug-screenshots')
          .upload(path, screenshotFile)
        if (uploadError) throw uploadError
        screenshot_url = path
      }

      const { data, error } = await supabase
        .from('bug_reports')
        .insert({
          reporter_id: reporterId,
          description,
          screenshot_url,
          page_url: pageUrl,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bug-reports'] }),
  })
}

// Admin inbox — every report, newest first, joined to the reporter's name.
export function useBugReports() {
  return useQuery({
    queryKey: ['bug-reports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bug_reports')
        .select('id, description, screenshot_url, page_url, status, created_at, reporter:profiles!bug_reports_reporter_id_fkey ( id, full_name )')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    refetchInterval: 30000,
  })
}

export function useUnresolvedBugReportCount() {
  return useQuery({
    queryKey: ['bug-reports-unresolved-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('bug_reports')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'new')
      if (error) throw error
      return count ?? 0
    },
    refetchInterval: 30000,
  })
}

export function useResolveBugReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('bug_reports')
        .update({ status: 'resolved' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bug-reports'] })
      qc.invalidateQueries({ queryKey: ['bug-reports-unresolved-count'] })
    },
  })
}

// Resolves a stored object path to a short-lived signed URL for display —
// the bucket is private, so there's no stable public URL to just render.
export function useBugScreenshotUrl(path) {
  return useQuery({
    queryKey: ['bug-screenshot-url', path],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from('bug-screenshots')
        .createSignedUrl(path, 3600)
      if (error) throw error
      return data.signedUrl
    },
    enabled: !!path,
    staleTime: 55 * 60 * 1000,
  })
}
