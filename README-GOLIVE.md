# BLACK DRAGON AI — go-live checklist

Built 2026-10-24. Everything below runs on the SAME accounts as the Money Motion app.

## What exists
- The studio app (this folder): owner login, model picker (Wan cheap zone / Seedance 2.5 premium / music placeholder), prompt + length + quality + shape, jobs list with live polling, PWA install + auto-refresh.
- Backend code: `supabase/schema-black-dragon.sql`, `supabase/functions/bd-generate/`, `supabase/functions/bd-status/`.
- Generation runs through fal.ai (one account covers Wan + Seedance + 1,000 other models). The fal key lives ONLY in Supabase Edge Function secrets — never in the web app.

## Gates (need Keyz)
1. Create GitHub repo **black-dragon-ai** (public) under moneymotionstudios — GitHub Apps can't create repos on personal accounts.
2. fal.ai account: sign up at fal.ai with littmobstudios@gmail.com, add a payment method, load ~$25, create an API key.

## Deploy steps (assistant, once gates are done)
1. Push this folder to the repo (text-only push; images already embedded as data/SVG).
2. Enable Pages (main / root). Live URL: https://moneymotionstudios.github.io/black-dragon-ai/
3. Supabase (same project "money-motion-studios"): run `schema-black-dragon.sql` in the SQL editor.
4. Create Edge Functions `bd-generate` and `bd-status` (dashboard code editor or CLI) with the code in supabase/functions/.
5. Edge Function secrets: `FAL_KEY` = his fal.ai API key. (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-provided.)
6. Test: sign in as owner, run ONE Wan clip at 480p/5s (~$0.20), confirm it lands in Your clips and plays.
7. Pin the current Wan endpoint if fal has a newer one: set secret `FAL_MODEL_WAN` (default in code: fal-ai/wan/v2.7/text-to-video). Seedance default: bytedance/seedance-2.5/text-to-video (override: FAL_MODEL_SEEDANCE).

## Notes
- Owner-only by design: the functions reject any signed-in user who isn't littmobstudios@gmail.com, so the balance can't be burned by anyone else.
- fal result URLs are hosted by fal (fal.media) — v1 plays/downloads from there. Permanent storage (Supabase Storage copy) is a v1.1 step.
- Phase 2: ElevenLabs music zone, then GLOBAL VIZION client access (per-client logins + quotas).
