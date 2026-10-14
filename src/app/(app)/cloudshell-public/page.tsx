import PublicShell from '@/components/PublicShell'
import { PageHeader } from '@/components/ui'

// Public CloudShell for everyone. Separate from the owner /cloudshell page and /api/cloud-agent/*, which are untouched.
export default function PublicCloudShellPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="CloudShell" sub="A real terminal in a public, throwaway sandbox. Not the owner shell." />
      <PublicShell />
    </div>
  )
}
