-- Public downloads: files the owner uploads from their computer that anyone on the internet may download.
--
-- Storage bucket "packages" is PUBLIC for reading (anyone can download a file if they have its link) and writable ONLY by the owner (is_owner()).
-- The list of packages is the table public.public_packages: readable by everyone (including signed-out visitors), writable only by the owner.
-- Nothing private belongs here: the app checks names, types, size and scans text files in the owner's browser before upload, but the owner decides what to publish.

insert into storage.buckets (id, name, public, file_size_limit)
values ('packages', 'packages', true, 52428800)       -- 50 MB per file
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists "owner uploads packages" on storage.objects;
drop policy if exists "owner updates packages" on storage.objects;
drop policy if exists "owner deletes packages" on storage.objects;
create policy "owner uploads packages" on storage.objects for insert to authenticated with check (bucket_id = 'packages' and (select public.is_owner()));
create policy "owner updates packages" on storage.objects for update to authenticated using (bucket_id = 'packages' and (select public.is_owner())) with check (bucket_id = 'packages' and (select public.is_owner()));
create policy "owner deletes packages" on storage.objects for delete to authenticated using (bucket_id = 'packages' and (select public.is_owner()));
-- No select policy is needed for downloads: a public bucket serves files by link without one, and nobody can list the bucket through the API.

create table if not exists public.public_packages (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) between 10 and 2000),
  licence     text not null check (char_length(licence) between 2 and 80),
  file_name   text not null check (char_length(file_name) between 1 and 120),
  path        text not null unique check (char_length(path) between 3 and 200),
  size_bytes  bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid not null references auth.users (id) default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.public_packages enable row level security;
drop policy if exists "anyone reads packages" on public.public_packages;
drop policy if exists "owner adds packages" on public.public_packages;
drop policy if exists "owner removes packages" on public.public_packages;
create policy "anyone reads packages" on public.public_packages for select to anon, authenticated using (true);
create policy "owner adds packages" on public.public_packages for insert to authenticated with check (uploaded_by = (select auth.uid()) and (select public.is_owner()));
create policy "owner removes packages" on public.public_packages for delete to authenticated using ((select public.is_owner()));
revoke insert, update, delete, truncate on public.public_packages from anon;
revoke update, truncate on public.public_packages from authenticated;
