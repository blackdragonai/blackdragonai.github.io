// BLACK DRAGON AI - bd-generate
// Verifies the caller is the owner, submits the job to fal.ai's queue
// (key stays server-side), records the job, returns it.
// Secrets needed: FAL_KEY. Optional: FAL_MODEL_WAN, FAL_MODEL_SEEDANCE.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OWNER_EMAIL = "littmobstudios@gmail.com";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const FAL_KEY = Deno.env.get("FAL_KEY");
    if (!FAL_KEY) return json({ error: "Generation is not switched on yet (no fal.ai key set)." }, 503);

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user || userData.user.email !== OWNER_EMAIL) {
      return json({ error: "Owner only." }, 403);
    }

    const body = await req.json();
    const model = String(body.model || "");
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return json({ error: "Prompt required." }, 400);
    const duration = Math.max(4, Math.min(30, parseInt(body.duration || "10", 10)));
    const resolution = ["480p", "720p", "1080p"].includes(body.resolution) ? body.resolution : "720p";
    const aspect = ["16:9", "9:16", "1:1", "4:3", "3:4"].includes(body.aspect_ratio) ? body.aspect_ratio : "16:9";
    const imageUrl = body.image_url ? String(body.image_url) : null;

    // fal endpoint ids - verified against fal's published docs 2026-10-24;
    // override via secrets if fal renames them.
    let falId: string;
    const input: Record<string, unknown> = {
      prompt, duration, resolution, aspect_ratio: aspect, generate_audio: true,
    };
    if (model === "seedance") {
      const base = Deno.env.get("FAL_MODEL_SEEDANCE") || "bytedance/seedance-2.5/text-to-video";
      falId = imageUrl ? base.replace("text-to-video", "image-to-video") : base;
      if (imageUrl) input.image_url = imageUrl;
    } else if (model === "wan") {
      falId = Deno.env.get("FAL_MODEL_WAN") || "fal-ai/wan/v2.7/text-to-video";
      // v1: the Wan text-to-video endpoint takes no image; image-led clips go to Seedance.
    } else {
      return json({ error: "Unknown model." }, 400);
    }

    const falRes = await fetch(`https://queue.fal.run/${falId}`, {
      method: "POST",
      headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const falJson = await falRes.json().catch(() => ({}));
    if (!falRes.ok) {
      return json({ error: "fal.ai rejected the job: " + (falJson.detail || falJson.error || falRes.status) }, 502);
    }

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: job, error: insErr } = await admin.from("bd_jobs").insert({
      owner_email: OWNER_EMAIL,
      model, prompt, duration, resolution,
      status: "queued",
      fal_request_id: falJson.request_id || null,
      fal_status_url: falJson.status_url || null,
      fal_response_url: falJson.response_url || null,
    }).select().single();
    if (insErr) return json({ error: "Could not record the job: " + insErr.message }, 500);
    return json({ job });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
