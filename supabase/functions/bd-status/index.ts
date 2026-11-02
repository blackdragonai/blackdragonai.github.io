// BLACK DRAGON AI - bd-status (v2.1, credits + ComfyUI)
// The job's owner (or the app owner) polls one job. fal jobs check
// fal.ai; ComfyUI jobs (models "comfy" / "comfy-i2v" / "comfy-ltx" -
// the free engine) poll the
// owner's host /history/<prompt_id> and save the /view URL. When
// finished, saves the video URL. If the job ends in error after credits
// were charged, the charge is refunded exactly once (free jobs get
// their free generation back instead).
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
    const { data: job, error: jobErr } = await admin.from("bd_jobs").select("*").eq("id", job_id).single();
    if (jobErr || !job) return json({ error: "Job not found." }, 404);
    if (caller.email !== OWNER_EMAIL && job.user_id !== caller.id) {
      return json({ error: "Not your job." }, 403);
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
      const hRes = await fetch(job.fal_status_url);
      if (hRes.status === 404) return json({ job }); // not finished yet
      const hist = await hRes.json().catch(() => ({}));
      const entry = hist[job.fal_request_id];
      if (!entry) return json({ job });
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
