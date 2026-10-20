import type { Page, Route } from "@playwright/test"
import { expect, test } from "./fixtures.ts"

// The Settings page (SET-02) with the registry mocked, so the rows are known
// and no write reaches the database. The panels still read the real backend.

const TOPICS = [
  ["account", "Account"],
  ["appearance", "Appearance"],
  ["sync", "Channels & sync"],
  ["ai", "AI & models"],
  ["publishing", "Publishing"],
  ["network", "Network"],
  ["retention", "Retention"],
  ["directory", "Directory & Discover"],
  ["reach", "Reach"],
  ["media", "Media"],
  ["jobs", "Background jobs"],
  ["quota", "Quota"],
  ["access", "Access & sessions"],
  ["email", "Email"],
  ["database", "Database"],
  ["server", "Server"],
  ["operator", "Operator"],
].map(([id, title]) => ({ id, title }))

type Row = Record<string, unknown> & { id: string }

function row(id: string, overrides: Record<string, unknown>): Row {
  const [topic, segment] = id.split(".")
  const scope =
    segment === "yours" ? "account" : segment === "env" ? "env" : segment
  return {
    id,
    title: id,
    description: "",
    topic,
    scope,
    type: "integer",
    options: [],
    min: null,
    max: null,
    value: 1,
    default: 1,
    defaultSource: "code",
    modified: false,
    canEdit: true,
    lockReason: null,
    applies: "now",
    storage: `tg_user_settings.x.${id}`,
    sensitive: false,
    envName: null,
    sourceRef: null,
    ...overrides,
  }
}

const ROWS: Row[] = [
  row("retention.yours.logDays", {
    title: "Keep your logs for",
    description: "Days your publish, AI and embedding logs are kept.",
    value: 7,
    default: 7,
    min: 0,
    max: 30,
    defaultSource: "env",
  }),
  row("retention.yours.discoverReportDays", {
    title: "Keep Discover reports for",
    description: "Days your saved Discover reports are kept.",
    value: 30,
    default: 90,
    min: 0,
    modified: true,
  }),
  row("retention.deployment.postDays", {
    title: "Keep Posts for",
    description: "Days a Post is kept before retention deletes it.",
    value: 365,
    default: 365,
    canEdit: false,
    lockReason: "Set by the Operator",
    storage: "tg_app_settings.retention.postRetentionDays",
  }),
  row("sync.deployment.intervalMinutes", {
    title: "Sync interval",
    description: "How stale a followed channel may get.",
    value: 60,
    default: 60,
  }),
  row("publishing.yours.citationStyle", {
    title: "Citation style",
    type: "enum",
    value: "asWritten",
    default: "asWritten",
    options: [
      { value: "asWritten", label: "As written" },
      { value: "channelName", label: "Channel name" },
      { value: "numbered", label: "Numbered" },
    ],
    storage: "tg_user_settings.publishing.citationStyle",
  }),
  row("server.env.logLevel", {
    title: "Log level",
    type: "string",
    value: "INFO",
    default: "INFO",
    canEdit: false,
    lockReason: "Read at startup: change .env and restart",
    applies: "restart",
    storage: ".env LOG_LEVEL",
  }),
]

interface Mock {
  puts: { id: string; body: Record<string, unknown> }[]
}

// Configuration (SET-04): what an Operator holding settings:manage also reads.
const CONFIGURATION: Row[] = [
  row("server.env.slowRequestLogMs", {
    title: "Slow request log ms",
    value: 500,
    default: 1000,
    modified: true,
    canEdit: false,
    lockReason: "Read at startup: change .env and restart",
    applies: "restart",
    storage: ".env: SLOW_REQUEST_LOG_MS",
    envName: "SLOW_REQUEST_LOG_MS",
  }),
  row("server.env.secretKey", {
    title: "Secret key",
    type: "string",
    value: "set",
    default: null,
    canEdit: false,
    lockReason: "Read at startup: change .env and restart",
    applies: "restart",
    sensitive: true,
    storage: "Environment: SECRET_KEY",
    envName: "SECRET_KEY",
  }),
  row("network.env.viteTelegramWebDomain", {
    title: "Telegram web domain",
    type: "string",
    value: null,
    default: "t.me",
    canEdit: false,
    lockReason: "Built into the frontend: change .env and rebuild",
    applies: "rebuild",
    storage: "Frontend build: VITE_TELEGRAM_WEB_DOMAIN",
    envName: "VITE_TELEGRAM_WEB_DOMAIN",
  }),
  row("sync.code.channelClaimLeaseSeconds", {
    title: "Channel claim lease seconds",
    value: 300,
    default: 300,
    canEdit: false,
    lockReason: "Constant in code: needs a deploy",
    applies: "deploy",
    storage: "backend/app/services/channels.py:40",
    sourceRef: "backend/app/services/channels.py:40",
  }),
]

async function mockRegistry(page: Page, extra: Row[] = []): Promise<Mock> {
  const mock: Mock = { puts: [] }
  await page.route("**/api/v1/settings/registry", (route) =>
    route.fulfill({
      json: { topics: TOPICS, rows: [...ROWS, ...extra], permissions: [] },
    }),
  )
  await page.route(
    /\/api\/v1\/settings\/(?!registry)[^/?]+$/,
    (route: Route) => {
      const id = decodeURIComponent(
        new URL(route.request().url()).pathname.split("/").pop() ?? "",
      )
      const body = route.request().postDataJSON() as Record<string, unknown>
      mock.puts.push({ id, body })
      const current = ROWS.find((r) => r.id === id) as Row
      if (body.value === 13) {
        return route.fulfill({
          status: 422,
          json: { detail: "Refused by the server" },
        })
      }
      const value = body.reset ? current.default : body.value
      return route.fulfill({
        json: { ...current, value, modified: value !== current.default },
      })
    },
  )
  return mock
}

async function openSettings(page: Page, query = "") {
  await page.goto(`/?tab=settings${query}`)
  await expect(page.getByTestId("settings-search")).toBeVisible()
  await expect(page.locator("#setting-retention-yours-logDays")).toBeAttached()
}

const search = (page: Page) => page.getByTestId("settings-search")
const item = (page: Page, id: string) =>
  page.locator(`#setting-${id.replace(/\./g, "-")}`)
const contents = (page: Page) =>
  page.getByRole("navigation", { name: "Settings contents" })

test.describe("Settings page", () => {
  test("search matches words and operators, highlights, and says when nothing matches", async ({
    page,
  }) => {
    await mockRegistry(page)
    await openSettings(page)

    await search(page).fill("logs")
    await expect(
      item(page, "retention.yours.logDays").locator("mark").first(),
    ).toHaveText("logs")
    await expect(item(page, "sync.deployment.intervalMinutes")).toHaveCount(0)

    await search(page).fill("@modified")
    await expect(item(page, "retention.yours.discoverReportDays")).toBeVisible()
    await expect(item(page, "retention.yours.logDays")).toHaveCount(0)

    await search(page).fill("@editable")
    await expect(item(page, "retention.deployment.postDays")).toHaveCount(0)
    await expect(item(page, "retention.yours.logDays")).toBeVisible()

    await search(page).fill("@scope:deployment")
    await expect(item(page, "retention.deployment.postDays")).toBeVisible()
    await expect(item(page, "retention.yours.logDays")).toHaveCount(0)

    await search(page).fill("@id:publishing")
    await expect(item(page, "publishing.yours.citationStyle")).toBeVisible()
    await expect(item(page, "retention.yours.logDays")).toHaveCount(0)

    await search(page).fill("zzzz-nothing")
    await expect(page.getByText("Nothing matches.")).toBeVisible()

    await search(page).fill("")
    await page.getByRole("button", { name: "Search syntax" }).click()
    await page.getByRole("button", { name: "@modified" }).click()
    await expect(search(page)).toHaveValue("@modified ")
  })

  test("the pills filter the page and the count says what they hid", async ({
    page,
  }) => {
    await mockRegistry(page)
    await openSettings(page)
    const count = page.getByTestId("settings-count")
    await expect(count).toHaveText(/6 of 6 settings · 1 changed from default/)

    await page.getByRole("button", { name: "Changed only" }).click()
    await expect(count).toHaveText(/1 of 6 settings/)
    await page.getByRole("button", { name: "Changed only" }).click()

    await page.getByRole("button", { name: /Scope/ }).click()
    await page.getByRole("radio", { name: "Deployment" }).click()
    await expect(count).toHaveText(/2 of 6 settings/)
  })

  test("the contents count changes, fold, follow the reading and remember folding", async ({
    page,
  }) => {
    await mockRegistry(page)
    await openSettings(page)
    const tree = contents(page)

    // The topic being read opens on its own.
    await expect(tree.getByRole("button", { name: "Profile" })).toBeVisible()

    const retention = tree.getByRole("link", { name: /^Retention/ })
    await expect(retention.getByTestId("settings-changed-count")).toHaveText(
      "1",
    )
    await tree.getByRole("button", { name: "Expand Retention" }).click()
    const yours = tree.getByRole("button", { name: /^Your account/ })
    await expect(yours.getByTestId("settings-changed-count")).toHaveText("1")

    await page.reload()
    await expect(
      contents(page).getByRole("button", { name: "Collapse Retention" }),
    ).toBeVisible()

    await contents(page).getByRole("button", { name: "Expand all" }).click()
    await expect(
      contents(page).getByRole("button", { name: "Collapse Publishing" }),
    ).toBeVisible()
    await contents(page).getByRole("button", { name: "Collapse all" }).click()
    await expect(
      contents(page).getByRole("button", { name: "Expand Retention" }),
    ).toBeVisible()
  })

  test("a .env group stays hidden until chosen in the contents", async ({
    page,
  }) => {
    await mockRegistry(page)
    await openSettings(page)
    await expect(item(page, "server.env.logLevel")).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "Show 1 .env values" }),
    ).toBeVisible()

    await contents(page).getByRole("button", { name: "Expand Server" }).click()
    await contents(page)
      .getByRole("button", { name: /^\.env/ })
      .click()
    await expect(item(page, "server.env.logLevel")).toBeVisible()
  })

  test("Configuration is found by @restart and @scope, says what it costs, and counts as changed", async ({
    page,
  }) => {
    await mockRegistry(page, CONFIGURATION)
    await openSettings(page)

    // A changed .env value counts in the contents even while its group is folded.
    const server = contents(page).getByRole("link", { name: /^Server/ })
    await expect(server.getByTestId("settings-changed-count")).toHaveText("1")
    await expect(item(page, "server.env.slowRequestLogMs")).toHaveCount(0)

    await search(page).fill("@restart")
    await expect(item(page, "server.env.slowRequestLogMs")).toContainText(
      "Restart to apply",
    )
    await expect(item(page, "server.env.secretKey")).toContainText("set")
    await expect(item(page, "server.env.logLevel")).toBeVisible()
    await expect(item(page, "network.env.viteTelegramWebDomain")).toHaveCount(0)
    await expect(item(page, "sync.code.channelClaimLeaseSeconds")).toHaveCount(
      0,
    )
    await expect(item(page, "retention.yours.logDays")).toHaveCount(0)

    await search(page).fill("@scope:code")
    const constant = item(page, "sync.code.channelClaimLeaseSeconds")
    await expect(constant).toContainText("Needs a deploy")
    await expect(constant).toContainText("backend/app/services/channels.py:40")
    await expect(item(page, "server.env.slowRequestLogMs")).toHaveCount(0)

    // A build value shows what this bundle runs, not the server's null.
    await search(page).fill("@scope:env telegram")
    const build = item(page, "network.env.viteTelegramWebDomain")
    await expect(build).toContainText("Rebuild to apply")
    await expect(build).toContainText("t.me")
  })

  test("?setting= and an old ?section= land where they point", async ({
    page,
  }) => {
    await mockRegistry(page)
    await openSettings(page, "&setting=retention.yours.discoverReportDays")
    await expect(
      item(page, "retention.yours.discoverReportDays"),
    ).toBeInViewport()
    await expect(item(page, "retention.yours.discoverReportDays")).toHaveClass(
      /bg-blue-500/,
    )

    await openSettings(page, "&section=publishing")
    await expect(page.locator("#settings-topic-publishing")).toBeInViewport()
  })

  test("a row saves on Enter, refuses out of bounds, shows a server refusal and resets", async ({
    page,
  }) => {
    const mock = await mockRegistry(page)
    await openSettings(page)

    const logDays = item(page, "retention.yours.logDays")
    const field = logDays.getByRole("textbox", { name: "Keep your logs for" })
    await field.fill("99")
    await field.press("Enter")
    await expect(field).toHaveAttribute("aria-invalid", "true")
    expect(mock.puts).toHaveLength(0)

    await field.fill("12")
    await field.press("Enter")
    await expect(logDays.getByText("Saved")).toBeVisible()
    await expect(logDays.getByText("Changed · default 7")).toBeVisible()
    expect(mock.puts).toEqual([
      { id: "retention.yours.logDays", body: { value: 12 } },
    ])

    const reports = item(page, "retention.yours.discoverReportDays")
    const reportField = reports.getByRole("textbox")
    await reportField.fill("13")
    await reportField.press("Enter")
    await expect(reports.getByRole("alert")).toHaveText("Refused by the server")
    await expect(reportField).toHaveValue("13")
    await expect(reportField).toHaveAttribute("aria-invalid", "true")

    await reports.getByText("Changed · default 90").click()
    await expect(reports.getByText("Changed · default 90")).toHaveCount(0)
    expect(mock.puts.at(-1)).toEqual({
      id: "retention.yours.discoverReportDays",
      body: { reset: true },
    })
  })

  test("the palette sets a Setting and goes to a topic", async ({ page }) => {
    const mock = await mockRegistry(page)
    await openSettings(page)

    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("citation style numbered")
    await page
      .getByRole("option", { name: "Set Citation style → Numbered" })
      .click()
    await expect
      .poll(() => mock.puts.at(-1))
      .toEqual({
        id: "publishing.yours.citationStyle",
        body: { value: "numbered" },
      })

    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("go to settings retention")
    await page
      .getByRole("option", { name: "Go to Settings → Retention" })
      .click()
    await expect(page).toHaveURL(/setting=retention/)
    await expect(page.locator("#settings-topic-retention")).toBeInViewport()
  })

  test("on a phone the contents open from a pill", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await mockRegistry(page)
    await openSettings(page)
    await expect(contents(page)).toBeHidden()
    await page.getByRole("button", { name: "Contents" }).click()
    await expect(
      page.getByRole("dialog").getByRole("link", { name: /^Retention/ }),
    ).toBeVisible()
  })
})
