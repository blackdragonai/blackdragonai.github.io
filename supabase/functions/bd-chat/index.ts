// BLACK DRAGON AI - bd-chat (v1: DeepSeek chat zone)
// Any signed-in user. A chat assistant (DeepSeek) that helps users write
// better video prompts for the app's video models (Cheap Zone / Wan and
// Premium Zone / Seedance 2.5) and answers questions about plans/credits.
// Chat is free for signed-in users for now - no credits are charged.
// Secrets needed: DEEPSEEK_API_KEY. Until the owner sets it, this returns
// a plain 503 "not live yet" error and the front end shows it in the panel.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const ALLOWED_MODELS = ["deepseek-chat", "deepseek-reasoner"];
const MAX_MESSAGES = 20;
const MAX_CHARS = 4000;

const SYSTEM_PROMPT = [
  "You are the Black Dragon AI assistant, inside the BLACK DRAGON AI video studio (a Black Dragon Films LLC product).",
  "Your main job: help users write better video prompts for this app's video models, and answer questions about the app's plans and credits.",
  "The app's video models: the Cheap Zone runs Wan (fast, low-cost clips, 5-15 seconds, 720p/1080p) and the Premium Zone runs Seedance 2.5 by ByteDance (cinematic clips up to 30 seconds, 480p/720p, native audio, can start from a reference image).",
  "Good video prompts name the subject, the action, the environment, the lighting, and the camera move. When a user gives you a rough idea, offer a tightened, ready-to-paste prompt they can drop straight into the generator.",
  "Plans and credits: every new account gets a 7-day free trial with 25 free generations in the Cheap Zone (Wan, 720p, up to 10 seconds each). After the trial, clips cost credits - Wan is priced per second at 720p/1080p, Seedance per second at 480p/720p, and the live rates are shown in the app.",
  "Monthly plans (credits re-grant every 30 days when the plan is paid): Creator $50/month for 750 credits, Pro $100/month for 1,700 credits, Studio $200/month for 3,600 credits. One-time credit packs: $10 for 100, $25 for 275, $50 for 600, $100 for 1,300 credits.",
  "How buying works: the user picks a plan or pack in the app, gets an order code (BD-XXXXXX), and pays the owner directly with Cash App, Venmo, or Chime with that code in the payment note. Credits land once the owner confirms the payment. Nothing auto-charges and no card is kept on file.",
  "Keep answers short, plain, and useful. You cannot generate videos yourself, check a user's balance, or change anyone's account - point users to the Generate button, the Plans & credits section, or the balance chip at the top of the app for those.",
].join("\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Sign in first." }, 401);

    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
    if (!DEEPSEEK_API_KEY) return json({ error: "Chat is not live yet — DeepSeek key not set" }, 503);

    const body = await req.json();
    const model = body.model === undefined || body.model === null || body.model === "" ? "deepseek-chat" : String(body.model);
    if (!ALLOWED_MODELS.includes(model)) return json({ error: "Unknown chat model." }, 400);

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return json({ error: "Send at least one message." }, 400);
    }
    if (body.messages.length > MAX_MESSAGES) {
      return json({ error: `Too many messages - keep it to the last ${MAX_MESSAGES}.` }, 400);
    }
    const messages: Array<{ role: string; content: string }> = [];
    for (const m of body.messages) {
      const role = String((m && m.role) || "");
      const content = String((m && m.content) || "");
      if (role !== "user" && role !== "assistant") return json({ error: "Bad message role." }, 400);
      if (!content.trim()) return json({ error: "Empty message." }, 400);
      if (content.length > MAX_CHARS) return json({ error: `Message too long - ${MAX_CHARS} characters max.` }, 400);
      messages.push({ role, content });
    }
    if (messages[messages.length - 1].role !== "user") {
      return json({ error: "The last message must be from the user." }, 400);
    }

    const dsRes = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        stream: false,
      }),
    });
    const dsJson = await dsRes.json().catch(() => ({}));
    if (!dsRes.ok) {
      const detail = dsJson?.error?.message || dsJson?.message || dsJson?.detail || ("HTTP " + dsRes.status);
      return json({ error: "DeepSeek error: " + String(detail).slice(0, 300) }, dsRes.status);
    }
    const reply = dsJson?.choices?.[0]?.message?.content;
    if (!reply) return json({ error: "DeepSeek came back empty - try again." }, 502);
    return json({ reply });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
