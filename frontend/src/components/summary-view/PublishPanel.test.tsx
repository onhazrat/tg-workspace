/**
 * The publish panel (SUMTAB-09), from props: it renders whatever Parts the
 * server's plan returns and sends with the options chosen on it. The plan and
 * the send are the server's; nothing here cuts or formats text.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { PublicationPlanResponse } from "@/client"
import type { BotCredential, ChatDestination } from "@/types"
import { PublishPanel, type PublishPanelProps } from "./PublishPanel"
import { publicationToast } from "./publish-panel-model"

afterEach(cleanup)

const bots = [{ id: "b1", name: "Bot" }] as BotCredential[]
const dests = [
  { id: "d1", chatId: "c1", name: "News Desk" },
  { id: "d2", chatId: "c2", name: "Other" },
] as ChatDestination[]

const DEFAULT_METADATA = [
  "📊 *Analysis Metadata*",
  "🕒 *Time Range:* Oct 7, 2026, 9:27 AM – 12:27 PM (Asia/Tehran, GMT+3:30) · 3h",
  "📡 *Channels Used:* 2",
  "📋 *Channel List:* @news_ir, @tech",
  "🤖 *AI Model:* test-model",
  "📝 *Posts Analyzed:* 42",
].join("\n")

const plan: PublicationPlanResponse = {
  parts: [
    {
      kind: "summary",
      text: "**Rates** rose [news_ir #5].",
      length: 1200,
      cutInside: false,
    },
    { kind: "summary", text: "Second part.", length: 12, cutInside: true },
  ],
  defaultMetadata: DEFAULT_METADATA,
  limit: 4096,
}

function renderPanel(props: Partial<PublishPanelProps> = {}) {
  const handlers = {
    onOptionsChange: mock(),
    onSaveMetadataText: mock(async () => {}),
    onOpenSettings: mock(),
    onPublish: mock(async () => {}),
  }
  render(
    <PublishPanel
      bots={bots}
      destinations={dests}
      plan={plan}
      options={{ includeMetadata: false, metadataInFirstPart: false }}
      metadataText=""
      citationStyle="numbered"
      linkPreviews={false}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

describe("PublishPanel", () => {
  test("renders every Part the plan returns, as Telegram shows it, with its length", () => {
    renderPanel()

    const parts = screen.getAllByRole("listitem")
    expect(parts).toHaveLength(2)
    expect(parts[0].textContent).toContain("1 / 2")
    expect(parts[0].textContent).toContain("1,200 / 4,096")
    expect(parts[0].querySelector("b")?.textContent).toBe("Rates")
    expect(parts[0].textContent).toContain("Rates rose [news_ir #5].")
    expect(parts[0].querySelector("a")?.textContent).toBe("[news_ir #5]")
    expect(parts[1].textContent).toContain("cut inside a word")
  })

  test("the button names the Part count and the destination, and sends with the chosen options", () => {
    const { onPublish } = renderPanel({
      options: { includeMetadata: true, metadataInFirstPart: true },
    })
    const publish = screen.getByRole("button", { name: /^Publish($| \d)/ })
    expect((publish as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText("Bot"), { target: { value: "b1" } })
    fireEvent.change(screen.getByLabelText("Destination"), {
      target: { value: "d1" },
    })
    expect(publish.textContent).toBe("Publish 2 messages to News Desk")
    fireEvent.click(publish)

    expect(onPublish).toHaveBeenCalledWith({
      botId: "b1",
      destinationId: "d1",
      includeMetadata: true,
      metadataInFirstPart: true,
    })
  })

  test("metadata is a switch, off until turned on, and its rows appear only then", () => {
    const { onOptionsChange } = renderPanel()
    expect(screen.queryByText("Time range")).toBeNull()

    fireEvent.click(screen.getByRole("switch", { name: "Send metadata" }))

    expect(onOptionsChange).toHaveBeenCalledWith({
      includeMetadata: true,
      metadataInFirstPart: false,
    })
  })

  test("each metadata row shows its value; unticking one saves the text without it", () => {
    const { onSaveMetadataText } = renderPanel({
      options: { includeMetadata: true, metadataInFirstPart: false },
    })
    const row = screen.getByRole("checkbox", { name: /Channel list/ })
    expect(row.closest("label")?.textContent).toContain("@news_ir, @tech")
    expect((row as HTMLInputElement).checked).toBe(true)

    fireEvent.click(row)

    expect(onSaveMetadataText).toHaveBeenCalledWith(
      DEFAULT_METADATA.split("\n")
        .filter((l) => !l.includes("Channel List"))
        .join("\n"),
    )
  })

  test("ticking every row back is the generated text, saved as empty", () => {
    const { onSaveMetadataText } = renderPanel({
      options: { includeMetadata: true, metadataInFirstPart: false },
      metadataText: DEFAULT_METADATA.split("\n")
        .filter((l) => !l.includes("AI Model"))
        .join("\n"),
    })
    const row = screen.getByRole("checkbox", { name: /AI model/ })
    expect((row as HTMLInputElement).checked).toBe(false)

    fireEvent.click(row)

    expect(onSaveMetadataText).toHaveBeenCalledWith("")
  })

  test("edit as text saves what was typed, and reset goes back to generated", () => {
    const { onSaveMetadataText } = renderPanel({
      options: { includeMetadata: true, metadataInFirstPart: false },
      metadataText: "My own words",
    })
    expect(
      (screen.getByRole("checkbox", { name: /Time range/ }) as HTMLInputElement)
        .disabled,
    ).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Edit as text" }))
    fireEvent.change(screen.getByLabelText("Metadata text"), {
      target: { value: "Edited" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(onSaveMetadataText).toHaveBeenCalledWith("Edited")

    fireEvent.click(screen.getByRole("button", { name: "Reset to generated" }))
    expect(onSaveMetadataText).toHaveBeenLastCalledWith("")
  })

  test("the first-Part option is offered with the metadata", () => {
    const { onOptionsChange } = renderPanel({
      options: { includeMetadata: true, metadataInFirstPart: false },
    })

    fireEvent.click(
      screen.getByRole("switch", { name: "In the first Part when it fits" }),
    )

    expect(onOptionsChange).toHaveBeenCalledWith({
      includeMetadata: true,
      metadataInFirstPart: true,
    })
  })

  test("shows the Account's citation style and link previews, with a way to Settings", () => {
    const { onOpenSettings } = renderPanel()
    expect(screen.getByText(/Citations numbered/)).toBeTruthy()
    expect(screen.getByText(/link previews off/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Publishing settings" }))

    expect(onOpenSettings).toHaveBeenCalled()
  })

  test("a send's answer is a success toast, or how far it got and why it stopped", () => {
    expect(
      publicationToast({
        status: "success",
        error: null,
        partsSent: 2,
        partsTotal: 2,
      }),
    ).toEqual({ kind: "success", text: "Published 2 messages." })
    expect(
      publicationToast({
        status: "failed",
        error: "chat not found",
        partsSent: 1,
        partsTotal: 3,
      }),
    ).toEqual({
      kind: "error",
      text: "Publishing stopped after 1 of 3 messages: chat not found",
    })
  })

  test("with no bot or destination it says where to add one", () => {
    renderPanel({ bots: [] })
    expect(screen.getByText(/Add a bot and a destination/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Publish($| \d)/ })).toBeNull()
  })
})
