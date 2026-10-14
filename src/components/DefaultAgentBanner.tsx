'use client'

import Link from 'next/link'
import { AGENT_LABEL } from '@/lib/coding-assistant'
import { useDefaultAgent } from './useDefaultAgent'

export default function DefaultAgentBanner() {
  const [agent] = useDefaultAgent()
  return <p className="rounded-lg border border-line bg-surface p-3 text-sm" role="note">
    Your default coding agent: <strong>{AGENT_LABEL[agent]}</strong> (saved in this browser only). Change it in the{' '}
    <Link className="underline" href="/cloudshell-public">public CloudShell</Link> or the owner <Link className="underline" href="/cloudshell">CloudShell</Link>.
  </p>
}
