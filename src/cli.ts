#!/usr/bin/env node
// The `copc-tileset` CLI. Its one command, `init <dir>`, copies the self-contained
// Service Worker into a consumer's public directory (à la `msw init`), so it is
// served from their origin at a stable URL and can be registered with
// `registerCopcServiceWorker`. Because `dist/copc-sw.js` inlines laz-perf and its
// WASM, the copied file needs no bundler processing.
import { copyFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_FILENAME = "copc-sw.js";

function fail(message: string): never {
  console.error(`copc-tileset: ${message}`);
  process.exit(1);
}

function init(dir: string | undefined): void {
  if (!dir) fail("`init` requires a target directory, e.g. `copc-tileset init public`");

  // dist/cli.js and dist/copc-sw.js sit side by side, so resolve the worker
  // relative to this module rather than the (unknown) consumer layout.
  const source = fileURLToPath(new URL(`./${WORKER_FILENAME}`, import.meta.url));
  const destDir = resolve(process.cwd(), dir);
  const dest = join(destDir, WORKER_FILENAME);

  try {
    mkdirSync(destDir, { recursive: true });
    copyFileSync(source, dest);
  } catch (error) {
    fail(`could not write the Service Worker to ${dest} — ${(error as Error).message}`);
  }

  console.log(`copc-tileset: wrote ${WORKER_FILENAME} to ${dest}`);
  console.log(
    "copc-tileset: register it with " +
      '`registerCopcServiceWorker("/copc-sw.js")` (adjust the path to your base URL).',
  );
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "init":
      init(rest[0]);
      break;
    case "-h":
    case "--help":
    case undefined:
      console.log(`Usage: ${basename(process.argv[1] ?? "copc-tileset")} init <public-dir>`);
      break;
    default:
      fail(`unknown command "${command}" — the only command is \`init <public-dir>\``);
  }
}

main();
