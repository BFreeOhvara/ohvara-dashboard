import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, Circle, Lock, PlayCircle, ArrowRight, Award } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useMyTraining, useSetModuleDone, useTeamTraining, completedIds } from '../../hooks/useAgentTraining'
import { TRAINING_MODULES, TOTAL_MODULES } from '../../data/agentTraining'
import { card, cardTitle, eyebrow, primaryBtn, ghostBtn, MONO, DISPLAY } from '../../lib/exportStyles'
import { Pill, SectionHead, EmptyNote, ScriptHint } from '../../components/agent/AgentUI'
import { isTestAccount } from '../../lib/testAccounts'

// Training (Prompt 670) — short modules on how the agent job works now: get
// the client on the phone, book a 30-minute call, hand off to Fulfillment.
// Content lives in src/data/agentTraining.js (draft, pending Brayden).
//
// Modules unlock in order — the old setter portal's "complete training to
// unlock" veil, re-pointed at the modules themselves. It deliberately does
// NOT lock Book a call or any real work: the content is still a draft, and
// the live team is already booking. Admin sees every module unlocked (to
// review it) plus each agent's progress, and has nothing to tick.

const fmtDate = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function Training() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { data: row, isLoading } = useMyTraining(profile?.id)
  const setDone = useSetModuleDone(profile?.id)
  const [error, setError] = useState('')

  const done = useMemo(() => new Set(completedIds(row)), [row])
  // A module is locked while any module before it is unfinished.
  const lockedAt = i => !isAdmin && TRAINING_MODULES.slice(0, i).some(m => !done.has(m.id))
  const firstOpen = TRAINING_MODULES.findIndex(m => !done.has(m.id))

  const [picked, setPicked] = useState(null)
  const detailRef = useRef(null)
  const activeIdx = picked ?? (firstOpen === -1 ? 0 : firstOpen)
  const active = TRAINING_MODULES[activeIdx]

  const count = done.size
  const complete = count === TOTAL_MODULES

  // Bring the module's top into view when it's off screen — on a phone the
  // detail sits below the list, and after "Mark as done" the page is scrolled
  // to the bottom of the module just finished.
  function show(i) {
    setPicked(i)
    const top = detailRef.current?.getBoundingClientRect().top
    if (top != null && (top < 0 || top > window.innerHeight * 0.6)) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  function toggle(moduleId, value) {
    setError('')
    setDone.mutate({ moduleId, done: value, current: row }, {
      onSuccess: () => {
        // Finishing a module moves on to the next one, from its top.
        if (value && activeIdx < TOTAL_MODULES - 1) show(activeIdx + 1)
      },
      onError: err => setError(err.message || 'Could not save your progress'),
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {!isAdmin && <ProgressCard count={count} complete={complete} finishedAt={row?.unlocked_at} loading={isLoading} />}

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ ...card, padding: 0, overflow: 'hidden', flex: '1 1 300px' }} className="max-w-full lg:max-w-[380px]">
          <div style={{ ...eyebrow, padding: '11px 20px', background: 'var(--bg-elevated)' }}>Modules</div>
          {TRAINING_MODULES.map((m, i) => (
            <ModuleRow
              key={m.id} m={m} n={i + 1}
              done={done.has(m.id)} locked={lockedAt(i)} active={i === activeIdx}
              onClick={() => show(i)}
            />
          ))}
        </div>

        <div ref={detailRef} style={{ flex: '2 1 480px', minWidth: 0, scrollMarginTop: 80 }}>
          <ModuleDetail
            m={active} n={activeIdx + 1}
            locked={lockedAt(activeIdx)}
            prev={activeIdx > 0 ? TRAINING_MODULES[activeIdx - 1] : null}
            onGoPrev={() => show(TRAINING_MODULES.findIndex(m => !done.has(m.id)))}
            done={done.has(active.id)}
            canTick={!isAdmin}
            busy={setDone.isPending}
            onToggle={v => toggle(active.id, v)}
            error={error}
          />
        </div>
      </div>

      {isAdmin && <TeamProgress />}
    </div>
  )
}

function ProgressCard({ count, complete, finishedAt, loading }) {
  const pct = Math.round((count / TOTAL_MODULES) * 100)
  return (
    <div style={{
      ...card, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
      ...(complete ? { background: 'var(--success-dim)', borderColor: 'var(--success-bd)' } : null),
    }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <p style={{ ...eyebrow, ...(complete ? { color: 'var(--success)' } : null) }}>
          {complete ? 'Training complete' : 'Your progress'}
        </p>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
          {loading ? 'Loading…'
            : complete ? `You finished every module${finishedAt ? ` on ${fmtDate(finishedAt)}` : ''}. Come back any time to refresh.`
              : count === 0 ? 'Four short modules on how the job works, start to finish. Work through them in order.'
                : `${TOTAL_MODULES - count} module${TOTAL_MODULES - count === 1 ? '' : 's'} left. Pick up where you left off.`}
        </p>
      </div>
      <div style={{ flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--bg-muted)', overflow: 'hidden' }}>
          <div style={{
            width: `${pct}%`, height: '100%', borderRadius: 999, transition: 'width 300ms ease-out',
            background: complete ? 'var(--success)' : 'var(--accent)',
          }} />
        </div>
        <span style={{
          fontFamily: MONO, fontSize: 22, fontWeight: 500, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
          color: complete ? 'var(--success)' : 'var(--text-primary)',
        }}>
          {count}/{TOTAL_MODULES}
        </span>
      </div>
    </div>
  )
}

function ModuleRow({ m, n, done, locked, active, onClick }) {
  const Icon = done ? CheckCircle2 : locked ? Lock : Circle
  return (
    <button
      onClick={onClick}
      className="table-row-hover"
      aria-current={active ? 'step' : undefined}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
        padding: '14px 20px', border: 'none', borderTop: 'var(--border-w) solid var(--border)',
        boxShadow: active ? 'inset 3px 0 0 var(--accent)' : 'none',
        background: active ? 'var(--bg-elevated)' : 'transparent',
        opacity: locked && !active ? 0.6 : 1,
      }}
    >
      <Icon size={18} style={{ flexShrink: 0, color: done ? 'var(--success)' : 'var(--text-muted)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ ...eyebrow, fontSize: 10, color: 'var(--text-muted)' }}>Module {n}</p>
        <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {m.title}
        </p>
      </div>
    </button>
  )
}

function VideoFrame({ m }) {
  return (
    <div style={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)' }}>
      {m.youtubeId ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${m.youtubeId}?rel=0`}
          title={m.title}
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)' }}>
          <PlayCircle size={36} strokeWidth={1.5} />
          <p style={{ ...eyebrow, color: 'var(--text-muted)' }}>Video coming soon</p>
        </div>
      )}
    </div>
  )
}

function ModuleBody({ m }) {
  return (
    <>
      <VideoFrame m={m} />
      <p style={{ ...cardTitle, margin: '24px 0 10px' }}>Key points</p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {m.points.map((pt, i) => (
          <li key={i} style={{ display: 'flex', gap: 10, fontSize: 14, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, marginTop: 8 }} />
            <span>{pt}</span>
          </li>
        ))}
      </ul>
      {m.script.length > 0 && (
        <>
          <p style={{ ...cardTitle, margin: '24px 0 10px' }}>What to say</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {m.script.map((line, i) => <ScriptHint key={i}>{line}</ScriptHint>)}
          </div>
        </>
      )}
    </>
  )
}

function ModuleDetail({ m, n, locked, prev, onGoPrev, done, canTick, busy, onToggle, error }) {
  return (
    <div style={{ ...card, padding: '24px 28px' }}>
      <p style={eyebrow}>Module {n} of {TOTAL_MODULES}</p>
      <h2 style={{ margin: '6px 0 4px', fontFamily: DISPLAY, fontSize: 22, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
        {m.title}
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text-muted)' }}>{m.summary}</p>

      {locked ? (
        // The setter portal's locked veil (Prompts 283/297/300), simplified:
        // the module shows through, dimmed and blurred, under one centered
        // card that says what unlocks it.
        <div style={{ position: 'relative', minHeight: 320 }}>
          <div aria-hidden style={{ filter: 'blur(3px)', opacity: 0.35, pointerEvents: 'none', userSelect: 'none' }}>
            <ModuleBody m={m} />
          </div>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 56 }}>
            <div style={{
              ...card, maxWidth: 340, padding: '24px 24px 20px', textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
            }}>
              <span style={{ width: 44, height: 44, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                <Lock size={20} />
              </span>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                Finish the module{n - 1 > 1 ? 's' : ''} before this one to unlock it
              </p>
              {prev && (
                <button onClick={onGoPrev} style={{ ...primaryBtn, marginTop: 4 }}>
                  Continue training <ArrowRight size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <ModuleBody m={m} />
          {canTick && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 24,
              padding: '14px 16px', borderRadius: 12, background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
            }}>
              {done ? (
                <>
                  <Pill tone="success" icon={CheckCircle2}>Done</Pill>
                  <span style={{ flex: 1, minWidth: 160, fontSize: 13.5, color: 'var(--text-secondary)' }}>You've finished this module.</span>
                  <button disabled={busy} onClick={() => onToggle(false)} style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>Mark not done</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, minWidth: 160, fontSize: 13.5, color: 'var(--text-secondary)' }}>Read it through, then mark it done to move on.</span>
                  <button disabled={busy} onClick={() => onToggle(true)} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
                    <CheckCircle2 size={15} /> {busy ? 'Saving…' : 'Mark as done'}
                  </button>
                </>
              )}
            </div>
          )}
          {error && <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--danger)' }}>{error}</p>}
        </>
      )}
    </div>
  )
}

// Admin only — RLS (tp_admin_select) is what lets this read other rows.
function TeamProgress() {
  const { data: team = [], isLoading } = useTeamTraining(true)
  return (
    <div>
      <SectionHead title="Team progress" sub="Where each active agent is in training" />
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {team.length === 0 ? (
          <EmptyNote>{isLoading ? 'Loading…' : 'No active agents yet.'}</EmptyNote>
        ) : team.map((a, i) => {
          const n = completedIds(a.progress).length
          const finished = n === TOTAL_MODULES
          return (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 20px',
              borderTop: i === 0 ? 'none' : 'var(--border-w) solid var(--border)',
            }}>
              <p style={{ flex: '1 1 160px', margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                {a.full_name || 'Unnamed'}
                {isTestAccount(a.id) && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>test account</span>}
              </p>
              <span style={{ fontFamily: MONO, fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                {n}/{TOTAL_MODULES}
              </span>
              {finished
                ? <Pill tone="success" icon={Award}>{a.progress?.unlocked_at ? `Done ${fmtDate(a.progress.unlocked_at)}` : 'Done'}</Pill>
                : n > 0 ? <Pill tone="info">In progress</Pill> : <Pill tone="muted">Not started</Pill>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
