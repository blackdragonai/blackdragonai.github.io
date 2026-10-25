// PWA: register the service worker; auto-reload once when a new build takes over.
if ("serviceWorker" in navigator) {
  let bdRefreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (bdRefreshing) return;
    bdRefreshing = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js")
      .then((reg) => { reg.update().catch(() => {}); })
      .catch(() => {});
  });
}
let bdDeferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  bdDeferredPrompt = e;
  if (document.getElementById("bd-install-btn")) return;
  const btn = document.createElement("button");
  btn.id = "bd-install-btn";
  btn.textContent = "Install BLACK DRAGON AI";
  btn.setAttribute("style",
    "position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:9999;" +
    "background:#d8d8d8;color:#000;border:none;border-radius:999px;" +
    "padding:12px 22px;font-weight:800;font-size:15px;box-shadow:0 6px 24px rgba(0,0,0,.6);cursor:pointer;");
  btn.addEventListener("click", async () => {
    btn.remove();
    if (bdDeferredPrompt) { bdDeferredPrompt.prompt(); await bdDeferredPrompt.userChoice; bdDeferredPrompt = null; }
  });
  document.body.appendChild(btn);
});
