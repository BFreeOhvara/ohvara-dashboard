import { useEffect, useState } from 'react'
import {
  DailyProvider, useCallObject, useDaily, useDailyEvent,
  useParticipantIds, useParticipant, useLocalSessionId, DailyVideo, DailyAudio,
} from '@daily-co/daily-react'
import { Mic, MicOff, Video, VideoOff, PhoneOff, Users, Loader2 } from 'lucide-react'
import { useAppSettings } from '../../hooks/useAppSettings'
import { useNotifyLiveRoom } from '../../hooks/useNotifications'
import { Avatar } from '../ui/Avatar'
import { ComingSoon } from '../agent/ComingSoon'
import { GapNote } from '../ui/ExportForm'
import { primaryBtn, ghostBtn } from '../../lib/exportStyles'

// Live Room (Prompt 393) — one always-open Daily.co room embedded directly
// in the Meetings tab, not an iframe/new-tab link. Room identity lives in
// app_settings.daily_room_url (migration 097); no API key anywhere
// client-side, since joining a Daily room only needs its URL.
//
// v1 scope, confirmed with Brayden: just ONE room, prove it works before any
// multi-channel infrastructure. The call object is only created once the
// agent clicks Join (not on tab load) so nobody's camera/mic gets touched
// without an explicit action.

function ParticipantTile({ sessionId, isLocal }) {
  const p = useParticipant(sessionId)
  if (!p) return null

  const name = p.user_name || (isLocal ? 'You' : 'Teammate')
  const label = isLocal ? `${name} (You)` : name

  return (
    <div style={{
      position: 'relative', borderRadius: 10, overflow: 'hidden', aspectRatio: '4 / 3',
      background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {p.video ? (
        <DailyVideo
          sessionId={sessionId}
          automirror
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <Avatar
          name={p.user_name}
          avatarUrl={p.userData?.avatar_url}
          avatarColor={p.userData?.avatar_color}
          size={56}
        />
      )}
      <div style={{
        position: 'absolute', bottom: 8, left: 8, right: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 600, color: '#fff', padding: '2px 8px', borderRadius: 4,
          background: 'rgba(0,0,0,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {label}
        </span>
        {!p.audio && (
          <span style={{
            width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <MicOff size={11} style={{ color: 'var(--danger)' }} />
          </span>
        )}
      </div>
    </div>
  )
}

function RoomView({ url, userName, userData, onLeave }) {
  const daily = useDaily()
  const localSessionId = useLocalSessionId()
  const localParticipant = useParticipant(localSessionId)
  const participantIds = useParticipantIds({ sort: 'joined_at' })
  const [state, setState] = useState('joining')

  useEffect(() => {
    if (!daily) return
    daily.join({ url, userName, userData }).catch(err => {
      console.error('[LiveRoom] join failed', err)
      setState('error')
    })
  }, [daily, url, userName, userData])

  useDailyEvent('joined-meeting', () => setState('joined'))
  useDailyEvent('left-meeting', () => onLeave())
  useDailyEvent('error', (ev) => { console.error('[LiveRoom]', ev); setState('error') })

  if (state === 'error') {
    return (
      <div style={{ padding: '24px 0' }}>
        <p style={{ fontSize: 13, color: 'var(--danger)' }}>Couldn't join the Live Room. Check the room link in Settings → Integrations.</p>
        <button onClick={onLeave} style={{ ...ghostBtn, marginTop: 12 }}>Back</button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <DailyAudio />

      {state === 'joining' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '24px 0' }}>
          <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Joining Live Room…</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {participantIds.map(id => (
            <ParticipantTile key={id} sessionId={id} isLocal={id === localSessionId} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => daily?.setLocalAudio(!localParticipant?.audio)} style={ghostBtn}>
          {localParticipant?.audio ? <Mic size={14} /> : <MicOff size={14} style={{ color: 'var(--danger)' }} />}
          {localParticipant?.audio ? 'Mute' : 'Unmute'}
        </button>
        <button onClick={() => daily?.setLocalVideo(!localParticipant?.video)} style={ghostBtn}>
          {localParticipant?.video ? <Video size={14} /> : <VideoOff size={14} style={{ color: 'var(--danger)' }} />}
          {localParticipant?.video ? 'Camera off' : 'Camera on'}
        </button>
        <button
          onClick={() => daily?.leave()}
          style={{ ...primaryBtn, background: 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <PhoneOff size={14} /> Leave
        </button>
      </div>
    </div>
  )
}

function ActiveRoom({ url, userName, userData, onLeave }) {
  // useCallObject owns the DailyCall instance's lifecycle — created on mount,
  // destroyed on unmount (i.e. the moment `active` flips back to false
  // below). Safe under StrictMode's double-invoke, which is the whole reason
  // this hook exists rather than a bare `Daily.createCallObject()` call.
  const callObject = useCallObject({})
  return (
    <DailyProvider callObject={callObject}>
      <RoomView url={url} userName={userName} userData={userData} onLeave={onLeave} />
    </DailyProvider>
  )
}

function NotifyButton({ profileId }) {
  const notify = useNotifyLiveRoom(profileId)
  const [sent, setSent] = useState(null)

  async function handleClick() {
    setSent(null)
    try {
      const count = await notify.mutateAsync()
      setSent(count)
      setTimeout(() => setSent(null), 4000)
    } catch {
      setSent('error')
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <button onClick={handleClick} disabled={notify.isPending} style={{ ...ghostBtn, opacity: notify.isPending ? 0.6 : 1 }}>
        {notify.isPending ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />}
        Notify team to join
      </button>
      {sent === 'error' && <span style={{ fontSize: 11.5, color: 'var(--danger)' }}>Couldn't send — try again.</span>}
      {typeof sent === 'number' && (
        <span style={{ fontSize: 11.5, color: 'var(--success)' }}>
          {sent > 0 ? `Notified ${sent} teammate${sent === 1 ? '' : 's'}.` : 'No one else to notify yet.'}
        </span>
      )}
    </div>
  )
}

export function LiveRoom({ profile }) {
  const { data: settings, isLoading } = useAppSettings()
  const [active, setActive] = useState(false)
  const roomUrl = settings?.daily_room_url
  const isAdmin = profile?.role === 'admin'

  if (isLoading) return null

  if (!roomUrl) {
    return (
      <ComingSoon
        title="Live Room not set up yet"
        description={
          isAdmin
            ? 'Create a free room at daily.co and paste its URL in Settings → Integrations to turn this on.'
            : "The Live Room hasn't been configured yet — check with an admin."
        }
      />
    )
  }

  const userData = { avatar_url: profile?.avatar_url, avatar_color: profile?.avatar_color }

  return (
    <div>
      {!active && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>Live Room</h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
              Drop in anytime — camera on or off, mic on or off.
            </p>
          </div>
          {isAdmin && <NotifyButton profileId={profile.id} />}
        </div>
      )}

      {active ? (
        <ActiveRoom
          url={roomUrl}
          userName={profile?.full_name || 'Agent'}
          userData={userData}
          onLeave={() => setActive(false)}
        />
      ) : (
        <div style={{
          background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
          borderRadius: 8, padding: '40px 24px', textAlign: 'center',
        }}>
          <button onClick={() => setActive(true)} style={primaryBtn}>Join Live Room</button>
          <GapNote>Nobody's camera or mic turns on until you join.</GapNote>
        </div>
      )}
    </div>
  )
}
