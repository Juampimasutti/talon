const CACHE = "talon-shell-v4"; // el mismo nombre que SHELL_CACHE en submit.ts
const SHELL = ["/", "/ingreso", "/estacion", "/reparto", "/marca/icon-192.png"];

function provisorioHtml() {
  return `<!doctype html>
<html lang="es-AR">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comprobante provisorio</title>
<body style="margin:0;font-family:Segoe UI,Arial,Helvetica,sans-serif;color:#1c1917;background:#fff">
<article style="max-width:36rem;margin:0 auto;padding:1.5rem">
  <p><a href="/estacion">Volver a la estación</a></p>
  <div id="doc"><p>Abriendo el comprobante provisorio…</p></div>
</article>
<script>
(function () {
  var raw = null;
  try { raw = localStorage.getItem("talon-last-receipt") || sessionStorage.getItem("talon-last-receipt"); } catch (e) {}
  var doc = document.getElementById("doc");
  if (!raw) {
    doc.innerHTML = "<p>No hay un comprobante provisorio en este dispositivo.</p>";
    return;
  }
  var receipt;
  try { receipt = JSON.parse(raw); } catch (e) { receipt = null; }
  if (!receipt || receipt.fiscal !== "provisorio") {
    doc.innerHTML = "<p>No hay un comprobante provisorio en este dispositivo.</p>";
    return;
  }
  var issued = String(receipt.issuedOn || "");
  var parts = issued.slice(0, 10).split("-");
  if (parts.length === 3 && parts[0].length === 4) issued = parts[2] + "/" + parts[1] + "/" + parts[0];
  var money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
  var lines = (receipt.lines || []).map(function (line) {
    return "<tr><td>" + line.description + "</td><td>" + line.quantity + "</td><td style=\\"text-align:right\\">" + money.format((line.totalCents || 0) / 100) + "</td></tr>";
  }).join("");
  doc.innerHTML = "<p style=\\"letter-spacing:.08em;text-transform:uppercase;font-size:.75rem\\">Sin validez fiscal</p>"
    + "<h1>Comprobante provisorio</h1>"
    + "<p>" + receipt.localNumber + " · " + issued + "</p>"
    + "<p>" + receipt.partyName + "</p>"
    + "<table style=\\"width:100%\\"><thead><tr><th style=\\"text-align:left\\">Detalle</th><th style=\\"text-align:left\\">Cant.</th><th style=\\"text-align:right\\">Total</th></tr></thead><tbody>"
    + lines + "</tbody></table>"
    + "<p style=\\"display:flex;justify-content:space-between;font-size:1.25rem\\"><span>Total</span><span>" + money.format((receipt.totalCents || 0) / 100) + "</span></p>"
    + "<p>Provisorio. No tiene CAE ni número fiscal. Se numera cuando vuelve la conexión.</p>";
})();
</script>
</body>
</html>`;
}

function provisorioResponse() {
  return new Response(provisorioHtml(), { headers: { "content-type": "text/html; charset=utf-8" } });
}

function cleanDocument(html) {
  return !html.includes("nextjs-portal") && !html.includes("data-nextjs-dev-overlay");
}

async function putCleanDocument(cache, path) {
  const response = await fetch(path, { headers: { accept: "text/html" } });
  if (!response.ok) return;
  const copy = response.clone();
  const html = await response.text();
  if (!cleanDocument(html)) return;
  await cache.put(path, copy);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(["/marca/icon-192.png"]).catch(() => undefined);
    for (const path of SHELL) {
      if (path.startsWith("/marca/")) continue;
      try { await putCleanDocument(cache, path); } catch { /* el documento de dev no se guarda */ }
    }
    await cache.put("/provisorio", provisorioResponse());
    try {
      const list = await fetch("/shell-assets.json");
      if (list.ok) {
        const assets = await list.json();
        await Promise.all(assets.map(async (url) => {
          try {
            const response = await fetch(url);
            if (response.ok) await cache.put(url, response);
          } catch { /* un chunk que falte no frena al resto */ }
        }));
      }
    } catch { /* en dev todavía no hay manifest */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

async function cachedStatic(request) {
  return caches.match(request);
}

async function cachedDocument(pathname) {
  return (await caches.match(pathname)) || null;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === "/provisorio") {
    event.respondWith((async () => {
      const cached = await caches.match("/provisorio");
      if (navigator.onLine === false) return cached || provisorioResponse();
      try {
        const response = await fetch(request, { signal: AbortSignal.timeout(2000) });
        if (response.ok) return response;
      } catch { /* el provisorio precacheado no espera sesión */ }
      return cached || provisorioResponse();
    })());
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/marca/")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cachedStatic(request);
      if (navigator.onLine === false) return cached || new Response("Sin conexión", { status: 503 });
      const refresh = fetch(request).then((response) => {
        if (response.ok) void cache.put(request, response.clone());
        return response;
      }).catch(() => null);
      if (cached) {
        void refresh;
        return cached;
      }
      const response = await refresh;
      return response || new Response("Sin conexión", { status: 503 });
    })());
    return;
  }

  const shellApi = url.pathname === "/api/auth/me" || url.pathname === "/api/catalogos" || url.pathname === "/api/sync/referencia" || url.pathname === "/api/estacion" || url.pathname.startsWith("/api/estacion/");
  if (request.mode === "navigate" || shellApi) {
    event.respondWith((async () => {
      if (navigator.onLine === false) {
        const cached = request.mode === "navigate" ? await cachedDocument(url.pathname) : await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const home = await cachedDocument("/estacion");
          if (home) return home;
        }
        if (shellApi) return new Response(JSON.stringify({ ok: false, error: "Sin conexión" }), { status: 503, headers: { "content-type": "application/json" } });
        return new Response("Sin conexión", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      try {
        const response = await fetch(request);
        if (response.ok && response.status < 400) {
          if (request.mode === "navigate") {
            const copy = response.clone();
            const html = await response.clone().text();
            if (cleanDocument(html)) {
              const cache = await caches.open(CACHE);
              await cache.put(url.pathname, copy);
            }
          } else if (shellApi) {
            const cache = await caches.open(CACHE);
            await cache.put(request, response.clone());
          }
        }
        return response;
      } catch {
        const cached = request.mode === "navigate" ? await cachedDocument(url.pathname) : await caches.match(request);
        if (cached) return cached;
        if (shellApi) return new Response(JSON.stringify({ ok: false, error: "Sin conexión" }), { status: 503, headers: { "content-type": "application/json" } });
        return new Response("Sin conexión", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    })());
  }
});
