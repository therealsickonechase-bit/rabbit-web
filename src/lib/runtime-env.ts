// Runtime bindings that exist on Cloudflare Workers and have a Node equivalent elsewhere (for example Cloud Run).
// On Workers the bindings come from `cloudflare:workers`. On Node that module does not exist, so it is imported
// lazily and failure falls back to environment variables.

export interface WorkersAi { run(model: string, input: Record<string, unknown>): Promise<unknown> }

let cached: Record<string, unknown> | undefined

/** The Workers environment bindings, or an empty object when not running on Workers. */
export async function runtimeEnv(): Promise<Record<string, unknown>> {
  if (cached) return cached
  try {
    cached = (await import('cloudflare:workers')).env
  } catch {
    cached = {}
  }
  return cached
}

// Workers AI over its REST API, used off Workers when CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are set.
function restAi(accountId: string, token: string): WorkersAi {
  return {
    async run(model, input) {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        redirect: 'error',
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; result?: unknown } | null
      if (!res.ok || !json?.success) throw new Error(`Workers AI request failed (${res.status})`)
      return json.result
    },
  }
}

/** The Workers AI binding, the REST fallback, or undefined when neither is configured. */
export async function getAi(): Promise<WorkersAi | undefined> {
  const binding = (await runtimeEnv()).AI as WorkersAi | undefined
  if (binding) return binding
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  return accountId && token ? restAi(accountId, token) : undefined
}
