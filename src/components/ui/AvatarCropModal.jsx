import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import Cropper from 'react-easy-crop'
import { X } from 'lucide-react'
import { primaryBtn, ghostBtn } from '../../lib/exportStyles'
import { cropImageToBlob } from '../../lib/imageCrop'

// Prompt 422 — crop/zoom step between file-select and upload. No cropper
// existed anywhere in the repo before this (Prompt 407's avatar upload sent
// whatever was picked as-is, off-center or stretched into the circle);
// react-easy-crop is a small, actively maintained pick with no extra deps
// beyond React, wired into this one modal.
export function AvatarCropModal({ imageSrc, onCancel, onConfirm, saving }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)

  const onCropComplete = useCallback((_croppedArea, pixels) => {
    setCroppedAreaPixels(pixels)
  }, [])

  async function confirm() {
    if (!croppedAreaPixels) return
    const blob = await cropImageToBlob(imageSrc, croppedAreaPixels)
    onConfirm(blob)
  }

  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420,
          background: 'var(--bg-elevated)',
          border: '0.5px solid var(--border)',
          borderRadius: 10, padding: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            Position your photo
          </p>
          <button
            onClick={onCancel}
            style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex' }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ position: 'relative', width: '100%', height: 280, borderRadius: 8, overflow: 'hidden', background: 'var(--bg-base)' }}>
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <input
          type="range" min={1} max={3} step={0.01} value={zoom}
          onChange={e => setZoom(Number(e.target.value))}
          style={{ width: '100%', marginTop: 14, accentColor: 'var(--accent)' }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button onClick={onCancel} style={{ ...ghostBtn, height: 32 }}>Cancel</button>
          <button
            onClick={confirm}
            disabled={saving || !croppedAreaPixels}
            style={{ ...primaryBtn, height: 32, padding: '0 16px', fontSize: 12, opacity: (saving || !croppedAreaPixels) ? 0.5 : 1 }}
          >
            {saving ? 'Uploading…' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
