// Entry point. The transfer counter installs a `fetch` wrapper as an import side
// effect, and copc.js captures its `fetch` reference the moment it is evaluated —
// so the counter has to be in place before anything pulls in the library. Hence
// the dynamic import: static imports are hoisted and would load the app first.
//
// The exported `start` must actually be called: package.json declares
// `"sideEffects": false`, so a dynamically imported module whose exports go unused
// is tree-shaken away entirely in the production build (dev is unaffected, which
// makes this a build-only failure if you get it wrong).
import "./transferCounter";

const { start } = await import("./app");
await start();
