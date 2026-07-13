/**
 * Registers the COPC Service Worker that serves on-the-fly tiles. Call this once
 * during app startup, before creating a {@link CopcPointCloudPrimitive}. `scriptUrl`
 * points at the bundled `copc-sw` worker — with Vite, that is typically
 * `new URL("@gyeonghokim/copc-tileset/copc-sw", import.meta.url)`.
 *
 * The worker must be served from your app's origin (Service Worker scope rules),
 * so it is registered by the app, not bundled into the library's main entry.
 *
 * Serve `copc-sw.js` from the **same directory as your page** (your app's base):
 * virtual tile URLs are relative to that base, so the worker's default scope (its
 * own directory) covers them — no special scope or `Service-Worker-Allowed` header
 * is needed, even on sub-path hosts. If you must serve it from elsewhere, pass a
 * matching `scope` in `options` (which may require the `Service-Worker-Allowed` header).
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
    ...options,
  });
  await navigator.serviceWorker.ready;

  // On the first load the worker activates but does not yet control this page, so
  // its fetch handler would not intercept tile requests (they'd 404 on the static
  // host and tiles silently fail to load). Wait until it takes control.
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      navigator.serviceWorker.addEventListener("controllerchange", done, { once: true });
      setTimeout(done, 3000); // fallback so registration never hangs
    });
  }
  return registration;
}
