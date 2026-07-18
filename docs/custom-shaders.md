# Custom shaders — attribute-driven colouring

Each point carries `Classification`, `Intensity` and `GpsTime` in the `.pnts` batch table, so you can colour or filter points on the GPU with a Cesium [`CustomShader`](https://cesium.com/learn/cesiumjs/ref-doc/CustomShader.html). Use a custom shader for **attribute-driven colouring**; use [`pointCloudShading`](./picking-and-shading.md) for distance attenuation and Eye Dome Lighting.

Related: [Picking & shading](./picking-and-shading.md) · [Authentication](./authentication.md) · [Bundler setup](./bundler-setup.md)

## Set a shader at creation or at runtime

`customShader` is both a `fromProvider` option and a live property — assign it any time.

```ts
import { CustomShader } from "cesium";
import { CopcProvider, CopcPointCloudPrimitive } from "@gyeonghokim/copc-tileset";

const provider = await CopcProvider.fromUrl(url);
const pointCloud = await CopcPointCloudPrimitive.fromProvider(provider, {
  customShader: myShader,
});

// …or swap it later:
pointCloud.customShader = myShader;
```

Per-point attributes are read from `fsInput.metadata.<Name>` inside `fragmentMain`.

## Colour by classification

Map ASPRS classification codes to colours (2 = ground, 5 = high vegetation, 6 = building, …).

```ts
const byClassification = new CustomShader({
  fragmentShaderText: `
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      float c = fsInput.metadata.Classification;
      if (c == 2.0)      material.diffuse = vec3(0.55, 0.40, 0.25); // ground
      else if (c == 3.0) material.diffuse = vec3(0.30, 0.55, 0.20); // low vegetation
      else if (c == 5.0) material.diffuse = vec3(0.10, 0.60, 0.10); // high vegetation
      else if (c == 6.0) material.diffuse = vec3(0.75, 0.35, 0.30); // building
      else if (c == 9.0) material.diffuse = vec3(0.20, 0.45, 0.85); // water
    }`,
});
```

## Colour by intensity

Normalise 16-bit intensity to a grayscale ramp.

```ts
const byIntensity = new CustomShader({
  fragmentShaderText: `
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      float i = fsInput.metadata.Intensity / 65535.0;
      material.diffuse = vec3(i);
    }`,
});
```

## Filter points by attribute

Discard fragments to hide points — here, everything but ground and buildings.

```ts
const groundAndBuildings = new CustomShader({
  fragmentShaderText: `
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      float c = fsInput.metadata.Classification;
      if (c != 2.0 && c != 6.0) discard;
    }`,
});
```

## Filter by GPS time

`GpsTime` lets you fade or gate points by acquisition time (e.g. a temporal slider bound to a shader `uniform`).

```ts
const recentOnly = new CustomShader({
  uniforms: {
    u_minGpsTime: { type: "float", value: 0.0 },
  },
  fragmentShaderText: `
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      if (fsInput.metadata.GpsTime < u_minGpsTime) discard;
    }`,
});

// Move the threshold over time:
recentOnly.setUniform("u_minGpsTime", someValue);
```

Clear the shader by assigning `undefined`: `pointCloud.customShader = undefined;`
