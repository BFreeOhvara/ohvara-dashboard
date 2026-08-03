import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, Underline, List, ListOrdered, Loader2, Check } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useAppSettings, useUpdateAppSettings } from '../../../hooks/useAppSettings'
import { card, ghostBtn, MONO } from '../../../lib/exportStyles'

// Prompt 415 — Training Center Script tab. Single shared script doc (not
// per-agent), admin-only edit, everyone else read-only. Lands on
// app_settings.training_script (migration 099) — same singleton row the
// Daily.co room URL already lives on, same "everyone reads / admins
// update" RLS.
//
// No rich-text-editor library exists in this repo yet, so the toolbar is a
// plain contentEditable + document.execCommand — the classic lightweight
// approach, fine for an internal admin-only editor with a handful of
// formatting needs (bold/italic/underline/lists). The div is intentionally
// uncontrolled: its innerHTML is set imperatively once on load, then read
// on each input rather than re-rendered from state, so typing doesn't reset
// the caret position the way a controlled dangerouslySetInnerHTML would.
export function ScriptTab() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { data: settings, isLoading } = useAppSettings()
  const updateSettings = useUpdateAppSettings()

  if (isLoading) {
    return (
      <div style={{ minHeight: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  return isAdmin
    ? <ScriptEditor settings={settings} updateSettings={updateSettings} />
    : <ScriptReadOnly settings={settings} />
}

function ScriptReadOnly({ settings }) {
  const html = settings?.training_script
  return (
    <div>
      <MetaLine settings={settings} />
      <div style={{ ...card, minHeight: 300 }}>
        {html
          ? <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: html }} />
          : <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }}>No script has been added yet.</p>}
      </div>
    </div>
  )
}

function MetaLine({ settings }) {
  if (!settings?.training_script_updated_at) return null
  const when = new Date(settings.training_script_updated_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  return (
    <p style={{ margin: '0 0 10px', fontSize: 11, fontFamily: MONO, color: 'var(--text-muted)' }}>
      Last updated {settings.training_script_updated_by ? `by ${settings.training_script_updated_by} ` : ''}· {when}
    </p>
  )
}

const TOOLBAR = [
  { cmd: 'bold', icon: Bold, label: 'Bold' },
  { cmd: 'italic', icon: Italic, label: 'Italic' },
  { cmd: 'underline', icon: Underline, label: 'Underline' },
  { cmd: 'insertUnorderedList', icon: List, label: 'Bulleted list' },
  { cmd: 'insertOrderedList', icon: ListOrdered, label: 'Numbered list' },
]

function ScriptEditor({ settings, updateSettings }) {
  const { profile } = useAuth()
  const editorRef = useRef(null)
  const initializedRef = useRef(false)
  const dirtyRef = useRef(false)
  const saveTimerRef = useRef(null)
  const [status, setStatus] = useState('saved') // 'saved' | 'dirty' | 'saving'

  // Set the editor's starting content once the row has loaded — never again,
  // so a background refetch (e.g. React Query revalidation) can't stomp on
  // whatever the admin is mid-typing.
  useEffect(() => {
    if (initializedRef.current || !editorRef.current || settings === undefined) return
    editorRef.current.innerHTML = settings?.training_script || ''
    initializedRef.current = true
  }, [settings])

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  // Warn on tab close/refresh while a debounced save hasn't landed yet —
  // covers the "don't lose content on nav-away" requirement for the one
  // nav-away path a component can't otherwise intercept.
  useEffect(() => {
    function handler(e) {
      if (!dirtyRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  function flush() {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    if (!dirtyRef.current || !editorRef.current) return
    setStatus('saving')
    updateSettings.mutate({
      training_script: editorRef.current.innerHTML,
      training_script_updated_at: new Date().toISOString(),
      training_script_updated_by: profile?.full_name || null,
    }, {
      onSuccess: () => { dirtyRef.current = false; setStatus('saved') },
      onError: () => setStatus('dirty'),
    })
  }

  function onInput() {
    dirtyRef.current = true
    setStatus('dirty')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(flush, 1500)
  }

  function exec(cmd) {
    editorRef.current?.focus()
    document.execCommand(cmd, false, null)
    onInput()
  }

  return (
    <div>
      <style>{`
        .script-editor:empty:before {
          content: attr(data-placeholder);
          color: var(--text-muted);
        }
        .script-editor ul, .script-editor ol { margin: 0 0 0 20px; padding: 0; }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {TOOLBAR.map(({ cmd, icon: Icon, label }) => (
            <button
              key={cmd}
              type="button"
              title={label}
              onMouseDown={e => e.preventDefault()} // keep focus/selection in the editor
              onClick={() => exec(cmd)}
              style={{
                width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
                borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>

        <SaveStatus status={status} settings={settings} onBlurFlush={flush} />
      </div>

      <div
        ref={editorRef}
        className="script-editor"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Type or paste your script here…"
        onInput={onInput}
        onBlur={flush}
        style={{
          ...card, minHeight: 300, fontSize: 14, lineHeight: 1.7,
          color: 'var(--text-primary)', outline: 'none', cursor: 'text',
        }}
      />
    </div>
  )
}

function SaveStatus({ status, settings, onBlurFlush }) {
  if (status === 'saving') {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: MONO, color: 'var(--text-muted)' }}>
        <Loader2 size={12} className="animate-spin" /> Saving…
      </span>
    )
  }
  if (status === 'dirty') {
    return (
      <button type="button" onClick={onBlurFlush} style={{ ...ghostBtn, height: 30, padding: '0 12px', fontSize: 11 }}>
        Save now
      </button>
    )
  }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: MONO, color: 'var(--text-muted)' }}>
      <Check size={12} style={{ color: 'var(--success)' }} />
      {settings?.training_script_updated_at
        ? `Saved · ${new Date(settings.training_script_updated_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
        : 'Saved'}
    </span>
  )
}
