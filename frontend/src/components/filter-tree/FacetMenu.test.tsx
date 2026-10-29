/**
 * The shared facet dropdown (PTR-01): a row's count and tick are what the
 * tab says, not something the dropdown computes, and a busy tick cannot be
 * pressed. The Channels counting is tested through `ChannelFacetMenu`.
 */
import { afterEach, expect, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { FacetMenu, type FacetMenuRow } from "./FacetMenu"

afterEach(cleanup)

const rows: FacetMenuRow[] = [
  { id: "a", label: "Alpha", selected: 3, total: 3, tick: "true" },
  { id: "b", label: "Beta", selected: 1, total: 4, tick: "mixed" },
  { id: "c", label: "Gamma", selected: 0, total: 9, tick: "false", busy: true },
]

test("rows show the tab's counts and ticks; a busy tick is disabled", () => {
  const picked: string[] = []
  render(
    <FacetMenu
      label="Kinds"
      noun="kind"
      testId="toy"
      rows={rows}
      funnelled={[]}
      labelOf={(id) => id}
      onToggleSelect={(row) => picked.push(row.id)}
      onFunnel={() => {}}
      onClearFunnels={() => {}}
      tickHint="Tick selects every match"
    />,
  )
  expect(screen.getByTestId("toy").textContent).toBe("Kinds2")
  fireEvent.click(screen.getByTestId("toy"))
  expect(screen.getByText("Tick selects every match")).toBeTruthy()
  expect(
    rows.map((row) => [
      screen.getByTestId(`toy-row-${row.id}`).getAttribute("aria-checked"),
      screen.getByTestId(`toy-count-${row.id}`).textContent,
    ]),
  ).toEqual([
    ["true", "3/3"],
    ["mixed", "1/4"],
    ["false", "0/9"],
  ])
  fireEvent.click(screen.getByTestId("toy-row-c"))
  fireEvent.click(screen.getByTestId("toy-row-b"))
  expect(picked).toEqual(["b"])
})

test("offers to create a searched name no row has, and clears the search once created", async () => {
  const created: string[] = []
  render(
    <FacetMenu
      label="Kinds"
      noun="kind"
      testId="toy"
      rows={rows}
      funnelled={[]}
      labelOf={(id) => id}
      onFunnel={() => {}}
      onClearFunnels={() => {}}
      onCreate={async (name) => {
        created.push(name)
        return true
      }}
    />,
  )
  fireEvent.click(screen.getByTestId("toy"))
  expect(screen.queryByTestId("toy-create")).toBeNull()
  expect(screen.getByText("Type a name to create a kind")).toBeTruthy()
  const search = screen.getByRole("searchbox") as HTMLInputElement
  fireEvent.change(search, { target: { value: "alpha" } })
  expect(screen.queryByTestId("toy-create")).toBeNull()
  fireEvent.change(search, { target: { value: "  Delta " } })
  expect(screen.getByTestId("toy-create").textContent).toBe(
    'Create kind "Delta"',
  )
  fireEvent.click(screen.getByTestId("toy-create"))
  await waitFor(() => expect(search.value).toBe(""))
  expect(created).toEqual(["Delta"])
})

// ---- Rename, delete, the row action and the held order (TGU-02) ------------

const tags: FacetMenuRow[] = [
  { id: "news", label: "News", selected: 0, total: 3, tick: "false" },
  { id: "world", label: "World", selected: 0, total: 5, tick: "false" },
  {
    id: "untagged",
    label: "Untagged",
    explanation: "Channels with no Tag",
    selected: 0,
    total: 2,
    tick: "false",
  },
]

type Calls = { renamed: string[]; deleted: string[] }

function renderTags(
  rows: FacetMenuRow[],
  calls: Calls,
  extra: Partial<React.ComponentProps<typeof FacetMenu>> = {},
) {
  const props = (next: FacetMenuRow[]) => (
    <FacetMenu
      label="Tags"
      noun="Tag"
      testId="tags"
      rows={next}
      funnelled={[]}
      labelOf={(id) => id}
      onToggleSelect={() => {}}
      onFunnel={() => {}}
      onClearFunnels={() => {}}
      manage={{
        onRename: (id, to) => calls.renamed.push(`${id}->${to}`),
        onDelete: (id) => calls.deleted.push(id),
        deleteText: (row) => `"${row.label}" is on ${row.total} channels.`,
        mergeText: (_id, to) =>
          to.toLowerCase() === "world" ? "World is already a Tag." : undefined,
      }}
      {...extra}
    />
  )
  const view = render(props(rows))
  return (next: FacetMenuRow[]) => view.rerender(props(next))
}

const shownIds = () =>
  screen
    .getAllByRole("checkbox")
    .map((row) => row.getAttribute("data-testid")?.replace("tags-row-", ""))

function rename(label: string, to: string) {
  fireEvent.click(screen.getByLabelText(`Rename ${label}`))
  const input = screen.getByLabelText(`New name for ${label}`)
  fireEvent.change(input, { target: { value: to } })
  fireEvent.submit(input)
}

test("holds the row order while open and shows the new order on reopen", () => {
  const rerender = renderTags(
    tags,
    { renamed: [], deleted: [] },
    {
      freezeOrder: true,
    },
  )
  const reversed = [tags[1], tags[0], tags[2]]
  fireEvent.click(screen.getByTestId("tags"))
  expect(shownIds()).toEqual(["news", "world", "untagged"])
  rerender(reversed)
  expect(shownIds()).toEqual(["news", "world", "untagged"])
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
  fireEvent.click(screen.getByTestId("tags"))
  expect(shownIds()).toEqual(["world", "news", "untagged"])
})

test("a rename onto a new name renames at once, onto another Tag's asks first", async () => {
  const calls: Calls = { renamed: [], deleted: [] }
  renderTags(tags, calls)
  fireEvent.click(screen.getByTestId("tags"))
  rename("News", "Headlines")
  expect(calls.renamed).toEqual(["news->Headlines"])
  expect(screen.queryByTestId("tags-merge-confirm")).toBeNull()

  rename("News", "world")
  expect(calls.renamed).toEqual(["news->Headlines"])
  expect(screen.getByText("World is already a Tag.")).toBeTruthy()
  fireEvent.click(screen.getByTestId("tags-merge-confirm"))
  await waitFor(() =>
    expect(calls.renamed).toEqual(["news->Headlines", "news->world"]),
  )
})

test("a delete asks first with the Tag's channel count", async () => {
  const calls: Calls = { renamed: [], deleted: [] }
  renderTags(tags, calls)
  fireEvent.click(screen.getByTestId("tags"))
  fireEvent.click(screen.getByLabelText("Delete World"))
  expect(calls.deleted).toEqual([])
  expect(screen.getByText('"World" is on 5 channels.')).toBeTruthy()
  fireEvent.click(screen.getByTestId("tags-delete-confirm"))
  await waitFor(() => expect(calls.deleted).toEqual(["world"]))
})

test("a derived row offers no rename or delete", () => {
  renderTags(tags, { renamed: [], deleted: [] })
  fireEvent.click(screen.getByTestId("tags"))
  expect(screen.getByLabelText("Rename News")).toBeTruthy()
  expect(screen.queryByLabelText("Rename Untagged")).toBeNull()
  expect(screen.queryByLabelText("Delete Untagged")).toBeNull()
})

test("a row reads select, name, its actions, count, filter", () => {
  renderTags(
    tags.slice(0, 1),
    { renamed: [], deleted: [] },
    {
      rowAction: {
        icon: "*",
        label: (row) => `Open ${row.label}`,
        onClick: () => {},
      },
    },
  )
  fireEvent.click(screen.getByTestId("tags"))
  const row = screen.getByTestId("tags-row-news").parentElement as HTMLElement
  const parts = [...row.children].map(
    (part) =>
      part.getAttribute("aria-label") ??
      part.getAttribute("role") ??
      part.textContent,
  )
  expect(parts).toEqual([
    "checkbox",
    "Open News",
    "Rename News",
    "Delete News",
    "0/3",
    "Show only News",
  ])
})
