// Mirrors supabase/migrations/20261009010000_research_agents.sql.
// The ingest Worker validates agent payloads against these shapes.

export type AgentKind = 'research' | 'ai_participant' | 'network_node'
export type TopicStatus = 'queued' | 'explored' | 'dropped'
export type AssetKind = 'chart' | 'video' | 'corpus' | 'other'

export interface Agent {
  node_id: string
  kind: AgentKind
  twin_id: string | null
  created_at: string
  last_seen_at: string | null
}

export interface ResearchTopic {
  id: number
  topic: string
  biomarker: string | null
  parent_topic_id: number | null
  status: TopicStatus
  discovered_by: string | null
  created_at: string
  explored_at: string | null
}

export interface ResearchRun {
  id: number
  agent_id: string
  twin_id: string | null
  topic_id: number | null
  cycle: number
  new_ids_found: number
  summary: string | null
  started_at: string
}

/** id is the agents' dedupe key, e.g. 'article:42566532' or 'trial:NCT06760507'. */
export interface ResearchRecord {
  id: string
  source: string
  title: string
  url: string | null
  topic_id: number | null
  run_id: number | null
  meta: Record<string, unknown>
  first_seen_at: string
}

export interface ChainBlock {
  block_id: string
  chain: string // 'network' | 'maxwell' | ...
  height: number | null
  payload: unknown
  node_id: string
  source: string
  das_score: number | null
  hash: string
  prev_hash: string | null
  mined_at: string
}

export interface NodeScore {
  id: number
  node_id: string
  mos: number | null
  balance: number | null
  ts: string
}

export interface AuditEntry {
  seq: number
  module: string
  action: string
  details: Record<string, unknown>
  node_id: string | null
  prev_hash: string | null
  hash: string
  ts: string
}

export interface Asset {
  id: number
  kind: AssetKind
  r2_key: string
  sha256: string
  run_id: number | null
  created_at: string
}

export interface ResearchSummary {
  id: number
  agent_id: string
  topic_id: number | null
  model: string
  ai_interpretation: string
  disclaimer: string
  source_counts: Record<string, unknown>
  input_hash: string
  created_at: string
}
