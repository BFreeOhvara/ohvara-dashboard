import { Switch, useNote } from '../template/kit'
import { useAppSettings, useUpdateAppSettings } from '../hooks/useAppSettings'
import { switchReady } from '../lib/dataMode'

// P848 — "Show sample data": company-wide, ON by default. While on, every portal (agent, VA, admin) keeps its sample
// information exactly as today; real reads and writes are built underneath and show once it is off. Admins preview
// real data for themselves from the avatar menu (View: Sample / Real) without changing what anyone else sees.
// The value is app_settings.show_sample_data; until that column exists it reads as on and can't be saved.
export default function SampleSwitch({ live }) {
  const note = useNote()
  const { data } = useAppSettings()
  const save = useUpdateAppSettings()
  const ready = live && switchReady(data)
  const on = data?.show_sample_data !== false
  const flip = v => {
    if (!live) { note('Sample only here. The real switch is on the signed-in admin page'); return }
    if (!ready) { note('This switch needs a database update first. Until then every portal shows sample data'); return }
    save.mutate({ show_sample_data: v }, {
      onSuccess: () => note(v ? 'Sample data on for everyone' : 'Sample data off. Everyone now sees real data'),
      onError: () => note('Could not save. Nothing changed'),
    })
  }
  return (
    <div className="adm-swgroup">
      <h3 className="fx-h3">Data</h3>
      <ul className="tp-list">
        <li className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Show sample data</b>
          <p className="tp-sub">On: every portal shows its sample information. Off: everyone sees their real data. You can preview real data for yourself from your avatar menu (View).{live && !ready && ' Needs a database update before it can be turned off.'}</p></div>
          <Switch on={on} label="Show sample data" onChange={flip} /></li>
      </ul>
    </div>
  )
}
