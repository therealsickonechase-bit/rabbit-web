-- Live EEG band powers from a BrainFlow / OpenBCI bridge.
--
-- Neural data is among the most sensitive data there is: owner-only read, written only by the signed ingest
-- (service role). Only band powers per channel are stored, never raw waveforms.

create table if not exists public.eeg_band_samples (
  id         bigint generated always as identity primary key,
  agent_id   text not null references public.agents (node_id) on delete cascade,
  session    text not null check (char_length(session) between 1 and 64),
  ts         timestamptz not null,
  channel    text not null check (char_length(channel) between 1 and 16),
  band       text not null check (band in ('delta', 'theta', 'alpha', 'beta', 'gamma')),
  power      real not null check (power >= 0),          -- absolute band power (uV^2)
  rel_power  real check (rel_power between 0 and 1),    -- share of total 1-45 Hz power
  board      text not null default 'unknown',
  created_at timestamptz not null default now(),
  unique (agent_id, session, ts, channel, band)
);
create index if not exists eeg_band_samples_ts_idx on public.eeg_band_samples (ts desc);

alter table public.eeg_band_samples enable row level security;
drop policy if exists "owner read" on public.eeg_band_samples;
create policy "owner read" on public.eeg_band_samples for select to authenticated using ((select public.is_owner()));
revoke all on public.eeg_band_samples from anon;
revoke insert, update, delete, truncate on public.eeg_band_samples from authenticated;

-- Keep only 30 days of samples; run this occasionally (or schedule it) so the table stays small.
create or replace function public.purge_old_eeg_samples() returns integer
language sql security definer set search_path = '' as $$
  with gone as (delete from public.eeg_band_samples where ts < now() - interval '30 days' returning 1)
  select count(*)::integer from gone
$$;
revoke execute on function public.purge_old_eeg_samples() from anon, authenticated, public;
grant execute on function public.purge_old_eeg_samples() to service_role;
