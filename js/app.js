// BLACK DRAGON AI - studio logic (v2: accounts + credits).
(function () {
  const cfg = window.BD_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const authForm = document.getElementById("auth-form");
  const studio = document.getElementById("studio");
  const signoutBtn = document.getElementById("signout-btn");
  const buyBtn = document.getElementById("buy-btn");
  const balanceChip = document.getElementById("balance-chip");
  const freeChip = document.getElementById("free-chip");
  let session = null;
  let profile = null;
  let pricing = null;
  let freePerWeek = 25;
  let selectedModel = cfg.MODELS[0];
  let pollTimer = null;
  let authMode = "in"; // "in" | "up"
  const isOwner = () => !!session && session.user.email === cfg.OWNER_EMAIL;
  const esc = (s) => String(s == null ? "" : s);

  // ---------- pricing ----------
  function perSec(modelId, res) {
    if (!pricing) return null;
    if (modelId === "comfy") return 0;
    if (modelId === "wan") return res === "1080p" ? pricing.wan_1080_per_sec : pricing.wan_720_per_sec;
    if (modelId === "seedance") return res === "480p" ? pricing.seedance_480_per_sec : pricing.seedance_720_per_sec;
    return null;
  }
  function currentCost() {
    const d = parseInt(document.getElementById("duration").value || "0", 10);
    const r = document.getElementById("resolution").value;
    const p = perSec(selectedModel.id, r);
    if (p == null || !d) return null;
    const secs = selectedModel.id === "wan" ? Math.min(15, d) : d;
    return p * secs;
  }
  async function loadPricing() {
    const { data } = await sb.from("bd_pricing").select("*").eq("id", 1).single();
    if (!data) return;
    pricing = data;
    freePerWeek = pricing.free_gens_per_week != null ? pricing.free_gens_per_week : 25;
    document.getElementById("auth-rates").textContent =
      "Unlimited free generations in your 7-day window · reopens every 30 days · Credit packs $50 / $150 / $200 · Wan " + pricing.wan_720_per_sec + " credits/sec";
    document.getElementById("free-allowance-note").textContent =
      "Unlimited free generations in your 7-day window — reopens every 30 days (free engine, up to " + (pricing.free_max_seconds || 10) + " sec each)";
    document.querySelectorAll(".model-price").forEach(function (el) {
      const id = el.dataset.model;
      if (id === "wan") el.textContent = pricing.wan_720_per_sec + " credits/sec (720p) · " + pricing.wan_1080_per_sec + " credits/sec (1080p)";
      if (id === "seedance") el.textContent = pricing.seedance_480_per_sec + " credits/sec (480p) · " + pricing.seedance_720_per_sec + " credits/sec (720p)";
    });
    renderPacks();
    renderPlans();
    renderPublic();
    renderBalances();
    updateCost();
    if (isOwner()) {
      document.getElementById("price-wan720").value = pricing.wan_720_per_sec;
      document.getElementById("price-wan1080").value = pricing.wan_1080_per_sec;
      document.getElementById("price-seed480").value = pricing.seedance_480_per_sec;
      document.getElementById("price-seed720").value = pricing.seedance_720_per_sec;
      document.getElementById("price-freegens").value = freePerWeek;
      document.getElementById("price-freemax").value = pricing.free_max_seconds || 10;
    }
  }
  function scrollToAuth() {
    authForm.scrollIntoView({ behavior: "smooth", block: "center" });
    const em = document.getElementById("auth-email");
    if (em) setTimeout(() => em.focus({ preventScroll: true }), 450);
  }
  function renderPublic() {
    if (!pricing) return;
    document.getElementById("pub-free-note").textContent =
      "Unlimited free generations in a 7-day free trial";
    const mk = function (name, big, sub) {
      const div = document.createElement("div");
      div.className = "pack-card";
      const n = document.createElement("div"); n.className = "pack-name"; n.textContent = name;
      const c = document.createElement("div"); c.className = "pack-credits"; c.textContent = big;
      const u = document.createElement("div"); u.className = "pack-usd"; u.textContent = sub;
      const b = document.createElement("button");
      b.className = "btn btn-gold"; b.type = "button"; b.textContent = "Start free";
      b.addEventListener("click", scrollToAuth);
      div.append(n, c, u, b);
      return div;
    };
    const pg = document.getElementById("pub-plan-grid");
    pg.innerHTML = "";
    pg.appendChild(mk("FREE TRIAL", "Unlimited gens · 7 days", "$0 · Cheap Zone clips"));
    (pricing.plans || []).forEach(function (p) {
      pg.appendChild(mk(esc(p.name).toUpperCase(), p.credits + " credits", "$" + p.usd + " / month"));
    });
    const kg = document.getElementById("pub-pack-grid");
    kg.innerHTML = "";
    (pricing.packs || []).forEach(function (p) {
      kg.appendChild(mk(esc(p.name).toUpperCase(), p.credits + " credits", "$" + p.usd + " one-time"));
    });
  }
  function freeWindow() {
    // Mirrors the server rule: free runs 7 days at a time on a 30-day
    // cycle from signup. No weekly reset - the counter resets only when
    // a new 30-day cycle begins.
    if (!profile || !profile.trial_ends_at) return { open: true, used: profile ? (profile.free_gens_used || 0) : 0 };
    const DAY = 24 * 3600 * 1000;
    const start = Date.parse(profile.trial_ends_at) - 7 * DAY;
    const el = Date.now() - start;
    if (el < 0) return { open: true, used: profile.free_gens_used || 0 };
    const cycleStart = start + Math.floor(el / (30 * DAY)) * (30 * DAY);
    const open = (Date.now() - cycleStart) < 7 * DAY;
    const lastReset = profile.free_cycle_start ? Date.parse(profile.free_cycle_start) : start;
    const used = cycleStart > lastReset ? 0 : (profile.free_gens_used || 0);
    return { open: open, used: used };
  }
  function trialOver() { return !freeWindow().open; }
  function freeLeft() {
    // Unlimited inside the 7-day window (Keyz, 2026-10-30): no count.
    if (!profile) return 999;
    return freeWindow().open ? 999 : 0;
  }
  function qualifiesFreeUI() {
    if (!pricing) return false;
    const d = parseInt(document.getElementById("duration").value || "0", 10);
    const r = document.getElementById("resolution").value;
    return selectedModel.id === "wan" && r === "720p" && d > 0 && d <= (pricing.free_max_seconds || 10);
  }
  function renderBalances() {
    if (!session) return;
    balanceChip.textContent = "⚡ " + (profile ? profile.credits : 0) + " credits";
    freeChip.textContent = trialOver() ? "🎁 trial over" : "🎁 unlimited free in window";
    if (profile) {
      const planName = profile.plan && profile.plan !== "free"
        ? profile.plan.charAt(0).toUpperCase() + profile.plan.slice(1) + " (monthly)"
        : "Free";
      document.getElementById("plan-line").innerHTML = "";
      const t = document.createTextNode("Your plan: ");
      const s = document.createElement("strong"); s.textContent = planName;
      document.getElementById("plan-line").append(t, s);
    }
  }
  function renderPlans() {
    const grid = document.getElementById("plan-grid");
    grid.innerHTML = "";
    const free = document.createElement("div");
    free.className = "pack-card";
    free.innerHTML = "";
    const fn = document.createElement("div"); fn.className = "pack-name"; fn.textContent = "FREE TRIAL";
    const fc = document.createElement("div"); fc.className = "pack-credits"; fc.textContent = freePerWeek + " gens · 7 days";
    const fu = document.createElement("div"); fu.className = "pack-usd"; fu.textContent = "$0 · free engine · reopens every 30 days";
    free.append(fn, fc, fu);
    grid.appendChild(free);
    (pricing.plans || []).forEach(function (p) {
      const div = document.createElement("div");
      div.className = "pack-card";
      const n = document.createElement("div"); n.className = "pack-name"; n.textContent = esc(p.name).toUpperCase();
      const c = document.createElement("div"); c.className = "pack-credits"; c.textContent = p.credits + " credits";
      const u = document.createElement("div"); u.className = "pack-usd"; u.textContent = "$" + p.usd + " / month";
      const b = document.createElement("button");
      b.className = "btn btn-gold"; b.type = "button"; b.textContent = "Start plan";
      b.addEventListener("click", () => buyPlan(p.id));
      div.append(n, c, u, b);
      grid.appendChild(div);
    });
  }
  function renderPacks() {
    const grid = document.getElementById("pack-grid");
    grid.innerHTML = "";
    (pricing.packs || []).forEach(function (p) {
      const div = document.createElement("div");
      div.className = "pack-card";
      const n = document.createElement("div"); n.className = "pack-name"; n.textContent = esc(p.name).toUpperCase();
      const c = document.createElement("div"); c.className = "pack-credits"; c.textContent = p.credits + " credits";
      const u = document.createElement("div"); u.className = "pack-usd"; u.textContent = "$" + p.usd;
      const v = document.createElement("div"); v.className = "pack-value";
      const perClip = ((pricing && pricing.wan_720_per_sec) || 3) * 5;
      v.textContent = "≈ " + Math.floor(p.credits / perClip) + " clips · 5s each · Wan 720p";
      const b = document.createElement("button");
      b.className = "btn btn-gold"; b.type = "button"; b.textContent = "Buy";
      b.addEventListener("click", () => buyPack(p.id));
      div.append(n, c, u, v, b);
      grid.appendChild(div);
    });
  }
  function setMeter(pct, cls) {
    const fill = document.getElementById("price-meter-fill");
    if (!fill) return;
    fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
    fill.className = "price-meter-fill" + (cls ? " " + cls : "");
  }
  function updateCost() {
    const line = document.getElementById("cost-line");
    const btn = document.getElementById("generate-btn");
    const dSel = parseInt(document.getElementById("duration").value || "0", 10);
    if (dSel > 15 && !isProUser()) {
      line.textContent = "30-second clips are PRO 🔒 — they unlock with any credit pack.";
      btn.disabled = true;
      btn.textContent = "PRO only — grab a pack below";
      setMeter(100, "high");
      return;
    }
    if (qualifiesFreeUI() && freeLeft() > 0) {
      line.textContent = "This one is FREE — unlimited generations inside your 7-day window 🎁";
      btn.disabled = false;
      btn.textContent = "Generate (free)";
      setMeter(100, "free");
      return;
    }
    const cost = currentCost();
    if (cost == null) {
      // The free beta engine has no per-second price: show a FREE meter
      // while beta_free is on, otherwise an empty meter.
      if (selectedModel && selectedModel.id === "comfy" && pricing && pricing.beta_free && !trialOver()) {
        line.textContent = "FREE during your 7-day window — the beta engine runs on us 🐉";
        setMeter(100, "free");
      } else { line.textContent = ""; setMeter(0, ""); }
      return;
    }
    // The price meter: fill = this job's cost against the priciest
    // standard render (Seedance 720p x 30s), green -> gold -> red.
    const maxRef = ((pricing && pricing.seedance_720_per_sec) || 12) * 30;
    const pct = Math.max(3, Math.round((cost / maxRef) * 100));
    setMeter(pct, pct < 40 ? "" : pct < 75 ? "mid" : "high");
    const bal = profile ? profile.credits : null;
    line.textContent = "Cost: " + cost + " credits" + (bal != null ? " · Your balance after: " + (bal - cost) : "");
    if (bal != null && bal < cost) {
      btn.disabled = true;
      btn.textContent = "Not enough credits — grab a pack below";
    } else {
      btn.disabled = false;
      btn.textContent = "Generate";
    }
  }

  // ---------- models ----------
  const grid = document.getElementById("model-grid");
  cfg.MODELS.forEach(function (m) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "model-card" + (m.disabled ? " disabled" : "") + (m === selectedModel ? " selected" : "");
    const zone = document.createElement("span"); zone.className = "model-zone"; zone.textContent = m.zone;
    const name = document.createElement("div"); name.className = "model-name"; name.textContent = m.name;
    const blurb = document.createElement("div"); blurb.className = "muted"; blurb.textContent = m.blurb;
    const price = document.createElement("div"); price.className = "model-price"; price.dataset.model = m.id; price.textContent = m.priceNote;
    b.append(zone, name, blurb, price);
    if (!m.disabled) b.addEventListener("click", function () {
      selectedModel = m;
      grid.querySelectorAll(".model-card").forEach((el) => el.classList.remove("selected"));
      b.classList.add("selected");
      fillOptions();
    });
    grid.appendChild(b);
  });
  function fillOptions() {
    const d = document.getElementById("duration");
    const r = document.getElementById("resolution");
    d.innerHTML = ""; r.innerHTML = "";
    selectedModel.durations.forEach(function (s) {
      const o = document.createElement("option"); o.value = s; o.textContent = s === 30 ? "30 sec · PRO 🔒" : s + " sec"; d.appendChild(o);
    });
    if (selectedModel.durations.includes(10)) d.value = "10";
    selectedModel.resolutions.forEach(function (q) {
      const o = document.createElement("option"); o.value = q; o.textContent = q; r.appendChild(o);
    });
    if (selectedModel.resolutions.includes("720p")) r.value = "720p";
    document.getElementById("gen-note").textContent =
      selectedModel.id === "wan" ? "Cheap Zone: photo-led clips run on the free engine while your window is open — or on Seedance." : "";
    updateCost();
  }
  ["duration", "resolution"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", updateCost);
  });
  document.getElementById("image-url").addEventListener("input", updateCost);
  // Reference photo UPLOAD (Keyz, 2026-10-30): no URLs - the user picks a
  // file from any device (phone, tablet, PC, or cloud storage through the
  // OS picker); it lands in the bd-uploads bucket and the public link is
  // handed to the generator behind the scenes.
  const imgFile = document.getElementById("image-file");
  const imgName = document.getElementById("image-upload-name");
  const imgPrev = document.getElementById("image-preview");
  const imgClear = document.getElementById("image-clear-btn");
  document.getElementById("image-upload-btn").addEventListener("click", function () { imgFile.click(); });
  imgClear.addEventListener("click", function () {
    imgFile.value = "";
    document.getElementById("image-url").value = "";
    imgName.textContent = "No photo chosen";
    imgPrev.hidden = true; imgPrev.removeAttribute("src");
    imgClear.hidden = true;
    updateCost();
  });
  imgFile.addEventListener("change", async function () {
    const f = imgFile.files && imgFile.files[0];
    if (!f) return;
    if (!session) { imgName.textContent = "Sign in first, then upload your photo."; return; }
    imgName.textContent = "Uploading " + f.name + "…";
    const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = session.user.id + "/" + Date.now() + "." + ext;
    const up = await sb.storage.from("bd-uploads").upload(path, f, { contentType: f.type || "image/jpeg", upsert: true });
    if (up.error) { imgName.textContent = "Upload failed — " + up.error.message; return; }
    const pub = sb.storage.from("bd-uploads").getPublicUrl(path);
    document.getElementById("image-url").value = pub.data.publicUrl;
    imgName.textContent = "✓ " + f.name;
    imgPrev.src = pub.data.publicUrl; imgPrev.hidden = false;
    imgClear.hidden = false;
    updateCost();
  });
  fillOptions();

  // ---------- auth ----------
  const authToggle = document.getElementById("auth-toggle");
  authToggle.addEventListener("click", function () {
    authMode = authMode === "in" ? "up" : "in";
    document.getElementById("auth-title").textContent = authMode === "in" ? "Sign in" : "Create your account";
    document.getElementById("auth-sub").textContent = authMode === "in"
      ? "Welcome back. Your clips and credits live on your account."
      : "Make an account, grab a credit pack, and start generating. New accounts start at 0 credits.";
    document.getElementById("auth-submit").textContent = authMode === "in" ? "Sign In" : "Create Account";
    authToggle.textContent = authMode === "in" ? "New here? Create an account" : "Already have an account? Sign in";
    document.getElementById("auth-password").autocomplete = authMode === "in" ? "current-password" : "new-password";
    document.getElementById("auth-error").textContent = "";
  });
  authForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const err = document.getElementById("auth-error");
    err.textContent = "";
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    if (authMode === "up") {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) { err.textContent = "Could not create the account: " + error.message; return; }
      if (!data.session) {
        err.style.color = "#86efac";
        err.textContent = "Account made — check your email for the confirm link, then sign in.";
        return;
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { err.textContent = "Sign-in failed: " + error.message; return; }
    }
    refreshAuth();
  });
  signoutBtn.addEventListener("click", async function () {
    await sb.auth.signOut();
    window.location.reload();
  });
  buyBtn.addEventListener("click", function () {
    document.getElementById("buy-section").scrollIntoView({ behavior: "smooth" });
  });

  async function refreshAuth() {
    const { data } = await sb.auth.getSession();
    session = data.session;
    const inOk = !!session;
    authForm.classList.toggle("hidden", inOk);
    document.getElementById("showcase").classList.toggle("hidden", inOk);
    studio.classList.toggle("hidden", !inOk);
    signoutBtn.classList.toggle("hidden", !inOk);
    buyBtn.classList.toggle("hidden", !inOk);
    balanceChip.classList.toggle("hidden", !inOk);
    freeChip.classList.toggle("hidden", !inOk);
    document.getElementById("owner-panel").classList.toggle("hidden", !isOwner());
    if (inOk) {
      await loadProfile();
      loadJobs();
      loadMyOrders();
      if (isOwner()) loadOwner();
      loadPricing();
      startPolling();
    }
  }
  async function loadProfile() {
    if (!session) return;
    // refresh applies any due monthly plan grant (the free trial never resets)
    try {
      const out = await callFn("bd-credits", { action: "refresh" });
      if (out && out.profile) {
        profile = out.profile;
        if (typeof out.free_per_week === "number") freePerWeek = out.free_per_week;
        renderBalances();
        updateCost();
        return;
      }
    } catch (e) { /* fall through to a plain read */ }
    let { data } = await sb.from("bd_profiles").select("*").eq("user_id", session.user.id).single();
    if (!data) { // profile trigger can lag a beat on brand-new accounts
      await new Promise((r) => setTimeout(r, 1500));
      ({ data } = await sb.from("bd_profiles").select("*").eq("user_id", session.user.id).single());
    }
    profile = data || null;
    renderBalances();
    updateCost();
  }

  // ---------- function calls ----------
  function fnUrl(name) { return cfg.SUPABASE_URL + "/functions/v1/" + name; }
  async function callFn(name, body) {
    const res = await fetch(fnUrl(name), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + session.access_token,
        "apikey": cfg.SUPABASE_ANON_KEY
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ("Request failed (" + res.status + ")"));
    return data;
  }

  // ---------- generate ----------
  document.getElementById("generate-btn").addEventListener("click", async function () {
    const err = document.getElementById("gen-error");
    err.textContent = "";
    const prompt = document.getElementById("prompt").value.trim();
    if (!prompt) { err.textContent = "Write a prompt first."; return; }
    const btn = this;
    btn.disabled = true; btn.textContent = "Sending...";
    try {
      const out = await callFn("bd-generate", {
        model: selectedModel.id,
        prompt: prompt,
        duration: parseInt(document.getElementById("duration").value, 10),
        resolution: document.getElementById("resolution").value,
        aspect_ratio: document.getElementById("aspect").value,
        image_url: document.getElementById("image-url").value.trim() || null
      });
      if (profile && typeof out.balance === "number") profile.credits = out.balance;
      if (profile && typeof out.free_left === "number") profile.free_gens_used = Math.max(0, freePerWeek - out.free_left);
      renderBalances();
      document.getElementById("prompt").value = "";
      updateCost();
      await loadJobs();
    } catch (ex) {
      err.textContent = "Generate failed: " + ex.message;
      loadProfile();
    } finally {
      updateCost();
    }
  });

  // ---------- ai chat (DeepSeek, via bd-chat) ----------
  const chatHistory = [];
  const chatBox = document.getElementById("chat-messages");
  function appendChat(role, text) {
    const div = document.createElement("div");
    div.className = "chat-msg " + role;
    div.textContent = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    return div;
  }
  document.getElementById("chat-send").addEventListener("click", async function () {
    const errEl = document.getElementById("chat-error");
    errEl.textContent = "";
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) { errEl.textContent = "Write a message first."; return; }
    chatHistory.push({ role: "user", content: text });
    while (chatHistory.length > 20) chatHistory.shift();
    const userBubble = appendChat("user", text);
    input.value = "";
    const btn = this;
    btn.disabled = true; btn.textContent = "Thinking...";
    try {
      const out = await callFn("bd-chat", {
        messages: chatHistory.slice(),
        model: document.getElementById("chat-model").value
      });
      chatHistory.push({ role: "assistant", content: out.reply });
      appendChat("assistant", out.reply);
    } catch (ex) {
      // No reply came back (e.g. chat not live yet): drop the failed turn
      // from the history AND from the panel, so what the user sees always
      // matches what will be re-sent, and say it plainly in the panel.
      chatHistory.pop();
      if (userBubble) userBubble.remove();
      appendChat("system", ex.message);
    } finally {
      btn.disabled = false; btn.textContent = "Send";
    }
  });

  // ---------- jobs ----------
  let jobsCache = [];
  async function loadJobs() {
    const { data, error } = await sb.from("bd_jobs")
      .select("*").order("created_at", { ascending: false }).limit(30);
    if (error) return;
    jobsCache = data || [];
    renderJobs();
  }
  function renderJobs() {
    const box = document.getElementById("jobs");
    box.innerHTML = "";
    if (!jobsCache.length) {
      box.innerHTML = '<p class="hint">Nothing yet - your generations will land here.</p>';
      return;
    }
    jobsCache.forEach(function (j) {
      const div = document.createElement("div");
      div.className = "job";
      const head = document.createElement("div"); head.className = "job-head";
      const left = document.createElement("span");
      left.textContent = (j.model === "seedance" ? "Seedance 2.5" : j.model === "comfy" ? "Black Dragon FREE (Beta)" : "Wan") + " · " + (j.duration || "?") + "s · " + (j.resolution || "")
        + (j.free_gen ? " · FREE" : j.credits_charged ? " · " + j.credits_charged + " credits" : "")
        + (isOwner() && j.user_email && j.user_email !== session.user.email ? " · " + j.user_email : "");
      const st = document.createElement("span");
      st.className = "job-status " + (j.status === "done" ? "done" : j.status === "error" ? "error" : "");
      st.textContent = j.status.toUpperCase();
      head.append(left, st);
      const p = document.createElement("p"); p.className = "prompt"; p.textContent = j.prompt;
      div.append(head, p);
      if (j.status === "done" && j.video_url) {
        const v = document.createElement("video");
        v.src = j.video_url; v.controls = true; v.playsInline = true;
        const dl = document.createElement("p");
        const a = document.createElement("a");
        a.href = j.video_url; a.textContent = "Download clip"; a.setAttribute("download", "");
        dl.appendChild(a);
        div.append(v, dl);
      }
      if (j.status === "error" && j.error) {
        const e = document.createElement("p"); e.className = "form-error"; e.textContent = j.error;
        div.appendChild(e);
      }
      box.appendChild(div);
    });
  }

  // ---------- orders (buyer side) ----------
  let myOrdersCache = [];
  let hasPaidOrder = false;
  // PRO = owner, a plan holder, or anyone with a credited pack order.
  // 30-second clips are PRO-only (server enforces it too).
  function isProUser() {
    if (isOwner()) return true;
    if (profile && profile.plan && profile.plan !== "free") return true;
    return hasPaidOrder;
  }
  async function buyPack(packId) {
    try {
      const out = await callFn("bd-credits", { action: "create_order", pack_id: packId });
      showOrder(out.order);
      loadMyOrders();
    } catch (ex) {
      alert("Could not start the order: " + ex.message);
    }
  }
  async function buyPlan(planId) {
    try {
      const out = await callFn("bd-credits", { action: "create_order", plan_id: planId });
      showOrder(out.order);
      loadMyOrders();
    } catch (ex) {
      alert("Could not start the plan: " + ex.message);
    }
  }
  function showOrder(order) {
    if (!pricing || !order) return;
    const h = pricing.handles || {};
    document.getElementById("order-panel").classList.remove("hidden");
    document.getElementById("order-code").textContent = order.code;
    document.getElementById("order-amount").textContent = "$" + Number(order.amount_usd).toFixed(2) + (order.kind === "plan" ? " / month" : "");
    document.getElementById("order-credits").textContent = order.credits + " credits" + (order.kind === "plan" ? " every month" : "");
    const ca = document.getElementById("pay-cashapp");
    ca.href = "https://cash.app/" + (h.cashapp || "") + "/" + Number(order.amount_usd);
    const vm = document.getElementById("pay-venmo");
    vm.href = h.venmo_url || "#";
    document.getElementById("pay-chime-note").textContent = h.chime || "";
    document.getElementById("order-panel").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  async function loadMyOrders() {
    if (!session) return;
    const { data } = await sb.from("bd_orders").select("*")
      .eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(10);
    myOrdersCache = data || [];
    hasPaidOrder = myOrdersCache.some(function (o) { return o.status === "credited"; });
    updateCost();
    const box = document.getElementById("my-orders");
    box.innerHTML = "";
    if (!myOrdersCache.length) { box.innerHTML = '<p class="hint">No orders yet.</p>'; return; }
    const t = document.createElement("table"); t.className = "tbl";
    myOrdersCache.forEach(function (o) {
      const tr = document.createElement("tr");
      const c1 = document.createElement("td"); c1.textContent = o.code;
      const c2 = document.createElement("td"); c2.textContent = "$" + Number(o.amount_usd).toFixed(2) + " → " + o.credits + " cr" + (o.kind === "plan" ? " · plan" : "");
      const c3 = document.createElement("td");
      const chip = document.createElement("span"); chip.className = "status-chip " + o.status; chip.textContent = o.status;
      c3.appendChild(chip);
      tr.append(c1, c2, c3);
      t.appendChild(tr);
      if (o.status === "pending") tr.addEventListener("click", () => showOrder(o));
    });
    box.appendChild(t);
  }

  // ---------- owner panel ----------
  async function loadOwner() {
    if (!isOwner()) return;
    const { data: orders } = await sb.from("bd_orders").select("*")
      .eq("status", "pending").order("created_at", { ascending: true });
    const obox = document.getElementById("owner-orders");
    obox.innerHTML = "";
    if (!orders || !orders.length) { obox.innerHTML = '<p class="hint">None waiting.</p>'; }
    else {
      const t = document.createElement("table"); t.className = "tbl";
      orders.forEach(function (o) {
        const tr = document.createElement("tr");
        const c1 = document.createElement("td"); c1.textContent = o.email;
        const c2 = document.createElement("td"); c2.textContent = o.code + " · $" + Number(o.amount_usd).toFixed(2) + " → " + o.credits + " cr" + (o.kind === "plan" ? " · PLAN " + (o.plan_id || "") : "");
        const c3 = document.createElement("td");
        const ok = document.createElement("button");
        ok.className = "btn btn-gold btn-small"; ok.type = "button"; ok.textContent = "Paid — credit it";
        ok.addEventListener("click", async function () {
          ok.disabled = true;
          try { await callFn("bd-credits", { action: "confirm_order", order_id: o.id }); loadOwner(); if (o.user_id === session.user.id) { loadProfile(); loadMyOrders(); } }
          catch (ex) { alert(ex.message); ok.disabled = false; }
        });
        const no = document.createElement("button");
        no.className = "btn btn-ghost btn-small"; no.type = "button"; no.textContent = "Cancel";
        no.addEventListener("click", async function () {
          try { await callFn("bd-credits", { action: "cancel_order", order_id: o.id }); loadOwner(); }
          catch (ex) { alert(ex.message); }
        });
        c3.append(ok, document.createTextNode(" "), no);
        tr.append(c1, c2, c3);
        t.appendChild(tr);
      });
      obox.appendChild(t);
    }
    const { data: users } = await sb.from("bd_profiles").select("*").order("created_at", { ascending: true });
    const ubox = document.getElementById("owner-users");
    ubox.innerHTML = "";
    const t2 = document.createElement("table"); t2.className = "tbl";
    (users || []).forEach(function (u) {
      const tr = document.createElement("tr");
      const c1 = document.createElement("td"); c1.textContent = u.email;
      const c2 = document.createElement("td"); c2.textContent = u.credits + " cr · " + (u.plan || "free");
      const c3 = document.createElement("td");
      const inp = document.createElement("input");
      inp.type = "number"; inp.placeholder = "credits"; inp.min = "1";
      const add = document.createElement("button");
      add.className = "btn btn-gold btn-small"; add.type = "button"; add.textContent = "Add";
      const sub = document.createElement("button");
      sub.className = "btn btn-ghost btn-small"; sub.type = "button"; sub.textContent = "Remove";
      const doAdjust = async function (sign) {
        const n = parseInt(inp.value || "0", 10);
        if (!n) return;
        try { await callFn("bd-credits", { action: "adjust", email: u.email, delta: sign * n }); loadOwner(); if (u.user_id === session.user.id) loadProfile(); }
        catch (ex) { alert(ex.message); }
      };
      add.addEventListener("click", () => doAdjust(1));
      sub.addEventListener("click", () => doAdjust(-1));
      c3.append(inp, document.createTextNode(" "), add, document.createTextNode(" "), sub);
      tr.append(c1, c2, c3);
      t2.appendChild(tr);
    });
    ubox.appendChild(t2);
  }
  document.getElementById("price-save").addEventListener("click", async function () {
    const msg = document.getElementById("price-msg");
    msg.textContent = "";
    try {
      await callFn("bd-credits", {
        action: "set_pricing",
        wan_720_per_sec: parseInt(document.getElementById("price-wan720").value, 10),
        wan_1080_per_sec: parseInt(document.getElementById("price-wan1080").value, 10),
        seedance_480_per_sec: parseInt(document.getElementById("price-seed480").value, 10),
        seedance_720_per_sec: parseInt(document.getElementById("price-seed720").value, 10),
        free_gens_per_week: parseInt(document.getElementById("price-freegens").value, 10),
        free_max_seconds: parseInt(document.getElementById("price-freemax").value, 10)
      });
      msg.style.color = "#86efac";
      msg.textContent = "Prices saved — the whole app uses them now.";
      loadPricing();
    } catch (ex) {
      msg.style.color = "";
      msg.textContent = ex.message;
    }
  });

  // ---------- polling ----------
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async function () {
      const pending = jobsCache.filter((j) => j.status === "queued" || j.status === "running");
      for (const j of pending) {
        try { await callFn("bd-status", { job_id: j.id }); } catch (e) { /* keep polling */ }
      }
      if (pending.length) { loadJobs(); loadProfile(); }
      if (myOrdersCache.some((o) => o.status === "pending")) { loadMyOrders(); loadProfile(); }
      if (isOwner()) loadOwner();
    }, 12000);
  }

  document.getElementById("pub-cta").addEventListener("click", scrollToAuth);

  loadPricing();
  refreshAuth();
})();
