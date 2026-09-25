/**
 * The Chat tab's pieces, each rendered from props alone. `ChatView` keeps the
 * contexts; what is pinned here is what a person reads and clicks: which modes
 * are offered, what the status pill says, what a copy puts on the clipboard,
 * and when the sources and the composer appear.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ChatMessage, Post } from "@/types"
import {
  ChatComposer,
  ChatHistoryActions,
  ChatLanguageAndModel,
  ChatModeToggle,
  ChatThinking,
  ChatTurn,
  ChatTurnSources,
  EmbeddingsStatus,
} from "./ChatViewParts"
import {
  chatTranscriptText,
  chatViewSections,
  citedSource,
  turnProseClass,
} from "./chat-view-model"

afterEach(cleanup)

const post = {
  channelName: "news",
  id: 7,
  text: "Rates held",
  timestamp: Date.UTC(2026, 0, 2),
} as Post

describe("chatTranscriptText", () => {
  test("names each speaker and rules the turns apart", () => {
    const turns: ChatMessage[] = [
      { role: "user", text: "Why?" },
      { role: "model", text: "Because." },
    ]
    expect(chatTranscriptText(turns)).toBe(
      "**User**:\nWhy?\n\n---\n\n**AI Analyst**:\nBecause.",
    )
  })
})

describe("chatViewSections", () => {
  test("an idle tab with no turns shows the empty state and no composer", () => {
    expect(chatViewSections(0, false)).toEqual({
      empty: true,
      composer: false,
    })
  })

  test("a first turn on its way hides the empty state and shows the composer", () => {
    expect(chatViewSections(0, true)).toEqual({ empty: false, composer: true })
  })

  test("a conversation shows the composer", () => {
    expect(chatViewSections(2, false)).toEqual({
      empty: false,
      composer: true,
    })
  })
})

describe("turnProseClass", () => {
  test("a user bubble inverts in the light theme only", () => {
    expect(turnProseClass("user", "light", false, "English")).toContain(
      "prose-invert",
    )
    expect(turnProseClass("user", "dark", false, "English")).not.toContain(
      "prose-invert",
    )
  })

  test("a model bubble follows the theme", () => {
    expect(turnProseClass("model", "light", false, "English")).toContain(
      "dark:prose-invert",
    )
  })

  test("Persian gets its face, other right-to-left text the serif", () => {
    const persian = turnProseClass("model", "dark", true, "Persian")
    expect(persian).toContain("text-right")
    expect(persian).toContain("font-persian")
    const arabic = turnProseClass("model", "dark", true, "Arabic")
    expect(arabic).toContain("font-serif")
    expect(arabic).not.toContain("font-persian")
    const ltr = turnProseClass("model", "dark", false, "English")
    expect(ltr).not.toContain("text-right")
    expect(ltr).not.toContain("font-serif")
  })
})

describe("citedSource", () => {
  test("matches on channel and id together", () => {
    expect(citedSource([post], "news", 7)).toBe(post)
    expect(citedSource([post], "news", 8)).toBeUndefined()
    expect(citedSource([post], "other", 7)).toBeUndefined()
    expect(citedSource(undefined, "news", 7)).toBeUndefined()
  })
})

describe("ChatModeToggle", () => {
  test("Semantic is offered only with embeddings on, and a click picks the mode", () => {
    const onChange = mock()
    render(
      <ChatModeToggle
        chatMode="semantic"
        onChange={onChange}
        embeddingsEnabled
      />,
    )
    expect(screen.getByText("Semantic").className).toContain("bg-app-card")
    expect(screen.getByText("Full Scope").className).not.toContain(
      "bg-app-card",
    )
    fireEvent.click(screen.getByText("Full Scope"))
    expect(onChange).toHaveBeenCalledWith("full_scope")
    fireEvent.click(screen.getByText("Semantic"))
    expect(onChange).toHaveBeenCalledWith("semantic")
    cleanup()
    render(
      <ChatModeToggle
        chatMode="full_scope"
        onChange={onChange}
        embeddingsEnabled={false}
      />,
    )
    expect(screen.queryByText("Semantic")).toBeNull()
  })
})

describe("ChatLanguageAndModel", () => {
  test("changing the language reaches its handler, and the picker renders in its slot", () => {
    const onLanguageChange = mock()
    const { container } = render(
      <ChatLanguageAndModel
        aiLanguage="English"
        onLanguageChange={onLanguageChange}
        modelPicker={<span>picker</span>}
      />,
    )
    expect(screen.getByText("picker")).toBeTruthy()
    const select = container.querySelector("select") as HTMLSelectElement
    fireEvent.change(select, { target: { value: "Persian" } })
    expect(onLanguageChange).toHaveBeenCalledWith("Persian")
  })
})

describe("EmbeddingsStatus", () => {
  const progress = { current: 3, total: 10 }

  test("says nothing while embeddings are off", () => {
    const { container } = render(
      <EmbeddingsStatus
        embeddingsEnabled={false}
        isSyncing
        progress={progress}
      />,
    )
    expect(container.textContent).toBe("")
  })

  test("counts a sync in progress, and says it is checking before it knows", () => {
    render(<EmbeddingsStatus embeddingsEnabled isSyncing progress={progress} />)
    expect(screen.getByText("Syncing (3/10)")).toBeTruthy()
    cleanup()
    render(
      <EmbeddingsStatus
        embeddingsEnabled
        isSyncing
        progress={{ current: 0, total: 0 }}
      />,
    )
    expect(screen.getByText("Checking...")).toBeTruthy()
  })

  test("says ready once the sync is done", () => {
    render(
      <EmbeddingsStatus
        embeddingsEnabled
        isSyncing={false}
        progress={progress}
      />,
    )
    expect(screen.getByText("Embeddings Ready")).toBeTruthy()
  })
})

describe("ChatHistoryActions", () => {
  test("nothing to copy or clear before the first turn", () => {
    const { container } = render(
      <ChatHistoryActions
        hasTurns={false}
        copied={false}
        onCopy={() => {}}
        onClear={() => {}}
      />,
    )
    expect(container.textContent).toBe("")
    expect(screen.queryByLabelText("Copy Chat History")).toBeNull()
    expect(screen.queryByLabelText("Clear Conversation")).toBeNull()
  })

  test("copy and clear reach their handlers", () => {
    const onCopy = mock()
    const onClear = mock()
    render(
      <ChatHistoryActions hasTurns copied onCopy={onCopy} onClear={onClear} />,
    )
    fireEvent.click(screen.getByLabelText("Copy Chat History"))
    expect(onCopy).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByLabelText("Clear Conversation"))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})

describe("ChatTurn", () => {
  const display = { isRTL: false, theme: "light", aiLanguage: "English" }

  test("a user turn copies its own text and has no sources", () => {
    const onCopy = mock()
    render(
      <ChatTurn
        message={{ role: "user", text: "What happened?" }}
        sourcesOpen={false}
        onToggleSources={() => {}}
        onCopy={onCopy}
        {...display}
      />,
    )
    expect(screen.getByText("What happened?")).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Copy message"))
    expect(onCopy).toHaveBeenCalledWith("What happened?")
    expect(screen.queryByText(/Sources Analyzed/)).toBeNull()
  })

  test("a model turn resolves its citations and offers its sources", () => {
    const onToggleSources = mock()
    const { container } = render(
      <ChatTurn
        message={{
          role: "model",
          text: "Rates held [news #7].\n\n- see [news #7]",
          sources: [post],
        }}
        sourcesOpen={false}
        onToggleSources={onToggleSources}
        onCopy={() => {}}
        {...display}
        isRTL
      />,
    )
    expect(container.textContent).not.toContain("[news #7]")
    expect(container.querySelector("[dir=rtl]")).toBeTruthy()
    fireEvent.click(screen.getByText(/1 Sources Analyzed/))
    expect(onToggleSources).toHaveBeenCalledTimes(1)
  })
})

describe("ChatTurnSources", () => {
  test("the cards show only once opened", () => {
    render(
      <ChatTurnSources sources={[post]} open={false} onToggle={() => {}} />,
    )
    expect(screen.queryByText("@news")).toBeNull()
    cleanup()
    render(<ChatTurnSources sources={[post]} open onToggle={() => {}} />)
    expect(screen.getByText("@news")).toBeTruthy()
    expect(screen.getByText("Rates held")).toBeTruthy()
  })
})

describe("ChatThinking", () => {
  test("says the reply is on its way, and nothing once it has come", () => {
    render(<ChatThinking active />)
    expect(screen.getByText("Analyzing...")).toBeTruthy()
    cleanup()
    const { container } = render(<ChatThinking active={false} />)
    expect(container.textContent).toBe("")
  })
})

describe("ChatComposer", () => {
  const props = (over: Partial<Parameters<typeof ChatComposer>[0]> = {}) => ({
    input: "hello",
    onInputChange: mock(),
    onSend: mock(),
    isChatting: false,
    inputRef: null,
    ...over,
  })

  test("Enter sends, Shift+Enter does not, and typing reaches its handler", () => {
    const p = props()
    render(<ChatComposer {...p} />)
    const box = screen.getByPlaceholderText(/Ask about trends/)
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true })
    expect(p.onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: "a" })
    expect(p.onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: "Enter" })
    expect(p.onSend).toHaveBeenCalledTimes(1)
    fireEvent.change(box, { target: { value: "hello there" } })
    expect(p.onInputChange).toHaveBeenCalledWith("hello there")
    fireEvent.click(screen.getByLabelText("Send Message"))
    expect(p.onSend).toHaveBeenCalledTimes(2)
  })

  test("a blank draft cannot be sent", () => {
    render(<ChatComposer {...props({ input: "   " })} />)
    expect(
      (screen.getByLabelText("Send Message") as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
