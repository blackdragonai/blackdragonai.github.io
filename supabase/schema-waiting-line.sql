-- BLACK DRAGON AI - waiting line support. Run ONCE in the Supabase SQL
-- editor, BEFORE deploying the bd-generate / bd-status versions that
-- ship the waiting line (v2.4 / v2.2, 2026-11-02). Safe to re-run.
-- bd_jobs gains the two inputs a parked ("waiting") job must carry so
-- the bd-status sweep can dispatch it later exactly as bd-generate
-- would have: the reference photo (photo-led + image-to-video jobs)
-- and the aspect ratio (image-to-video latent shape).
alter table public.bd_jobs add column if not exists image_url text;
alter table public.bd_jobs add column if not exists aspect_ratio text;
