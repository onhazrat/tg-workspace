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
import { cleanup, render, screen, within } from "@testing-library/react"
import ReactMarkdown from "react-markdown"
import { api } from "@/api"
import type { ScopedPostRef } from "@/client"
import { splitCitations } from "@/lib/citations/replace-citations"
import { citedPostResolver } from "@/lib/summaries/cited-posts"
import { parseCitationRefs } from "@/lib/summaries/summary-model"
import type { Post, Summary } from "@/types"
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

// bank: 2 Cited Posts (one cited twice), 3 covered. gov: 1 and 1. rogue: 1
// cited, outside the Scope. quiet: never cited, 5 covered.
const PROSE =
  "Rates rose [bank #10], said [gov #20], [bank #11] and [bank #10] again; [rogue #9] too."
const COVERED = [
  ...refs("quiet", range(1, 5)),
  ...refs("bank", [10, 11, 12]),
  ...refs("gov", [20]),
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
  channels = ["quiet", "bank", "gov"],
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
          loading: false,
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
      "gov: 1 cited, 1 covered",
      "rogue: 1 cited, 0 covered, outside the Scope",
      "quiet: 0 cited, 5 covered",
    ])
    const [bank, gov, rogue, quiet] = avatars()
    expect(badge(bank)).toEqual(["cited:2", "covered:3"])
    expect(badge(gov)).toEqual(["cited:1", "covered:1"])
    // Nothing covered and nothing to say: the grey half goes.
    expect(badge(rogue)).toEqual(["cited:1"])
    expect(badge(quiet)).toEqual(["covered:5"])
    expect(within(wall()).getByText("Outside the Scope")).toBeTruthy()
    // Never cited is greyed out, its count kept.
    expect(quiet.className).toContain("grayscale")
    expect(bank.className).not.toContain("grayscale")
    expect(within(wall()).getByText("3 of 4 channels cited · 9 posts used"))
    expect(within(wall()).getByText(/2 of the 12 posts/)).toBeTruthy()
  })

  test("no Covered Posts on record counts Citations only and says so", () => {
    renderSummary(PROSE, null)
    expect(avatars().map((a) => a.getAttribute("aria-label"))).toEqual([
      "bank: 2 cited",
      "gov: 1 cited",
      "rogue: 1 cited, outside the Scope",
      "quiet: 0 cited",
    ])
    expect(avatars().map(badge)).toEqual([
      ["cited:2"],
      ["cited:1"],
      ["cited:1"],
      [],
    ])
    expect(within(wall()).getByText("3 of 4 channels cited")).toBeTruthy()
    expect(within(wall()).getByText(/input was not recorded/)).toBeTruthy()
  })
})
