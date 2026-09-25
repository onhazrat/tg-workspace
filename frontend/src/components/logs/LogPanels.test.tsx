/**
 * The log panels and the filter bar, each rendered from props alone.
 *
 * `ActiveLogPanel` is the tab switch `LogsView` used to hold as a four-deep
 * ternary. What is pinned is what an operator reads off a card (title, meta
 * line, error) and which row a click acts on. Rows are rendered collapsed: an
 * expanded row fetches its bodies through react-query, which is the shell's
 * business, not the card's.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DEFAULT_LOG_FILTERS, type LogFilters } from "@/lib/logs/filters"
import type { LogTab } from "@/lib/logs/tabs"
import type {
  EmbeddingLog,
  LLMLogListItem,
  NetworkLog,
  PublishLogListItem,
  SyncLogListItem,
} from "@/types"
import { ActiveLogPanel, type LogRowsByTab } from "./ActiveLogPanel"
import { LogFilterBar } from "./LogFilterBar"

afterEach(cleanup)

const base = { timestamp: Date.UTC(2026, 0, 1) }

const publish: PublishLogListItem[] = [
  {
    ...base,
    id: "p1",
    summaryId: "s1",
    botId: "b1",
    botName: "Herald",
    chatId: "-100",
    chatName: "News",
    status: "success",
  },
  {
    ...base,
    id: "p2",
    summaryId: "s2",
    botId: "b1",
    botName: "Herald",
    chatId: "-100",
    chatName: "News",
    status: "failed",
    error: "chat not found",
  },
] as PublishLogListItem[]

const sync: SyncLogListItem[] = [
  {
    ...base,
    id: "y1",
    channelName: "alpha",
    source: "auto",
    status: "success",
    postsCount: 12,
    newLatestId: 99,
  },
  {
    ...base,
    id: "y2",
    channelName: "beta",
    source: "manual",
    status: "failed",
    postsCount: 0,
    error: "flood wait",
  },
] as SyncLogListItem[]

const llm: LLMLogListItem[] = [
  {
    ...base,
    id: "l1",
    model: "gemini-x",
    type: "chat_full_scope",
    status: "success",
    duration: 1200,
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    actedByEmail: "owner@example.com",
    tokens: 345,
    modelConfig: { temperature: 0.3 },
  },
  {
    ...base,
    id: "l2",
    model: "gemini-x",
    type: "summary",
    status: "failed",
    error: "quota exceeded",
  },
] as LLMLogListItem[]

const network: NetworkLog[] = [
  {
    ...base,
    id: "n1",
    url: "https://t.me/s/alpha",
    method: "GET",
    status: "success",
    duration: 80,
    proxyUsed: "socks5h://127.0.0.1:9050",
    attempts: 3,
    telemetry: { hops: 2 },
  },
  {
    ...base,
    id: "n2",
    url: "https://t.me/s/beta",
    method: "GET",
    status: "failed",
    attempts: 1,
    error: "timeout",
  },
] as NetworkLog[]

const embedding: EmbeddingLog[] = [
  {
    ...base,
    id: "e1",
    status: "success",
    tokensEstimated: 900,
    duration: 50,
    textCount: 4,
  },
  { ...base, id: "e2", status: "failed", textCount: 1, error: "bad input" },
] as EmbeddingLog[]

const logs: LogRowsByTab = { publish, sync, llm, network, embedding }
const perTab = <T,>(value: T): Record<LogTab, T> => ({
  publish: value,
  sync: value,
  llm: value,
  network: value,
  embedding: value,
})

function renderPanel(
  activeTab: LogTab,
  over: Partial<Parameters<typeof ActiveLogPanel>[0]> = {},
) {
  const onToggle = mock()
  const onDelete = mock()
  const onViewSummary = mock()
  const toggledFor: LogTab[] = []
  const deletedFor: LogTab[] = []
  render(
    <ActiveLogPanel
      activeTab={activeTab}
      logs={logs}
      loading={perTab(false)}
      visible={perTab(20)}
      expanded={perTab(null)}
      onToggleExpand={(tab) => {
        toggledFor.push(tab)
        return onToggle
      }}
      onDelete={(tab) => {
        deletedFor.push(tab)
        return onDelete
      }}
      onViewSummary={onViewSummary}
      {...over}
    />,
  )
  return { onToggle, onDelete, onViewSummary, toggledFor, deletedFor }
}

describe("ActiveLogPanel", () => {
  test("the publish panel names bot and destination, and links the summary", () => {
    const h = renderPanel("publish")
    expect(screen.getByText("Published Successfully")).toBeTruthy()
    expect(screen.getByText("Publish Failed")).toBeTruthy()
    expect(screen.getAllByText("Dest: News (-100)")).toHaveLength(2)
    expect(screen.getByText("chat not found")).toBeTruthy()
    fireEvent.click(screen.getAllByLabelText("View Summary in History")[1])
    expect(h.onViewSummary).toHaveBeenCalledWith("s2")
    fireEvent.click(screen.getAllByLabelText("Delete Log Entry")[0])
    expect(h.onDelete).toHaveBeenCalledWith("p1")
    fireEvent.click(screen.getAllByLabelText("Expand Details")[1])
    expect(h.onToggle).toHaveBeenCalledWith("p2")
    expect(h.toggledFor).toEqual(["publish"])
    expect(h.deletedFor).toEqual(["publish"])
  })

  test("the sync panel shows the new posts on success and the error on failure", () => {
    const h = renderPanel("sync")
    expect(screen.getByText("Sync Successful")).toBeTruthy()
    expect(screen.getByText("New Posts: 12")).toBeTruthy()
    expect(screen.getByText("99")).toBeTruthy()
    expect(screen.getByText("Sync Failed")).toBeTruthy()
    expect(screen.getByText("flood wait")).toBeTruthy()
    expect(screen.getByText("Channel: @beta")).toBeTruthy()
    expect(h.toggledFor).toEqual(["sync"])
    expect(h.deletedFor).toEqual(["sync"])
  })

  test("the LLM panel carries provider, runner and duration on the card", () => {
    renderPanel("llm")
    expect(screen.getByText("LLM Interaction")).toBeTruthy()
    expect(screen.getByText("LLM Error")).toBeTruthy()
    expect(screen.getByText("1200ms")).toBeTruthy()
    expect(screen.getByText("openrouter").getAttribute("title")).toBe(
      "https://openrouter.ai/api/v1",
    )
    expect(screen.getByText("Run by owner@example.com")).toBeTruthy()
    // One card has a runner, the other does not.
    expect(screen.getAllByText(/Run by/)).toHaveLength(1)
  })

  test("the network panel names the route and counts retries only past one", () => {
    renderPanel("network")
    expect(screen.getByText("Network Request")).toBeTruthy()
    expect(screen.getByText("Network Error")).toBeTruthy()
    expect(screen.getByText("Tor")).toBeTruthy()
    expect(screen.getByText("Direct")).toBeTruthy()
    expect(screen.getAllByText(/tries/)).toHaveLength(1)
    expect(screen.getByText("3 tries")).toBeTruthy()
  })

  test("the embedding panel estimates tokens, zero when none were counted", () => {
    renderPanel("embedding")
    expect(screen.getByText("Embedding Generation")).toBeTruthy()
    expect(screen.getByText("Embedding Error")).toBeTruthy()
    expect(screen.getByText("Tokens: 900")).toBeTruthy()
    expect(screen.getByText("Tokens: 0")).toBeTruthy()
  })

  test("an expanded row shows its details, and the rest stay collapsed", () => {
    renderPanel("embedding", {
      expanded: { ...perTab(null), embedding: "e2" },
    })
    expect(screen.getByText("Texts embedded: 1")).toBeTruthy()
    expect(screen.getByText("bad input")).toBeTruthy()
    expect(screen.queryByText("Texts embedded: 4")).toBeNull()
    expect(screen.getByLabelText("Collapse Details")).toBeTruthy()
    cleanup()
    renderPanel("network", { expanded: { ...perTab(null), network: "n1" } })
    expect(screen.getByText("Telemetry Data")).toBeTruthy()
  })

  test("only the visible count of rows renders", () => {
    renderPanel("publish", { visible: { ...perTab(20), publish: 1 } })
    expect(screen.getByText("Published Successfully")).toBeTruthy()
    expect(screen.queryByText("Publish Failed")).toBeNull()
  })

  test.each(["publish", "sync", "llm", "network", "embedding"] as const)(
    "the %s panel says loading, then empty, never both",
    (tab) => {
      renderPanel(tab, { loading: { ...perTab(false), [tab]: true } })
      expect(screen.getByLabelText("Loading logs")).toBeTruthy()
      expect(screen.queryByText(/logs found/)).toBeNull()
      cleanup()
      renderPanel(tab, { logs: { ...logs, [tab]: [] } })
      expect(screen.getByText(/No .* logs found/)).toBeTruthy()
      expect(screen.queryByLabelText("Loading logs")).toBeNull()
    },
  )
})

describe("LogFilterBar", () => {
  function renderBar(
    activeTab: LogTab,
    filters: Partial<LogFilters> = {},
    showFilters = true,
  ) {
    const h = {
      onFiltersChange: mock(),
      onToggleFilters: mock(),
      onClearAllFilters: mock(),
    }
    const view = render(
      <LogFilterBar
        activeTab={activeTab}
        filters={{ ...DEFAULT_LOG_FILTERS, ...filters }}
        showFilters={showFilters}
        modelOptions={["gpt-x"]}
        botOptions={["herald"]}
        channelOptions={["alpha"]}
        {...h}
      />,
    )
    return { ...h, ...view }
  }

  test("the search box is named for the tab, and clears only when it has text", () => {
    const h = renderBar("sync", {}, false)
    const box = screen.getByPlaceholderText("SEARCH SYNC LOGS...")
    fireEvent.change(box, { target: { value: "alpha" } })
    expect(h.onFiltersChange).toHaveBeenCalledWith({ searchQuery: "alpha" })
    expect(h.container.querySelectorAll("button")).toHaveLength(1)
    fireEvent.click(screen.getByLabelText("Search in Details"))
    expect(h.onFiltersChange).toHaveBeenCalledWith({ searchInDetails: true })
    fireEvent.click(screen.getByText("Filters"))
    expect(h.onToggleFilters).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("Status")).toBeNull()
    cleanup()
    const again = renderBar("sync", { searchQuery: "alpha" }, false)
    const buttons = again.container.querySelectorAll("button")
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[0])
    expect(again.onFiltersChange).toHaveBeenCalledWith({ searchQuery: "" })
  })

  test("each tab gets only its own dropdown", () => {
    renderBar("llm")
    expect(screen.getByText("ALL MODELS")).toBeTruthy()
    expect(screen.getByText("GPT-X")).toBeTruthy()
    expect(screen.queryByText("ALL BOTS")).toBeNull()
    cleanup()
    renderBar("publish")
    expect(screen.getByText("HERALD")).toBeTruthy()
    expect(screen.queryByText("ALL CHANNELS")).toBeNull()
    cleanup()
    renderBar("sync")
    expect(screen.getByText("ALPHA")).toBeTruthy()
    expect(screen.queryByText("ALL MODELS")).toBeNull()
    cleanup()
    const { container } = renderBar("network")
    expect(container.querySelectorAll("select")).toHaveLength(0)
  })

  test("the dropdowns, status chips and dates report their patch", () => {
    const h = renderBar("llm", { statusFilter: "failed" })
    fireEvent.change(h.container.querySelector("select") as HTMLElement, {
      target: { value: "gpt-x" },
    })
    expect(h.onFiltersChange).toHaveBeenCalledWith({ modelFilter: "gpt-x" })
    expect(screen.getByText("failed").className).toContain("bg-app-ink")
    fireEvent.click(screen.getByText("success"))
    expect(h.onFiltersChange).toHaveBeenCalledWith({ statusFilter: "success" })
    const [start, end] = h.container.querySelectorAll("input[type=date]")
    fireEvent.change(start, { target: { value: "2026-01-02" } })
    expect(h.onFiltersChange).toHaveBeenCalledWith({
      startDate: new Date("2026-01-02T00:00:00").getTime(),
    })
    fireEvent.change(end, { target: { value: "2026-01-05" } })
    expect(h.onFiltersChange).toHaveBeenCalledWith({
      endDate: new Date("2026-01-05T00:00:00").getTime(),
    })
    cleanup()
    const pub = renderBar("publish")
    fireEvent.change(pub.container.querySelector("select") as HTMLElement, {
      target: { value: "herald" },
    })
    expect(pub.onFiltersChange).toHaveBeenCalledWith({ botFilter: "herald" })
    cleanup()
    const syn = renderBar("sync")
    fireEvent.change(syn.container.querySelector("select") as HTMLElement, {
      target: { value: "alpha" },
    })
    expect(syn.onFiltersChange).toHaveBeenCalledWith({ channelFilter: "alpha" })
  })

  test("Clear All Filters is live only while a filter is set", () => {
    renderBar("network")
    const idle = screen.getByText("Clear All Filters") as HTMLButtonElement
    expect(idle.disabled).toBe(true)
    cleanup()
    const h = renderBar("network", { statusFilter: "failed" })
    fireEvent.click(screen.getByText("Clear All Filters"))
    expect(h.onClearAllFilters).toHaveBeenCalledTimes(1)
  })
})
