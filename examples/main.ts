import {
  CopcPointCloudPrimitive,
  CopcProvider,
  registerCopcServiceWorker,
} from "@gyeonghokim/copc-tileset";
import {
  Cesium3DTileFeature,
  ImageryLayer,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  Viewer,
} from "cesium";

// Verified public COPC datasets (HTTP range + CORS enabled).
const DATASETS: Record<string, string> = {
  "Autzen Stadium (77 MB)": "https://s3.amazonaws.com/hobu-lidar/autzen-classified.copc.laz",
  "Millsite Reservoir (1.35 GB)": "https://s3.amazonaws.com/hobu-lidar/millsite.copc.laz",
  "SoFi Stadium (1.9 GB)": "https://s3.amazonaws.com/hobu-lidar/sofi.copc.laz",
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

async function main(): Promise<void> {
  // The COPC Service Worker turns each octree node into a 3D Tiles tile on the fly.
  // It is emitted as copc-sw.js under the app base (see vite.config.ts).
  await registerCopcServiceWorker(`${import.meta.env.BASE_URL}copc-sw.js`);

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

  let pointCloud: CopcPointCloudPrimitive | undefined;
  let loadToken = 0;

  async function load(url: string): Promise<void> {
    const token = ++loadToken;
    const provider = await CopcProvider.fromUrl(url);
    const next = await CopcPointCloudPrimitive.fromProvider(provider, {
      pointSize: Number($<HTMLInputElement>("pointSize").value),
      maximumScreenSpaceError: Number($<HTMLInputElement>("sse").value),
      pointCloudShading: {
        attenuation: $<HTMLInputElement>("attenuation").checked,
        eyeDomeLighting: $<HTMLInputElement>("edl").checked,
      },
    });
    // Surface tile streaming failures (404/500/decode) that Cesium otherwise swallows.
    next.tileset.tileFailed.addEventListener((error: { url?: string; message?: string }) => {
      console.error("[copc-tileset] tile failed:", error.url, error.message);
    });

    // A newer load() superseded this one while we awaited — discard this primitive.
    if (token !== loadToken) {
      next.destroy();
      return;
    }
    if (pointCloud) viewer.scene.primitives.remove(pointCloud); // remove() destroys it
    pointCloud = next;
    viewer.scene.primitives.add(pointCloud);
    viewer.camera.flyToBoundingSphere(pointCloud.boundingSphere);
  }

  datasetSelect.addEventListener("change", () => void load(datasetSelect.value));
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

void main();
