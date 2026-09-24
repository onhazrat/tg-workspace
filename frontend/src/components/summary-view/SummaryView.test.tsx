/**
 * The pieces `SummaryView` is assembled from. Each takes props only, so no
 * providers and no `mock.module` (process-wide in bun, see
 * `DataContext.test.tsx`). What is pinned is what the view did before it was
 * split: which text a clicked bullet searches for, how long the Telegram
 * message is with and without metadata, that Publish needs both a bot and a
 * destination, that the note editor starts from the saved note, and that
 * Cancel puts the saved metadata back.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { BotCredential, ChatDestination, Summary } from "@/types"
import { PublishMetadataPanel } from "./PublishMetadataPanel"
import { SummaryNote } from "./SummaryNote"
import { PendingSummaryPanel, SummaryMetaChips } from "./SummaryParts"
import {
  ExportButtons,
  NoteToggleButton,
  PublishControls,
  TelegramLengthHint,
} from "./SummaryToolbar"
import {
  exportFilename,
  extractText,
  relatedPostsQuery,
  TELEGRAM_MESSAGE_LIMIT,
  telegramMessageLength,
} from "./summary-text"

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

  test("the Telegram length counts metadata and its blank line only when sent", () => {
    expect(telegramMessageLength("abcd", null)).toBe(4)
    expect(telegramMessageLength("abcd", "meta")).toBe(10)
    expect(telegramMessageLength(null, null)).toBe(0)
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

describe("PublishControls", () => {
  const bots = [{ id: "b1", name: "Bot One" }] as BotCredential[]
  const dests = [
    { id: "d1", name: "Channel", chatId: "-100" },
  ] as ChatDestination[]
  const publishButton = () =>
    screen.getByText("Publish").closest("button") as HTMLButtonElement

  test("hidden until there is a bot and a destination to pick", () => {
    const { container } = render(
      <PublishControls bots={bots} destinations={[]} onPublish={() => {}} />,
    )
    expect(container.innerHTML).toBe("")
  })

  test("publishes to the picked pair once both are chosen", () => {
    const onPublish = mock()
    render(
      <PublishControls
        bots={bots}
        destinations={dests}
        onPublish={onPublish}
      />,
    )
    expect(publishButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Bot"), { target: { value: "b1" } })
    expect(publishButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Destination"), {
      target: { value: "d1" },
    })
    fireEvent.click(publishButton())
    expect(onPublish).toHaveBeenCalledWith(bots[0], dests[0])
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

  test("the length hint warns only past Telegram's limit", () => {
    render(<TelegramLengthHint length={TELEGRAM_MESSAGE_LIMIT} />)
    expect(screen.queryByText(/may exceed/)).toBeNull()
    cleanup()
    render(<TelegramLengthHint length={TELEGRAM_MESSAGE_LIMIT + 1} />)
    expect(screen.getByText(/may exceed/)).toBeTruthy()
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

describe("PublishMetadataPanel", () => {
  const renderPanel = (send: boolean) => {
    const props = {
      send,
      text: "edited",
      savedText: "saved",
      onSendChange: mock(),
      onTextChange: mock(),
      onSave: mock(async () => {}),
    }
    render(<PublishMetadataPanel {...props} />)
    return props
  }

  test("unticking hides the metadata and reports it", () => {
    const props = renderPanel(true)
    expect(screen.getByText("edited")).toBeTruthy()
    fireEvent.click(screen.getByRole("checkbox"))
    expect(props.onSendChange).toHaveBeenCalledWith(false)
    cleanup()
    renderPanel(false)
    expect(screen.queryByText("edited")).toBeNull()
  })

  test("cancel restores the saved text; save sends the current text", async () => {
    const props = renderPanel(true)
    fireEvent.click(screen.getByText("edited"))
    fireEvent.click(screen.getByText("Cancel"))
    expect(props.onTextChange).toHaveBeenCalledWith("saved")
    expect(screen.queryByLabelText("Metadata text")).toBeNull()

    fireEvent.click(screen.getByText("edited"))
    fireEvent.click(screen.getByText("Save"))
    expect(props.onSave).toHaveBeenCalledWith("edited")
    await screen.findByText("Click to Edit")
  })
})
