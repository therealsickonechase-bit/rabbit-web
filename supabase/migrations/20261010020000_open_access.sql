-- Open access: RabbitOS has no login and no owner / member / guest tiers.
--
-- NOT APPLIED automatically. Review, then apply by hand.
--
-- What this does
--   1. Creates ONE shared "visitor" row in auth.users. Every anonymous action in the app is attributed to it, so the
--      user_id / created_by foreign keys keep holding. It has no password and no email delivery; nobody can sign in as it.
--   2. Drops the owner-only and own-rows-only read policies and lets everyone (anon and authenticated) READ the opened tables.
--   3. Writes stay service-role only: no insert / update / delete / truncate is granted to anon or authenticated.
--      The app writes through the server (service role), which never reaches the browser.
--   4. twin_identity is readable only through a column grant that leaves out subject_name and subject_dob.
--
-- What stays closed (no policy, no grant for anon or authenticated)
--   contact_records, contact_access_log   other people's contact data
--   api_keys, api_key_calls               nobody can mint, list or revoke keys anonymously
--   user_settings                         per-person secrets
--   guest_passes, owners                  legacy role tables (kept for history, unreachable)
--   record_embeddings                     already closed; read through the server only
--   audit_entries is readable, but append-only (trigger) and writable only by the signed ingest (service role).

-- 1. The shared visitor identity (same id as PUBLIC_USER_ID in src/lib/open-access.ts).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'visitor@public.rabbitsoftware.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

-- 2. Public read on the opened tables. Writes are not granted to anyone but the service role.
do $$
declare t text;
begin
  foreach t in array array[
    'twin_identity', 'convergence_tokens', 'sdr_node_profiles', 'mesh_node_readings', 'xrpl_memo_anchors',
    'bci_ledger', 'rabbit_network_latencies', 'agents', 'chain_blocks', 'node_scores', 'audit_entries', 'assets',
    'research_topics', 'research_runs', 'research_records', 'research_summaries',
    'chat_threads', 'chat_messages', 'collections', 'collection_items', 'notes',
    'eeg_band_samples', 'agent_tasks', 'merkle_batches', 'kg_edges', 'self_daily',
    'chemo_baselines', 'crispr_guide_registry', 'dna_storage_records'
  ] loop
    continue when to_regclass(format('public.%I', t)) is null;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner read" on public.%I', t);
    execute format('drop policy if exists "authenticated read" on public.%I', t);
    execute format('drop policy if exists "own rows read" on public.%I', t);
    execute format('drop policy if exists "own tasks read" on public.%I', t);
    execute format('drop policy if exists "signed-in read" on public.%I', t);
    execute format('drop policy if exists "owner insert" on public.%I', t);
    execute format('drop policy if exists "owner update" on public.%I', t);
    execute format('drop policy if exists "owner delete" on public.%I', t);
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

-- 3. The twin's name and date of birth are never exposed, even to a direct API read: column-level grant only.
revoke select on public.twin_identity from anon, authenticated;
grant select (id, is_sealed, biological_hash, sealed_at) on public.twin_identity to anon, authenticated;

-- 4. Protected tables stay closed. Idempotent: these already have no policy for anon / authenticated.
do $$
declare t text;
begin
  foreach t in array array['contact_records', 'contact_access_log', 'api_keys', 'api_key_calls', 'user_settings', 'guest_passes', 'owners', 'record_embeddings'] loop
    continue when to_regclass(format('public.%I', t)) is null;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- 5. Anonymous task proposals are stored as 'proposed' by the app; claim_agent_task only ever claims 'queued',
--    so they never run. Nothing to change here; the function stays service-role only.
