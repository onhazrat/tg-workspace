/**
 * The Summary card's four states, from props. What is pinned: pending beats a
 * body, a body beats generating, generating beats the empty state; and the
 * note, scope footer and publish panel appear only for a saved Summary.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import ReactMarkdown from "react-markdown"

import {
  loadAppSettings,
  loadSetting,
  persistAppSettings,
  readerFromRecord,
} from "@/lib/settings/store"
import type { Summary } from "@/types"
import { SummaryBody, type SummaryBodyProps } from "./SummaryBody"

afterEach(cleanup)

const summary: Summary = {
  id: "s1",
  text: "body",
  language: "English",
  postCount: 12,
  timestamp: 0,
}

function renderBody(props: Partial<SummaryBodyProps>) {
  const handlers = {
    onRerun: mock(),
    onPaste: mock(),
    onEditingNoteChange: mock(),
  }
  const noop = async () => {}
  render(
    <SummaryBody
      summary={undefined}
      promptText={undefined}
      body={null}
      isPending={false}
      summarizing={false}
      running={false}
      direction={{ dir: "rtl", className: "font-fa" }}
      editingNote={false}
      onSaveNote={noop}
      onDeleteNote={noop}
      publishPanel={(s) => <p data-testid="publish">publish {s.id}</p>}
      renderMarkdown={(md) => <p>{md}</p>}
      scopeLine={(s, className) => (
        <p data-testid="scope" className={className}>
          scope of {s.id}
        </p>
      )}
      emptyState={<p>go to Action</p>}
      zone={{ timeZone: "Asia/Tehran", locale: "en-US" }}
      textSize="M"
      onTextSizeChange={() => {}}
      workspace={{ channel: () => undefined, onAddChannel: () => {} }}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

describe("SummaryBody", () => {
  test("pending beats a body: the paste panel and its scope line", () => {
    const { onPaste } = renderBody({
      summary: { ...summary, status: "pending" },
      body: "streamed",
      isPending: true,
    })
    expect(screen.getByText("Awaiting External Response")).toBeTruthy()
    expect(screen.queryByText("Analysis Report")).toBeNull()
    expect(screen.getByTestId("scope").className).toBe("mt-3")
    fireEvent.click(screen.getByText("Paste AI Response"))
    expect(onPaste).toHaveBeenCalled()
  })

  test("a saved report: body in its direction, note, metadata and footer", () => {
    const { onRerun, onEditingNoteChange } = renderBody({
      summary,
      body: "rendered markdown",
    })
    expect(screen.getByText("Analysis Report")).toBeTruthy()
    const prose = screen.getByText("rendered markdown").closest("[dir]")
    expect(prose?.getAttribute("dir")).toBe("rtl")
    expect(prose?.className).toContain("font-fa")
    expect(screen.getByTestId("scope").textContent).toBe("scope of s1")

    fireEvent.click(screen.getByRole("button", { name: "Add note" }))
    expect(onEditingNoteChange).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole("button", { name: "Re-analyze window" }))
    expect(onRerun).toHaveBeenCalled()
  })

  test("the publish panel closes a saved report, after the scope footer", () => {
    renderBody({ summary, body: "the body" })
    const scope = screen.getByTestId("scope")
    const publish = screen.getByTestId("publish")
    expect(publish.textContent).toBe("publish s1")
    expect(
      scope.compareDocumentPosition(publish) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  test("a live stream with nothing saved has no note, footer or publish panel", () => {
    renderBody({ body: "streamed" })
    expect(screen.getByText("Analysis Report")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Add note" })).toBeNull()
    expect(screen.queryByTestId("scope")).toBeNull()
    expect(screen.queryByTestId("publish")).toBeNull()
  })

  test("generating beats the empty state, which shows last", () => {
    renderBody({ summarizing: true })
    expect(screen.queryByText("go to Action")).toBeNull()
    cleanup()

    renderBody({})
    expect(screen.getByText("go to Action")).toBeTruthy()
  })
})

describe("reading controls", () => {
  test("every section, by heading or single bold line, folds and unfolds", () => {
    renderBody({
      summary,
      body: [
        "Intro with **bold** inside.",
        "## Economy",
        "Rates rose.",
        "**Politics:**",
        "A vote passed.",
      ].join("\n\n"),
      renderMarkdown: (md) => <ReactMarkdown>{md}</ReactMarkdown>,
    })
    // The intro has no heading, so nothing folds it.
    expect(screen.getAllByRole("button", { name: /^Fold / })).toHaveLength(2)

    fireEvent.click(screen.getByRole("button", { name: "Fold Economy" }))
    expect(screen.queryByText("Rates rose.")).toBeNull()
    expect(screen.getByText("Economy")).toBeTruthy()
    expect(screen.getByText("A vote passed.")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Unfold Economy" }))
    expect(screen.getByText("Rates rose.")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Fold Politics" }))
    expect(screen.queryByText("A vote passed.")).toBeNull()
    expect(screen.getByText(/Intro with/)).toBeTruthy()
  })

  test("text size S, M or L sizes the prose and survives the settings store", () => {
    const onTextSizeChange = mock()
    renderBody({
      summary,
      body: "rendered markdown",
      textSize: "M",
      onTextSizeChange,
    })
    const prose = () => screen.getByText("rendered markdown").closest("[dir]")
    expect(prose()?.className).not.toContain("prose-lg")
    fireEvent.click(screen.getByRole("button", { name: "L" }))
    expect(onTextSizeChange).toHaveBeenCalledWith("L")
    cleanup()

    renderBody({ summary, body: "rendered markdown", textSize: "L" })
    expect(prose()?.className).toContain("prose-lg")

    // Remembered per Account: the setting round-trips through the store
    // `SettingsProvider` reads and writes through `scopedStorage`.
    const stored: Record<string, string> = {}
    persistAppSettings(
      { ...loadAppSettings(readerFromRecord({})), summaryTextSize: "L" },
      { setItem: (k, v) => void (stored[k] = v) },
    )
    expect(loadSetting("summaryTextSize", readerFromRecord(stored))).toBe("L")
    expect(loadSetting("summaryTextSize", readerFromRecord({}))).toBe("M")
  })
})

/** A `<p>` whose text includes `needle`, whitespace normalised (Intl uses thin spaces). */
function lineWith(needle: string): string {
  const line = screen.getByText(
    (_, el) => el?.tagName === "P" && (el.textContent ?? "").includes(needle),
  )
  return (line.textContent ?? "").replace(/\s+/g, " ")
}

describe("the Summary header", () => {
  const start = Date.UTC(2026, 9, 7, 5, 57)
  const scoped: Summary = {
    ...summary,
    model: "gemini-x",
    timestamp: Date.now() - 2 * 60 * 60 * 1000,
    scope: {
      channels: ["a", "b", "c"],
      start,
      end: start + 3 * 60 * 60 * 1000,
      scopedPostCount: 447,
    },
  }

  test("line one reads the window, its zone's city, Channels and Covered Posts", () => {
    renderBody({ summary: scoped, body: "body" })
    expect(lineWith("channels")).toBe(
      "3h · Oct 7, 2026, 9:27 AM – 12:27 PM (Tehran) · 3 channels · 447 posts",
    )
  })

  test("a Scope with no window says so, and no Covered Posts on record is not zero", () => {
    renderBody({
      summary: { ...scoped, scope: { ...scoped.scope!, start: 0, end: 0 } },
      body: "body",
    })
    expect(lineWith("channels")).toBe(
      "Analysis window not recorded · 3 channels · 447 posts",
    )
    cleanup()

    renderBody({
      summary: {
        ...scoped,
        scope: { ...scoped.scope!, channels: ["a"], scopedPostCount: null },
      },
      body: "body",
    })
    expect(lineWith("channel")).toBe(
      "3h · Oct 7, 2026, 9:27 AM – 12:27 PM (Tehran) · 1 channel",
    )
  })

  test("line two reads the model, Output language and age", () => {
    renderBody({ summary: scoped, body: "body" })
    expect(lineWith("gemini-x")).toBe("gemini-x · English · 2h ago")
  })

  test("the note action is named for an existing note", () => {
    const { onEditingNoteChange } = renderBody({
      summary: { ...summary, note: "hi" },
      body: "body",
    })
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }))
    expect(onEditingNoteChange).toHaveBeenCalledWith(true)
  })

  test("copy writes the body and says so", () => {
    const writes: string[] = []
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => void writes.push(t) },
    })
    renderBody({ summary, body: "the body" })
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }))
    expect(writes).toEqual(["the body"])
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy()
  })

  test("export is an icon action with a spoken name", () => {
    renderBody({ summary, body: "body" })
    expect(screen.getByRole("button", { name: "Export Markdown" })).toBeTruthy()
  })
})
