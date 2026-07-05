// ══════════════════════════════════════
//  SafeHer — pwa.js
//  Registers the service worker and
//  handles the "Add to Home Screen" prompt
// ══════════════════════════════════════

// ── 1. Register Service Worker ──
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then(() => console.log("Service Worker registered"))
      .catch(console.error);
  });
}

// ── 2. Catch the install prompt (Android Chrome) ──
//  We save the event so we can show our own
//  "Install App" button at the right moment.
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // stop the automatic browser popup
  deferredInstallPrompt = e;

  // Show our custom install banner if it exists on the page
  const banner = document.getElementById("pwa-install-banner");
  if (banner) banner.style.display = "flex";
});

// ── 3. Install button handler ──
//  Call this from your "Install App" button's onclick
window.installPWA = function () {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then((result) => {
    console.log("[SafeHer] Install result:", result.outcome);
    deferredInstallPrompt = null;
    const banner = document.getElementById("pwa-install-banner");
    if (banner) banner.style.display = "none";
  });
};

// ── 4. Hide banner if already installed ──
window.addEventListener("appinstalled", () => {
  console.log("[SafeHer] App installed successfully!");
  const banner = document.getElementById("pwa-install-banner");
  if (banner) banner.style.display = "none";
  deferredInstallPrompt = null;
});
