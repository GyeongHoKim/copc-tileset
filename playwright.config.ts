import { defineConfig, devices } from "@playwright/test";

// Browser E2E for the one layer unit/integration tests can't reach: the built demo
// running in a real browser, where the Service Worker intercepts virtual tileset
// URLs and Cesium fetches + renders the synthesised .pnts. Network-dependent (it
// streams the real Autzen COPC from S3), so it lives outside `npm test`.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    // Cesium needs WebGL; headless Chromium renders it via SwiftShader.
    launchOptions: {
      args: [
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--ignore-gpu-blocklist",
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Serve the real built artifact the user deploys — the dev server does not
    // serve the Service Worker the same way. The build is run by the `test:e2e`
    // script *before* this, never here: a reused preview server would otherwise
    // skip the build and serve a stale bundle.
    command: "npm run preview:demo",
    url: "http://localhost:4173",
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
});
