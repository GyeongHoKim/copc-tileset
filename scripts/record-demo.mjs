// Records the README demo GIF (docs/media/demo.gif).
//
// MAINTENANCE TOOLING — deliberately not wired into package.json scripts and
// never run in CI: it needs a headed browser, a GPU and ffmpeg on PATH. Run it by
// hand when the demo in examples/ changes, then commit the GIF it produces:
//
//   npm run build:demo
//   npm run preview:demo            # in another shell — serves port 4173
//   node scripts/record-demo.mjs
//
// It drives the built demo in a real (headed, GPU-backed) Chromium so Cesium
// renders at full speed, captures the page with Playwright's video recorder —
// which, unlike a canvas captureStream(), also picks up the HTML overlays (the
// transfer readout and the control panel) — and converts the webm to a GIF with
// ffmpeg's two-pass palette filter.
//
// Flags: --keep (keep the raw webm), --fps=N, --width=N, --out=path.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ARGS = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE_URL = "http://localhost:4173/";
const OUT_GIF = opt("out", fileURLToPath(new URL("../docs/media/demo.gif", import.meta.url)));
const VIDEO = { width: 1280, height: 720 };
const GIF_WIDTH = Number(opt("width", 640));
const GIF_FPS = Number(opt("fps", 7));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * Camera rig installed in the page. Two things it has to work around:
 *  - No Cesium classes are reachable from the demo's test hook, so it borrows the
 *    Cartesian3 constructor off `camera.position` and does the ECEF math by hand.
 *  - The point cloud's bounding sphere is the COPC octree *cube*, whose centre
 *    floats well above the ground when the data is much wider than it is tall.
 *    Orbiting that centre keeps the points at the bottom edge of the frame, so the
 *    rig aims at the cube's horizontal centre lowered to the elevation of whatever
 *    the depth buffer reports under the middle of the screen (i.e. the cloud).
 */
const INSTALL_RIG = () => {
  const h = window.__copcE2E;
  const scene = h.viewer.scene;
  const C3 = h.viewer.camera.position.constructor;
  const v = (x, y, z) => new C3(x, y, z);
  const n = (a) => {
    const m = Math.hypot(a.x, a.y, a.z);
    return v(a.x / m, a.y / m, a.z / m);
  };

  const sphere = h.pointCloud.boundingSphere;
  const hit = scene.pickPosition({
    x: scene.canvas.clientWidth / 2,
    y: scene.canvas.clientHeight / 2,
  });
  // Guard against a pick taken while the camera is still flying in, which lands
  // somewhere else entirely on the globe and would send the orbit off into space.
  const picked =
    hit &&
    Math.hypot(hit.x - sphere.center.x, hit.y - sphere.center.y, hit.z - sphere.center.z) <
      sphere.radius * 1.5
      ? hit
      : null;
  const groundRadius = picked
    ? Math.hypot(picked.x, picked.y, picked.z)
    : Math.hypot(sphere.center.x, sphere.center.y, sphere.center.z);
  const dir = n(sphere.center);
  const target = v(dir.x * groundRadius, dir.y * groundRadius, dir.z * groundRadius);

  window.__rig = {
    radius: sphere.radius,
    /** heading/pitch in radians, range in metres from the target. */
    setView({ heading, pitch, range }) {
      const up = n(target);
      const east = n(v(-up.y, up.x, 0));
      const north = v(
        up.y * east.z - up.z * east.y,
        up.z * east.x - up.x * east.z,
        up.x * east.y - up.y * east.x,
      );
      const k = Math.cos(pitch);
      const off = n(
        v(
          -k * Math.sin(heading) * east.x -
            k * Math.cos(heading) * north.x -
            Math.sin(pitch) * up.x,
          -k * Math.sin(heading) * east.y -
            k * Math.cos(heading) * north.y -
            Math.sin(pitch) * up.y,
          -k * Math.sin(heading) * east.z -
            k * Math.cos(heading) * north.z -
            Math.sin(pitch) * up.z,
        ),
      );
      const position = v(
        target.x + off.x * range,
        target.y + off.y * range,
        target.z + off.z * range,
      );
      const look = n(v(target.x - position.x, target.y - position.y, target.z - position.z));
      const wUp = n(position);
      const d = wUp.x * look.x + wUp.y * look.y + wUp.z * look.z;
      const camUp = n(v(wUp.x - look.x * d, wUp.y - look.y * d, wUp.z - look.z * d));
      h.viewer.camera.setView({
        destination: position,
        orientation: { direction: look, up: camUp },
      });
    },
    /**
     * Eased move between two views. Driven by wall-clock rather than a frame
     * count, so the beat lasts the same time on a 60 Hz and a 120 Hz display.
     */
    move(from, to, ms) {
      return new Promise((resolve) => {
        const start = performance.now();
        const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
        const step = () => {
          const raw = Math.min(1, (performance.now() - start) / ms);
          const t = ease(raw);
          window.__rig.setView({
            heading: from.heading + (to.heading - from.heading) * t,
            pitch: from.pitch + (to.pitch - from.pitch) * t,
            range: from.range + (to.range - from.range) * t,
          });
          if (raw < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
    },
  };
  return { pickedGround: !!picked, radius: sphere.radius };
};

const browser = await chromium.launch({
  headless: false, // real GPU: SwiftShader's frame rate makes for an ugly GIF
  args: [
    "--window-position=0,0",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--hide-scrollbars",
  ],
});
const workDir = mkdtempSync(join(tmpdir(), "copc-demo-"));
const context = await browser.newContext({
  viewport: VIDEO,
  deviceScaleFactor: 1,
  recordVideo: { dir: workDir, size: VIDEO },
});
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.error("  [page]", m.text());
});

const t0 = Date.now();
const since = () => ((Date.now() - t0) / 1000).toFixed(1);

console.log("→ loading demo…");
await page.goto(BASE_URL, { waitUntil: "load" });
// Cesium's default overlays are noise in a promo GIF; the demo's own panel stays.
await page.addStyleTag({
  content: ".cesium-navigation-help, .cesium-viewer-toolbar { display: none !important; }",
});

await page.waitForFunction(
  () => (window.__copcE2E?.pointCloud?.tileset.totalMemoryUsageInBytes ?? 0) > 0,
  null,
  { timeout: 90_000 },
);
// The demo's own fit-to-view flight is still running at this point — wait for the
// camera to come to rest before doing anything, and start the GIF there. What
// comes before (Service Worker registration, Cesium boot, the flight in from
// space) is boot noise, and gets trimmed off the front.
await page.waitForFunction(
  () => {
    const p = window.__copcE2E.viewer.camera.position;
    const last = window.__lastCam;
    window.__lastCam = { x: p.x, y: p.y, z: p.z };
    return !!last && Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) < 1;
  },
  null,
  { polling: 250, timeout: 30_000 },
);
const trimAt = Math.max(0, (Date.now() - t0) / 1000 - 0.3);
console.log(`→ ${since()}s framed and still (trim point)`);

// Every beat below is timed: a GIF of a point cloud is nearly incompressible
// (fine, high-contrast dots), so seconds cost megabytes. Beats overlap where they
// can — the SSE drag happens *while* the camera orbits.
//
// 1. Hold on the fit-to-view framing while the root node fills in.
await sleep(1000);

const rig = await page.evaluate(INSTALL_RIG);
console.log(`→ ${since()}s rig ready ${JSON.stringify(rig)}`);
const R = rig.radius;
const WIDE = { heading: 0, pitch: -1.35, range: R * 2.1 };
const CLOSE = { heading: 0.55, pitch: -0.5, range: R * 0.72 };
const ORBITED = { heading: 1.3, pitch: -0.42, range: R * 0.6 };

/**
 * Drags a range input from its current value to `to`, in steps, so the knob is
 * seen moving. Native range inputs place the knob inside the track by half a
 * thumb width, so the usable travel is inset — hence the padding either side.
 */
async function dragSlider(selector, to) {
  const el = page.locator(selector);
  const box = await el.boundingBox();
  const [min, max] = [Number(await el.getAttribute("min")), Number(await el.getAttribute("max"))];
  const pad = 8; // ≈ half the thumb
  const at = (value) => box.x + pad + ((box.width - 2 * pad) * (value - min)) / (max - min);
  const from = Number(await el.inputValue());
  await page.mouse.move(at(from), box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) {
    const t = easeInOut(i / 16);
    await page.mouse.move(at(from + (to - from) * t), box.y + box.height / 2);
    await sleep(45);
  }
  await page.mouse.up();
  const landed = await el.inputValue();
  console.log(`   ${selector} → ${landed}${landed === String(to) ? "" : ` (wanted ${to})`}`);
}

// 2. Fly down into an oblique view. Every metre closer tightens the screen-space
//    error, so Cesium asks for deeper octree nodes and the cloud sharpens live.
//    Fatten the points on the way in: at this range 2 px reads as noise.
console.log(`→ ${since()}s flying in`);
const flying = page.evaluate(([from, to]) => window.__rig.move(from, to, 2000), [WIDE, CLOSE]);
await sleep(700);
await dragSlider("#pointSize", 4);
await flying;
await sleep(500);

// 3. Slow orbit — the point cloud reads as 3D and more tiles stream in — with the
//    screen-space error pulled down midway through it: the headline moment for
//    "streamed on demand", where the transfer readout and the density both jump.
console.log(`→ ${since()}s orbiting + tightening SSE`);
const orbiting = page.evaluate(([from, to]) => window.__rig.move(from, to, 2900), [CLOSE, ORBITED]);
await sleep(400);
await dragSlider("#sse", 4);
await orbiting;
await sleep(1300); // the deeper tiles land

// 4. Eye Dome Lighting off → on: shading computed on the streamed points.
console.log(`→ ${since()}s toggling Eye Dome Lighting`);
await page.uncheck("#edl");
await sleep(1100);
await page.check("#edl");
await sleep(900);

// 5. A custom shader reading the per-point Classification from the batch table.
console.log(`→ ${since()}s classification colours`);
await page.selectOption("#shader", "Classification");
await sleep(1800);

console.log(`→ ${since()}s done, saving video`);
const video = page.video();
await context.close();
await browser.close();
const webm = await video.path();

const palette = join(workDir, "palette.png");
const vf = `fps=${GIF_FPS},scale=${GIF_WIDTH}:-2:flags=lanczos`;
const trim = ["-ss", String(trimAt), "-t", "40"]; // -t: a hung run can't make a monster GIF

console.log("→ ffmpeg: palette");
execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    ...trim,
    "-i",
    webm,
    "-vf",
    `${vf},palettegen=max_colors=128:stats_mode=diff`,
    "-y",
    palette,
  ],
  { stdio: "inherit" },
);

console.log("→ ffmpeg: gif");
execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    ...trim,
    "-i",
    webm,
    "-i",
    palette,
    "-lavfi",
    `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    "-loop",
    "0",
    "-y",
    OUT_GIF,
  ],
  { stdio: "inherit" },
);

console.log(`✔ ${OUT_GIF} — ${(statSync(OUT_GIF).size / 1e6).toFixed(2)} MB`);
if (ARGS.includes("--keep")) console.log(`  raw video: ${webm}`);
else rmSync(workDir, { recursive: true, force: true });
