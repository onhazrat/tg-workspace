/**
 * The Tags dropdown the Directory and the Requests tab share (TGU-03): its
 * rows, counts and ticks come from one read of the tab's Tag order when it
 * opens, a Tag with none of the tab's Channels is not listed, and selecting a
 * Tag hands the tab that one Tag's handles and records a Tag use.
 */
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { toast } from "sonner"
import { configureGeneratedClient } from "@/api/generated-client"
import { client } from "@/client/client.gen"
import { queryClient } from "@/lib/queryClient"
import { TagsDropdown } from "./TagsDropdown"

type Sent = { method: string; path: string; body: unknown }
let sent: Sent[] = []

/** Every Tag, and each one's channels in scope, selected and score. */
const TAGS = [
  { name: "Big", channels: 900 },
  { name: "Bank", channels: 12 },
  { name: "Art", channels: 4 },
  { name: "Elsewhere", channels: 30 },
  { name: "group:Slow", channels: 7 },
]
const ORDER = [
  { name: "Big", channels: 3, selected: 0, score: 0 },
  { name: "Bank", channels: 2, selected: 2, score: 1.5 },
  { name: "Art", channels: 4, selected: 1, score: 0 },
  { name: "Elsewhere", channels: 0, selected: 0, score: 4 },
]
const HANDLES: Record<string, string[]> = { Bank: ["bnk1", "bnk2"] }

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  })

beforeEach(() => {
  sent = []
  configureGeneratedClient()
  client.setConfig({
    baseUrl: "http://api.test",
    fetch: (async (request: Request) => {
      const url = new URL(request.url)
      const text = await request.text()
      sent.push({
        method: request.method,
        path: url.pathname + url.search,
        body: text ? JSON.parse(text) : undefined,
      })
      if (url.pathname.endsWith("/tags")) return json(TAGS)
      if (url.pathname.endsWith("/tags/order"))
        return json(ORDER.map((row) => ({ ...row, lastUsedAt: null })))
      if (url.pathname.endsWith("/tags/channels")) {
        const handles = HANDLES[url.searchParams.get("name") ?? ""]
        return handles
          ? json({ handles })
          : new Response('{"detail":"boom"}', { status: 500 })
      }
      return json({ changed: 1 })
    }) as unknown as typeof fetch,
  })
})

const realConfig = client.getConfig()

afterEach(() => {
  cleanup()
  queryClient.clear()
  client.setConfig({ fetch: realConfig.fetch, baseUrl: realConfig.baseUrl })
})

function mount() {
  const selections: { handles: string[]; on: boolean }[] = []
  const funnels: [string, boolean][] = []
  render(
    <QueryClientProvider client={queryClient}>
      <TagsDropdown
        tab="requests"
        testId="tags"
        tickHint="Select adds its channels"
        scope={["bnk1", "bnk2", "art1"]}
        selected={["bnk1", "bnk2"]}
        onSelect={(handles, on) => selections.push({ handles, on })}
        funnelled={[]}
        onFunnel={(name, on) => funnels.push([name, on])}
        onClearFunnels={() => {}}
      />
    </QueryClientProvider>,
  )
  return { selections, funnels }
}

const reads = () =>
  sent.filter(
    (s) =>
      s.path.endsWith("/tags/order") &&
      (s.body as { selected?: string[] }).selected !== undefined,
  )
const rowIds = () =>
  screen
    .getAllByTestId(/^tags-row-/)
    .map((row) => row.dataset.testid?.replace("tags-row-", ""))

async function open() {
  fireEvent.click(screen.getByTestId("tags"))
  await waitFor(() =>
    expect(screen.getByTestId("tags-count-Bank").textContent).toBe("2/2"),
  )
}

test("one read on open gives the rows, counts and ticks; Tags with none of the tab's Channels are left out", async () => {
  mount()
  await open()
  expect(reads().map((s) => s.body)).toEqual([
    {
      tab: "requests",
      scope: ["bnk1", "bnk2", "art1"],
      selected: ["bnk1", "bnk2"],
    },
  ])
  // By Tag use, then the tab's channels, then name; no Elsewhere, no group.
  expect(rowIds()).toEqual(["Bank", "Art", "Big"])
  expect(
    ["Bank", "Art", "Big"].map((id) => [
      screen.getByTestId(`tags-row-${id}`).getAttribute("aria-checked"),
      screen.getByTestId(`tags-count-${id}`).textContent,
    ]),
  ).toEqual([
    ["true", "2/2"],
    ["mixed", "1/4"],
    ["false", "0/3"],
  ])
  expect(screen.getByText("Select adds its channels")).toBeTruthy()
})

test("selecting a Tag hands the tab that one Tag's handles and records a use", async () => {
  const { selections } = mount()
  await open()
  fireEvent.click(screen.getByTestId("tags-row-Bank"))
  await waitFor(() => expect(selections.length).toBe(1))
  // Bank is all selected, so selecting it again takes its Channels out.
  expect(selections).toEqual([{ handles: ["bnk1", "bnk2"], on: false }])
  const handleReads = sent.filter((s) => s.path.includes("/tags/channels"))
  expect(handleReads.map((s) => s.path)).toEqual([
    "/api/v1/data/tags/channels?name=Bank",
  ])
  await waitFor(() =>
    expect(
      sent.filter((s) => s.path.endsWith("/tags/uses")).map((s) => s.body),
    ).toEqual([{ tab: "requests", name: "Bank" }]),
  )
})

test("a failed read of a Tag's channels says so and selects nothing", async () => {
  const error = spyOn(toast, "error").mockImplementation(() => "")
  const { selections } = mount()
  await open()
  fireEvent.click(screen.getByTestId("tags-row-Art"))
  await waitFor(() => expect(error).toHaveBeenCalledTimes(1))
  expect(selections).toEqual([])
  error.mockRestore()
})

test("the funnel filters by the Tag", async () => {
  const { funnels } = mount()
  await open()
  fireEvent.click(screen.getByTestId("tags-funnel-Art"))
  expect(funnels).toEqual([["Art", true]])
})
