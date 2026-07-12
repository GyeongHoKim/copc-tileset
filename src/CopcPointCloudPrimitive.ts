import {
  type BoundingSphere,
  Cesium3DTileStyle,
  Cesium3DTileset,
  type CustomShader,
  PointCloudShading,
} from "cesium";
import type { CopcProvider } from "./CopcProvider";
import { tilesetUrl } from "./sw/scheme";

/**
 * Point attenuation and Eye Dome Lighting options, mirroring Cesium's native
 * `PointCloudShading`. Use this — not a custom shader — for distance-based point
 * sizing and EDL.
 */
export interface PointCloudShadingOptions {
  attenuation?: boolean;
  maximumAttenuation?: number;
  eyeDomeLighting?: boolean;
  eyeDomeLightingStrength?: number;
  eyeDomeLightingRadius?: number;
}

export interface CopcPointCloudPrimitiveOptions {
  /** Fixed point size in pixels. Applied via a 3D Tiles style. */
  pointSize?: number;
  /** Screen-space error that drives octree LOD refinement. */
  maximumScreenSpaceError?: number;
  /** Attenuation / Eye Dome Lighting options. */
  pointCloudShading?: PointCloudShadingOptions;
  /** GLSL shader for attribute-driven colouring / filtering (classification, intensity, ...). */
  customShader?: CustomShader;
}

// Minimal structural view of the Cesium primitive lifecycle methods that Cesium
// hides from its public typings but calls each frame. Forwarding them lets a
// CopcPointCloudPrimitive be added to `scene.primitives` directly.
interface RenderablePrimitive {
  update(frameState: unknown): void;
  prePassesUpdate?(frameState: unknown): void;
  updateForPass?(frameState: unknown, passState: unknown): void;
  postPassesUpdate?(frameState: unknown): void;
  isDestroyed(): boolean;
  destroy(): void;
}

/**
 * Streams and renders a COPC point cloud in CesiumJS. Internally it drives a
 * {@link Cesium3DTileset} whose tiles are synthesised on the fly from the COPC
 * octree by the COPC Service Worker (register it first via
 * `registerCopcServiceWorker`).
 *
 * Add it to `viewer.scene.primitives`, then frame it with
 * `viewer.camera.flyToBoundingSphere(pointCloud.boundingSphere)`.
 */
export class CopcPointCloudPrimitive {
  private destroyed = false;
  private _pointSize?: number;

  private constructor(
    /** The COPC data source. */
    readonly provider: CopcProvider,
    /** The underlying Cesium 3D Tiles primitive. */
    readonly tileset: Cesium3DTileset,
  ) {}

  /** Creates a primitive for `provider`. The COPC Service Worker must be registered. */
  static async fromProvider(
    provider: CopcProvider,
    options: CopcPointCloudPrimitiveOptions = {},
  ): Promise<CopcPointCloudPrimitive> {
    const tileset = await Cesium3DTileset.fromUrl(tilesetUrl(provider.url), {
      maximumScreenSpaceError: options.maximumScreenSpaceError ?? 16,
      pointCloudShading: options.pointCloudShading
        ? new PointCloudShading(options.pointCloudShading)
        : undefined,
    });
    if (options.customShader) tileset.customShader = options.customShader;
    const primitive = new CopcPointCloudPrimitive(provider, tileset);
    if (options.pointSize !== undefined) primitive.pointSize = options.pointSize;
    return primitive;
  }

  /** ECEF bounding sphere of the dataset, for `camera.flyToBoundingSphere`. */
  get boundingSphere(): BoundingSphere {
    return this.provider.boundingSphere;
  }

  /** Whether the point cloud is shown. */
  get show(): boolean {
    return this.tileset.show;
  }
  set show(value: boolean) {
    this.tileset.show = value;
  }

  /** Screen-space error driving LOD refinement. Settable at runtime. */
  get maximumScreenSpaceError(): number {
    return this.tileset.maximumScreenSpaceError;
  }
  set maximumScreenSpaceError(value: number) {
    this.tileset.maximumScreenSpaceError = value;
  }

  /** Attribute-driven GLSL shader. Settable at runtime. */
  get customShader(): CustomShader | undefined {
    return this.tileset.customShader;
  }
  set customShader(value: CustomShader | undefined) {
    this.tileset.customShader = value;
  }

  /** Fixed point size in pixels (applied via a 3D Tiles style). Settable at runtime. */
  get pointSize(): number | undefined {
    return this._pointSize;
  }
  set pointSize(value: number | undefined) {
    this._pointSize = value;
    this.tileset.style =
      value === undefined ? undefined : new Cesium3DTileStyle({ pointSize: value });
  }

  // --- Cesium primitive lifecycle: forwarded to the tileset ---

  update(frameState: unknown): void {
    this.asRenderable().update(frameState);
  }
  prePassesUpdate(frameState: unknown): void {
    this.asRenderable().prePassesUpdate?.(frameState);
  }
  updateForPass(frameState: unknown, passState: unknown): void {
    this.asRenderable().updateForPass?.(frameState, passState);
  }
  postPassesUpdate(frameState: unknown): void {
    this.asRenderable().postPassesUpdate?.(frameState);
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  destroy(): void {
    if (this.destroyed) return; // idempotent: Cesium3DTileset.destroy() throws if called twice
    this.destroyed = true;
    const tileset = this.asRenderable();
    if (!tileset.isDestroyed()) tileset.destroy();
  }

  private asRenderable(): RenderablePrimitive {
    return this.tileset as unknown as RenderablePrimitive;
  }
}
