-- BLACK DRAGON AI v2 - credits system migration.
-- Run ONCE in the Supabase SQL editor (project money-motion-studios),
-- AFTER schema-black-dragon.sql (bd_jobs must already exist).
-- Adds: user profiles with credit balances, credit-pack orders,
-- a single-row pricing table, and credit fields on bd_jobs.

-- ---------- profiles: one row per signed-up user, holds the balance ----------
create table if not exists public.bd_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  credits integer not null default 0 check (credits >= 0),
  created_at timestamptz not null default now()
);
alter table public.bd_profiles enable row level security;

-- users read their own row; the owner reads all. Writes happen only
-- through the Edge Functions (service role), never from the browser.
drop policy if exists "bd_profiles_select" on public.bd_profiles;
create policy "bd_profiles_select" on public.bd_profiles
  for select using (
    auth.uid() = user_id
    or (auth.jwt() ->> 'email') = 'littmobstudios@gmail.com'
  );

-- auto-create a profile (0 credits) whenever someone signs up
create or replace function public.bd_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bd_profiles (user_id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists bd_on_auth_user_created on auth.users;
create trigger bd_on_auth_user_created
  after insert on auth.users
  for each row execute function public.bd_handle_new_user();

-- backfill a profile for anyone who already has an account (the owner)
insert into public.bd_profiles (user_id, email)
select id, coalesce(email, '') from auth.users
on conflict (user_id) do nothing;

-- ---------- orders: a credit-pack purchase, credited by the owner ----------
create table if not exists public.bd_orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  pack_id text not null,
  amount_usd numeric(10,2) not null,
  credits integer not null,
  status text not null default 'pending', -- pending | credited | cancelled
  created_at timestamptz not null default now(),
  credited_at timestamptz
);
alter table public.bd_orders enable row level security;

-- buyers see their own orders; the owner sees all. Inserts/updates only
-- through the Edge Functions (service role).
drop policy if exists "bd_orders_select" on public.bd_orders;
create policy "bd_orders_select" on public.bd_orders
  for select using (
    auth.uid() = user_id
    or (auth.jwt() ->> 'email') = 'littmobstudios@gmail.com'
  );

-- ---------- pricing: single row (id = 1) the whole app reads ----------
create table if not exists public.bd_pricing (
  id integer primary key check (id = 1),
  wan_720_per_sec integer not null default 3,
  wan_1080_per_sec integer not null default 6,
  seedance_480_per_sec integer not null default 6,
  seedance_720_per_sec integer not null default 12,
  packs jsonb not null default '[
    {"id":"starter","name":"Starter","usd":10,"credits":100},
    {"id":"creator","name":"Creator","usd":25,"credits":275},
    {"id":"pro","name":"Pro","usd":50,"credits":600},
    {"id":"studio","name":"Studio","usd":100,"credits":1300}
  ]'::jsonb,
  handles jsonb not null default '{
    "cashapp":"$LYNXUNLIMITEDMUSIC",
    "chime":"$Johnnie-Gannaway",
    "venmo_url":"https://venmo.com/code?user_id=4643723270948240531&created=1792792682"
  }'::jsonb
);
alter table public.bd_pricing enable row level security;

-- prices are public (shown to visitors); changes only via Edge Functions.
drop policy if exists "bd_pricing_select" on public.bd_pricing;
create policy "bd_pricing_select" on public.bd_pricing
  for select using (true);

insert into public.bd_pricing (id) values (1) on conflict (id) do nothing;

-- ---------- bd_jobs: who ran it, what it cost, whether it was refunded ----------
alter table public.bd_jobs add column if not exists user_id uuid references auth.users (id);
alter table public.bd_jobs add column if not exists user_email text;
alter table public.bd_jobs add column if not exists credits_charged integer not null default 0;
alter table public.bd_jobs add column if not exists refunded boolean not null default false;

-- jobs: users see their own, the owner sees all (replaces the v1 policy)
drop policy if exists bd_owner_select on public.bd_jobs;
drop policy if exists "bd_jobs_select" on public.bd_jobs;
create policy "bd_jobs_select" on public.bd_jobs
  for select using (
    auth.uid() = user_id
    or (auth.jwt() ->> 'email') = 'littmobstudios@gmail.com'
  );
