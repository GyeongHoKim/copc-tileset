import type { BoundingSphere, CustomShader } from "cesium";
import type { CopcProvider } from "./CopcProvider";

/**
 * Point attenuation and Eye Dome Lighting options, mirroring Cesium's native
 * `PointCloudShading`. Use this — not a custom shader — for distance-based
 * point sizing and EDL.
 */
export interface PointCloudShadingOptions {
  attenuation?: boolean;
  maximumAttenuation?: number;
  eyeDomeLighting?: boolean;
  eyeDomeLightingStrength?: number;
  eyeDomeLightingRadius?: number;
}

export interface CopcPointCloudPrimitiveOptions {
  /** The COPC data source, from {@link CopcProvider.fromUrl}. */
  provider: CopcProvider;
  /** Point size in pixels. Defaults to `1`. */
  pointSize?: number;
  /** Screen-space error that drives octree LOD refinement. Defaults to `16`. */
  maximumScreenSpaceError?: number;
  /** Attenuation / Eye Dome Lighting options. */
  pointCloudShading?: PointCloudShadingOptions;
  /** GLSL shader for attribute-driven coloring / filtering (classification, intensity, ...). */
  customShader?: CustomShader;
  /** Enables `scene.pick()` to read per-point attributes. Defaults to `false`. */
  enablePicking?: boolean;
}

/**
 * A Cesium primitive that streams and renders COPC octree nodes based on the
 * camera view and level of detail. Add it to `viewer.scene.primitives`.
 *
 * Since `viewer.flyTo` does not accept custom primitives, frame it via
 * `viewer.camera.flyToBoundingSphere(pointCloud.boundingSphere)`.
 */
export class CopcPointCloudPrimitive {
  readonly provider: CopcProvider;
  pointSize: number;
  maximumScreenSpaceError: number;
  pointCloudShading: PointCloudShadingOptions;
  customShader: CustomShader | undefined;
  enablePicking: boolean;

  constructor(options: CopcPointCloudPrimitiveOptions) {
    this.provider = options.provider;
    this.pointSize = options.pointSize ?? 1;
    this.maximumScreenSpaceError = options.maximumScreenSpaceError ?? 16;
    this.pointCloudShading = options.pointCloudShading ?? {};
    this.customShader = options.customShader;
    this.enablePicking = options.enablePicking ?? false;
  }

  /**
   * ECEF bounding sphere of the whole dataset, for camera framing via
   * `camera.flyToBoundingSphere`.
   */
  get boundingSphere(): BoundingSphere {
    // Computed from the COPC header bounds in M1/M2.
    throw new Error("CopcPointCloudPrimitive.boundingSphere is not implemented yet");
  }

  /**
   * Called by Cesium each frame to collect draw commands. Do not call directly.
   * Streaming + rendering land in M2/M3.
   */
  update(_frameState: unknown): void {}

  isDestroyed(): boolean {
    return false;
  }

  destroy(): void {
    // Release GPU resources here.
  }
}
