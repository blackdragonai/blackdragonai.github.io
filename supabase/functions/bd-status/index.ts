// BLACK DRAGON AI - bd-status
// Owner-only. Checks fal.ai for one job; when finished, saves the video URL.
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
    if (!FAL_KEY) return json({ error: "No fal.ai key set." }, 503);

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user || userData.user.email !== OWNER_EMAIL) {
      return json({ error: "Owner only." }, 403);
    }

    const { job_id } = await req.json();
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: job, error: jobErr } = await admin.from("bd_jobs").select("*").eq("id", job_id).single();
    if (jobErr || !job) return json({ error: "Job not found." }, 404);
    if (job.status === "done" || job.status === "error") return json({ job });
    if (!job.fal_status_url) return json({ job });

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
      } else {
        const detail = resJson?.detail || resJson?.error || ("HTTP " + res.status);
        const msg = "fal finished without a video: " + (typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300);
        await admin.from("bd_jobs").update({ status: "error", error: msg }).eq("id", job.id);
        job.status = "error"; job.error = msg;
      }
      return json({ job });
    }
    await admin.from("bd_jobs").update({ status: "error", error: "fal status: " + s }).eq("id", job.id);
    job.status = "error"; job.error = "fal status: " + s;
    return json({ job });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
