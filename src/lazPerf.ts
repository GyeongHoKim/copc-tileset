import { createLazPerf } from "laz-perf/lib/web";
// The bundler emits laz-perf's WASM as an asset and rewrites this to its URL.
import lazPerfWasmUrl from "laz-perf/lib/web/laz-perf.wasm?url";

// laz-perf's Emscripten glue resolves `laz-perf.wasm` relative to the running
// script. Inside a bundled Service Worker there is no `document.currentScript`, so
// it fetches the wrong path — the host returns HTML and `WebAssembly.instantiate`
// aborts ("expected magic word 00 61 73 6d"), which fails every `.pnts` decode.
// Pin `locateFile` to the URL the bundler emits so decoding works in the worker.
// Shared and lazy: the WASM module is instantiated once per worker and reused.
let lazPerfPromise: ReturnType<typeof createLazPerf> | undefined;

/** The shared laz-perf instance, with its WASM located at the bundler-emitted URL. */
export function getLazPerf(): ReturnType<typeof createLazPerf> {
  if (!lazPerfPromise) {
    lazPerfPromise = createLazPerf({ locateFile: () => lazPerfWasmUrl });
  }
  return lazPerfPromise;
}
