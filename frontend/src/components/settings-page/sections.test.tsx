/**
 * The Settings page's grouping, landing and row save state (SET-02). The
 * Playwright spec drives these through the page; the CRAP ratchet only sees
 * unit coverage, so the rules are pinned here too.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { Row } from "./model"
import { Item, lastPassed } from "./SettingsPage"
import {
  buildSections,
  landingFor,
  linkTarget,
  type SettingsPageState,
} from "./sections"

afterEach(cleanup)

const row = (over: Partial<Row>): Row =>
  ({
    id: "sync.yours.interval",
    title: "Sync interval",
    description: "Minutes between syncs.",
    topic: "sync",
    scope: "account",
    type: "integer",
    value: 60,
    default: 30,
    defaultSource: "code",
    modified: true,
    canEdit: true,
    lockReason: null,
    applies: "now",
    storage: "tg_user_settings.sync.interval",
    sensitive: false,
    ...over,
  }) as Row

const registry = {
  topics: [
    { id: "account", title: "Account" },
    { id: "sync", title: "Channels & sync" },
    { id: "server", title: "Server" },
  ],
  rows: [
    row({}),
    row({ id: "sync.browser.zoom", scope: "browser", modified: false }),
    row({ id: "server.env.port", topic: "server", scope: "env" }),
  ],
  permissions: [],
} as unknown as Parameters<typeof buildSections>[0]

const ALL = { scope: "all", modifiedOnly: false, editableOnly: false } as const

describe("buildSections", () => {
  test("topics in order with their panels, scope groups and counts", () => {
    const sections = buildSections(registry, "", ALL, new Set())
    expect(sections.map((s) => s.id)).toEqual(["account", "sync", "server"])
    const sync = sections[1]
    expect(sync.groups.map((g) => g.scope)).toEqual(["browser", "account"])
    expect([sync.rowCount, sync.modifiedCount]).toEqual([2, 1])
    expect(sections[0].panels.length).toBeGreaterThan(0)
  })

  test(".env and code groups start folded unless searched or unfolded", () => {
    const server = (q: string, unfolded = new Set<string>()) =>
      buildSections(registry, q, ALL, unfolded).find((s) => s.id === "server")
        ?.groups[0].folded
    expect(server("")).toBe(true)
    expect(server("port")).toBe(false)
    expect(server("", new Set(["server.env"]))).toBe(false)
  })

  test("a value filter hides the panels, which hold no value", () => {
    const sections = buildSections(
      registry,
      "",
      { ...ALL, modifiedOnly: true },
      new Set(),
    )
    expect(sections.every((s) => s.panels.length === 0)).toBe(true)
    expect(sections.map((s) => s.id)).toEqual(["sync", "server"])
  })
})

describe("a Setting a panel shows (RKD-02)", () => {
  const jobs = {
    topics: [{ id: "jobs", title: "Background jobs" }],
    rows: [
      row({
        id: "jobs.deployment.probeRequestsEnabled",
        title: "Telegram work: Directory probe",
        topic: "jobs",
        scope: "deployment",
      }),
      row({ id: "jobs.deployment.other", title: "Other", topic: "jobs" }),
    ],
    permissions: ["jobs:manage"],
  } as unknown as Parameters<typeof buildSections>[0]
  const ids = (q: string, reg = jobs) =>
    buildSections(reg, q, ALL, new Set()).flatMap((s) => [
      ...s.panels.map((p) => p.id),
      ...s.groups.flatMap((g) => g.rows.map((r) => r.id)),
    ])

  test("is not a row of its own; a search for it finds the panel", () => {
    expect(ids("")).toEqual([
      "jobs.deployment.runs",
      "jobs.deployment.requestKinds",
      "jobs.deployment.other",
    ])
    expect(ids("Directory probe")).toEqual(["jobs.deployment.requestKinds"])
  })

  test("without the panel's Permission it stays a row", () => {
    expect(ids("Directory probe", { ...jobs, permissions: [] })).toEqual([
      "jobs.deployment.probeRequestsEnabled",
    ])
  })

  test("a link to it lands on the panel", () => {
    expect(
      linkTarget("jobs.deployment.probeRequestsEnabled", ["jobs:manage"]),
    ).toBe("jobs.deployment.requestKinds")
    expect(linkTarget("jobs.deployment.other", ["jobs:manage"])).toBe(
      "jobs.deployment.other",
    )
    expect(linkTarget(undefined, [])).toBeUndefined()
  })
})

describe("landingFor", () => {
  test("a topic lands on its heading, a row in the middle", () => {
    expect(landingFor("sync", registry)).toEqual({
      elementId: "settings-topic-sync",
      block: "start",
      unfold: null,
    })
    expect(landingFor("sync.yours.interval", registry)).toEqual({
      elementId: "setting-sync-yours-interval",
      block: "center",
      unfold: null,
    })
  })

  test("a panel lands at its top, since a long table centred hides its forms", () => {
    expect(landingFor("operator.deployment.users", registry)).toEqual({
      elementId: "setting-operator-deployment-users",
      block: "start",
      unfold: null,
    })
  })

  test("a folded .env row has its group opened first", () => {
    expect(landingFor("server.env.port", registry).unfold).toBe("server.env")
  })
})

describe("lastPassed", () => {
  test("the last heading above the line, or the first topic", () => {
    const tops: Record<string, number> = { a: -200, b: 40, c: 900 }
    expect(lastPassed(["a", "b", "c"], (id) => tops[id], 100)).toBe("b")
    expect(lastPassed(["a", "b"], () => undefined, 100)).toBe("a")
    expect(lastPassed([], () => 0, 100)).toBeNull()
  })
})

const page = (over: Partial<SettingsPageState>) =>
  ({
    query: "",
    flash: null,
    save: async () => {},
    reset: async () => {},
    ...over,
  }) as unknown as SettingsPageState

describe("Item", () => {
  test("a changed row names its default and resets to it", async () => {
    const reset = mock(async (_r: Row) => {})
    render(<Item row={row({})} page={page({ reset })} topicTitle="Sync" />)
    fireEvent.click(
      screen.getByRole("button", { name: /Changed · default 30/ }),
    )
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy())
  })

  test("a refused write shows the server's reason on the row", async () => {
    const save = mock(async (_r: Row, _v: unknown) => {
      throw new Error("Set by the Operator")
    })
    render(
      <Item
        row={row({ modified: false })}
        page={page({ save })}
        topicTitle="Sync"
      />,
    )
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "45" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Set by the Operator"),
    )
    expect(save.mock.calls[0][1]).toBe(45)
  })
})
