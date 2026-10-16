import { appPage, legacyRedirect } from './open-access.ts'

export { legacyRedirect }

/** Page requests: reads everywhere; POST (server actions) only on the app pages, never on login, keys, members or other paths. */
export function pageMethodAllowed(path: string, method: string) {
  if (method === 'GET' || method === 'HEAD') return true
  return method === 'POST' && !legacyRedirect(path) && appPage(path) !== null
}

export const WORKSPACE_SECTIONS = [
  'dashboard', 'research', 'ask', 'brain', 'twin', 'connections',
  'memory', 'collections', 'tasks', 'settings', 'chain', 'agents', 'crispr',
] as const

export type WorkspaceSection = typeof WORKSPACE_SECTIONS[number]

export function workspaceSection(value: string): WorkspaceSection | null {
  return WORKSPACE_SECTIONS.find((section) => section === value) ?? null
}

// Open access: these were owner-only and are now open to everyone. Input checks, size limits and rate limits stay in the routes.
const OPEN_ROUTES: Record<string, string[]> = {
  '/api/brain/live': ['GET'],
  '/api/brain/illustrate': ['POST'],
  '/api/self/daily': ['GET', 'POST', 'DELETE'],
  '/api/chain/restore': ['POST'],
}

const PUBLIC_READS = [
  '/api/public/research-feed', '/api/public/proof', '/api/health',
  '/api/model/body', '/api/model/state', '/api/model/concepts', '/api/model/openapi.json',
  '/api/chain/head', '/api/chain/ledger', '/api/chain/dna',
]

/** The read-only data hub: /api/data and /api/data/<dataset>. The route itself 404s unknown datasets. */
const DATA_HUB_PATH = /^\/api\/data\/[a-z_]{1,40}$/

export function publicApiAllowed(path: string, method: string) {
  if (path === '/api/avatar/ask') return method === 'POST'
  if (Object.hasOwn(OPEN_ROUTES, path)) return OPEN_ROUTES[path].includes(method)
  if (path === '/api/data' || DATA_HUB_PATH.test(path)) return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
  return PUBLIC_READS.includes(path) && (method === 'GET' || method === 'HEAD' || method === 'OPTIONS')
}

export function machineApi(path: string) {
  return path === '/api/ingest' || path.startsWith('/api/ingest/') ||
    path.startsWith('/api/agent/') || path === '/api/mcp'
}
