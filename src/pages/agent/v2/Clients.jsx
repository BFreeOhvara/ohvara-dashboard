import { Users } from 'lucide-react'
import { PortalV2Layout } from '../../../components/agent/PortalV2Nav'
import { ClientsV2Split } from '../../../components/agent/ClientsV2Parts'

// Clients (the v2 portal's page). /agent/clients now always renders My Pipeline, which shows these
// same parts when v2 is on (portal parity T5). The list, the detail cards and the data all live in
// components/agent/ClientsV2Parts.jsx; this page only puts them in the v2 shell.

export default function Clients() {
  return (
    <PortalV2Layout active="clients" title="Clients" icon={Users}>
      <ClientsV2Split gridClass="pv-grid2 cli" colClass="pv-col2" backClass="pv-back">
        <div className="pv-ph1"><h1>Clients</h1><p className="pv-sub">People you&rsquo;ve sold and the clients you already had. We help keep their policies on the books.</p></div>
      </ClientsV2Split>
    </PortalV2Layout>
  )
}
