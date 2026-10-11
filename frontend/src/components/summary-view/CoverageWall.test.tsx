/**
 * The coverage wall and the Channel posts sheet (SUMTAB-06), in a Summary
 * rendered the way the tab renders it. What is pinned: Channels ordered by
 * distinct Cited Posts, then Covered Posts; each badge's two halves; a cited
 * Channel outside the Scope flagged; a Summary with no Covered Posts on record
 * counting Citations only and saying so; and the sheet listing "Cited in the
 * summary" before "Also covered", 20 at a time, with Find closing it and
 * finding the Citation.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import ReactMarkdown from "react-markdown"
import { api } from "@/api"
import type { ScopedPostRef } from "@/client"
import { CITATION_ATTR, FOUND_ATTR } from "@/lib/citations/find-citation"
import { splitCitations } from "@/lib/citations/replace-citations"
import { citedPostResolver } from "@/lib/summaries/cited-posts"
import { parseCitationRefs } from "@/lib/summaries/summary-model"
import type { Post, Summary } from "@/types"
import { HIGHLIGHT_ATTR } from "./CoverageWall"
import { SummaryBody } from "./SummaryBody"
import { SummaryCitation } from "./SummaryCitation"

const post = (channelName: string, id: number): Post => ({
  id,
  channelName,
  text: `${channelName} post ${id}`,
  date: "2026-10-07T09:00:00Z",
  timestamp: Date.UTC(2026, 9, 7, 9),
})

const refs = (channelName: string, ids: number[]): ScopedPostRef[] =>
  ids.map((postId) => ({ channelName, postId }))

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)

// bank: 2 Cited Posts (one cited twice), 3 covered. gov: 1 and 2, radio: 1
// and 1, so gov passes radio on Covered Posts though radio is first in the
// Scope. rogue: 1 cited, outside the Scope. quiet: never cited, 5 covered.
const PROSE =
  "Rates rose [bank #10], said [gov #20], [radio #30], [bank #11] and [bank #10] again; [rogue #9] too."
const COVERED = [
  ...refs("quiet", range(1, 5)),
  ...refs("bank", [10, 11, 12]),
  ...refs("gov", [20, 21]),
  ...refs("radio", [30]),
]

const lookupPosts = api.lookupPosts
const scrollIntoView = HTMLElement.prototype.scrollIntoView
let looked: ScopedPostRef[][] = []
let scrolled: Element[] = []
beforeEach(() => {
  looked = []
  api.lookupPosts = async (r) => {
    looked.push(r)
    return r.map((x) => post(x.channelName, x.postId))
  }
  scrolled = []
  HTMLElement.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this)
  }
})
afterEach(() => {
  cleanup()
  api.lookupPosts = lookupPosts
  HTMLElement.prototype.scrollIntoView = scrollIntoView
})

function renderSummary(
  prose: string,
  covered: ScopedPostRef[] | null,
  channels = ["quiet", "radio", "bank", "gov"],
  loading = false,
) {
  const resolve = citedPostResolver({
    live: parseCitationRefs(prose).map((r) => post(r.channelName, r.postId)),
    snapshot: {},
    covered,
  })
  const summary: Summary = {
    id: "s1",
    text: prose,
    language: "English",
    timestamp: 0,
    scope: { channels, start: 0, end: 1, posts: covered },
  }
  const workspace = { channel: () => undefined, onAddChannel: mock() }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <SummaryBody
        summary={summary}
        promptText={undefined}
        body={prose}
        isPending={false}
        summarizing={false}
        running={false}
        direction={{ dir: "ltr", className: "" }}
        onRerun={() => {}}
        onPaste={() => {}}
        editingNote={false}
        onEditingNoteChange={() => {}}
        onSaveNote={async () => {}}
        onDeleteNote={async () => {}}
        publishPanel={() => null}
        scopeLine={() => null}
        emptyState={null}
        zone={{ timeZone: "UTC", locale: "en-US" }}
        textSize="M"
        onTextSizeChange={() => {}}
        workspace={workspace}
        cited={{
          posts: parseCitationRefs(prose).map((r) =>
            resolve(r.channelName, r.postId),
          ),
          loading,
          covered,
        }}
        renderMarkdown={(md) => (
          <ReactMarkdown
            components={{
              p: ({ children }) => (
                <p>
                  {splitCitations(children, (channelName, postId, key) => (
                    <SummaryCitation
                      key={key}
                      cited={resolve(channelName, postId)}
                      loading={false}
                      sheet={false}
                      workspace={workspace}
                    />
                  ))}
                </p>
              ),
            }}
          >
            {md}
          </ReactMarkdown>
        )}
      />
    </QueryClientProvider>,
  )
}

const wall = () => screen.getByRole("region", { name: "Channel coverage" })
const avatars = () => within(wall()).getAllByRole("button", { pressed: false })
const badge = (avatar: HTMLElement) =>
  [...avatar.querySelectorAll("[data-badge]")].map(
    (half) => `${half.getAttribute("data-badge")}:${half.textContent}`,
  )

describe("the coverage wall", () => {
  test("orders by Cited Posts then Covered Posts, each with a split badge", () => {
    renderSummary(PROSE, COVERED)
    expect(avatars().map((a) => a.getAttribute("aria-label"))).toEqual([
      "bank: 2 cited, 3 covered",
      "gov: 1 cited, 2 covered",
      "radio: 1 cited, 1 covered",
      "rogue: 1 cited, 0 covered, outside the Scope",
      "quiet: 0 cited, 5 covered",
    ])
    const [bank, gov, , rogue, quiet] = avatars()
    expect(badge(bank)).toEqual(["cited:2", "covered:3"])
    expect(badge(gov)).toEqual(["cited:1", "covered:2"])
    // Nothing covered and nothing to say: the grey half goes.
    expect(badge(rogue)).toEqual(["cited:1"])
    expect(badge(quiet)).toEqual(["covered:5"])
    expect(within(wall()).getByText("Outside the Scope")).toBeTruthy()
    // Never cited is greyed out, its count kept.
    expect(quiet.className).toContain("grayscale")
    expect(bank.className).not.toContain("grayscale")
    expect(
      within(wall()).getByText("4 of 5 channels cited · 11 posts used"),
    ).toBeTruthy()
    expect(within(wall()).getByText(/2 of the 12 posts/)).toBeTruthy()
  })

  test("waits for the Cited Posts rather than counting too early", () => {
    renderSummary(PROSE, COVERED, undefined, true)
    expect(
      screen.queryByRole("region", { name: "Channel coverage" }),
    ).toBeNull()
    expect(screen.getByText("Loading the coverage…")).toBeTruthy()
  })

  test("no Covered Posts on record counts Citations only and says so", () => {
    renderSummary(PROSE, null)
    expect(avatars().map((a) => a.getAttribute("aria-label"))).toEqual([
      "bank: 2 cited",
      "radio: 1 cited",
      "gov: 1 cited",
      "rogue: 1 cited, outside the Scope",
      "quiet: 0 cited",
    ])
    expect(avatars().map(badge)).toEqual([
      ["cited:2"],
      ["cited:1"],
      ["cited:1"],
      ["cited:1"],
      [],
    ])
    expect(within(wall()).getByText("4 of 5 channels cited")).toBeTruthy()
    expect(within(wall()).getByText(/input was not recorded/)).toBeTruthy()
  })
})

const avatar = (name: string) =>
  within(wall()).getByRole("button", { name: new RegExp(`^${name}:`) })
const citation = (key: string) =>
  document.querySelector(`[${CITATION_ATTR}="${key}"]`) as HTMLElement
const sheet = () => screen.queryByRole("dialog")
/** A real press: Radix watches the pointerdown, then the click. */
const press = (el: HTMLElement) => {
  fireEvent.pointerDown(el)
  fireEvent.click(el)
}
const cardTexts = (section: HTMLElement) =>
  within(section)
    .queryAllByTestId("cited-post-card")
    .map((card) => card.textContent ?? "")

describe("the Channel posts sheet", () => {
  test("tapping an avatar highlights its Citations and lists Cited Posts before the rest", async () => {
    renderSummary(PROSE, COVERED)
    fireEvent.click(avatar("bank"))
    expect(avatar("bank").getAttribute("aria-pressed")).toBe("true")
    expect(citation("bank#10").hasAttribute(HIGHLIGHT_ATTR)).toBe(true)
    expect(citation("bank#11").hasAttribute(HIGHLIGHT_ATTR)).toBe(true)
    expect(citation("gov#20").hasAttribute(HIGHLIGHT_ATTR)).toBe(false)

    const dialog = await screen.findByRole("dialog", { name: "bank" })
    const [cited, also] = within(dialog).getAllByRole("region")
    expect(within(cited).getByText("Cited in the summary (2)")).toBeTruthy()
    expect(within(also).getByText("Also covered (1)")).toBeTruthy()
    expect(within(cited).getAllByText("Cited in the report")).toHaveLength(2)
    expect(cardTexts(cited).join()).toContain("bank post 10")
    expect(cardTexts(cited).join()).toContain("bank post 11")
    await waitFor(() => expect(cardTexts(also)).toHaveLength(1))
    expect(cardTexts(also)[0]).toContain("bank post 12")
    // Only the Post not cited was looked up.
    expect(looked).toEqual([refs("bank", [12])])

    // Another avatar switches the sheet: a press on the wall is not "outside"
    // it, or Radix's dismiss, which runs after the click, would close it.
    press(avatar("gov"))
    expect(await screen.findByRole("dialog", { name: "gov" })).toBeTruthy()
    expect(citation("bank#10").hasAttribute(HIGHLIGHT_ATTR)).toBe(false)
    expect(citation("gov#20").hasAttribute(HIGHLIGHT_ATTR)).toBe(true)

    // Tapping it again closes both.
    press(avatar("gov"))
    await waitFor(() => expect(sheet()).toBeNull())
    expect(citation("gov#20").hasAttribute(HIGHLIGHT_ATTR)).toBe(false)
  })

  test("Find closes the sheet and then finds the Citation", async () => {
    renderSummary(PROSE, COVERED)
    fireEvent.click(avatar("bank"))
    const dialog = await screen.findByRole("dialog", { name: "bank" })
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Find bank #11 in the report",
      }),
    )
    await waitFor(() => expect(sheet()).toBeNull())
    // `toBe`: a deep compare of two happy-dom nodes walks the whole window.
    await waitFor(() => expect(scrolled.length).toBe(1))
    expect(scrolled[0]).toBe(citation("bank#11"))
    expect(citation("bank#11").hasAttribute(FOUND_ATTR)).toBe(true)
  })

  test("a never-cited Channel opens too, its Posts newest first, 20 at a time", async () => {
    renderSummary("Nothing cited.", refs("quiet", range(1, 25)), ["quiet"])
    fireEvent.click(avatar("quiet"))
    const dialog = await screen.findByRole("dialog", { name: "quiet" })
    expect(within(dialog).queryByText(/Cited in the summary/)).toBeNull()
    const also = within(dialog).getByRole("region")
    expect(within(also).getByText("Also covered (25)")).toBeTruthy()
    await waitFor(() => expect(cardTexts(also)).toHaveLength(20))
    expect(cardTexts(also)[0]).toContain("quiet post 25")
    expect(cardTexts(also)[19]).toContain("quiet post 6")

    fireEvent.click(within(also).getByRole("button", { name: "Show more" }))
    await waitFor(() => expect(cardTexts(also)).toHaveLength(25))
    expect(cardTexts(also)[24]).toContain("quiet post 1")
    expect(within(also).queryByRole("button", { name: "Show more" })).toBeNull()
    expect(looked.map((batch) => batch.length)).toEqual([20, 5])
  })

  test("with no Covered Posts on record the sheet says so", async () => {
    renderSummary(PROSE, null)
    fireEvent.click(avatar("gov"))
    const dialog = await screen.findByRole("dialog", { name: "gov" })
    expect(within(dialog).getByText("Cited in the summary (1)")).toBeTruthy()
    expect(within(dialog).getByText(/input was not recorded/)).toBeTruthy()
    expect(looked).toEqual([])
  })
})
