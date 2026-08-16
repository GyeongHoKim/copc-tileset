import {
  CopcPointCloudPrimitive,
  CopcProvider,
  registerCopcServiceWorker,
} from "@gyeonghokim/copc-tileset";
import {
  Cesium3DTileFeature,
  Cesium3DTileset,
  CustomShader,
  ImageryLayer,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  Viewer,
} from "cesium";
import {
  createTransferAccumulator,
  getPageTransferStats,
  resetPageTransferStats,
  type TransferStats,
} from "./transferCounter";

// Verified public COPC datasets (HTTP range + CORS enabled).
const DATASETS: Record<string, string> = {
  "Autzen Stadium (77 MB)": "https://s3.amazonaws.com/hobu-lidar/autzen-classified.copc.laz",
  "Millsite Reservoir (1.35 GB)": "https://s3.amazonaws.com/hobu-lidar/millsite.copc.laz",
  "SoFi Stadium (1.9 GB)": "https://s3.amazonaws.com/hobu-lidar/sofi.copc.laz",
};

/** Pre-converted 3D Tiles, for showing COPC streaming and classic tiles in one scene. */
const CONVERTED_TILESET_URL = `${import.meta.env.BASE_URL}converted/tileset.json`;

// ASPRS classification codes → colours. See docs/custom-shaders.md.
const BY_CLASSIFICATION = new CustomShader({
  fragmentShaderText: `
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      float c = fsInput.metadata.Classification;
      if (c == 2.0)      material.diffuse = vec3(0.55, 0.40, 0.25); // ground
      else if (c == 3.0) material.diffuse = vec3(0.45, 0.65, 0.30); // low vegetation
      else if (c == 4.0) material.diffuse = vec3(0.25, 0.60, 0.25); // medium vegetation
      else if (c == 5.0) material.diffuse = vec3(0.10, 0.55, 0.15); // high vegetation
      else if (c == 6.0) material.diffuse = vec3(0.85, 0.35, 0.30); // building
      else if (c == 9.0) material.diffuse = vec3(0.20, 0.45, 0.85); // water
      else               material.diffuse = vec3(0.60, 0.60, 0.62);
    }`,
});

const BY_INTENSITY = new CustomShader({
  fragmentShaderText: `
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      float i = clamp(fsInput.metadata.Intensity / 4096.0, 0.0, 1.0);
      material.diffuse = mix(vec3(0.05, 0.10, 0.35), vec3(1.0, 0.95, 0.75), i);
    }`,
});

const SHADERS: Record<string, CustomShader | undefined> = {
  "RGB (source colour)": undefined,
  Classification: BY_CLASSIFICATION,
  Intensity: BY_INTENSITY,
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// Test hook: exposes just enough runtime state for the Playwright E2E to assert
// that the Service Worker actually streamed points into Cesium (see e2e/). Harmless
// in the shipped demo — it only mirrors state the app already holds.
declare global {
  interface Window {
    __copcE2E?: {
      viewer?: Viewer;
      pointCloud?: CopcPointCloudPrimitive;
      tileFailures: { url?: string; message?: string }[];
    };
  }
}

/** Asks the Service Worker how many bytes its range requests have pulled. */
function askWorker<T>(message: unknown): Promise<T | undefined> {
  const worker = navigator.serviceWorker.controller;
  if (!worker) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(undefined), 1000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data as T);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

const formatBytes = (bytes: number): string =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(2)} GB`
    : bytes >= 1e6
      ? `${(bytes / 1e6).toFixed(1)} MB`
      : `${(bytes / 1e3).toFixed(0)} KB`;

export async function start(): Promise<void> {
  // The COPC Service Worker turns each octree node into a 3D Tiles tile on the fly.
  // We register the demo's wrapper (public/copc-sw-demo.js) rather than the
  // library's copc-sw.js: it counts range-request bytes for the readout below and
  // then imports the library worker, which does the actual tile serving.
  // `type: "classic"` so the wrapper can use importScripts() — see the comment
  // block in public/copc-sw-demo.js for why that is the only ordering that works.
  await registerCopcServiceWorker(`${import.meta.env.BASE_URL}copc-sw-demo.js`, {
    type: "classic",
  });

  // OpenStreetMap base layer so the demo needs no Cesium ion token.
  const viewer = new Viewer("cesiumContainer", {
    baseLayer: new ImageryLayer(
      new UrlTemplateImageryProvider({
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        credit: "© OpenStreetMap contributors",
        maximumLevel: 19,
      }),
    ),
    baseLayerPicker: false,
    geocoder: false,
    animation: false,
    timeline: false,
  });

  const datasetSelect = $<HTMLSelectElement>("dataset");
  for (const name of Object.keys(DATASETS)) {
    datasetSelect.add(new Option(name, DATASETS[name]));
  }
  const shaderSelect = $<HTMLSelectElement>("shader");
  for (const name of Object.keys(SHADERS)) {
    shaderSelect.add(new Option(name, name));
  }

  let pointCloud: CopcPointCloudPrimitive | undefined;
  let converted: Cesium3DTileset | undefined;
  let loadToken = 0;
  /** Total size of the current source, from a HEAD request — the denominator. */
  let sourceBytes = 0;
  const workerStats = createTransferAccumulator();

  const e2e: NonNullable<Window["__copcE2E"]> = { viewer, tileFailures: [] };
  window.__copcE2E = e2e;

  async function load(url: string): Promise<void> {
    const token = ++loadToken;
    sourceBytes = 0;
    resetPageTransferStats();
    workerStats.reset();
    await askWorker({ type: "copc-reset-transfer-stats" });

    // The denominator for the transfer readout. Best-effort: a host that blocks
    // HEAD just leaves the readout showing the absolute figure.
    void fetch(url, { method: "HEAD" })
      .then((r) => {
        if (token === loadToken) sourceBytes = Number(r.headers.get("content-length") ?? 0);
      })
      .catch(() => {});

    const provider = await CopcProvider.fromUrl(url);
    const next = await CopcPointCloudPrimitive.fromProvider(provider, {
      pointSize: Number($<HTMLInputElement>("pointSize").value),
      maximumScreenSpaceError: Number($<HTMLInputElement>("sse").value),
      pointCloudShading: {
        attenuation: $<HTMLInputElement>("attenuation").checked,
        eyeDomeLighting: $<HTMLInputElement>("edl").checked,
      },
      customShader: SHADERS[shaderSelect.value],
    });
    // Surface tile streaming failures (404/500/decode) that Cesium otherwise swallows.
    next.tileset.tileFailed.addEventListener((error: { url?: string; message?: string }) => {
      console.error("[copc-tileset] tile failed:", error.url, error.message);
      e2e.tileFailures.push({ url: error.url, message: error.message });
    });

    // A newer load() superseded this one while we awaited — discard this primitive.
    if (token !== loadToken) {
      next.destroy();
      return;
    }
    if (pointCloud) viewer.scene.primitives.remove(pointCloud); // remove() destroys it
    pointCloud = next;
    e2e.pointCloud = next;
    viewer.scene.primitives.add(pointCloud);
    viewer.camera.flyToBoundingSphere(pointCloud.boundingSphere);
  }

  // Transfer readout — the headline number for "we only fetched what we needed".
  // Range reads happen in two places: this page (header, VLRs, the hierarchy the
  // bounding sphere needs) and the Service Worker (every tile). They are separate
  // module instances with separate counters, so the honest figure is the sum.
  const transferEl = $("transfer");
  const render = () => {
    const page = getPageTransferStats();
    const worker = workerStats.total();
    const bytes = page.bytes + worker.bytes;
    const requests = page.requests + worker.requests;
    const share = sourceBytes ? ` · ${((bytes / sourceBytes) * 100).toFixed(2)}% of the file` : "";
    const total = sourceBytes ? ` / ${formatBytes(sourceBytes)}` : "";
    transferEl.innerHTML =
      `<b>${formatBytes(bytes)}</b>${total}${share}` +
      `<span class="sub">${requests.toLocaleString("en-US")} range requests</span>`;
  };
  // The worker pushes after every tile it serves — that is what keeps the total
  // intact across its restarts. Polling only covers idle stretches and startup.
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: string; stats?: TransferStats };
    if (data?.type === "copc-transfer-stats" && data.stats) {
      workerStats.apply(data.stats);
      render();
    }
  });
  setInterval(async () => {
    const stats = await askWorker<TransferStats>({ type: "copc-transfer-stats" });
    if (stats) workerStats.apply(stats);
    render();
  }, 500);

  datasetSelect.addEventListener("change", () => void load(datasetSelect.value));
  shaderSelect.addEventListener("change", () => {
    if (pointCloud) pointCloud.customShader = SHADERS[shaderSelect.value];
  });
  $<HTMLInputElement>("pointSize").addEventListener("input", (e) => {
    if (pointCloud) pointCloud.pointSize = Number((e.target as HTMLInputElement).value);
  });
  $<HTMLInputElement>("sse").addEventListener("input", (e) => {
    if (pointCloud)
      pointCloud.maximumScreenSpaceError = Number((e.target as HTMLInputElement).value);
  });
  const applyShading = () => {
    if (pointCloud) {
      pointCloud.pointCloudShading = {
        attenuation: $<HTMLInputElement>("attenuation").checked,
        eyeDomeLighting: $<HTMLInputElement>("edl").checked,
      };
    }
  };
  $<HTMLInputElement>("edl").addEventListener("change", applyShading);
  $<HTMLInputElement>("attenuation").addEventListener("change", applyShading);

  // Pre-converted 3D Tiles alongside the COPC stream: the same scene rendering
  // content that needed a tiling pass and content that did not.
  $<HTMLInputElement>("converted").addEventListener("change", async (e) => {
    const on = (e.target as HTMLInputElement).checked;
    if (!on) {
      if (converted) viewer.scene.primitives.remove(converted);
      converted = undefined;
      return;
    }
    try {
      converted = await Cesium3DTileset.fromUrl(CONVERTED_TILESET_URL);
      viewer.scene.primitives.add(converted);
    } catch (error) {
      console.error("[copc-tileset] converted tileset failed:", error);
      $("pick").textContent = `Pre-converted tileset not found:\n${CONVERTED_TILESET_URL}`;
      (e.target as HTMLInputElement).checked = false;
    }
  });

  // Picking: read the clicked point's attributes from its Cesium3DTileFeature.
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement: { position: import("cesium").Cartesian2 }) => {
    const picked = viewer.scene.pick(movement.position);
    const out = $("pick");
    if (picked instanceof Cesium3DTileFeature) {
      const props = ["Classification", "Intensity", "GpsTime"]
        .map((name) => `${name}: ${picked.getProperty(name)}`)
        .join("\n");
      out.textContent = props;
    } else {
      out.textContent = "No point here.";
    }
  }, ScreenSpaceEventType.LEFT_CLICK);

  await load(DATASETS[Object.keys(DATASETS)[0] as string] as string);
}
