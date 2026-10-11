export const WORKSPACE_SECTIONS = [
  'dashboard', 'research', 'ask', 'brain', 'twin', 'connections',
  'memory', 'collections', 'tasks', 'settings', 'chain', 'agents', 'crispr',
] as const

export type WorkspaceSection = typeof WORKSPACE_SECTIONS[number]

export function workspaceSection(value: string): WorkspaceSection | null {
  return WORKSPACE_SECTIONS.find((section) => section === value) ?? null
}

const PUBLIC_READS = [
  '/api/public/research-feed', '/api/public/proof', '/api/health',
  '/api/model/body', '/api/model/state', '/api/model/concepts', '/api/model/openapi.json',
]

export function publicApiAllowed(path: string, method: string) {
  if (path === '/api/avatar/ask') return method === 'POST'
  return PUBLIC_READS.includes(path) && (method === 'GET' || method === 'HEAD' || method === 'OPTIONS')
}

export function machineApi(path: string) {
  return path === '/api/ingest' || path.startsWith('/api/ingest/') ||
    path.startsWith('/api/agent/') || path === '/api/mcp'
}
