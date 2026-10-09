-- 1. Make score ingestion idempotent: one score per node per timestamp.
alter table public.node_scores
  add constraint node_scores_node_ts_key unique (node_id, ts);

-- 2. audit_entries is append-only, so ON DELETE SET NULL (an UPDATE) would be
--    rejected by the trigger. Block deleting an agent that has audit history instead.
alter table public.audit_entries
  drop constraint audit_entries_node_id_fkey,
  add constraint audit_entries_node_id_fkey
    foreign key (node_id) references public.agents (node_id) on delete restrict;
