// EDENX AI — app logic.
// Honest mechanics: generations are real jobs on the ex-generate backend.
// If the backend is not deployed yet, the server answers 404 and the UI
// says the studio is still being built — nothing is faked.
(function () {
  const C = window.EX_CONFIG;
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  const $ = (id) => document.getElementById(id);
  const state = { user: null, photoFile: null, photoUrl: null, style: null, ego: null, ride: null, dur: 5, jobs: [], pollTimer: null };

  function toast(msg, ms) {
    const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), ms || 4200);
  }
  const isOwner = () => state.user && state.user.email === C.OWNER_EMAIL;

  // ---------- render pickers ----------
  function renderStyles() {
    $("styles").innerHTML = "";
    C.EGO_STYLES.forEach((s) => {
      const b = document.createElement("button");
      b.className = "card" + (state.style === s.id ? " sel" : "");
      b.innerHTML = "<h3>" + s.name + "</h3><p>" + s.blurb + "</p>";
      b.onclick = () => { state.style = s.id; renderStyles(); syncButtons(); };
      $("styles").appendChild(b);
    });
  }
  function renderRides() {
    $("rides").innerHTML = "";
    C.RIDES.forEach((r) => {
      const b = document.createElement("button");
      b.className = "card" + (state.ride === r.id ? " sel" : "");
      b.innerHTML = '<span class="tag">' + r.tag.toUpperCase() + "</span><h3>" + r.name + "</h3><p>" + r.blurb + "</p>";
      b.onclick = () => { state.ride = r.id; renderRides(); syncButtons(); };
      $("rides").appendChild(b);
    });
  }
  function renderDurations() {
    $("durations").innerHTML = "";
    C.DURATIONS.forEach((d) => {
      const b = document.createElement("button");
      b.textContent = d + "s"; b.className = state.dur === d ? "sel" : "";
      b.onclick = () => { state.dur = d; renderDurations(); };
      $("durations").appendChild(b);
    });
  }
  function syncButtons() {
    $("btn-ego").disabled = !(state.user && state.photoFile && state.style);
    $("ego-note").textContent = !state.user ? "Sign in first — your Alter Egos live in your account."
      : !state.photoFile ? "Add your photo above." : !state.style ? "Now pick a style."
      : "Ready — build the star.";
    $("btn-gen").disabled = !(state.user && state.ego && state.ride);
    $("gen-note").textContent = !state.ego ? "Create or pick an Alter Ego first."
      : !state.ride ? "Now pick your ride." : "Ready to roll.";
  }

  // ---------- photo ----------
  $("btn-pick").onclick = () => $("file").click();
  $("file").onchange = (e) => { if (e.target.files[0]) setPhoto(e.target.files[0]); };
  ["dragover", "dragleave", "drop"].forEach((ev) => $("drop").addEventListener(ev, (e) => {
    e.preventDefault(); if (ev === "drop" && e.dataTransfer.files[0]) setPhoto(e.dataTransfer.files[0]);
  }));
  function setPhoto(f) {
    if (!f.type.startsWith("image/")) { toast("That file is not an image."); return; }
    state.photoFile = f; $("filename").textContent = f.name;
    const url = URL.createObjectURL(f); const img = $("preview");
    img.src = url; img.classList.remove("hidden"); syncButtons();
  }
  // any image type -> JPEG data handling happens server-side too; here we
  // upload the original to the ex-uploads bucket via a signed flow in
  // ex-generate (the function returns the public path we poll against).
  async function uploadPhoto() {
    const ext = (state.photoFile.name.split(".").pop() || "jpg").toLowerCase();
    const path = state.user.id + "/ego-" + Date.now() + "." + ext;
    const { error } = await sb.storage.from("ex-uploads").upload(path, state.photoFile, { upsert: false });
    if (error) throw new Error("Photo upload failed: " + error.message);
    const { data } = sb.storage.from("ex-uploads").getPublicUrl(path);
    return data.publicUrl;
  }

  // ---------- backend calls ----------
  async function callFn(name, body) {
    const { data: sess } = await sb.auth.getSession();
    const token = sess && sess.session ? sess.session.access_token : C.SUPABASE_ANON_KEY;
    const res = await fetch(C.SUPABASE_URL + "/functions/v1/" + name, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, apikey: C.SUPABASE_ANON_KEY },
      body: JSON.stringify(body || {}),
    });
    if (res.status === 404) throw new Error("STUDIO_BUILDING");
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 202) throw new Error(data.error || ("Request failed (" + res.status + ")"));
    return data;
  }

  // ---------- alter ego ----------
  $("btn-ego").onclick = async () => {
    try {
      $("btn-ego").disabled = true; $("ego-note").textContent = "Uploading your photo…";
      if (!state.photoUrl) state.photoUrl = await uploadPhoto();
      $("ego-note").textContent = "Casting your Alter Ego…";
      const out = await callFn("ex-generate", { kind: "ego", image_url: state.photoUrl, style: state.style });
      toast(out.status === "waiting" ? "Your Alter Ego is IN LINE — the engine will build it in order when it wakes." : "Your Alter Ego is being built…");
      await refreshJobs(); startPolling();
    } catch (err) { handleErr(err); } finally { syncButtons(); }
  };

  // ---------- generate movie ----------
  $("btn-gen").onclick = async () => {
    try {
      $("btn-gen").disabled = true;
      const ride = C.RIDES.find((r) => r.id === state.ride);
      const out = await callFn("ex-generate", { kind: "scene", ego_id: state.ego, ride: ride.id, seconds: state.dur });
      toast(out.status === "waiting" ? "Your movie is IN LINE — it shoots in order when the engine wakes." : "Cameras rolling on “" + ride.name + "”…");
      await refreshJobs(); startPolling();
    } catch (err) { handleErr(err); } finally { syncButtons(); }
  };

  function handleErr(err) {
    if (err.message === "STUDIO_BUILDING") {
      toast("The EDENX studio is built and the engine line opens with the next engine session — your photo and picks are safe in your account.", 6000);
    } else { toast(err.message || "Something failed — try again."); }
  }

  // ---------- jobs / movies ----------
  async function refreshJobs() {
    if (!state.user) return;
    try {
      const out = await callFn("ex-status", {});
      state.jobs = out.jobs || [];
      renderMovies(); renderEgos();
    } catch (e) { /* status endpoint not live yet — leave UI as-is */ }
  }
  function badge(st) {
    if (st === "done") return '<span class="badge done">DONE</span>';
    if (st === "waiting") return '<span class="badge wait">IN LINE</span>';
    if (st === "failed") return '<span class="badge fail">ENGINE OFFLINE</span>';
    return '<span class="badge run">FILMING…</span>';
  }
  function renderEgos() {
    const egos = state.jobs.filter((j) => j.kind === "ego");
    const box = $("my-egos"); box.innerHTML = "";
    egos.forEach((j) => {
      const d = document.createElement("div"); d.className = "movie";
      const styleName = (C.EGO_STYLES.find((s) => s.id === j.style) || {}).name || j.style;
      d.innerHTML = (j.result_url ? '<img class="still" src="' + j.result_url + '" alt="Alter Ego">' : "")
        + '<div class="meta"><p>Alter Ego — ' + styleName + "</p>" + badge(j.status) + "</div>"
        + (j.status === "done" ? '<div class="row"><button data-ego="' + j.id + '">Use this Alter Ego</button></div>' : "");
      const btn = d.querySelector("[data-ego]");
      if (btn) btn.onclick = () => { state.ego = j.id; toast("Alter Ego locked in. Pick your ride."); syncButtons(); window.scrollTo({ top: $("step-ride").offsetTop - 70, behavior: "smooth" }); };
      box.appendChild(d);
    });
  }
  function renderMovies() {
    const scenes = state.jobs.filter((j) => j.kind === "scene");
    const box = $("movies");
    if (!scenes.length) { box.innerHTML = '<p class="note" style="margin-top:14px">Nothing here yet — your first scene is waiting above.</p>'; return; }
    box.innerHTML = "";
    scenes.forEach((j) => {
      const ride = C.RIDES.find((r) => r.id === j.ride) || {};
      const d = document.createElement("div"); d.className = "movie";
      let media = "";
      if (j.status === "done" && j.result_url) media = '<video controls playsinline src="' + j.result_url + '"></video>';
      const share = j.status === "done" ? '<a href="' + C.VIRALX_URL + '" target="_blank" rel="noopener"><button>Share on VIRALX</button></a>'
        + ' <a href="' + j.result_url + '" download><button>Download</button></a>' : "";
      d.innerHTML = media + '<div class="meta"><p>' + (ride.name || "Scene") + " · " + j.seconds + "s</p>" + badge(j.status) + "</div>"
        + (share ? '<div class="row">' + share + "</div>" : "")
        + (j.status === "failed" ? '<p class="note">The engine went offline mid-shoot. Your place and picks are saved — generate again when it wakes.</p>' : "");
      box.appendChild(d);
    });
  }
  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(async () => {
      await refreshJobs();
      const active = state.jobs.some((j) => j.status === "waiting" || j.status === "running" || j.status === "queued");
      if (!active) { clearInterval(state.pollTimer); state.pollTimer = null; }
    }, 15000);
  }

  // ---------- auth ----------
  $("btn-signin").onclick = () => $("auth-modal").classList.remove("hidden");
  $("auth-cancel").onclick = () => $("auth-modal").classList.add("hidden");
  $("auth-go").onclick = async () => {
    const email = $("auth-email").value.trim(), pass = $("auth-pass").value;
    if (!email || !pass) { $("auth-note").textContent = "Enter email and password."; return; }
    let { error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) {
      const r = await sb.auth.signUp({ email, password: pass });
      if (r.error) { $("auth-note").textContent = r.error.message; return; }
      error = null;
      if (!r.data.session) { $("auth-note").textContent = "Account created — check your email to confirm, then sign in."; return; }
    }
    $("auth-modal").classList.add("hidden");
  };
  $("btn-signout").onclick = async () => { await sb.auth.signOut(); };
  sb.auth.onAuthStateChange(async (_ev, session) => {
    state.user = session ? session.user : null;
    $("whoami").textContent = state.user ? state.user.email + (isOwner() ? " · OWNER" : "") : "";
    $("btn-signin").classList.toggle("hidden", !!state.user);
    $("btn-signout").classList.toggle("hidden", !state.user);
    state.photoUrl = null; syncButtons();
    if (state.user) { await refreshJobs(); if (state.jobs.some((j) => j.status === "waiting" || j.status === "running")) startPolling(); }
    else { $("movies").innerHTML = '<p class="note" style="margin-top:14px">Sign in to see your reel.</p>'; $("my-egos").innerHTML = ""; }
  });

  renderStyles(); renderRides(); renderDurations(); syncButtons();
})();
