/**
 * A Summary's Citations (SUMTAB-04), rendered in the report the way the tab
 * renders them. What is pinned: hovering opens the Cited Post as a full card,
 * as it is now or as the Summary kept it; with no hover a tap opens the same
 * card in a bottom sheet, the long text whole; a Post in neither says so; the
 * out-of-Scope notice appears only when Covered Posts are on record and this
 * Post is not one; and every Citation is findable.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import ReactMarkdown from "react-markdown"
import { CITATION_ATTR, citationKey } from "@/lib/citations/find-citation"
import { splitCitations } from "@/lib/citations/replace-citations"
import {
  type CitedPostSources,
  citedPostResolver,
} from "@/lib/summaries/cited-posts"
import type { Post, Summary } from "@/types"
import { SummaryBody } from "./SummaryBody"
import { SummaryCitation } from "./SummaryCitation"

afterEach(cleanup)

const post = (channelName: string, id: number, text: string): Post => ({
  id,
  channelName,
  text,
  date: "2026-10-07T09:00:00Z",
  timestamp: Date.UTC(2026, 9, 7, 9),
})

const summary: Summary = {
  id: "s1",
  text: "",
  language: "English",
  timestamp: 0,
}

function renderReport(
  prose: string,
  sources: Partial<CitedPostSources>,
  options: { sheet?: boolean; loading?: boolean } = {},
) {
  const resolve = citedPostResolver({
    live: [],
    snapshot: {},
    covered: null,
    ...sources,
  })
  render(
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
      workspace={{ channel: () => undefined, onAddChannel: () => {} }}
      renderMarkdown={(md) => (
        <ReactMarkdown
          components={{
            p: ({ children }) => (
              <p>
                {splitCitations(children, (channelName, postId, key) => (
                  <SummaryCitation
                    key={key}
                    cited={resolve(channelName, postId)}
                    loading={options.loading ?? false}
                    sheet={options.sheet ?? false}
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

const hover = async (label: string) => {
  const chip = screen.getByText(label)
  fireEvent.pointerEnter(chip, { pointerType: "mouse" })
  fireEvent.mouseEnter(chip)
  fireEvent.mouseMove(chip)
  return screen.findByTestId("cited-post-card", {}, { timeout: 2000 })
}

describe("a Citation in the report", () => {
  test("hovering shows the Cited Post as it is now, as a full post card", async () => {
    renderReport("Rates rose [news #7] again.", {
      live: [{ ...post("news", 7, "edited today"), viewsCount: 1500 }],
      snapshot: { "news-7": post("news", 7, "as it was") },
    })
    const card = await hover("news #7")
    expect(within(card).getByText("edited today")).toBeTruthy()
    expect(within(card).queryByText("as it was")).toBeNull()
    // The post card's own footer: today's views.
    expect(within(card).getByText("1.5K")).toBeTruthy()
    expect(within(card).queryByText(/Outside this Summary/)).toBeNull()
  })

  test("a deleted or aged-out Post is shown from the Summary's snapshot", async () => {
    renderReport("Rates rose [news #7].", {
      snapshot: { "news-7": post("news", 7, "as it was") },
    })
    const card = await hover("news #7")
    expect(within(card).getByText("as it was")).toBeTruthy()
    expect(within(card).getByText(/As saved with this Summary/)).toBeTruthy()
  })

  test("a Post in neither says it was not found", async () => {
    renderReport("Rates rose [news #7].", {})
    const card = await hover("news #7")
    expect(within(card).getByText(/Post not found/)).toBeTruthy()
  })

  test("the hover card shows a long Post whole, with no Show More", async () => {
    const long = Array(30).fill("line").join("\n")
    renderReport("See [news #7].", { live: [post("news", 7, long)] })
    const card = await hover("news #7")
    expect(within(card).queryByText("Show More")).toBeNull()
  })

  test("with no hover, a tap opens the card in a bottom sheet that shows a long Post whole", async () => {
    const long = `${Array(30).fill("line").join("\n")}\nthe last line`
    renderReport(
      "See [news #7].",
      { live: [post("news", 7, long)] },
      { sheet: true },
    )
    fireEvent.click(screen.getByRole("button", { name: /news #7/ }))
    const sheet = await screen.findByRole("dialog")
    const card = within(sheet).getByTestId("cited-post-card")
    expect(within(card).getByText(/the last line/)).toBeTruthy()
    expect(within(card).queryByText("Show More")).toBeNull()
  })

  test("outside the Scope only when Covered Posts are on record and this Post is not one", async () => {
    renderReport(
      "See [news #7] and [news #8].",
      {
        live: [post("news", 7, "given"), post("news", 8, "not given")],
        covered: [{ channelName: "news", postId: 7 }],
      },
      { sheet: true },
    )
    fireEvent.click(screen.getByRole("button", { name: /news #8/ }))
    const sheet = await screen.findByRole("dialog")
    expect(within(sheet).getByText(/Outside this Summary's Scope/)).toBeTruthy()
    cleanup()

    renderReport(
      "See [news #7].",
      {
        live: [post("news", 7, "given")],
        covered: [{ channelName: "news", postId: 7 }],
      },
      { sheet: true },
    )
    fireEvent.click(screen.getByRole("button", { name: /news #7/ }))
    const inScope = await screen.findByRole("dialog")
    expect(
      within(inScope).queryByText(/Outside this Summary's Scope/),
    ).toBeNull()
    cleanup()

    // No Covered Posts on record: nothing to be outside of.
    renderReport(
      "See [news #8].",
      { live: [post("news", 8, "not given")], covered: null },
      { sheet: true },
    )
    fireEvent.click(screen.getByRole("button", { name: /news #8/ }))
    const unrecorded = await screen.findByRole("dialog")
    expect(
      within(unrecorded).queryByText(/Outside this Summary's Scope/),
    ).toBeNull()
  })

  test("a click on the chip or inside its sheet never reaches the bullet, which searches on click", async () => {
    const onBulletClick = mock()
    render(
      <li onClick={onBulletClick}>
        <SummaryCitation
          cited={citedPostResolver({
            live: [post("news", 7, "the post")],
            snapshot: {},
            covered: null,
          })("news", 7)}
          loading={false}
          sheet
          workspace={{ channel: () => undefined, onAddChannel: mock() }}
        />
      </li>,
    )
    fireEvent.click(screen.getByRole("button", { name: /news #7/ }))
    const sheet = await screen.findByRole("dialog")
    fireEvent.click(within(sheet).getByText("the post"))
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }))
    expect(onBulletClick).not.toHaveBeenCalled()
  })

  test("every Citation carries its Post's key, so it can be found", () => {
    renderReport("See [News #7].", {})
    expect(
      screen
        .getByText("News #7")
        .closest(`[${CITATION_ATTR}]`)
        ?.getAttribute(CITATION_ATTR),
    ).toBe(citationKey("news", 7))
  })
})
