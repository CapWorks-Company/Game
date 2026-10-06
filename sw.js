// Service worker : app shell installable + MODE HORS-LIGNE pour le Solo.
// Les mini-jeux solo vivent entièrement dans le navigateur : une fois le site
// chargé une fois en ligne, tout (page, scripts, styles, icônes, polices) est
// servi depuis le cache. Duo / Multi / Fight restent bien sûr en ligne.
//
// IMPORTANT : à chaque déploiement qui doit déclencher le bouton "Mettre à jour"
// côté client, change la valeur de CACHE_NAME (ex: v3 -> v4).
const CACHE_NAME = "capnaval-shell-v6";
const SHELL_FILES = [
  "./", "./index.html", "./style.css", "./app.js", "./games2.js", "./manifest.json",
  "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-512-maskable.png",
  "./previews/solo-crab.webp",
  "./previews/solo-tubes.webp",
  "./previews/solo-2048.webp",
  "./previews/solo-memory.webp",
  "./previews/solo-snake.webp",
  "./previews/solo-taquin.webp",
  "./previews/solo-morpion.webp",
  "./previews/solo-flappy.webp",
  "./previews/solo-sudoku.webp",
  "./previews/solo-mines.webp",
  "./previews/solo-breakout.webp",
  "./previews/solo-simon.webp",
  "./previews/solo-peche.webp",
  "./previews/solo-magic.webp",
  "./previews/solo-darts.webp",
  "./previews/solo-lights.webp",
  "./previews/solo-ice.webp",
  "./previews/solo-dolphin.webp",
  "./previews/solo-bubbles.webp",
  "./previews/solo-rubik.webp",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Un fichier manquant ne doit pas faire échouer tout le précache.
      Promise.all(SHELL_FILES.map((f) => cache.add(f).catch(() => {})))
    )
  );
  // Pas de skipWaiting() : la nouvelle version attend le clic sur "Mettre à jour".
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (url.hostname.endsWith("onrender.com")) return; // backend : jamais en cache
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Met à jour le cache au fil de l'eau (page, scripts, polices, CDN du QR code…).
        if (res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) =>
          hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined) || Response.error()
        )
      )
  );
});
