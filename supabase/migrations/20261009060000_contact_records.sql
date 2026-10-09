-- Encrypted contact records.
--
-- One row per account, written when someone signs up. The email address is encrypted to a PUBLIC key held
-- by the app; only the owner's offline private key can open it, so a compromised server or database cannot
-- read it. email_hash is a keyed fingerprint (HMAC) used to find the record for an address named in a valid
-- legal request without decrypting anything else. Every opening is written to contact_access_log.
--
-- Both tables have row-level security on and NO policies, and no privileges for anon or authenticated:
-- only the service role (the app's server code and the owner's lookup script) can touch them.

create table if not exists public.contact_records (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid unique references auth.users (id) on delete set null,
  email_hash       text not null,
  email_enc        text not null,
  key_version      integer not null default 1,
  consented_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  account_closed_at timestamptz,
  delete_after     timestamptz
);
create index if not exists contact_records_hash_idx on public.contact_records (email_hash);
create index if not exists contact_records_delete_idx on public.contact_records (delete_after) where delete_after is not null;
alter table public.contact_records enable row level security;
revoke all on public.contact_records from anon, authenticated;

-- Who opened which record, why, and under what legal reference. Append-only.
create table if not exists public.contact_access_log (
  id              bigint generated always as identity primary key,
  accessed_at     timestamptz not null default now(),
  record_id       uuid,
  reason          text not null check (length(reason) between 5 and 2000),
  legal_reference text not null check (length(legal_reference) between 3 and 500),
  accessed_by     text not null
);
alter table public.contact_access_log enable row level security;
revoke all on public.contact_access_log from anon, authenticated;

create or replace function public.contact_access_log_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'contact_access_log is append-only';
end $$;
drop trigger if exists contact_access_log_no_change on public.contact_access_log;
create trigger contact_access_log_no_change
  before update or delete on public.contact_access_log
  for each row execute function public.contact_access_log_immutable();

-- When an account is deleted, keep the contact record for a limited period, then it can be purged.
-- (12 months here; adjust to your retention policy and keep the privacy policy in step.)
create or replace function public.contact_records_on_account_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.contact_records
     set account_closed_at = now(), delete_after = now() + interval '12 months'
   where user_id = old.id;
  return old;
end $$;
revoke execute on function public.contact_records_on_account_delete() from anon, authenticated, public;

drop trigger if exists contact_records_account_delete on auth.users;
create trigger contact_records_account_delete
  before delete on auth.users
  for each row execute function public.contact_records_on_account_delete();
