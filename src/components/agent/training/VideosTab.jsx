import { useState } from 'react'
import { Play, Plus, Trash2, ChevronUp, ChevronDown, X } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import {
  useTrainingVideos, useAddTrainingVideo, useDeleteTrainingVideo, useSwapTrainingVideoOrder,
} from '../../../hooks/useTrainingVideos'
import { extractYoutubeId, youtubeThumbnailUrl, youtubeEmbedUrl } from '../../../lib/youtube'
import { card, grid3, primaryBtn, ghostBtn } from '../../../lib/exportStyles'
import { TextField, GapNote } from '../../ui/ExportForm'

// Prompt 417 — Training Center Videos tab. Real YouTube embeds (migration
// 101, table training_videos), same admin-write/everyone-read shape as the
// Carrier Portals directory (useCarriers.js). No files are ever uploaded or
// re-hosted here -- every card renders a standard youtube.com/embed/{id}
// iframe, YouTube's own CDN and player the whole way through.
const BLANK = { title: '', youtube_url: '' }

export function VideosTab() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { data: videos = [], isLoading } = useTrainingVideos()
  const addVideo = useAddTrainingVideo()
  const deleteVideo = useDeleteTrainingVideo()
  const swapOrder = useSwapTrainingVideoOrder()

  const [form, setForm] = useState(BLANK)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState(null)

  function submit() {
    setError('')
    const title = form.title.trim()
    const url = form.youtube_url.trim()
    if (!title) return setError('Enter a title')
    if (!extractYoutubeId(url)) return setError('Enter a valid YouTube URL (watch, youtu.be, or shorts link)')

    const nextOrder = videos.reduce((max, v) => Math.max(max, v.sort_order), -1) + 1
    addVideo.mutate(
      { title, youtube_url: url, sort_order: nextOrder, created_by: profile?.id || null },
      {
        onSuccess: () => { setForm(BLANK); setAdding(false) },
        onError: err => setError(err.message || 'Could not save this video'),
      }
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
          {videos.length} video{videos.length === 1 ? '' : 's'}
        </span>
        {isAdmin && (
          <button onClick={() => setAdding(v => !v)} style={ghostBtn}>
            <Plus size={12} /> Add video
          </button>
        )}
      </div>

      {isAdmin && adding && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={grid3}>
            <TextField label="Title" placeholder="Getting past the gatekeeper" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <TextField label="YouTube URL" placeholder="https://youtube.com/watch?v=…" value={form.youtube_url} onChange={e => setForm(f => ({ ...f, youtube_url: e.target.value }))} />
          </div>
          {error && <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--danger)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={submit} disabled={addVideo.isPending} style={{ ...primaryBtn, opacity: addVideo.isPending ? 0.6 : 1 }}>
              {addVideo.isPending ? 'Saving…' : 'Save video'}
            </button>
            <button onClick={() => { setAdding(false); setForm(BLANK); setError('') }} style={{ ...ghostBtn, height: 36 }}>
              Cancel
            </button>
          </div>
          <GapNote>
            Paste any YouTube link (watch, youtu.be, or shorts) -- the video stays hosted on YouTube, this only
            saves the link and a title.
          </GapNote>
        </div>
      )}

      {isLoading ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>Loading videos…</p>
      ) : videos.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '40px 24px' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>No videos yet</p>
          <p style={{ margin: '6px auto 0', maxWidth: 420, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {isAdmin
              ? 'Add onboarding and product videos with a YouTube link -- they play inline right here.'
              : 'Onboarding and product videos land here once an admin adds them.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {videos.map((v, i) => (
            <VideoCard
              key={v.id}
              video={v}
              isAdmin={isAdmin}
              isOpen={openId === v.id}
              onOpen={() => setOpenId(v.id)}
              onClose={() => setOpenId(null)}
              onDelete={() => { if (openId === v.id) setOpenId(null); deleteVideo.mutate(v.id) }}
              onMoveUp={i > 0 ? () => swapOrder.mutate({ a: v, b: videos[i - 1] }) : null}
              onMoveDown={i < videos.length - 1 ? () => swapOrder.mutate({ a: v, b: videos[i + 1] }) : null}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function VideoCard({ video, isAdmin, isOpen, onOpen, onClose, onDelete, onMoveUp, onMoveDown }) {
  const youtubeId = extractYoutubeId(video.youtube_url)

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#000' }}>
        {isOpen && youtubeId ? (
          <iframe
            src={youtubeEmbedUrl(youtubeId)}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
          />
        ) : (
          <button
            onClick={onOpen}
            disabled={!youtubeId}
            title={youtubeId ? 'Play video' : 'Could not read a video ID from this URL'}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', padding: 0,
              cursor: youtubeId ? 'pointer' : 'not-allowed', background: 'var(--bg-elevated)',
            }}
          >
            {youtubeId && (
              <img
                src={youtubeThumbnailUrl(youtubeId)}
                alt={video.title}
                loading="lazy"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}
            <span style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              width: 44, height: 44, borderRadius: '50%',
              background: 'rgba(255,255,255,0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Play size={18} style={{ color: 'var(--accent)', marginLeft: 2 }} />
            </span>
          </button>
        )}

        {isOpen && (
          <button
            onClick={onClose}
            title="Collapse"
            style={{
              position: 'absolute', top: 6, right: 6, border: 'none', background: 'rgba(0,0,0,0.55)',
              color: '#fff', display: 'inline-flex', padding: 5, borderRadius: 6,
            }}
          >
            <X size={12} />
          </button>
        )}

        {isAdmin && !isOpen && (
          <button
            onClick={onDelete}
            title="Remove video"
            style={{
              position: 'absolute', top: 6, right: 6, border: 'none', background: 'rgba(0,0,0,0.55)',
              color: '#fff', display: 'inline-flex', padding: 5, borderRadius: 6,
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{video.title}</span>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 2 }}>
            <ReorderButton onClick={onMoveUp} label="Move up"><ChevronUp size={13} /></ReorderButton>
            <ReorderButton onClick={onMoveDown} label="Move down"><ChevronDown size={13} /></ReorderButton>
          </div>
        )}
      </div>
    </div>
  )
}

function ReorderButton({ onClick, label, children }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      title={label}
      style={{
        width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
        borderRadius: 5, color: onClick ? 'var(--text-secondary)' : 'var(--text-muted)',
        opacity: onClick ? 1 : 0.4, cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {children}
    </button>
  )
}
