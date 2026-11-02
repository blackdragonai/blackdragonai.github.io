// BLACK DRAGON AI - bd-status (v2.2, credits + ComfyUI + waiting line)
// The job's owner (or the app owner) polls one job. fal jobs check
// fal.ai; ComfyUI jobs (models "comfy" / "comfy-i2v" / "comfy-ltx" -
// the free engine) poll the
// owner's host /history/<prompt_id> and save the /view URL. When
// finished, saves the video URL. If the job ends in error after credits
// were charged, the charge is refunded exactly once (free jobs get
// their free generation back instead).
// WAITING LINE (v2.2, 2026-11-02): every invocation first runs a
// dispatch sweep - when the free engine is answering and fewer than 2
// comfy jobs are in flight, the oldest parked ("waiting") jobs are
// dispatched, oldest first, across all users (one shared GPU line).
// The sweep piggybacks on polling because Supabase's free tier has no
// always-on cron: the line moves while someone has the app open.
// ZOMBIE EXPIRY: a dispatched comfy job whose host answers but has no
// record of it (not in /history, not in /queue) once it is 15+ minutes
// old was sent to a previous, dead session - it is failed with an
// "engine_offline" error instead of sitting at QUEUED forever.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OWNER_EMAIL = "littmobstudios@gmail.com";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// --- FREE ENGINE (ComfyUI) dispatch pieces: MIRROR of bd-generate ---
// The two functions deploy separately, so the workflow build + host
// dispatch are copied here verbatim from bd-generate - keep them in
// sync. The sweep below runs the exact same code path bd-generate
// uses, never a second workflow format.
const COMFY_MODELS = ["comfy", "comfy-i2v", "comfy-ltx"];

// Is the free engine answering right now? ~4s timeout: a tunnel that
// takes longer than that is a dead door for our purposes.
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

// Build the ComfyUI workflow for a comfy-family job (mirror of
// bd-generate's buildComfyWorkflow). Returns { workflow } or
// { refuse } for the not-configured / invalid-template cases.
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

// True only when the job's host ANSWERS its /queue without listing
// this prompt_id as running or pending - positive proof the live
// host has never heard of the job. Any doubt (host unreachable, odd
// response shape) returns false: when in doubt, leave the job alone.
// (A job still rendering on the host has no /history entry yet, but
// it IS in /queue - this check is what keeps long renders safe from
// the zombie rule.)
async function comfyQueueMisses(job: { fal_response_url?: string | null; fal_request_id?: string | null }): Promise<boolean> {
  const base = (job.fal_response_url || "").replace(/\/$/, "");
  if (!base || !job.fal_request_id) return false;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(base + "/queue", { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const q = await r.json().catch(() => null);
    if (!q) return false;
    const items = [...(q.queue_running || []), ...(q.queue_pending || [])];
    const ids = items.map((item: any) => (Array.isArray(item) ? item[1] : item && item.prompt_id));
    return !ids.includes(job.fal_request_id);
  } catch { return false; }
}

// WAITING LINE SWEEP: if the engine is answering and fewer than 2
// comfy-family jobs are dispatched-and-unfinished, dispatch the
// oldest parked ("waiting") jobs, oldest first, across all users -
// one shared GPU line. A job whose workflow secret is not configured
// stays parked (skipped, never failed); a host hiccup mid-sweep
// leaves the rest of the line parked. The flip to "queued" is
// guarded on the row still being "waiting", so two polls sweeping at
// once can never dispatch the same job twice.
async function sweepWaitingLine(admin: ReturnType<typeof createClient>, COMFY: string) {
  if (!COMFY) return;
  if (!(await comfyHostAlive(COMFY))) return;
  const { count } = await admin.from("bd_jobs")
    .select("id", { count: "exact", head: true })
    .in("model", COMFY_MODELS)
    .in("status", ["queued", "running"])
    .not("fal_request_id", "is", null);
  const slots = 2 - (count || 0);
  if (slots <= 0) return;
  const { data: waiting } = await admin.from("bd_jobs")
    .select("*")
    .eq("status", "waiting")
    .in("model", COMFY_MODELS)
    .order("created_at", { ascending: true })
    .limit(slots);
  for (const row of waiting || []) {
    try {
      const built = buildComfyWorkflow(row.model, row.prompt, row.duration || 10, row.aspect_ratio || "16:9");
      if (built.refuse || !built.workflow) continue; // not configured / unparseable - stays in line
      const disp = await dispatchComfyJob(COMFY, row.model, built.workflow, row.image_url || null);
      if (disp.refuse || !disp.promptId) continue; // host hiccup - stays in line
      await admin.from("bd_jobs").update({
        status: "queued",
        fal_request_id: disp.promptId,
        fal_status_url: COMFY + "/history/" + disp.promptId,
        fal_response_url: COMFY,
      }).eq("id", row.id).eq("status", "waiting");
    } catch (_e) { /* one bad row never blocks the line */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const FAL_KEY = Deno.env.get("FAL_KEY");
    const COMFY = (Deno.env.get("COMFY_API_URL") || "").replace(/\/$/, "");
    // ComfyUI jobs poll the owner's host and never touch fal - only
    // refuse outright when neither engine is configured.
    if (!FAL_KEY && !(Deno.env.get("COMFY_API_URL") || "").trim()) return json({ error: "No fal.ai key set." }, 503);

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Sign in first." }, 401);
    const caller = userData.user;

    const { job_id } = await req.json();
    const admin = createClient(SUPABASE_URL, SERVICE);
    let { data: job, error: jobErr } = await admin.from("bd_jobs").select("*").eq("id", job_id).single();
    if (jobErr || !job) return json({ error: "Job not found." }, 404);
    if (caller.email !== OWNER_EMAIL && job.user_id !== caller.id) {
      return json({ error: "Not your job." }, 403);
    }
    // --- WAITING LINE SWEEP (2026-11-02) ---
    // Runs on every poll, before this job's own status work: if the
    // engine is on and has room, the oldest parked jobs dispatch now.
    // Defensively wrapped - a sweep failure must never break the
    // status response the caller is waiting on.
    try { await sweepWaitingLine(admin, COMFY); } catch (_e) { /* status first, sweep second */ }
    if (job.status === "waiting") {
      // The sweep may have just dispatched THIS job - re-read it so
      // the polling below works on the fresh row.
      const { data: fresh } = await admin.from("bd_jobs").select("*").eq("id", job.id).single();
      if (fresh) job = fresh;
    }
    if (job.status === "done" || job.status === "error") return json({ job });
    if (!job.fal_status_url) return json({ job });

    // mark error + refund the charge exactly once
    const failWithRefund = async (msg: string) => {
      await admin.from("bd_jobs")
        .update({ status: "error", error: msg, refunded: job.credits_charged > 0 ? true : job.refunded })
        .eq("id", job.id);
      job.status = "error"; job.error = msg;
      if (job.credits_charged > 0 && !job.refunded && job.user_id) {
        const { data: prof } = await admin.from("bd_profiles").select("credits").eq("user_id", job.user_id).single();
        if (prof) await admin.from("bd_profiles").update({ credits: prof.credits + job.credits_charged }).eq("user_id", job.user_id);
        job.refunded = true;
      }
      if (job.free_gen && job.user_id) {
        // give the weekly free generation back too (this runs once,
        // on the transition into error)
        const { data: prof2 } = await admin.from("bd_profiles").select("free_gens_used").eq("user_id", job.user_id).single();
        if (prof2) await admin.from("bd_profiles").update({ free_gens_used: Math.max(0, prof2.free_gens_used - 1) }).eq("user_id", job.user_id);
      }
      return json({ job });
    };

    // --- ComfyUI jobs: poll /history/<prompt_id> on the owner's host ---
    // (Mirrors VIRALX vx-status; failures go through failWithRefund so a
    // free job gets its free generation back exactly once, like fal.)
    if (job.model === "comfy" || job.model === "comfy-i2v" || job.model === "comfy-ltx") {
      // If the host cannot be reached at all, the job stays untouched:
      // an unreachable host cannot tell "still rendering" from
      // "session died", so nothing is decided either way.
      let hRes: Response | null = null;
      try { hRes = await fetch(job.fal_status_url); } catch (_e) { hRes = null; }
      if (!hRes) return json({ job });
      const hist = hRes.status === 404 ? {} : await hRes.json().catch(() => ({}));
      const entry = hist[job.fal_request_id];
      if (!entry) {
        // The host answered but has no history record of this job.
        // A job still queued or rendering on THIS host looks exactly
        // the same way, so the zombie verdict needs both proofs: the
        // job is 15+ minutes old AND the host's own /queue does not
        // know the prompt_id either (comfyQueueMisses). Then it was
        // dispatched to a previous session that died, and it will
        // never render: fail it as engine_offline through the normal
        // refund-once path (comfy jobs charged 0, so it refunds 0,
        // exactly once) and the frontend shows a clean retry.
        const ageMs = Date.now() - new Date(job.created_at).getTime();
        if (ageMs > 15 * 60 * 1000 && await comfyQueueMisses(job)) {
          return await failWithRefund("engine_offline: the studio engine went offline before this clip rendered.");
        }
        return json({ job }); // not finished yet
      }
      const stStr = entry.status && entry.status.status_str;
      if (stStr === "error") return await failWithRefund("ComfyUI reported an error on that job.");
      const outputs = entry.outputs || {};
      for (const nodeId of Object.keys(outputs)) {
        const out = outputs[nodeId];
        const files = [...(out.gifs || []), ...(out.videos || []), ...(out.images || [])];
        for (const f of files) {
          if (!f || !f.filename) continue;
          if (/\.(mp4|webm|gif)$/i.test(f.filename)) {
            const base = (job.fal_response_url || "").replace(/\/$/, "");
            const tunnelUrl = base + "/view?filename=" + encodeURIComponent(f.filename) +
              "&subfolder=" + encodeURIComponent(f.subfolder || "") +
              "&type=" + encodeURIComponent(f.type || "output");
            // Re-host the finished clip into the project's public storage
            // (site-media bucket, bd-clips/ folder) so it keeps playing
            // after the free engine's tunnel dies. Fall back to the tunnel
            // URL if the copy fails for any reason. (Same pattern as
            // VIRALX vx-status, added at the 2026-10-30 beta relaunch.)
            let url = tunnelUrl;
            try {
              const dl = await fetch(tunnelUrl);
              if (dl.ok) {
                const bytes = new Uint8Array(await dl.arrayBuffer());
                const ext = (f.filename.split(".").pop() || "mp4").toLowerCase();
                const path = "bd-clips/" + job.id + "." + ext;
                const up = await admin.storage.from("site-media").upload(path, bytes, {
                  contentType: ext === "webm" ? "video/webm" : ext === "gif" ? "image/gif" : "video/mp4",
                  upsert: true,
                });
                if (!up.error) {
                  url = admin.storage.from("site-media").getPublicUrl(path).data.publicUrl;
                }
              }
            } catch (_e) { /* keep the tunnel URL */ }
            await admin.from("bd_jobs").update({ status: "done", video_url: url }).eq("id", job.id);
            job.status = "done"; job.video_url = url;
            return json({ job });
          }
        }
      }
      if (job.status !== "running") {
        await admin.from("bd_jobs").update({ status: "running" }).eq("id", job.id);
        job.status = "running";
      }
      return json({ job });
    }

    if (!FAL_KEY) return json({ error: "No fal.ai key set." }, 503);
    const st = await fetch(job.fal_status_url, { headers: { "Authorization": `Key ${FAL_KEY}` } });
    const stJson = await st.json().catch(() => ({}));
    const s = stJson.status || "IN_QUEUE";

    if (s === "IN_QUEUE" || s === "IN_PROGRESS") {
      if (job.status !== "running") {
        await admin.from("bd_jobs").update({ status: "running" }).eq("id", job.id);
        job.status = "running";
      }
      return json({ job });
    }
    if (s === "COMPLETED") {
      const res = await fetch(job.fal_response_url, { headers: { "Authorization": `Key ${FAL_KEY}` } });
      const resJson = await res.json().catch(() => ({}));
      const videoUrl = resJson?.video?.url || resJson?.video_url || resJson?.url || null;
      if (videoUrl) {
        await admin.from("bd_jobs").update({ status: "done", video_url: videoUrl }).eq("id", job.id);
        job.status = "done"; job.video_url = videoUrl;
        return json({ job });
      }
      const detail = resJson?.detail || resJson?.error || ("HTTP " + res.status);
      const msg = "fal finished without a video: " + (typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300);
      return await failWithRefund(msg + (job.credits_charged > 0 ? " Credits refunded." : ""));
    }
    return await failWithRefund("fal status: " + s + (job.credits_charged > 0 ? " Credits refunded." : ""));
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
