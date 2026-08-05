import { defineConfig } from "@playwright/test";

/**
 * Port 3000 (and often 3001) is routinely held by an unrelated project on
 * this machine. A hardcoded 3000 here would silently point every test at
 * that OTHER app instead of failing loudly -- worse than a red test run.
 * So the dev server is started on an explicit, unusual port via `-p`, and
 * baseURL is derived from the exact same constant. Override with
 * PLAYWRIGHT_PORT if 3100 is ever occupied too.
 */
const PORT = process.env.PLAYWRIGHT_PORT ?? "3100";
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: { baseURL },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
