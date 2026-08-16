// Demo-only Service Worker. Wraps `fetch` to measure how many bytes the COPC
// range requests actually pull, then hands off to the library's worker.
//
// Why here and not in the library: the transfer readout is a demo instrument, so
// it has no business in the published package's API. Everything it needs is
// reachable from outside — the worker's range requests go through global `fetch`
// — so a wrapper is enough and src/ stays untouched.
//
// This is a CLASSIC service worker, registered with `{ type: "classic" }`, for
// two reasons that both matter:
//
//   1. The patch must be installed BEFORE the library worker is evaluated, because
//      copc.js pulls in cross-fetch, which captures a reference to `fetch` at
//      module load and keeps using it. `importScripts()` is synchronous, so the
//      ordering is guaranteed. A module worker cannot do this: static imports are
//      hoisted (they would run first) and top-level await is forbidden in service
//      workers, so `await import(...)` fails with "ServiceWorker cannot be started".
//   2. Listeners must be registered during the worker's initial, synchronous
//      evaluation. `importScripts()` keeps the library worker's install/activate/
//      fetch handlers inside that window; a deferred import would miss `install`.
//
// dist/copc-sw.js is a fully self-contained bundle with no top-level import or
// export statements, which is what makes it loadable as a classic script.

let bytes = 0;
let requests = 0;
// Identifies this worker instance. The browser terminates an idle Service Worker
// and these counters die with it, restarting from zero — the page watches this
// value to notice that and carry the previous figures forward.
const instanceId = crypto.randomUUID();

const nativeFetch = self.fetch.bind(self);

self.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  // 206 Partial Content is exactly the range reads we want to measure; the WASM
  // and anything else come back 200. Content-Length on a 206 is the slice size,
  // so no body reading is needed — and it stays readable cross-origin because it
  // is a CORS-safelisted response header.
  if (response.status === 206) {
    requests += 1;
    bytes += Number(response.headers.get("content-length") ?? 0);
    void broadcast();
  }
  return response;
};

const snapshot = () => ({ bytes, requests, instanceId });

async function broadcast() {
  for (const client of await self.clients.matchAll()) {
    client.postMessage({ type: "copc-transfer-stats", stats: snapshot() });
  }
}

self.addEventListener("message", (event) => {
  const type = event.data?.type;
  const reply = event.ports[0];
  if (type === "copc-transfer-stats") {
    reply?.postMessage(snapshot());
  } else if (type === "copc-reset-transfer-stats") {
    bytes = 0;
    requests = 0;
    reply?.postMessage(snapshot());
  }
});

// Hand off to the library worker, which registers its own install/activate/fetch
// listeners and does all the actual tile serving.
importScripts("./copc-sw.js");
