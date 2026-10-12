import { useEffect, useState } from 'react'
import { loadConnectAndInitialize } from '@stripe/connect-js'
import {
  ConnectComponentsProvider, ConnectAccountOnboarding, ConnectAccountManagement, ConnectNotificationBanner, ConnectDocuments,
} from '@stripe/react-connect-js'
import { Loader2, Lock } from 'lucide-react'
import { invokeConnect } from '../../hooks/useFulfillmentPayouts'
import { useTheme } from '../../hooks/useTheme'

// Prompt 753 — Stripe Connect embedded components inside Payout settings.
// Every form here is Stripe's own (bank, card, identity, tax), rendered in our
// card; bank and tax numbers go straight to Stripe and never through Ohvara.
// The Account Session is minted by fulfillment-connect-session for the
// signed-in rep only. Loaded with React.lazy so connect-js only ships to a
// rep who opens one.
//
//   kind: onboarding  first-time setup (identity, bank, tax)
//         bank        account management, narrowed to the payout account
//         details     account management, everything but the payout account
//         tax         account management, narrowed to the taxpayer ID
//         documents   tax forms to download (1099), if Stripe allows it
//         banner      Stripe's own "action needed" notice

const FONT = 'Manrope, system-ui, -apple-system, Segoe UI, sans-serif'

// Our v16 tokens, in Stripe's Connect appearance terms.
function connectAppearance(theme) {
  const light = theme === 'light'
  return {
    overlays: 'dialog',
    variables: {
      fontFamily: FONT,
      fontSizeBase: '15px',
      borderRadius: '12px',
      colorPrimary: light ? '#00806F' : '#7FA6F2',
      colorBackground: light ? '#FFFFFF' : '#10121A',
      colorText: light ? '#07332E' : '#FFFFFF',
      colorSecondaryText: light ? '#4F7F78' : '#8697B5',
      colorDanger: light ? '#B42318' : '#F87171',
      colorBorder: light ? 'rgba(2,79,70,0.18)' : 'rgba(255,255,255,0.12)',
      formBackgroundColor: light ? '#F6FAF9' : '#0B0D14',
      formHighlightColorBorder: light ? '#00806F' : '#7FA6F2',
      offsetBackgroundColor: light ? '#F6FAF9' : '#161922',
      buttonPrimaryColorBackground: light ? '#024F46' : '#FFFFFF',
      buttonPrimaryColorText: light ? '#FFFFFF' : '#0D1730',
      buttonSecondaryColorBackground: light ? '#FFFFFF' : 'rgba(255,255,255,0.06)',
      buttonSecondaryColorText: light ? '#07332E' : '#FFFFFF',
      buttonSecondaryColorBorder: light ? 'rgba(2,79,70,0.18)' : 'rgba(255,255,255,0.14)',
      actionPrimaryColorText: light ? '#00806F' : '#7FA6F2',
    },
  }
}

// One connect-js instance per page load; later sessions are fetched by
// connect-js itself through fetchClientSecret when the first one expires.
let boot = null
function connectInstance() {
  if (!boot) {
    boot = invokeConnect('session').then(first => {
      let pending = first.client_secret
      const instance = loadConnectAndInitialize({
        publishableKey: first.publishable_key,
        fetchClientSecret: async () => {
          if (pending) { const s = pending; pending = null; return s }
          return (await invokeConnect('session')).client_secret
        },
        fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap' }],
        appearance: connectAppearance(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'),
      })
      return { instance, documents: first.documents !== false }
    })
    boot.catch(() => { boot = null })
  }
  return boot
}

function useConnect() {
  const [theme] = useTheme()
  const [state, setState] = useState({ instance: null, documents: true, error: '' })
  useEffect(() => {
    let live = true
    connectInstance()
      .then(({ instance, documents }) => { if (live) setState({ instance, documents, error: '' }) })
      .catch(e => { if (live) setState(s => ({ ...s, error: e.message })) })
    return () => { live = false }
  }, [])
  useEffect(() => { state.instance?.update({ appearance: connectAppearance(theme) }) }, [state.instance, theme])
  return state
}

function Waiting({ label }) {
  return (
    <div role="status" className="ps-wait"><Loader2 size={17} className="animate-spin" /> {label}</div>
  )
}

const ONLY_BANK = { fields: 'eventually_due', futureRequirements: 'include', requirements: { only: ['external_account'] } }
const NOT_BANK = { fields: 'eventually_due', futureRequirements: 'include', requirements: { exclude: ['external_account'] } }
const ONLY_TAX = { fields: 'eventually_due', futureRequirements: 'include', requirements: { only: ['individual.ssn_last_4', 'individual.id_number'] } }

export default function ConnectEmbed({ kind, onDone, onDocuments }) {
  const { instance, documents, error } = useConnect()
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { if (instance) onDocuments?.(documents) }, [instance, documents, onDocuments])

  if (error) return <p role="alert" className="ov-mb-error">{error}</p>
  if (!instance) return kind === 'banner' ? null : <Waiting label="Opening Stripe's secure form…" />
  if (kind === 'documents' && !documents) return <p className="ps-note">Tax forms can't be shown here yet. Stripe emails your 1099 when it's ready.</p>

  const common = { onLoaderStart: () => setLoaded(true), onLoadError: () => setLoaded(true) }
  let body
  if (kind === 'onboarding') body = <ConnectAccountOnboarding onExit={onDone} collectionOptions={{ fields: 'eventually_due', futureRequirements: 'include' }} {...common} />
  else if (kind === 'bank') body = <ConnectAccountManagement collectionOptions={ONLY_BANK} {...common} />
  else if (kind === 'details') body = <ConnectAccountManagement collectionOptions={NOT_BANK} {...common} />
  else if (kind === 'tax') body = <ConnectAccountManagement collectionOptions={ONLY_TAX} {...common} />
  else if (kind === 'documents') body = <ConnectDocuments {...common} />
  else if (kind === 'banner') body = <ConnectNotificationBanner {...common} />

  return (
    <ConnectComponentsProvider connectInstance={instance}>
      {!loaded && kind !== 'banner' && <Waiting label="Loading Stripe's secure form…" />}
      {body}
      {kind !== 'banner' && (
        <div className="ov-mb-actions" style={{ marginTop: 14 }}>
          <span className="ov-mb-secure"><Lock size={13} strokeWidth={2} aria-hidden="true" /> Secured by Stripe</span>
          {onDone && kind !== 'onboarding' && <button type="button" className="ov-ghost ov-mb-btn" onClick={onDone}>Done</button>}
        </div>
      )}
    </ConnectComponentsProvider>
  )
}
