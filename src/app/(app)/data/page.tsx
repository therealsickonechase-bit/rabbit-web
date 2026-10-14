import { headers } from 'next/headers'
import DataExplorer from '@/components/DataExplorer'
import { PageHeader } from '@/components/ui'
import { readManifest } from '@/lib/data-hub-db'
import type { Manifest } from '@/lib/data-hub'

export const dynamic = 'force-dynamic'

// Public data hub: research data and the chain ledger, read-only. Everything here is also served by GET /api/data and /api/data/<dataset>.
export default async function DataPage() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'app.rabbitsoftware.io'
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${host}`
  let manifest: Manifest | null = null
  try { manifest = await readManifest() } catch { manifest = null }
  return (
    <div className="space-y-6">
      <PageHeader title="Data hub" sub="Public, read-only research data and the chain ledger. Copies are permanent. Personal tables are not here." />
      <DataExplorer origin={origin} initial={manifest} />
    </div>
  )
}
