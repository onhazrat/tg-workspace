/**
 * The photo strip (SUMTAB-05), in a Summary rendered the way the tab renders
 * it. What is pinned: only Cited Posts with a photo, in the order the prose
 * first cites them; right to left in a right-to-left Summary, the viewer's
 * next following it; the viewer steps through every strip photo; "Find in
 * report" closes the viewer and then finds the Citation, and the corner Locate
 * button finds it without opening anything; with no photos it says so.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import ReactMarkdown from "react-markdown"
import { api } from "@/api"
import { CITATION_ATTR, FOUND_ATTR } from "@/lib/citations/find-citation"
import { splitCitations } from "@/lib/citations/replace-citations"
import { citedPostResolver } from "@/lib/summaries/cited-posts"
import { parseCitationRefs } from "@/lib/summaries/summary-model"
import type { Post, Summary } from "@/types"
import { SummaryBody } from "./SummaryBody"
import { SummaryCitation } from "./SummaryCitation"

const post = (channelName: string, id: number, photo: boolean): Post => ({
  id,
  channelName,
  text: `post ${id}`,
  date: "2026-10-07T09:00:00Z",
  timestamp: Date.UTC(2026, 9, 7, 9),
  media: photo
    ? { kinds: ["photo"], thumbApiPath: `/thumb/${channelName}/${id}` }
    : null,
})

const summary: Summary = {
  id: "s1",
  text: "",
  language: "Persian",
  timestamp: 0,
}

// Each thumbnail answers with its own object URL, named for its path.
const fetchPostThumb = api.fetchPostThumb
const createObjectURL = URL.createObjectURL
const scrollIntoView = HTMLElement.prototype.scrollIntoView
let scrolled: Element[] = []
beforeEach(() => {
  const paths = new WeakMap<Blob, string>()
  api.fetchPostThumb = async (path) => {
    const blob = new Blob([path])
    paths.set(blob, path)
    return blob
  }
  URL.createObjectURL = (blob) => `blob:${paths.get(blob as Blob)}`
  scrolled = []
  HTMLElement.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this)
  }
})
afterEach(() => {
  cleanup()
  api.fetchPostThumb = fetchPostThumb
  URL.createObjectURL = createObjectURL
  HTMLElement.prototype.scrollIntoView = scrollIntoView
})

function renderSummary(
  prose: string,
  live: Post[],
  options: { dir?: string; loading?: boolean } = {},
) {
  const resolve = citedPostResolver({ live, snapshot: {}, covered: null })
  const cited = parseCitationRefs(prose).map((r) =>
    resolve(r.channelName, r.postId),
  )
  render(
    <SummaryBody
      summary={summary}
      promptText={undefined}
      body={prose}
      isPending={false}
      summarizing={false}
      running={false}
      direction={{ dir: options.dir ?? "ltr", className: "" }}
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
      cited={{ posts: cited, loading: options.loading ?? false }}
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
                    workspace={{
                      channel: () => undefined,
                      onAddChannel: mock(),
                    }}
                  />
                ))}
              </p>
            ),
          }}
        >
          {md}
        </ReactMarkdown>
      )}
    />,
  )
}

const PROSE =
  "Rates rose [bank #2], said [gov #1], [radio #3] reported [bank #2] and [tv #4]."
const LIVE = [
  post("gov", 1, true),
  post("bank", 2, true),
  post("radio", 3, false),
  post("tv", 4, true),
]
const tiles = () => screen.findAllByRole("button", { name: /^Photo from / })
const viewerLabel = () =>
  screen.getByTestId("photo-viewer-label").textContent ?? ""
/** The Citation chips findCitation scrolled to, by their key. */
const foundCitations = () =>
  scrolled
    .map((el) => el.getAttribute(CITATION_ATTR))
    .filter((key) => key !== null)

describe("the photo strip", () => {
  test("lists the Cited Posts with a photo, in first-Citation order, above the text size", async () => {
    renderSummary(PROSE, LIVE)
    expect((await tiles()).map((t) => t.getAttribute("aria-label"))).toEqual([
      "Photo from bank #2",
      "Photo from gov #1",
      "Photo from tv #4",
    ])
    const sizes = screen.getByRole("group", { name: "Text size" })
    expect(
      (await tiles())[0].compareDocumentPosition(sizes) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  test("with no photos it says so, or that the Posts are loading", () => {
    renderSummary("Only [radio #3].", LIVE)
    expect(screen.getByText("No photos in the cited posts")).toBeTruthy()
    cleanup()

    renderSummary("Only [radio #3].", [], { loading: true })
    expect(screen.getByText("Loading the cited posts…")).toBeTruthy()
  })

  test("runs right to left in a right-to-left Summary, and so does the viewer", async () => {
    renderSummary(PROSE, LIVE, { dir: "rtl" })
    const [first] = await tiles()
    expect(first.closest("[dir]")?.getAttribute("dir")).toBe("rtl")

    fireEvent.click(first)
    expect(viewerLabel()).toContain("bank #2 · 1 / 3")
    const next = screen.getByRole("button", { name: "Next photo" })
    expect(next.className).toContain("left-2")
    fireEvent.click(next)
    expect(viewerLabel()).toContain("gov #1 · 2 / 3")
    fireEvent.click(next)
    expect(viewerLabel()).toContain("tv #4 · 3 / 3")
    expect(next.hasAttribute("disabled")).toBe(true)
  })

  test("Find in report closes the viewer and then finds that photo's Citation", async () => {
    renderSummary(PROSE, LIVE)
    fireEvent.click((await tiles())[0])
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }))
    fireEvent.click(screen.getByRole("button", { name: "Find in report" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(foundCitations()).toEqual(["gov#1"]))
    expect(
      document
        .querySelector(`[${CITATION_ATTR}="gov#1"]`)
        ?.hasAttribute(FOUND_ATTR),
    ).toBe(true)
  })

  test("a tile's Locate button finds the Citation without opening the viewer", async () => {
    renderSummary(PROSE, LIVE)
    await tiles()
    fireEvent.click(
      screen.getByRole("button", { name: "Locate tv #4 in the report" }),
    )
    await waitFor(() => expect(foundCitations()).toEqual(["tv#4"]))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
