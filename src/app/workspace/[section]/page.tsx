import { notFound } from 'next/navigation'
import { workspaceSection } from '@/lib/account-free'
import PublicWorkspace from '@/components/PublicWorkspace'

export default async function WorkspacePage({ params }: { params: Promise<{ section: string }> }) {
  const section = workspaceSection((await params).section)
  if (!section) notFound()
  return <PublicWorkspace section={section} />
}
