// Service Worker entry point. Intercepts virtual COPC tile requests and serves
// on-the-fly tileset JSON / pnts from the COPC source over range requests. Build
// and register this with your app bundler (see registerCopcServiceWorker); it is
// browser-only and therefore not exercised by the Node test suite.

import { CopcProvider } from "../CopcProvider";
import { CopcTileStore } from "../copcTileStore";
import { handleCopcRequest } from "./handler";
import { VIRTUAL_PREFIX } from "./scheme";

interface FetchEvent {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}
interface ExtendableEvent {
  waitUntil(promise: Promise<unknown>): void;
}
interface ServiceWorkerScope {
  addEventListener(type: "install", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "activate", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
}

declare const self: ServiceWorkerScope;

// One store per COPC source, keyed by URL. The promise is cached so concurrent
// requests share a single provider/hierarchy load.
const stores = new Map<string, Promise<CopcTileStore>>();

function storeFor(copcUrl: string): Promise<CopcTileStore> {
  let store = stores.get(copcUrl);
  if (!store) {
    store = CopcProvider.fromUrl(copcUrl).then((provider) => new CopcTileStore(provider));
    stores.set(copcUrl, store);
  }
  return store;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const { pathname } = new URL(event.request.url);
  if (!pathname.startsWith(VIRTUAL_PREFIX)) return; // not ours — let the browser handle it
  event.respondWith(
    handleCopcRequest(event.request.url, storeFor).then(
      (response) => response ?? new Response("Not found", { status: 404 }),
    ),
  );
});
