import { defineConfig } from "vitest/config";

// Unit tests: offline, deterministic. Integration tests (which hit the network)
// live in *.integration.test.ts and run via `npm run test:integration`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
    testTimeout: 20000,
  },
});
