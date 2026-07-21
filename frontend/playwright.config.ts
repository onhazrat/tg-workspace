import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig, devices } from "@playwright/test"
import dotenv from "dotenv"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, "../.env") })

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const playwrightApiUrl = process.env.PLAYWRIGHT_API_URL
const devPort = playwrightApiUrl ? "5180" : "5173"
const baseURL = `http://localhost:${devPort}`

export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /*
   * Always one worker. Every spec shares a single backend, database and user
   * account, and most setup paths fetch the unbounded channel list, so workers
   * starve each other: parallel runs took 6.8-16.5 min and failed 1-3 specs at
   * random (a different set each run), while the same suite passes 51/51 in
   * 2.6 min serially. Contention was costing far more in timeout waits than
   * parallelism ever bought.
   */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI ? 'blob' : 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    ...(process.env.PLAYWRIGHT_CHANNEL
      ? {
          channel: process.env.PLAYWRIGHT_CHANNEL as
            | 'chrome'
            | 'chromium'
            | 'msedge',
        }
      : {}),
  },

  /* Configure projects for major browsers */
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },

    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // {
    //   name: 'firefox',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     storageState: 'playwright/.auth/user.json',
    //   },
    //   dependencies: ['setup'],
    // },

    // {
    //   name: 'webkit',
    //   use: {
    //     ...devices['Desktop Safari'],
    //     storageState: 'playwright/.auth/user.json',
    //   },
    //   dependencies: ['setup'],
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: playwrightApiUrl
      ? `PLAYWRIGHT_API_URL=${playwrightApiUrl} bun run dev -- --port ${devPort} --strictPort`
      : "bun run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
