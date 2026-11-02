// BLACK DRAGON AI - bd-generate (v2.4, credits + plans + 7-day trial + ComfyUI + waiting line)
// Any signed-in user. Prices come from the bd_pricing table (server-side).
// Every NEW account gets a 7-day free trial: a free-generation allowance
// (Wan only, length-capped, from bd_pricing.free_gens_per_week /
// free_max_seconds) usable only until bd_profiles.trial_ends_at. There is
// NO weekly reset - when the trial ends, free generations stop.
// A qualifying generation inside the trial with free ones left costs 0.
// Two-AI rule (owner's): FREE generations run on ComfyUI - the owner's
// host (COMFY_API_URL secret) - whenever it is connected; until then
// they keep the fal Wan stand-in below. PAID generations (credits)
// always run on the fal models. Comfy generations never touch credits,
// and a failed Comfy submission restores the free generation, same as
// a fal rejection. An explicit model:"comfy" request is free-path only.
// Paid plans re-grant their monthly credits lazily when the reset date
// passes. Credit flow otherwise: check balance -> deduct -> submit to
// fal.ai's queue -> record job. fal rejection refunds instantly.
// Secrets needed: FAL_KEY (paid models). Optional: COMFY_API_URL +
// COMFY_WORKFLOW_JSON (free engine), COMFY_WORKFLOW_I2V_JSON (free
// image-to-video, model "comfy-i2v"), COMFY_WORKFLOW_LTX_JSON (free
// LTX-2.5 text-to-video, model "comfy-ltx" - ComfyUI only, NEVER fal),
// FAL_MODEL_WAN, FAL_MODEL_SEEDANCE.
// WAITING LINE (v2.4, 2026-11-02): a comfy-family job submitted while
// the free engine is not answering is parked as status "waiting"
// (HTTP 202, nothing charged, never dispatched into the void) and the
// bd-status sweep dispatches it when the engine is back. Parked rows
// carry image_url + aspect_ratio (schema-waiting-line.sql) so the
// sweep can run the identical dispatch, photo-led jobs included.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OWNER_EMAIL = "littmobstudios@gmail.com";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// VPN / datacenter check for FREE generations (Keyz, 2026-10-30: "even
// with VPN block it"). VPN exits live in datacenter networks, so a free
// request whose IP belongs to a datacenter/VPN org gets no free. Paid
// generations are never checked. Lookup is ipapi.co (free, no key); if
// the checker is down or slow we fail OPEN (allow) so real users are
// never locked out by a checker outage.
const DC_ORG_KEYWORDS = [
  "digitalocean", "amazon", "google cloud", "google llc", "microsoft",
  "azure", "ovh", "hetzner", "vultr", "choopa", "linode", "akamai",
  "m247", "datacamp", "nordvpn", "mullvad", "proton", "expressvpn",
  "surfshark", "private internet access", "cloudflare", "fastly",
  "leaseweb", "contabo", "oracle cloud", "alibaba", "tencent",
  "datacenter", "data center", "hosting", "colocation", "gcore", "psychz",
];
async function ipLooksLikeVpn(ip: string): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch("https://ipapi.co/" + encodeURIComponent(ip) + "/json/", { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    const org = String(j.org || "").toLowerCase();
    if (!org) return false;
    return DC_ORG_KEYWORDS.some((k) => org.includes(k));
  } catch { return false; }
}

// Apply any due monthly plan grants. (The free trial never resets -
// free generations live and die by bd_profiles.trial_ends_at.)
// Returns the fresh profile row.
async function refreshAllowances(admin: ReturnType<typeof createClient>, userId: string) {
  const { data: p } = await admin.from("bd_profiles").select("*").eq("user_id", userId).single();
  if (!p) return null;
  const now = new Date();
  const patch: Record<string, unknown> = {};
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

// --- FREE ENGINE (ComfyUI) dispatch pieces ---
// The workflow build and the host dispatch live in these two helpers
// so there is exactly ONE workflow-substitution code path. bd-status
// carries a mirror of them for the waiting-line sweep (the two
// functions deploy separately - keep the copies in sync).
const COMFY_MODELS = ["comfy", "comfy-i2v", "comfy-ltx"];

// Is the free engine answering right now? Colab sessions die about
// hourly and every session gets a new tunnel URL, so an unreachable
// host is a normal state, not an error. ~4s timeout, mirroring the
// VPN checker's pattern: a door slower than that is a dead door.
async function comfyHostAlive(COMFY: string): Promise<boolean> {
  if (!COMFY) return false;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(COMFY + "/system_stats", { signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

// Build the ComfyUI workflow for a comfy-family job. Workflow: the
// per-model secret wins (COMFY_WORKFLOW_JSON / COMFY_WORKFLOW_I2V_JSON
// / COMFY_WORKFLOW_LTX_JSON); "comfy" otherwise falls back to a
// standard AnimateDiff text-to-video graph (same built-in as VIRALX).
// %PROMPT% / %NEG% / %SEED% are substituted, then clip length (and
// the I2V shape) is patched onto the graph. Returns { workflow } or
// { refuse: { error, status } } for the clean-refusal cases (engine
// not configured yet / template not valid JSON) - the caller decides
// what a refusal means (live path: undo + respond; sweep: skip).
function buildComfyWorkflow(model: string, prompt: string, billableSeconds: number, aspect: string):
  { workflow?: unknown; refuse?: { error: string; status: number } } {
  let wfText = Deno.env.get("COMFY_WORKFLOW_JSON") || "";
  if (model === "comfy-i2v") {
    // Image-to-Video runs its own graph (COMFY_WORKFLOW_I2V_JSON -
    // see workflows/README.md). No built-in fallback exists for it:
    // until the secret is set, say so cleanly and charge nothing.
    wfText = Deno.env.get("COMFY_WORKFLOW_I2V_JSON") || "";
    if (!wfText) {
      return { refuse: { error: "The image-to-video engine is not configured yet (beta) - nothing was charged.", status: 503 } };
    }
  } else if (model === "comfy-ltx") {
    // LTX-2.5 runs its own graph (COMFY_WORKFLOW_LTX_JSON - see
    // workflows/ltx25-t2v-workflow.README.md). ComfyUI ONLY, by the
    // owner's order: never fal, and no built-in fallback graph -
    // until the secret is set, say so cleanly and charge nothing.
    wfText = Deno.env.get("COMFY_WORKFLOW_LTX_JSON") || "";
    if (!wfText) {
      return { refuse: { error: "The LTX-2.5 engine is not configured yet (beta) - nothing was charged.", status: 503 } };
    }
  } else if (!wfText) {
    wfText = JSON.stringify({
      "3": { class_type: "KSampler", inputs: { seed: "%SEED%", steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
      "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "v1-5-pruned-emaonly.safetensors" } },
      "5": { class_type: "EmptyLatentImage", inputs: { width: 288, height: 512, batch_size: 16 } },
      "6": { class_type: "CLIPTextEncode", inputs: { text: "%PROMPT%", clip: ["4", 1] } },
      "7": { class_type: "CLIPTextEncode", inputs: { text: "blurry, low quality, distorted", clip: ["4", 1] } },
      "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
      "9": { class_type: "VHS_VideoCombine", inputs: { images: ["8", 0], frame_rate: 8, loop_count: 0, filename_prefix: "blackdragon", format: "video/h264-mp4", pingpong: false, save_output: true } },
    });
  }
  const seed = Math.floor(Math.random() * 1e9);
  const filled = wfText
    .replaceAll("%PROMPT%", prompt.replace(/"/g, '\\"'))
    .replaceAll("%NEG%", "blurry, low quality, distorted")
    .replaceAll("%SEED%", String(seed));
  let workflow: unknown;
  try { workflow = JSON.parse(filled); } catch {
    return { refuse: { error: "ComfyUI workflow template is not valid JSON. - free generation restored.", status: 500 } };
  }
  // Clip length follows the request on the Wan latent node:
  // 16 fps, length = secs*16+1 (81 frames = 5s, 161 = 10s, 241 = 15s).
  if (workflow && typeof workflow === "object") {
    const i2vDims: Record<string, [number, number]> = {
      "16:9": [1280, 704], "9:16": [704, 1280], "1:1": [960, 960], "4:3": [1152, 864], "3:4": [864, 1152],
    };
    const i2vScale: Record<string, [number, number]> = {
      "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1440, 1440], "4:3": [1728, 1296], "3:4": [1296, 1728],
    };
    for (const node of Object.values(workflow as Record<string, any>)) {
      if (node && node.class_type === "Wan22ImageToVideoLatent" && node.inputs) {
        node.inputs.length = billableSeconds * 16 + 1;
        // Image-to-Video also follows the requested shape: latent
        // dims per aspect (the T2V path keeps its proven 1280x704).
        if (model === "comfy-i2v") {
          const dims = i2vDims[aspect] || i2vDims["16:9"];
          node.inputs.width = dims[0];
          node.inputs.height = dims[1];
        }
      }
      // ...and the final upscale must match that shape, or a
      // vertical I2V clip would be squished back to landscape.
      if (model === "comfy-i2v" && node && node.class_type === "ImageScale" && node.inputs) {
        const sc = i2vScale[aspect] || i2vScale["16:9"];
        node.inputs.width = sc[0];
        node.inputs.height = sc[1];
      }
      // LTX-2.5: clip length lives on the LTX latent node, in
      // frames. PROVISIONAL - 24 fps, length = secs*24+1, pending
      // the engine-session verification pass documented in
      // workflows/ltx25-t2v-workflow.README.md (node class + fps
      // get confirmed against the real graph there). Width/height
      // stay whatever the saved workflow carries until that pass.
      if (model === "comfy-ltx" && node && node.class_type === "EmptyLTXVLatentVideo" && node.inputs) {
        node.inputs.length = billableSeconds * 24 + 1;
      }
    }
  }
  return { workflow };
}

// Wire the reference photo (if any) into the workflow as the Wan
// latent's start image, then POST the workflow to the host's /prompt.
// Returns { promptId } or { refuse: { error, status } } carrying the
// live path's exact refusal messages.
async function dispatchComfyJob(COMFY: string, model: string, workflow: unknown, imageUrl: string | null):
  Promise<{ promptId?: string; refuse?: { error: string; status: number } }> {
  // PHOTO-LED clips on the free engine (Keyz, 2026-10-30): when the
  // user uploaded a reference photo, push it to the Comfy host and
  // wire it as the Wan latent's start image (animate-a-photo).
  // Wan graphs only: LTX-2.5 ships here as text-to-video, and this
  // block replaces node "14" wholesale - never run it against an
  // LTX graph, whose node ids are a different contract.
  if (imageUrl && model !== "comfy-ltx" && workflow && typeof workflow === "object") {
    try {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error("photo fetch " + imgRes.status);
      // ANY IMAGE TYPE (Keyz, 2026-10-30): keep the photo's REAL
      // format — a JPEG named .png (or a WebP/GIF/BMP/AVIF with no
      // type) makes ComfyUI reject or misread the upload. Extension
      // comes from the response content-type, then the URL suffix.
      const ct = (imgRes.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const urlExt = (imageUrl.split("?")[0].split(".").pop() || "").toLowerCase();
      const ctExt: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/bmp": "bmp", "image/x-ms-bmp": "bmp", "image/avif": "avif" };
      const ext = ctExt[ct] || (["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"].includes(urlExt) ? (urlExt === "jpeg" ? "jpg" : urlExt) : "jpg");
      const rawBlob = await imgRes.blob();
      const imgBlob = rawBlob.type ? rawBlob : new Blob([await rawBlob.arrayBuffer()], { type: ct || "image/jpeg" });
      const form = new FormData();
      form.append("image", imgBlob, "bd-ref." + ext);
      form.append("overwrite", "true");
      const upRes = await fetch(COMFY + "/upload/image", { method: "POST", body: form });
      const upJson = await upRes.json().catch(() => ({}));
      if (!upRes.ok || !upJson.name) throw new Error("Comfy upload failed (HTTP " + upRes.status + ")");
      const wf = workflow as Record<string, any>;
      wf["14"] = { class_type: "LoadImage", inputs: { image: upJson.subfolder ? upJson.subfolder + "/" + upJson.name : upJson.name } };
      for (const node of Object.values(wf)) {
        if (node && node.class_type === "Wan22ImageToVideoLatent" && node.inputs) {
          node.inputs.start_image = ["14", 0];
        }
      }
    } catch (e) {
      return { refuse: { error: "Could not use that photo on the free engine: " + String(e).slice(0, 160) + " - nothing was charged.", status: 502 } };
    }
  }
  let cRes: Response | null = null;
  let cJson: Record<string, any> = {};
  try {
    cRes = await fetch(COMFY + "/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: "black-dragon-ai" }),
    });
    cJson = await cRes.json().catch(() => ({}));
  } catch (e) {
    return { refuse: { error: "Could not reach the ComfyUI host: " + String(e).slice(0, 200) + " - free generation restored.", status: 502 } };
  }
  if (!cRes || !cRes.ok || !cJson.prompt_id) {
    const detail = cJson?.error?.message || cJson?.error || ("HTTP " + (cRes ? cRes.status : 0));
    return { refuse: { error: "ComfyUI host rejected that one: " + String(detail).slice(0, 240) + " - free generation restored.", status: 502 } };
  }
  return { promptId: String(cJson.prompt_id) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const FAL_KEY = Deno.env.get("FAL_KEY");
    const COMFY = (Deno.env.get("COMFY_API_URL") || "").replace(/\/$/, "");
    // At least one engine must be configured: fal (paid) or ComfyUI (free).
    if (!FAL_KEY && !COMFY) return json({ error: "Generation is not switched on yet (no fal.ai key set)." }, 503);

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
    // Image-to-Video (comfy-i2v) is meaningless without its start photo.
    if (model === "comfy-i2v" && !imageUrl) {
      return json({ error: "Image to Video needs a photo first - upload one and try again." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE);

    // --- pricing + allowances ---
    const { data: pricing, error: priceErr } = await admin.from("bd_pricing").select("*").eq("id", 1).single();
    if (priceErr || !pricing) return json({ error: "Pricing is not set up yet." }, 503);
    let perSec: number;
    if (model === "wan") perSec = resolution === "1080p" ? pricing.wan_1080_per_sec : pricing.wan_720_per_sec;
    else if (model === "seedance") perSec = resolution === "480p" ? pricing.seedance_480_per_sec : pricing.seedance_720_per_sec;
    else if (model === "comfy" || model === "comfy-i2v" || model === "comfy-ltx") perSec = 0; // free engine only - never credit-priced (guarded below)
    else return json({ error: "Unknown model." }, 400);
    // Wan's endpoint caps at 15s; price the seconds that will actually render.
    // Comfy jobs use the same cap for the free-allowance check.
    const billableSeconds = (model === "wan" || model === "comfy" || model === "comfy-i2v" || model === "comfy-ltx") ? Math.max(2, Math.min(15, duration)) : duration;

    const profile = await refreshAllowances(admin, user.id);
    if (!profile) return json({ error: "Account profile missing - sign out and back in." }, 400);
    const isOwner = user.email === OWNER_EMAIL;

    // 30-SECOND CLIPS ARE PRO (Keyz, 2026-10-30): anything over 15s
    // requires a credited pack/plan order (or a plan on the profile);
    // the owner is exempt. Free and never-paid accounts cap at 15s.
    if (duration > 15 && user.email !== OWNER_EMAIL && (!profile.plan || profile.plan === "free")) {
      const { data: paidOrder } = await admin.from("bd_orders")
        .select("id").eq("user_id", user.id).eq("status", "credited").limit(1).maybeSingle();
      if (!paidOrder) {
        return json({ error: "30-second clips are PRO - they unlock with any credit pack. Grab a pack and the long format is yours." }, 402);
      }
    }

    const freePerWeek = pricing.free_gens_per_week ?? 25;
    const freeMaxSecs = pricing.free_max_seconds ?? 10;
    // FREE WINDOWS (Keyz, 2026-10-30): free runs 7 days at a time and
    // there is NO weekly reset - the window and the free counter reset
    // only on a 30-day cycle. Cycle k's free window is
    // [signup + 30k days, signup + 30k days + 7 days). Outside a window,
    // free is closed and generations run on credits.
    let inTrial = true;
    let firstWindow = true;
    if (profile.trial_ends_at) {
      const DAY = 24 * 3600 * 1000;
      const trialStart = new Date(profile.trial_ends_at).getTime() - 7 * DAY;
      const nowMs = Date.now();
      const elapsed = nowMs - trialStart;
      const cycleStart = trialStart + Math.floor(Math.max(0, elapsed) / (30 * DAY)) * (30 * DAY);
      inTrial = elapsed >= 0 && (nowMs - cycleStart) < 7 * DAY;
      firstWindow = cycleStart === trialStart;
      // Lazy counter reset: a new 30-day cycle has begun since the
      // last recorded reset - zero the free counter once, server-side.
      const lastReset = profile.free_cycle_start ? new Date(profile.free_cycle_start).getTime() : trialStart;
      if (cycleStart > lastReset) {
        await admin.from("bd_profiles")
          .update({ free_gens_used: 0, free_cycle_start: new Date(cycleStart).toISOString() })
          .eq("user_id", user.id);
        profile.free_gens_used = 0;
      }
    }
    // OWNER = UNLIMITED EVERYTHING (Keyz, 2026-10-30 21:34): the owner
    // is always inside the free window - no 7-day limit, no wall, no
    // caps, no credit charges - the owner is the tester and runs this
    // platform, so the owner can do what he wants.
    if (isOwner) inTrial = true;
    // ANTI-FARMING WALL (clarified by Keyz, 2026-10-30 21:34): the wall
    // is OFF for a customer only inside their FIRST 7-day window (beta:
    // upload + generate freely, no IP claim, no VPN block, nothing
    // recorded). After those 7 days the wall goes UP for everyone who
    // is not the owner - the per-connection IP claim (bd_ip_claims,
    // service-role only) and the VPN block apply, including inside
    // later 30-day cycle windows. The owner is never walled.
    const clientIp = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const wallOff = isOwner || (pricing.beta_free === true && inTrial && firstWindow);
    let ipBurned = false;
    let claimUserId: string | null = null;
    if (clientIp && !wallOff) {
      const { data: claim } = await admin.from("bd_ip_claims").select("ip, user_id").eq("ip", clientIp).maybeSingle();
      if (claim) {
        claimUserId = claim.user_id;
        if (claim.user_id !== user.id) ipBurned = true;
      }
    }
    const freeLeft = inTrial ? Math.max(0, freePerWeek - (profile.free_gens_used || 0)) : 0;
    const qualifiesFree = (model === "wan" || model === "comfy" || model === "comfy-i2v" || model === "comfy-ltx") && resolution === "720p" && billableSeconds <= freeMaxSecs;
    let useFree = qualifiesFree && inTrial && !ipBurned;
    // BETA MODE (Keyz, 2026-10-30): while bd_pricing.beta_free is true, the
    // free engine is open to signed-in users at no cost - no credit
    // charge, no free-gen consumption, and NO daily cap and NO
    // per-window generation count (Keyz, 2026-10-30: unlimited inside
    // the 7 days - the window is the only limit). During beta the
    // anti-abuse wall is OFF (Keyz, 2026-10-30 21:20): no IP claim and
    // no VPN block, so customers can upload and generate freely inside
    // their first 7 days; after that the wall is up for non-owners (see
    // wallOff above). After the window, credits/packs. Turn beta_free
    // off to return to trial-only rules with the wall on for everyone.
    let betaComfy = (model === "comfy" || model === "comfy-i2v" || model === "comfy-ltx") && pricing.beta_free === true && inTrial && !ipBurned;
    // VPN exits get no free when the wall is ON (post-beta, non-owner).
    // Checked only when this request would otherwise generate free, and
    // skipped when this same account already owns this IP's claim.
    let vpnBlocked = false;
    if (!wallOff && (betaComfy || useFree) && clientIp && claimUserId !== user.id) {
      vpnBlocked = await ipLooksLikeVpn(clientIp);
      if (vpnBlocked) { betaComfy = false; useFree = false; }
    }
    // No beta daily cap (deleted by Keyz's order, 2026-10-30).
    // ComfyUI is the FREE engine only - it never runs on credits. An
    // explicit comfy request that does not qualify for a free generation
    // is refused here instead of falling through to a paid fal call.
    if ((model === "comfy" || model === "comfy-i2v" || model === "comfy-ltx") && !useFree && !betaComfy) {
      if (vpnBlocked) {
        return json({ error: "Free generations don't run over a VPN or datacenter connection - turn the VPN off and try again, or grab a pack ($50 = 1,000 credits) to generate from anywhere." }, 402);
      }
      if (ipBurned) {
        return json({ error: "The free 7 days were already claimed on this connection - free is one window per connection, so new accounts on the same connection start on credits. Grab a pack ($50 = 1,000 credits) to keep creating." }, 402);
      }
      if (pricing.beta_free === true && !inTrial) {
        return json({ error: "Your free window is closed - free runs 7 days at a time and reopens every 30 days. Until then it runs on credits: grab a pack ($50 = 1,000 credits) to keep creating." }, 402);
      }
      return json({ error: `ComfyUI generations are free-trial only (720p, up to ${freeMaxSecs}s, inside the 7-day window) and your free window is closed or this request sits outside the free rules. Paid generations run on Wan or Seedance.`, free_left: freeLeft }, 402);
    }
    // The owner is never charged (unlimited everything, see above).
    const cost = (useFree || isOwner) ? 0 : perSec * billableSeconds;
    // Record this connection's free-window claim the first time this
    // account actually generates free - ONLY when the wall is on. During
    // beta (wall off) no claims are recorded, so beta use never burns a
    // connection's window. A PK conflict just means the claim already
    // exists - ignore it.
    if (!wallOff && (useFree || betaComfy) && clientIp) {
      await admin.from("bd_ip_claims").insert({ ip: clientIp, user_id: user.id });
    }

    // --- charge: free counter or credits ---
    let balanceAfter = profile.credits;
    let freeLeftAfter = freeLeft;
    if (useFree) {
      // Unlimited free inside the window - no counter is consumed.
    } else if (betaComfy) {
      // Beta: no charge and no trial consumption - the daily cap above is
      // the only gate. balanceAfter / freeLeftAfter stay as loaded.
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
      if (!useFree && !betaComfy) await admin.from("bd_profiles").update({ credits: now.credits + cost }).eq("user_id", user.id);
    };

    // --- FREE ENGINE: ComfyUI on the owner's host ---
    // Free (trial) generations route here whenever COMFY_API_URL is set.
    // The job row reuses the fal_* columns exactly like VIRALX's
    // vx_generations: fal_request_id holds the Comfy prompt_id,
    // fal_status_url the /history URL, fal_response_url the host base -
    // bd-status branches on model === "comfy" and polls those.
    if ((useFree || betaComfy) && COMFY) {
      const built = buildComfyWorkflow(model, prompt, billableSeconds, aspect);
      if (built.refuse) {
        await undoCharge();
        return json({ error: built.refuse.error }, built.refuse.status);
      }
      // ENGINE GATE + WAITING LINE (2026-11-02): if the free engine is
      // not answering right now, do NOT dispatch into the void - the
      // job would sit at QUEUED against a dead session forever. Park
      // it as "waiting" instead: HTTP 202, no error, nothing charged
      // (comfy jobs cost 0 anyway), and the bd-status sweep dispatches
      // it automatically, oldest first, when the engine is on. The
      // parked row carries image_url + aspect_ratio
      // (schema-waiting-line.sql) so the sweep can run this exact
      // dispatch later, photo-led jobs included. A parked job NEVER
      // falls through to fal - least of all comfy-ltx.
      if (!(await comfyHostAlive(COMFY))) {
        const { data: job, error: insErr } = await admin.from("bd_jobs").insert({
          owner_email: OWNER_EMAIL,
          user_id: user.id,
          user_email: user.email,
          credits_charged: 0,
          free_gen: useFree,
          model: model === "comfy-i2v" ? "comfy-i2v" : model === "comfy-ltx" ? "comfy-ltx" : "comfy", prompt, duration: billableSeconds, resolution,
          status: "waiting",
          fal_request_id: null,
          fal_status_url: null,
          fal_response_url: null,
          image_url: imageUrl,
          aspect_ratio: aspect,
        }).select().single();
        if (insErr) {
          await undoCharge();
          return json({ error: "Could not record the job: " + insErr.message + " - free generation restored." }, 500);
        }
        return json({ job, credits_charged: 0, balance: balanceAfter, free_left: freeLeftAfter, status: "waiting" }, 202);
      }
      const disp = await dispatchComfyJob(COMFY, model, built.workflow, imageUrl);
      if (disp.refuse) {
        await undoCharge();
        return json({ error: disp.refuse.error }, disp.refuse.status);
      }
      const { data: job, error: insErr } = await admin.from("bd_jobs").insert({
        owner_email: OWNER_EMAIL,
        user_id: user.id,
        user_email: user.email,
        credits_charged: 0,
        free_gen: useFree,
        model: model === "comfy-i2v" ? "comfy-i2v" : model === "comfy-ltx" ? "comfy-ltx" : "comfy", prompt, duration: billableSeconds, resolution,
        status: "queued",
        fal_request_id: disp.promptId,
        fal_status_url: COMFY + "/history/" + disp.promptId,
        fal_response_url: COMFY,
      }).select().single();
      if (insErr) {
        await undoCharge();
        return json({ error: "Could not record the job: " + insErr.message + " - free generation restored." }, 500);
      }
      return json({ job, credits_charged: 0, balance: balanceAfter, free_left: freeLeftAfter });
    }

    // Beta free-engine jobs NEVER fall through to fal: if the free engine
    // is not connected, say so instead of burning the fal balance.
    if ((model === "comfy" || model === "comfy-i2v" || model === "comfy-ltx") && betaComfy && !COMFY) {
      return json({ error: "The free engine is offline right now (beta). Try again in a bit - nothing was charged." }, 503);
    }
    // Same protection on the non-beta free path: an image-to-video job
    // must never fall through to fal (the Wan endpoint would silently
    // render it as text-to-video and lose the photo entirely).
    if (model === "comfy-i2v" && useFree && !COMFY) {
      return json({ error: "The free engine is offline right now (beta). Try again in a bit - nothing was charged." }, 503);
    }
    // LTX-2.5 is ComfyUI-only (owner's order): on ANY path it must never
    // fall through to fal - not as a paid LTX endpoint (there is none
    // wired, on purpose) and not as the free-trial Wan stand-in, which
    // would silently render a different model than the one picked.
    if (model === "comfy-ltx" && useFree && !COMFY) {
      return json({ error: "The free engine is offline right now (beta). Try again in a bit - nothing was charged." }, 503);
    }

    // --- build the fal call ---
    // Only reachable for paid jobs, or for free jobs while COMFY_API_URL
    // is unset (the fal Wan stand-in for the free engine). A fal call
    // needs the fal key - if it is missing, undo the charge first.
    if (!FAL_KEY) {
      await undoCharge();
      return json({ error: "Generation is not switched on yet (no fal.ai key set)." }, 503);
    }
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
      // an explicit "comfy" request only reaches this fal insert as the
      // free-trial stand-in (COMFY_API_URL unset) - it renders on Wan,
      // so record it as "wan" or bd-status would poll it as a Comfy job
      model: model === "comfy" ? "wan" : model, prompt, duration: billableSeconds, resolution,
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
