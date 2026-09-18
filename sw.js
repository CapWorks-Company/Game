// Service worker minimal : suffisant pour rendre le site installable (Chrome/Android/Bureau)
// et garder une copie de secours de l'app shell en cas de coupure réseau ponctuelle.
// Le jeu a de toute façon besoin d'internet pour le WebSocket — ceci ne rend pas
// les parties jouables hors-ligne, juste l'écran d'accueil affichable.
const CACHE_NAME = "capnaval-shell-v1";
const SHELL_FILES = ["./", "./index.html", "./style.css", "./app.js", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
