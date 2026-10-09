-- Dashboard reads use the signed-in user's session, so every table needs RLS.
-- Writes happen only via the service-role key (ingestion), which bypasses RLS.
-- Also disable public sign-ups in Supabase Auth settings so only invited users exist.
do $$
declare t text;
begin
  foreach t in array array[
    'twin_identity','convergence_tokens','sdr_node_profiles',
    'mesh_node_readings','xrpl_memo_anchors'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "authenticated read" on public.%I', t);
    execute format(
      'create policy "authenticated read" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;
