import { useEffect, useState } from 'react'
import { App } from '@capacitor/app'
import { isNativeApp } from '../../lib/native'
import { RUNNING, readOtaStatus, onOtaStatus } from '../../lib/ota'
import { aboutLines } from '../../lib/otaRules.js'

// P961 — "About this app": one small line under Sign out / at the foot of More, in the phone app only.
// Shows the store build, the web code it is running and what the live updater last did, so a screenshot
// from the phone says exactly what it runs.
export function AppAbout({ style }) {
  const [info, setInfo] = useState({})
  const [status, setStatus] = useState(readOtaStatus)
  useEffect(() => {
    if (!isNativeApp()) return undefined
    App.getInfo().then(setInfo).catch(() => {})
    return onOtaStatus(setStatus)
  }, [])
  if (!isNativeApp()) return null
  const [top, bottom] = aboutLines(info, RUNNING, status)
  return (
    <p aria-label="About this app" style={{ margin: '10px 4px 0', fontSize: 11, lineHeight: 1.45, color: 'var(--ov-mute)', overflowWrap: 'anywhere', ...style }}>
      <b style={{ fontWeight: 600 }}>About this app</b> · {top}<br />{bottom}
    </p>
  )
}
