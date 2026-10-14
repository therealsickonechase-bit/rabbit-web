import DefaultAgentBanner from '@/components/DefaultAgentBanner'
import CommandCatalogView from '@/components/CommandCatalogView'
import { PageHeader } from '@/components/ui'
import { CATALOG } from '@/lib/command-catalog'

// Rendered on the server from the catalog module. No API route: the module is plain data.
export default function CommandsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Commands" sub="Every command the owner built across rabbit-web, rabbitsoftware-cloudflare and research-agents, for everyone to read." />
      <DefaultAgentBanner />
      <CommandCatalogView entries={[...CATALOG]} />
    </div>
  )
}
