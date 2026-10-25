// BLACK DRAGON AI - studio logic.
(function () {
  const cfg = window.BD_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const loginForm = document.getElementById("login-form");
  const studio = document.getElementById("studio");
  const signoutBtn = document.getElementById("signout-btn");
  let session = null;
  let selectedModel = cfg.MODELS[0];
  let pollTimer = null;

  // ---------- models ----------
  const grid = document.getElementById("model-grid");
  cfg.MODELS.forEach(function (m) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "model-card" + (m.disabled ? " disabled" : "") + (m === selectedModel ? " selected" : "");
    const zone = document.createElement("span"); zone.className = "model-zone"; zone.textContent = m.zone;
    const name = document.createElement("div"); name.className = "model-name"; name.textContent = m.name;
    const blurb = document.createElement("div"); blurb.className = "muted"; blurb.textContent = m.blurb;
    const price = document.createElement("div"); price.className = "model-price"; price.textContent = m.priceNote;
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
      const o = document.createElement("option"); o.value = s; o.textContent = s + " sec"; d.appendChild(o);
    });
    if (selectedModel.durations.includes(10)) d.value = "10";
    selectedModel.resolutions.forEach(function (q) {
      const o = document.createElement("option"); o.value = q; o.textContent = q; r.appendChild(o);
    });
    if (selectedModel.resolutions.includes("720p")) r.value = "720p";
    document.getElementById("gen-note").textContent =
      selectedModel.id === "wan" ? "Cheap Zone: reference image is ignored here - use Seedance for image-led clips." : "";
  }
  fillOptions();

  // ---------- auth ----------
  async function refreshAuth() {
    const { data } = await sb.auth.getSession();
    session = data.session;
    const inOk = !!session;
    loginForm.classList.toggle("hidden", inOk);
    studio.classList.toggle("hidden", !inOk);
    signoutBtn.classList.toggle("hidden", !inOk);
    if (inOk) { loadJobs(); startPolling(); }
  }
  loginForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const err = document.getElementById("login-error");
    err.textContent = "";
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { err.textContent = "Sign-in failed: " + error.message; return; }
    refreshAuth();
  });
  signoutBtn.addEventListener("click", async function () {
    await sb.auth.signOut();
    window.location.reload();
  });

  // ---------- jobs ----------
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

  document.getElementById("generate-btn").addEventListener("click", async function () {
    const err = document.getElementById("gen-error");
    err.textContent = "";
    const prompt = document.getElementById("prompt").value.trim();
    if (!prompt) { err.textContent = "Write a prompt first."; return; }
    const btn = this;
    btn.disabled = true; btn.textContent = "Sending...";
    try {
      await callFn("bd-generate", {
        model: selectedModel.id,
        prompt: prompt,
        duration: parseInt(document.getElementById("duration").value, 10),
        resolution: document.getElementById("resolution").value,
        aspect_ratio: document.getElementById("aspect").value,
        image_url: document.getElementById("image-url").value.trim() || null
      });
      document.getElementById("prompt").value = "";
      await loadJobs();
    } catch (ex) {
      err.textContent = "Generate failed: " + ex.message;
    } finally {
      btn.disabled = false; btn.textContent = "Generate";
    }
  });

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
      left.textContent = (j.model === "seedance" ? "Seedance 2.5" : "Wan") + " · " + (j.duration || "?") + "s · " + (j.resolution || "");
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
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async function () {
      const pending = jobsCache.filter((j) => j.status === "queued" || j.status === "running");
      for (const j of pending) {
        try { await callFn("bd-status", { job_id: j.id }); } catch (e) { /* keep polling */ }
      }
      if (pending.length) loadJobs();
    }, 12000);
  }

  refreshAuth();
})();
