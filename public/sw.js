const SHELL_CACHE = "rankpilot-shell-v1";
const REPORT_CACHE = "rankpilot-reports-v1";
const OFFLINE_URLS = ["/en/offline", "/bn/offline", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(OFFLINE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== REPORT_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Cache last-viewed report pages and dashboard summaries for offline inspection
  const isReportOrDashboard =
    url.pathname.includes("/reports") || url.pathname.includes("/dashboard");

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && isReportOrDashboard) {
            const clone = response.clone();
            caches.open(REPORT_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cachedReport = await caches.match(request);
          if (cachedReport) return cachedReport;
          const isBn = url.pathname.startsWith("/bn");
          const fallback = await caches.match(isBn ? "/bn/offline" : "/en/offline");
          return (
            fallback ||
            new Response("Offline — Reconnect to use RankPilot.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }),
    );
  }
});
