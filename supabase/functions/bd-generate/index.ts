// BLACK DRAGON AI - bd-generate (v2.1, credits + plans)
// Any signed-in user. Prices come from the bd_pricing table (server-side).
// Every account also gets a weekly free-generation allowance (Wan only,
// length-capped, from bd_pricing.free_gens_per_week / free_max_seconds);
// a qualifying generation with free ones left costs 0 credits.
// Paid plans re-grant their monthly credits lazily when the reset date
// passes. Credit flow otherwise: check balance -> deduct -> submit to
// fal.ai's queue -> record job. fal rejection refunds instantly.
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

// Apply the weekly free reset and any due monthly plan grants.
// Returns the fresh profile row.
async function refreshAllowances(admin: ReturnType<typeof createClient>, userId: string) {
  const { data: p } = await admin.from("bd_profiles").select("*").eq("user_id", userId).single();
  if (!p) return null;
  const now = new Date();
  const patch: Record<string, unknown> = {};
  if (!p.free_gens_reset_at || new Date(p.free_gens_reset_at) <= now) {
    patch.free_gens_used = 0;
    patch.free_gens_reset_at = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();
  }
  if (p.plan !== "free" && p.plan_credits_monthly > 0 && p.next_credit_reset && new Date(p.next_credit_reset) <= now) {
    let credits = p.credits;
    let next = new Date(p.next_credit_reset);
    while (next <= now) {
      credits += p.plan_credits_monthly;
      next = new Date(next.getTime() + 30 * 24 * 3600 * 1000);
    }
    patch.credits = credits;
    patch.next_credit_reset = next.toISOString();
  }
  if (Object.keys(patch).length) {
    await admin.from("bd_profiles").update(patch).eq("user_id", userId);
    Object.assign(p, patch);
  }
  return p;
}

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
    if (userErr || !userData.user) return json({ error: "Sign in first." }, 401);
    const user = userData.user;

    const body = await req.json();
    const model = String(body.model || "");
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return json({ error: "Prompt required." }, 400);
    const duration = Math.max(4, Math.min(30, parseInt(body.duration || "10", 10)));
    const resolution = ["480p", "720p", "1080p"].includes(body.resolution) ? body.resolution : "720p";
    const aspect = ["16:9", "9:16", "1:1", "4:3", "3:4"].includes(body.aspect_ratio) ? body.aspect_ratio : "16:9";
    const imageUrl = body.image_url ? String(body.image_url) : null;

    const admin = createClient(SUPABASE_URL, SERVICE);

    // --- pricing + allowances ---
    const { data: pricing, error: priceErr } = await admin.from("bd_pricing").select("*").eq("id", 1).single();
    if (priceErr || !pricing) return json({ error: "Pricing is not set up yet." }, 503);
    let perSec: number;
    if (model === "wan") perSec = resolution === "1080p" ? pricing.wan_1080_per_sec : pricing.wan_720_per_sec;
    else if (model === "seedance") perSec = resolution === "480p" ? pricing.seedance_480_per_sec : pricing.seedance_720_per_sec;
    else return json({ error: "Unknown model." }, 400);
    // Wan's endpoint caps at 15s; price the seconds that will actually render.
    const billableSeconds = model === "wan" ? Math.max(2, Math.min(15, duration)) : duration;

    const profile = await refreshAllowances(admin, user.id);
    if (!profile) return json({ error: "Account profile missing - sign out and back in." }, 400);

    const freePerWeek = pricing.free_gens_per_week ?? 25;
    const freeMaxSecs = pricing.free_max_seconds ?? 10;
    const freeLeft = Math.max(0, freePerWeek - (profile.free_gens_used || 0));
    const qualifiesFree = model === "wan" && resolution === "720p" && billableSeconds <= freeMaxSecs && !imageUrl;
    const useFree = qualifiesFree && freeLeft > 0;
    const cost = useFree ? 0 : perSec * billableSeconds;

    // --- charge: free counter or credits ---
    let balanceAfter = profile.credits;
    let freeLeftAfter = freeLeft;
    if (useFree) {
      const { data: bumped, error: bErr } = await admin.from("bd_profiles")
        .update({ free_gens_used: (profile.free_gens_used || 0) + 1 })
        .eq("user_id", user.id).eq("free_gens_used", profile.free_gens_used || 0)
        .select("free_gens_used").single();
      if (bErr || !bumped) return json({ error: "Free counter changed while ordering - try again." }, 409);
      freeLeftAfter = freePerWeek - bumped.free_gens_used;
    } else {
      if (profile.credits < cost) {
        return json({ error: `Not enough credits: this clip costs ${cost}, you have ${profile.credits}.`, need_credits: cost, have_credits: profile.credits, free_left: freeLeft }, 402);
      }
      const { data: deducted, error: dedErr } = await admin.from("bd_profiles")
        .update({ credits: profile.credits - cost })
        .eq("user_id", user.id).eq("credits", profile.credits)
        .select("credits").single();
      if (dedErr || !deducted) return json({ error: "Balance changed while ordering - try again." }, 409);
      balanceAfter = deducted.credits;
    }
    const undoCharge = async () => {
      const { data: now } = await admin.from("bd_profiles").select("credits, free_gens_used").eq("user_id", user.id).single();
      if (!now) return;
      if (useFree) await admin.from("bd_profiles").update({ free_gens_used: Math.max(0, now.free_gens_used - 1) }).eq("user_id", user.id);
      else await admin.from("bd_profiles").update({ credits: now.credits + cost }).eq("user_id", user.id);
    };

    // --- build the fal call ---
    // Inputs are built per model: sending fields a model does not accept
    // (e.g. generate_audio or a 480p resolution to Wan 2.7, whose resolution
    // enum is only 720p/1080p and duration 2-15s) makes the queued job fail
    // at runtime with no video - learned from the first live test.
    let falId: string;
    const input: Record<string, unknown> = { prompt, aspect_ratio: aspect };
    if (model === "seedance") {
      const base = Deno.env.get("FAL_MODEL_SEEDANCE") || "bytedance/seedance-2.5/text-to-video";
      falId = imageUrl ? base.replace("text-to-video", "image-to-video") : base;
      input.duration = duration;
      input.resolution = resolution === "1080p" ? "720p" : resolution;
      input.generate_audio = true;
      if (imageUrl) input.image_url = imageUrl;
    } else {
      falId = Deno.env.get("FAL_MODEL_WAN") || "fal-ai/wan/v2.7/text-to-video";
      input.duration = billableSeconds;
      input.resolution = resolution === "1080p" ? "1080p" : "720p";
      // the Wan text-to-video endpoint takes no image and no generate_audio;
      // image-led clips go to Seedance.
    }

    const falRes = await fetch(`https://queue.fal.run/${falId}`, {
      method: "POST",
      headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const falJson = await falRes.json().catch(() => ({}));
    if (!falRes.ok) {
      await undoCharge();
      return json({ error: "fal.ai rejected the job: " + (falJson.detail || falJson.error || falRes.status) + (useFree ? " - free generation restored." : " - credits refunded.") }, 502);
    }

    const { data: job, error: insErr } = await admin.from("bd_jobs").insert({
      owner_email: OWNER_EMAIL,
      user_id: user.id,
      user_email: user.email,
      credits_charged: cost,
      free_gen: useFree,
      model, prompt, duration: billableSeconds, resolution,
      status: "queued",
      fal_request_id: falJson.request_id || null,
      fal_status_url: falJson.status_url || null,
      fal_response_url: falJson.response_url || null,
    }).select().single();
    if (insErr) {
      await undoCharge();
      return json({ error: "Could not record the job: " + insErr.message + (useFree ? " - free generation restored." : " - credits refunded.") }, 500);
    }
    return json({ job, credits_charged: cost, balance: balanceAfter, free_left: freeLeftAfter });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
