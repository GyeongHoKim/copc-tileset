# Picking & shading

Inspect individual points and tune how the cloud is rendered — point size, attenuation, Eye Dome Lighting, and level-of-detail — all at runtime.

Related: [Custom shaders](./custom-shaders.md) · [Bundler setup](./bundler-setup.md) · [Authentication](./authentication.md)

## Pick a point and read its attributes

Every point is a Cesium `Cesium3DTileFeature`, so `scene.pick` returns one and you read its per-point attributes with `getProperty`.

```ts
import {
  Cesium3DTileFeature,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from "cesium";

const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction((movement) => {
  const picked = viewer.scene.pick(movement.position);
  if (picked instanceof Cesium3DTileFeature) {
    console.log("Classification:", picked.getProperty("Classification"));
    console.log("Intensity:", picked.getProperty("Intensity"));
    console.log("GpsTime:", picked.getProperty("GpsTime"));
  }
}, ScreenSpaceEventType.LEFT_CLICK);
```

## Attenuation & Eye Dome Lighting

`pointCloudShading` mirrors Cesium's native [`PointCloudShading`](https://cesium.com/learn/cesiumjs/ref-doc/PointCloudShading.html). Assigning it replaces the whole shading object.

```ts
const pointCloud = await CopcPointCloudPrimitive.fromProvider(provider, {
  pointCloudShading: {
    attenuation: true, // scale point size with distance
    eyeDomeLighting: true, // depth-based shading that sharpens structure
  },
});

// Toggle at runtime — reassign the full object:
pointCloud.pointCloudShading = { attenuation: false, eyeDomeLighting: true };
```

All `PointCloudShadingOptions` fields:

```ts
interface PointCloudShadingOptions {
  attenuation?: boolean;
  maximumAttenuation?: number;
  eyeDomeLighting?: boolean;
  eyeDomeLightingStrength?: number;
  eyeDomeLightingRadius?: number;
}
```

## Point size & level of detail

```ts
pointCloud.pointSize = 3; // fixed pixel size
pointCloud.maximumScreenSpaceError = 8; // lower = more detail refined (default 16)
```

`fromProvider` also takes `dynamicScreenSpaceError` (default `true`, reduces detail for far tiles in dense scenes) and `cacheBytes` (GPU memory budget for loaded tiles):

```ts
await CopcPointCloudPrimitive.fromProvider(provider, {
  pointSize: 2,
  maximumScreenSpaceError: 16,
  dynamicScreenSpaceError: true,
  cacheBytes: 512 * 1024 * 1024,
});
```

## Frame the cloud

The primitive exposes a Cesium `boundingSphere`, so you can fly to it once loaded.

```ts
viewer.scene.primitives.add(pointCloud);
viewer.camera.flyToBoundingSphere(pointCloud.boundingSphere);
```

## Switching datasets safely

Loading is async, so guard against a newer load superseding an older one, and destroy the primitive you replace (removing it from `scene.primitives` destroys it).

```ts
let current;
let loadToken = 0;

async function load(url) {
  const token = ++loadToken;
  const provider = await CopcProvider.fromUrl(url);
  const next = await CopcPointCloudPrimitive.fromProvider(provider);

  if (token !== loadToken) {
    next.destroy(); // a newer load() already won
    return;
  }
  if (current) viewer.scene.primitives.remove(current); // remove() destroys it
  current = next;
  viewer.scene.primitives.add(current);
  viewer.camera.flyToBoundingSphere(current.boundingSphere);
}
```
