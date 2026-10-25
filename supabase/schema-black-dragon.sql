-- BLACK DRAGON AI - jobs table. Run ONCE in the Supabase SQL editor
-- (same project as the Money Motion app). Safe to re-run.
create table if not exists public.bd_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  owner_email text not null,
  model text not null,
  prompt text not null,
  duration int,
  resolution text,
  status text not null default 'queued',
  fal_request_id text,
  fal_status_url text,
  fal_response_url text,
  video_url text,
  error text
);
alter table public.bd_jobs enable row level security;
drop policy if exists bd_owner_select on public.bd_jobs;
create policy bd_owner_select on public.bd_jobs
  for select to authenticated
  using ((auth.jwt() ->> 'email') = 'littmobstudios@gmail.com');
-- Writes are done only by the Edge Functions (service role), never from the browser.
