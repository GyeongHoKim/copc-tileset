/**
 * Registers the COPC Service Worker that serves on-the-fly tiles. Call this once
 * during app startup, before creating a {@link CopcPointCloudPrimitive}. `scriptUrl`
 * points at the bundled `copc-sw` worker — with Vite, that is typically
 * `new URL("@gyeonghokim/copc-tileset/copc-sw", import.meta.url)`.
 *
 * The worker must be served from your app's origin (Service Worker scope rules),
 * so it is registered by the app, not bundled into the library's main entry.
 *
 * Virtual tile URLs are origin-absolute (`/__copc-tileset__/...`), so the worker
 * must control the origin root. This defaults `scope` to `"/"`; if the worker is
 * served from a sub-path, your host must send `Service-Worker-Allowed: /` for the
 * broadened scope to be accepted.
 */
export async function registerCopcServiceWorker(
  scriptUrl: string | URL,
  options: RegistrationOptions = {},
): Promise<ServiceWorkerRegistration> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    throw new Error("copc-tileset: Service Workers are not available in this environment");
  }
  const registration = await navigator.serviceWorker.register(scriptUrl, {
    type: "module",
    scope: "/",
    ...options,
  });
  await navigator.serviceWorker.ready;
  return registration;
}
