import { requireCloudIdentity } from '@/lib/auth/cloud-identity'
import { checkCloudGrant, checkCloudJob, linkCloudJob } from './cloud-access'
import { CloudJobError, configuredVaultRoots, forwardCloud, readJson, requireWriteOrigin, shellCommand, upstreamConfig, validateVaultResponse, validateVaultResult, vaultJobPath, vaultSnapshot } from './cloud-jobs'

export const privateJson = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
})

export async function cloudJobBff(request: Request, service: 'shell' | 'vault', id?: string, result = false, machine = false) {
  try {
    const identity = await requireCloudIdentity(request, machine)
    if (request.method === 'POST' && !machine) requireWriteOrigin(request)
    await checkCloudGrant(identity, service === 'shell' ? 'shell.execute' : request.method === 'POST' ? 'vault.submit' : 'vault.read', process.env)
    if (service === 'shell' && (process.env.RABBIT_CLOUDSHELL_TOKEN?.length ?? 0) < 32) {
      throw new CloudJobError(503, 'Cloud shell is not configured: a server token of at least 32 characters is required.')
    }
    const config = service === 'shell'
      ? upstreamConfig(process.env.RABBIT_CLOUDSHELL_URL, process.env.RABBIT_CLOUDSHELL_TOKEN)
      : upstreamConfig(process.env.VAULT_AGENT_URL, process.env.VAULT_AGENT_TOKEN)
    if (request.method === 'POST') {
      const input = await readJson(request, service === 'shell' ? 32_000 : 70_000)
      const payload = service === 'shell' ? shellCommand(input) : vaultSnapshot(input, approvedVaultRoots())
      const output = await forwardCloud(config, service === 'shell' ? '/execute' : vaultJobPath(), payload)
      if (service === 'shell') {
        const value = output as { stdout?: unknown; stderr?: unknown; exitCode?: unknown; timedOut?: unknown; truncated?: unknown } | null
        if (!value || typeof value.stdout !== 'string' || typeof value.stderr !== 'string' ||
            !Number.isInteger(value.exitCode)) throw new CloudJobError(502, 'Invalid command result.')
        return privateJson({ stdout: value.stdout, stderr: value.stderr, exitCode: value.exitCode,
          timedOut: value.timedOut === true, truncated: value.truncated === true })
      }
      const job = validateVaultResponse(output)
      await linkCloudJob(identity, job.id as string, process.env)
      return privateJson(job)
    }
    if (!id || !/^[a-f0-9]{64}$/.test(id)) throw new CloudJobError(400, 'Invalid job identifier.')
    await checkCloudJob(identity, id, process.env)
    const output = await forwardCloud(config, vaultJobPath(id, result))
    return privateJson(result ? validateVaultResult(output, id) : validateVaultResponse(output, id))
  } catch (error) {
    return privateJson({ error: error instanceof CloudJobError ? error.message : 'Cloud request failed.' },
      error instanceof CloudJobError ? error.status : 500)
  }
}

export function approvedVaultRoots() {
  return configuredVaultRoots(process.env.VAULT_AGENT_ROOTS)
}
