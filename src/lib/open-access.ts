// Open access: RabbitOS has no login and no owner, member or guest tiers. Everyone who opens the site is the same anonymous visitor.
// Pure rules live here (no imports) so tests can load them; the Supabase wiring is in auth/session.ts.

/** One shared identity for every visitor. A real row in auth.users is created for it by the open_access migration, so user_id foreign keys hold. */
export const PUBLIC_USER_ID = '00000000-0000-4000-8000-0000000000a1'
export const PUBLIC_USER_EMAIL = 'visitor@public.rabbitsoftware.invalid'

export type Visitor = { id: string; email: string; is_anonymous: true }

export const visitor = (): Visitor => ({ id: PUBLIC_USER_ID, email: PUBLIC_USER_EMAIL, is_anonymous: true })

/** Pages the app serves. Anything else is not rewritten. */
export const APP_PAGES = [
  'dashboard', 'twin', 'brain', 'connections', 'research', 'ask', 'memory', 'crispr',
  'collections', 'tasks', 'agents', 'chain', 'ledger',
] as const

export const appPage = (path: string) => APP_PAGES.find((p) => path === `/${p}` || path.startsWith(`/${p}/`)) ?? null

/** Old account paths: always sent to the dashboard. */
export const LEGACY_REDIRECTS = ['/login', '/signup', '/guest', '/members', '/guests', '/keys', '/settings']

export const legacyRedirect = (path: string) => LEGACY_REDIRECTS.includes(path) || path.startsWith('/auth/')

/** Tables nobody can read or change anonymously. Sensitive or secret, or they let one person act on another's behalf. */
export const PROTECTED_TABLES = [
  'contact_records', 'contact_access_log', 'api_keys', 'api_key_calls', 'user_settings', 'guest_passes', 'owners',
] as const

/** Tables with an anonymous public read policy (writes stay service-role only). Must not overlap PROTECTED_TABLES. */
export const OPEN_READ_TABLES = [
  'twin_identity', 'convergence_tokens', 'sdr_node_profiles', 'mesh_node_readings', 'xrpl_memo_anchors',
  'bci_ledger', 'rabbit_network_latencies', 'agents', 'chain_blocks', 'node_scores', 'audit_entries', 'assets',
  'research_topics', 'research_runs', 'research_records', 'research_summaries',
  'chat_threads', 'chat_messages', 'collections', 'collection_items', 'notes',
  'eeg_band_samples', 'agent_tasks', 'merkle_batches', 'kg_edges', 'self_daily',
  'chemo_baselines', 'crispr_guide_registry', 'dna_storage_records',
] as const

/** Columns of twin_identity an anonymous direct read may see. Name and date of birth are left out. */
export const TWIN_PUBLIC_COLUMNS = ['id', 'is_sealed', 'biological_hash', 'sealed_at'] as const

/** Explicit column lists for server reads (service role bypasses RLS, so each read names what it needs). */
export const COLS = {
  twin: 'id, is_sealed, biological_hash, sealed_at',
  tokens: 'id, minted_at, valence, arousal, gsr_delta_phi, cortisol_ng_ml, access_tier, state_hash',
  nodes: 'id, node_id, carrier_freq_ghz, prf_hz, reflection_sources, is_active',
  readings: 'id, timestamp, node_id, band, amplitude_uv, vasc_state',
  anchors: 'id, anchored_at, payload_type, xrpl_txn_hash, xrpl_ledger_index, access_tier',
  agents: 'node_id, kind, twin_id, created_at, last_seen_at',
  audit: 'seq, module, action, details, node_id, prev_hash, hash, ts',
} as const

/** Anonymous task proposals are parked here: agents only claim `queued` tasks, so these never run. */
export const ANON_TASK_STATUS = 'proposed' as const
