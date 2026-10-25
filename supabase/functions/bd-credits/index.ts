// BLACK DRAGON AI - bd-credits (v2.1: + plans, allowance refresh)
// The money side. Actions:
//   refresh       (any signed-in user)  - apply the weekly free reset and
//                 any due monthly plan grant, return the fresh profile.
//   create_order  (any signed-in user)  - start a credit-pack OR monthly
//                 plan order; the buyer pays the owner directly (Cash App /
//                 Venmo / Chime) with the order code in the note.
//   confirm_order (owner only)          - payment received -> credit buyer;
//                 plan orders also switch the buyer's plan on.
//   cancel_order  (owner only)          - kill a pending order.
//   adjust        (owner only)          - add/remove credits for any user
//                 by email (comps, fixes, refunds).
//   set_pricing   (owner only)          - update per-second rates / packs /
//                 plans / free-tier knobs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OWNER_EMAIL = "littmobstudios@gmail.com";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function orderCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return "BD-" + s;
}

// Same lazy-reset logic as bd-generate: weekly free counter + monthly grants.
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

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Sign in first." }, 401);
    const caller = userData.user;
    const isOwner = caller.email === OWNER_EMAIL;

    const body = await req.json();
    const action = String(body.action || "");
    const admin = createClient(SUPABASE_URL, SERVICE);

    if (action === "refresh") {
      const profile = await refreshAllowances(admin, caller.id);
      if (!profile) return json({ error: "Account profile missing." }, 400);
      const { data: pricing } = await admin.from("bd_pricing")
        .select("free_gens_per_week, free_max_seconds").eq("id", 1).single();
      return json({ profile, free_per_week: pricing?.free_gens_per_week ?? 25 });
    }

    if (action === "create_order") {
      const { data: pricing } = await admin.from("bd_pricing").select("packs, plans").eq("id", 1).single();
      let item: { id: string; usd: number; credits: number } | undefined;
      let kind = "pack";
      if (body.plan_id) {
        item = ((pricing?.plans || []) as Array<{ id: string; usd: number; credits: number }>).find((p) => p.id === body.plan_id);
        kind = "plan";
      } else {
        item = ((pricing?.packs || []) as Array<{ id: string; usd: number; credits: number }>).find((p) => p.id === body.pack_id);
      }
      if (!item) return json({ error: "Unknown pack or plan." }, 400);
      // one live pending order per buyer - reuse it so codes don't pile up
      const { data: existing } = await admin.from("bd_orders")
        .select("*").eq("user_id", caller.id).eq("status", "pending")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (existing) return json({ order: existing, reused: true });
      const { data: order, error } = await admin.from("bd_orders").insert({
        code: orderCode(),
        user_id: caller.id,
        email: caller.email,
        pack_id: kind === "pack" ? item.id : "plan",
        plan_id: kind === "plan" ? item.id : null,
        kind,
        amount_usd: item.usd,
        credits: item.credits,
        status: "pending",
      }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ order });
    }

    if (action === "confirm_order") {
      if (!isOwner) return json({ error: "Owner only." }, 403);
      const { data: order } = await admin.from("bd_orders").select("*").eq("id", body.order_id).single();
      if (!order) return json({ error: "Order not found." }, 404);
      if (order.status !== "pending") return json({ error: "Order already " + order.status + "." }, 409);
      const { data: prof } = await admin.from("bd_profiles").select("credits").eq("user_id", order.user_id).single();
      if (!prof) return json({ error: "Buyer profile missing." }, 400);
      await admin.from("bd_profiles").update({ credits: prof.credits + order.credits }).eq("user_id", order.user_id);
      if (order.kind === "plan" && order.plan_id) {
        await admin.from("bd_profiles").update({
          plan: order.plan_id,
          plan_credits_monthly: order.credits,
          plan_started_at: new Date().toISOString(),
          next_credit_reset: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        }).eq("user_id", order.user_id);
      }
      const { data: updated } = await admin.from("bd_orders")
        .update({ status: "credited", credited_at: new Date().toISOString() })
        .eq("id", order.id).select().single();
      return json({ order: updated, buyer_balance: prof.credits + order.credits });
    }

    if (action === "cancel_order") {
      if (!isOwner) return json({ error: "Owner only." }, 403);
      const { data: updated, error } = await admin.from("bd_orders")
        .update({ status: "cancelled" }).eq("id", body.order_id).eq("status", "pending")
        .select().single();
      if (error || !updated) return json({ error: "Order not found or not pending." }, 404);
      return json({ order: updated });
    }

    if (action === "adjust") {
      if (!isOwner) return json({ error: "Owner only." }, 403);
      const delta = parseInt(body.delta || "0", 10);
      if (!delta) return json({ error: "Give a non-zero credit amount." }, 400);
      const { data: prof } = await admin.from("bd_profiles").select("*")
        .eq("email", String(body.email || "")).single();
      if (!prof) return json({ error: "No profile with that email." }, 404);
      const next = Math.max(0, prof.credits + delta);
      await admin.from("bd_profiles").update({ credits: next }).eq("user_id", prof.user_id);
      return json({ email: prof.email, credits: next });
    }

    if (action === "set_pricing") {
      if (!isOwner) return json({ error: "Owner only." }, 403);
      const patch: Record<string, unknown> = {};
      for (const k of ["wan_720_per_sec", "wan_1080_per_sec", "seedance_480_per_sec", "seedance_720_per_sec", "free_gens_per_week", "free_max_seconds"]) {
        if (body[k] !== undefined) {
          const v = parseInt(body[k], 10);
          if (!(v >= 0) || (k.endsWith("per_sec") && v === 0)) return json({ error: "Rates must be positive whole credits (free knobs can be 0)." }, 400);
          patch[k] = v;
        }
      }
      if (Array.isArray(body.packs)) patch.packs = body.packs;
      if (Array.isArray(body.plans)) patch.plans = body.plans;
      if (Object.keys(patch).length === 0) return json({ error: "Nothing to change." }, 400);
      const { data: updated, error } = await admin.from("bd_pricing").update(patch).eq("id", 1).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ pricing: updated });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
