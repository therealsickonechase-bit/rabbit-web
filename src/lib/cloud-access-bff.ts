import { requireCloudIdentity } from '@/lib/auth/cloud-identity'
import { brokerConfig, CLOUD_SCOPES, requestedScopes } from './cloud-access'
import { CloudJobError, forwardCloud, readJson, requireWriteOrigin } from './cloud-jobs'
import { privateJson } from './cloud-job-bff'

export async function cloudAccessBff(request: Request, machine = false) {
  try {
    const identity = await requireCloudIdentity(request, machine)
    if (request.method === 'POST' && !machine) requireWriteOrigin(request)
    const config = brokerConfig(process.env)
    if (request.method === 'POST') {
      const input = await readJson(request, 2048) as { scopes?: unknown } | null
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'scopes')) {
        throw new CloudJobError(400, 'Only scopes may be requested. Identity and approval are derived server-side.')
      }
      const scopes = requestedScopes(input.scopes, identity.scopes)
      const output = await forwardCloud(config, '/access/request', { subject: identity.subject, scopes }) as {
        id?: unknown; subject?: unknown; state?: unknown; scopes?: unknown; expiresAt?: unknown
      } | null
      if (!output || typeof output.id !== 'string' || !output.id || output.id.length > 128 || output.subject !== identity.subject ||
          !['pending', 'approved'].includes(String(output.state)) ||
          !Array.isArray(output.scopes) || !output.scopes.length || output.scopes.some(scope => !scopes.includes(scope)) ||
          (output.state === 'approved' && (typeof output.expiresAt !== 'number' ||
            output.expiresAt <= Date.now() || output.expiresAt > Date.now() + 3600_000))) {
        throw new CloudJobError(502, 'Approval broker returned an invalid request response.')
      }
      return privateJson({ id: output.id, state: output.state, scopes: output.scopes, expiresAt: output.expiresAt ?? null }, 202)
    }
    const output = await forwardCloud(config, '/access/check', { subject: identity.subject }) as {
      approved?: unknown; scopes?: unknown; expiresAt?: unknown; requestId?: unknown
    } | null
    if (!output || typeof output.approved !== 'boolean' || !Array.isArray(output.scopes) ||
        output.scopes.some(scope => !CLOUD_SCOPES.includes(scope))) {
      throw new CloudJobError(502, 'Approval broker returned an invalid status.')
    }
    const expiresAt = typeof output.expiresAt === 'number' ? output.expiresAt : null
    const approved = output.approved && expiresAt !== null && expiresAt > Date.now() && expiresAt <= Date.now() + 3600_000
    return privateJson({
      approved, scopes: approved ? output.scopes.filter(scope => identity.scopes.includes(scope)) : [],
      expiresAt: approved ? expiresAt : null,
      requestId: typeof output.requestId === 'string' ? output.requestId : null,
    })
  } catch (error) {
    return privateJson({ error: error instanceof CloudJobError ? error.message : 'Access broker request failed.' },
      error instanceof CloudJobError ? error.status : 500)
  }
}
