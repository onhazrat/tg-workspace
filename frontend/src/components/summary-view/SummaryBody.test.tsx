/**
 * The Summary card's four states, from props. What is pinned: pending beats a
 * body, a body beats generating, generating beats the empty state; the note,
 * metadata and scope footer appear only for a saved Summary; and Publish sends
 * the body on screen with the chosen bot and destination.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { BotCredential, ChatDestination, Summary } from "@/types"
import { SummaryBody, type SummaryBodyProps } from "./SummaryBody"

afterEach(cleanup)

const summary: Summary = {
  id: "s1",
  text: "body",
  language: "English",
  postCount: 12,
  timestamp: 0,
}
const bots = [{ id: "b1", name: "Bot" }] as BotCredential[]
const dests = [{ id: "d1", chatId: "c1", name: "Chat" }] as ChatDestination[]

function renderBody(props: Partial<SummaryBodyProps>) {
  const handlers = {
    onPublish: mock(),
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
      bots={bots}
      destinations={dests}
      editingNote={false}
      onSaveNote={noop}
      onDeleteNote={noop}
      sendMetadata={true}
      metadataText="meta"
      metadataToSend="meta"
      onSendMetadataChange={() => {}}
      onMetadataTextChange={() => {}}
      onSaveMetadata={noop}
      markdown={<p>rendered markdown</p>}
      scopeLine={(s, className) => (
        <p data-testid="scope" className={className}>
          scope of {s.id}
        </p>
      )}
      emptyState={<p>go to Action</p>}
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
      body: "body",
    })
    expect(screen.getByText("Analysis Report")).toBeTruthy()
    const prose = screen.getByText("rendered markdown").parentElement
    expect(prose?.getAttribute("dir")).toBe("rtl")
    expect(prose?.className).toContain("font-fa")
    expect(screen.getByText("12 Posts Analyzed")).toBeTruthy()
    expect(screen.getByTestId("scope").textContent).toBe("scope of s1")

    fireEvent.click(screen.getByText("Note").closest("button") as HTMLElement)
    expect(onEditingNoteChange).toHaveBeenCalledWith(true)
    fireEvent.click(
      screen.getByText("Re-analyze Window").closest("button") as HTMLElement,
    )
    expect(onRerun).toHaveBeenCalled()
  })

  test("Publish sends the body on screen", () => {
    const { onPublish } = renderBody({ summary, body: "the body" })
    fireEvent.change(screen.getByLabelText("Bot"), { target: { value: "b1" } })
    fireEvent.change(screen.getByLabelText("Destination"), {
      target: { value: "d1" },
    })
    fireEvent.click(
      screen.getByText("Publish").closest("button") as HTMLElement,
    )
    expect(onPublish).toHaveBeenCalledWith(bots[0], dests[0], "the body")
  })

  test("a live stream with nothing saved has no note, metadata or footer", () => {
    renderBody({ body: "streamed" })
    expect(screen.getByText("Analysis Report")).toBeTruthy()
    expect(screen.queryByText("Note")).toBeNull()
    expect(screen.queryByTestId("scope")).toBeNull()
  })

  test("generating beats the empty state, which shows last", () => {
    renderBody({ summarizing: true })
    expect(screen.queryByText("go to Action")).toBeNull()
    cleanup()

    renderBody({})
    expect(screen.getByText("go to Action")).toBeTruthy()
  })
})
