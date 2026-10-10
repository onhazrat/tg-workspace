/**
 * The pieces `SummaryView` is assembled from. Each takes props only, so no
 * providers and no `mock.module` (process-wide in bun, see
 * `DataContext.test.tsx`). What is pinned is what the view did before it was
 * split: which text a clicked bullet searches for and that the note editor
 * starts from the saved note. The publish panel has its own test.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { Summary } from "@/types"
import { SummaryNote } from "./SummaryNote"
import { PendingSummaryPanel, SummaryMetaChips } from "./SummaryParts"
import { ExportButtons, NoteToggleButton } from "./SummaryToolbar"
import { exportFilename, extractText, relatedPostsQuery } from "./summary-text"

afterEach(cleanup)

describe("summary-text", () => {
  test("extractText skips nested lists so a parent bullet is only its own text", () => {
    expect(extractText("plain")).toBe("plain")
    expect(extractText(42)).toBe("42")
    expect(extractText(["a", <b key="b">b</b>])).toBe("ab")
    expect(
      extractText(
        <li>
          parent
          <ul>
            <li>child</li>
          </ul>
        </li>,
      ),
    ).toBe("")
    expect(extractText(<li>leaf</li>)).toBe("leaf")
    expect(extractText(<ol>x</ol>)).toBe("")
    expect(extractText(null)).toBe("")
  })

  test("relatedPostsQuery drops citations and keeps the text when that is all there is", () => {
    expect(relatedPostsQuery("Rates rose [bank #12] again")).toBe(
      "Rates rose  again",
    )
    expect(relatedPostsQuery("[bank #12]")).toBe("[bank #12]")
    expect(relatedPostsQuery("   ")).toBeNull()
  })

  test("export filename carries the local date", () => {
    expect(exportFilename(new Date(2026, 0, 5, 23, 30))).toBe(
      "analysis-2026-01-05.md",
    )
  })
})

const summary: Summary = {
  id: "s1",
  text: "body",
  language: "English",
  model: "gemini-x",
  postCount: 12,
  timestamp: 0,
}

describe("SummaryParts", () => {
  test("meta chips name the model and language", () => {
    render(<SummaryMetaChips timestamp={0} model="gemini-x" language="Farsi" />)
    expect(screen.getByText("gemini-x")).toBeTruthy()
    expect(screen.getByText("Farsi")).toBeTruthy()
  })

  test("the pending panel waits for its prompt before offering to copy it", () => {
    const onPaste = mock()
    render(
      <PendingSummaryPanel
        summary={summary}
        promptText={undefined}
        onPaste={onPaste}
      />,
    )
    expect(screen.getByText("Loading prompt…")).toBeTruthy()
    expect(
      (screen.getByText("Copy again").closest("button") as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(screen.getByText("12 Posts")).toBeTruthy()
    fireEvent.click(screen.getByText("Paste AI Response"))
    expect(onPaste).toHaveBeenCalledTimes(1)
  })
})

describe("toolbar", () => {
  test("the note button highlights a saved note and toggles", () => {
    const onToggle = mock()
    render(<NoteToggleButton note="hi" editing={false} onToggle={onToggle} />)
    const button = screen.getByText("Note").closest("button") as HTMLElement
    expect(button.className).toContain("text-amber-600")
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  test("copy writes the body and says so", async () => {
    const writes: string[] = []
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => void writes.push(t) },
    })
    render(<ExportButtons body="the body" />)
    fireEvent.click(screen.getByText("Copy Text"))
    expect(writes).toEqual(["the body"])
    expect(screen.getByText("Copied")).toBeTruthy()
  })
})

describe("SummaryNote", () => {
  const renderNote = (note: string | undefined, editing: boolean) => {
    const props = {
      note,
      editing,
      onEditingChange: mock(),
      onSave: mock(),
      onDelete: mock(),
    }
    render(<SummaryNote {...props} />)
    return props
  }

  test("renders nothing without a note, and the saved note opens the editor", () => {
    const { container } = render(
      <SummaryNote
        note={undefined}
        editing={false}
        onEditingChange={() => {}}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(container.innerHTML).toBe("")
    cleanup()
    const props = renderNote("remember this", false)
    fireEvent.click(screen.getByText("remember this"))
    expect(props.onEditingChange).toHaveBeenCalledWith(true)
  })

  test("the editor starts from the saved note and saves the draft on Cmd+Enter", () => {
    const props = renderNote("old", true)
    const box = screen.getByPlaceholderText(/Jot down/) as HTMLTextAreaElement
    expect(box.value).toBe("old")
    fireEvent.change(box, { target: { value: "new text" } })
    expect(screen.getByText("8 chars")).toBeTruthy()
    fireEvent.keyDown(box, { key: "Enter", metaKey: true })
    expect(props.onSave).toHaveBeenCalledWith("new text")
    fireEvent.keyDown(box, { key: "Escape" })
    expect(props.onEditingChange).toHaveBeenCalledWith(false)
  })

  test("delete is offered only for a note that exists", () => {
    const props = renderNote("old", true)
    fireEvent.click(screen.getByText("Delete"))
    expect(props.onDelete).toHaveBeenCalledTimes(1)
    cleanup()
    renderNote(undefined, true)
    expect(screen.queryByText("Delete")).toBeNull()
  })
})
