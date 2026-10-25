-- BLACK DRAGON AI v2.1 - plans + weekly free generations.
-- Run ONCE in the Supabase SQL editor, AFTER schema-credits.sql.

-- ---------- profiles: plan + allowance tracking ----------
alter table public.bd_profiles add column if not exists plan text not null default 'free';
alter table public.bd_profiles add column if not exists plan_credits_monthly integer not null default 0;
alter table public.bd_profiles add column if not exists plan_started_at timestamptz;
alter table public.bd_profiles add column if not exists next_credit_reset timestamptz;
alter table public.bd_profiles add column if not exists free_gens_used integer not null default 0;
alter table public.bd_profiles add column if not exists free_gens_reset_at timestamptz;

-- ---------- pricing: plan catalogue + free-tier knobs ----------
alter table public.bd_pricing add column if not exists free_gens_per_week integer not null default 25;
alter table public.bd_pricing add column if not exists free_max_seconds integer not null default 10;
alter table public.bd_pricing add column if not exists plans jsonb not null default '[
  {"id":"creator","name":"Creator","usd":50,"credits":750},
  {"id":"pro","name":"Pro","usd":100,"credits":1700},
  {"id":"studio","name":"Studio","usd":200,"credits":3600}
]'::jsonb;

-- ---------- orders: packs vs monthly plans ----------
alter table public.bd_orders add column if not exists kind text not null default 'pack';
alter table public.bd_orders add column if not exists plan_id text;

-- ---------- jobs: was this a free weekly generation? ----------
alter table public.bd_jobs add column if not exists free_gen boolean not null default false;
