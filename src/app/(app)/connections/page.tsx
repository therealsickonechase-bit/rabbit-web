import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionRole } from '@/lib/auth/session'
import ConnectionsMap, { type GeneExample } from '@/components/ConnectionsMap'
import { PageHeader } from '@/components/ui'
import { GENE_COUNTS } from '@/lib/neuro-genes'
import { queueTask } from '@/lib/task-queue'

async function askAgents(formData: FormData) {
  'use server'
  const { user } = await getSessionRole()
  const gene = String(formData.get('gene') ?? '')
  if (!(gene in GENE_COUNTS)) redirect('/connections')
  // a research task on the gene, framed around the brain so the agents look for the EEG and chemistry papers
  redirect(`/tasks?msg=${await queueTask(user.id, 'research_topic', { topic: `${gene} gene`, biomarker: 'EEG brain' })}`)
}

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const { n } = await searchParams
    const admin = createAdminClient()

  const [variants, titles] = await Promise.all([
    admin.from('research_records').select('title, url, meta').eq('source', 'clinvar').not('meta->>system', 'is', null).limit(400),
    admin.from('research_records').select('title').in('source', ['pubmed', 'europepmc', 'brain_paper', 'brain_preprint', 'crispr_paper', 'trial']).limit(3000),
  ])
  const examples: Record<string, GeneExample[]> = {}
  for (const v of variants.data ?? []) {
    const gene = String((v.meta as Record<string, unknown>)?.gene ?? '')
    if (!(gene in GENE_COUNTS) || !v.url) continue
    const list = (examples[gene] ??= [])
    if (list.length < 2) list.push({ title: v.title.slice(0, 90), cls: ((v.meta as Record<string, unknown>).classification as string) ?? null, url: v.url })
  }
  const papers: Record<string, number> = {}
  for (const g of Object.keys(GENE_COUNTS)) {
    const re = new RegExp(`(^|[^A-Za-z0-9])${g}([^A-Za-z0-9]|$)`)
    papers[g] = (titles.data ?? []).filter((t) => re.test(t.title)).length
  }

  return (
    <>
      <PageHeader title="Chemistry and DNA connections" sub="How genes, brain chemicals, EEG patterns and brain damage connect, with the strength of evidence for every link" />
      <div className="space-y-4">
        <p role="note" className="text-sm rounded-md border border-warn/40 text-warn px-3 py-2">
          Education and research use only. Links are textbook-level knowledge, and an EEG alone cannot diagnose a condition. Gene numbers are real counts from ClinVar and describe DNA changes in general, not any person.
        </p>
        <ConnectionsMap examples={examples} papers={papers} initial={n ?? null} isOwner ask={askAgents} />
      </div>
    </>
  )
}
