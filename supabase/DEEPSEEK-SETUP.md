# DeepSeek chat — go-live steps

The AI Chat zone (DeepSeek) is built but **not live yet**. The front end and
the `bd-chat` Edge Function are done. Until the steps below are finished,
signed-in users who send a chat message get a plain message in the chat
panel: "Chat is not live yet — DeepSeek key not set". Video generation
(Cheap Zone / Premium Zone) is not affected.

Do these steps in the owner's name, when ready:

1. **Create the DeepSeek account** — go to https://platform.deepseek.com
   and sign up with the owner's email. This is a separate account from
   fal.ai and from Supabase; DeepSeek bills on its own.
2. **Add a small balance** — in the DeepSeek platform, top up a small
   amount (a few dollars is plenty to start; chat is billed per token and
   is cheap). No balance = the API rejects calls even with a valid key.
3. **Create an API key** — in the DeepSeek platform, open the API keys
   page and create a new key. Copy it once, right then — it is shown in
   full only at creation time. **Never paste the key into chat, code, or
   this file.**
4. **Set the key as a Supabase secret** — in the Supabase dashboard for
   this project (Edge Functions / Secrets, or via the CLI with
   `supabase secrets set DEEPSEEK_API_KEY=<the key>`), add a secret named
   exactly `DEEPSEEK_API_KEY` holding that key. The `bd-chat` function
   reads it with `Deno.env.get("DEEPSEEK_API_KEY")` — the key never goes
   in the website code or in `js/config.js`.
5. **Deploy the function** — deploy `supabase/functions/bd-chat` to the
   project (Supabase dashboard: Edge Functions → Deploy; or CLI:
   `supabase functions deploy bd-chat`). No SQL/schema changes are needed,
   and no other function changes.
6. **Test it** — sign in to the app, open the AI Chat — DeepSeek section,
   send a message (try DeepSeek Chat first, then DeepSeek Reasoner). A
   reply in the panel = live. If the panel shows an error with an HTTP
   status instead, that comes from DeepSeek: 401 = key wrong/not set,
   402 = balance empty, 429 = rate limit.

Costs to expect: DeepSeek chat pricing is per million tokens and is a
fraction of the video costs — normal prompt-help conversations cost well
under a cent each. The function caps each request (max 20 messages,
~4000 characters each) to keep any single call small.

To switch chat off later: delete the `DEEPSEEK_API_KEY` secret (the zone
goes back to the "not live yet" message) — no code change needed.
