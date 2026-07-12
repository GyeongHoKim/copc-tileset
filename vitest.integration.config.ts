import { defineConfig } from "vitest/config";

// Integration tests hit real COPC data over HTTP range requests, so they need a
// network connection and longer timeouts. Kept out of the default `npm test`.
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
