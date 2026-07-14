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

  // On the first load the worker activates but does not yet control this page, so its
  // fetch handler would not intercept tile requests — they'd fall through to the static
  // host, which serves the app's index.html for unknown paths, and tiles fail to load.
  // The worker calls clients.claim() on activate, so a `controllerchange` is coming;
  // wait for it (do NOT proceed uncontrolled, or the very first tileset.json 404s).
  if (!navigator.serviceWorker.controller) {
    const controlled = new Promise<boolean>((resolve) => {
      // clients.claim() is near-instant; this only guards against a worker that
      // activates but never claims (pathological). We then recover with one reload.
      const timer = setTimeout(() => resolve(Boolean(navigator.serviceWorker.controller)), 10_000);
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          clearTimeout(timer);
          resolve(true);
        },
        { once: true },
      );
    });

    if (!(await controlled) && !navigator.serviceWorker.controller) {
      // The worker never took control. A single reload lets the now-active worker
      // control the fresh load. Guard with sessionStorage so we never loop. Storage
      // access can throw (SecurityError when the browser blocks all storage), so any
      // failure is treated as "cannot reload" and we fall through to the error below.
      const RELOAD_KEY = "copc-tileset:sw-reloaded";
      try {
        if (typeof location !== "undefined" && !sessionStorage.getItem(RELOAD_KEY)) {
          sessionStorage.setItem(RELOAD_KEY, "1");
          location.reload();
          await new Promise<never>(() => {}); // halt here; the reload replaces the page
        }
      } catch {
        // sessionStorage unavailable — skip the reload recovery.
      }
      throw new Error(
        "copc-tileset: the Service Worker registered but did not take control; tile requests will 404",
      );
    }
  }

  // Clear the one-shot reload guard once control is confirmed, so a genuinely broken
  // worker in a later session can recover with its own single reload. Storage access
  // can throw (SecurityError when storage is blocked), so ignore any failure.
  try {
    sessionStorage.removeItem("copc-tileset:sw-reloaded");
  } catch {
    // sessionStorage unavailable — nothing to clear.
  }
  return registration;
}
