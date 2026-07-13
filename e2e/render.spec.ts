import { expect, test } from "@playwright/test";

// Runtime shape exposed by the demo's test hook (examples/main.ts).
type DemoWindow = Window & {
  __copcE2E?: {
    viewer: {
      camera: { flyToBoundingSphere(sphere: unknown, options: { duration: number }): void };
      scene: { render(): void };
    };
    pointCloud?: {
      boundingSphere: { radius: number; center: { x: number; y: number; z: number } };
      tileset: {
        maximumScreenSpaceError: number;
        totalMemoryUsageInBytes: number;
        _statistics?: { numberOfPointsLoaded?: number; numberOfPointsSelected?: number };
      };
    };
    tileFailures: { url?: string; message?: string }[];
  };
};

/**
 * End-to-end proof that the Service Worker streams a real COPC into Cesium and the
 * tiles actually load & render — the one layer unit/integration tests can't reach.
 *
 * Uses the demo's default settings (no SSE override): the cloud must render at the
 * fit-to-view framing, which exercises the tileset-level geometricError fix. The one
 * environment concession: headless Chromium throttles requestAnimationFrame, so
 * Cesium's own render loop stalls — we pump frames ourselves from Node (immune to
 * page-timer throttling) to drive tile requests deterministically.
 */
test("streams the Autzen COPC into Cesium and loads point tiles", async ({ page }) => {
  // The SW's own range reads of the .copc.laz fire on the browser context, not the page.
  const lazStatuses: number[] = [];
  page.context().on("response", (res) => {
    if (res.url().includes(".copc.laz")) lazStatuses.push(res.status());
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/");
  await page.waitForFunction(
    () => !!(window as unknown as DemoWindow).__copcE2E?.pointCloud,
    null,
    {
      timeout: 30_000,
    },
  );

  // Frame the cloud (the demo's own fit-to-view) and warm up the render loop so
  // Cesium's memory-adjusted SSE settles and tile requests are issued.
  await page.evaluate(() => {
    const h = (window as unknown as DemoWindow).__copcE2E;
    if (!h?.pointCloud) throw new Error("point cloud missing");
    h.viewer.camera.flyToBoundingSphere(h.pointCloud.boundingSphere, { duration: 0 });
    for (let i = 0; i < 40; i++) h.viewer.scene.render();
  });

  // Each poll renders a small batch (keeping in-view tiles "touched" so their requests
  // are not cancelled); between polls the browser fetches .pnts and laz-perf decodes.
  // Memory > 0 means Cesium loaded synthesised tiles served by the Service Worker.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const h = (window as unknown as DemoWindow).__copcE2E;
          for (let i = 0; i < 4; i++) h?.viewer.scene.render();
          return h?.pointCloud?.tileset.totalMemoryUsageInBytes ?? 0;
        }),
      { timeout: 90_000, intervals: [200] },
    )
    .toBeGreaterThan(0);

  // Render a few more frames so the now-available content is selected for this frame.
  const state = await page.evaluate(() => {
    const h = (window as unknown as DemoWindow).__copcE2E;
    for (let i = 0; i < 10; i++) h?.viewer.scene.render();
    const pc = h?.pointCloud;
    if (!pc) throw new Error("point cloud primitive missing");
    const { center, radius } = pc.boundingSphere;
    return {
      memory: pc.tileset.totalMemoryUsageInBytes,
      pointsLoaded: pc.tileset._statistics?.numberOfPointsLoaded ?? null,
      pointsSelected: pc.tileset._statistics?.numberOfPointsSelected ?? null,
      failures: h?.tileFailures ?? [],
      radius,
      center: [center.x, center.y, center.z] as [number, number, number],
    };
  });

  // The SW read the COPC over HTTP range requests (206 Partial Content).
  expect(lazStatuses.length).toBeGreaterThan(0);
  expect(lazStatuses).toContain(206);

  // Cesium loaded synthesised .pnts content, with no tile failures (404/500/decode).
  expect(state.memory).toBeGreaterThan(0);
  expect(state.failures).toEqual([]);
  expect(pageErrors).toEqual([]);

  // Real points were decoded into memory.
  if (state.pointsLoaded !== null) {
    expect(state.pointsLoaded).toBeGreaterThan(0);
  }
  // Points were selected for rendering this frame.
  if (state.pointsSelected !== null) {
    expect(state.pointsSelected).toBeGreaterThan(0);
  }

  // The point cloud is a valid, non-degenerate sphere on the real Earth surface.
  expect(Number.isFinite(state.radius) && state.radius > 0).toBe(true);
  expect(Math.hypot(...state.center)).toBeGreaterThan(6.2e6);
});
