import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://garum.localhost:3000" },
  webServer: {
    command: "pnpm --filter @suarex/web dev",
    url: "http://garum.localhost:3000/1",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
