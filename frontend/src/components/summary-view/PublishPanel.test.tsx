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
      // As the server's parser cut it; the panel draws these, never the text.
      segments: [
        { kind: "bold", text: "Rates", url: null },
        { kind: "plain", text: " rose ", url: null },
        {
          kind: "link",
          text: "[news_ir #5]",
          url: "https://t.me/news_ir/5",
        },
        { kind: "plain", text: ".", url: null },
      ],
    },
    {
      kind: "summary",
      text: "Second part.",
      length: 12,
      cutInside: true,
      segments: [{ kind: "plain", text: "Second part.", url: null }],
    },
  ],
  defaultMetadata: DEFAULT_METADATA,
  metadataRows: [
    { key: "timeRange", label: "Time range", value: "Oct 7, 2026", sent: true },
    { key: "channelsUsed", label: "Channels used", value: "2", sent: true },
    {
      key: "channelList",
      label: "Channel list",
      value: "@news_ir, @tech",
      sent: true,
    },
    { key: "aiModel", label: "AI model", value: "test-model", sent: false },
    { key: "postsAnalyzed", label: "Posts analyzed", value: "42", sent: true },
  ],
  limit: 4096,
  partial: null,
}

function renderPanel(props: Partial<PublishPanelProps> = {}) {
  const handlers = {
    onOptionsChange: mock(),
    onSaveMetadataText: mock(async () => {}),
    onSaveOmittedRows: mock(async () => {}),
    onOpenSettings: mock(),
    onPublishingChange: mock(),
    onPublishingReset: mock(),
    onPublish: mock(async () => {}),
  }
  render(
    <PublishPanel
      bots={bots}
      destinations={dests}
      plan={plan}
      options={{ includeMetadata: false, metadataInFirstPart: false }}
      metadataText=""
      publishing={{
        citationStyle: "numbered",
        linkPreviews: false,
        timeZone: "Asia/Tehran",
      }}
      publishingCustomized={false}
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
    expect(parts[0].querySelector("a")?.getAttribute("href")).toBe(
      "https://t.me/news_ir/5",
    )
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

  test("each metadata row shows its value; unticking one saves the rows left out", () => {
    const { onSaveOmittedRows, onSaveMetadataText } = renderPanel({
      options: { includeMetadata: true, metadataInFirstPart: false },
    })
    const row = screen.getByRole("checkbox", { name: /Channel list/ })
    expect(row.closest("label")?.textContent).toContain("@news_ir, @tech")
    expect((row as HTMLInputElement).checked).toBe(true)

    fireEvent.click(row)

    expect(onSaveOmittedRows).toHaveBeenCalledWith(["channelList", "aiModel"])
    expect(onSaveMetadataText).not.toHaveBeenCalled()
  })

  test("ticking a row back leaves it out no longer", () => {
    const { onSaveOmittedRows } = renderPanel({
      options: { includeMetadata: true, metadataInFirstPart: false },
    })
    const row = screen.getByRole("checkbox", { name: /AI model/ })
    expect((row as HTMLInputElement).checked).toBe(false)

    fireEvent.click(row)

    expect(onSaveOmittedRows).toHaveBeenCalledWith([])
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

  test("shows the options it publishes with, from Settings until changed here", () => {
    const { onOpenSettings } = renderPanel()
    expect(screen.getByText(/Your defaults from/)).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "[1][2]" })
        .getAttribute("aria-pressed"),
    ).toBe("true")
    expect(
      (screen.getByLabelText("Time zone of the metadata") as HTMLInputElement)
        .value,
    ).toBe("Asia/Tehran")
    expect(screen.queryByRole("button", { name: "Use my defaults" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Publishing settings" }))

    expect(onOpenSettings).toHaveBeenCalled()
  })

  test("changes an option for this Summary alone, and goes back to Settings", () => {
    const { onPublishingChange, onPublishingReset } = renderPanel({
      publishingCustomized: true,
    })

    fireEvent.click(screen.getByRole("button", { name: "(chan, chan)" }))
    fireEvent.click(screen.getByRole("switch", { name: "Link previews" }))
    const zone = screen.getByLabelText("Time zone of the metadata")
    fireEvent.change(zone, { target: { value: "Europe/Berlin" } })
    fireEvent.blur(zone)
    fireEvent.click(screen.getByRole("button", { name: "Use my defaults" }))

    expect(onPublishingChange.mock.calls).toEqual([
      [{ citationStyle: "channelName" }],
      [{ linkPreviews: true }],
      [{ timeZone: "Europe/Berlin" }],
    ])
    expect(onPublishingReset).toHaveBeenCalled()
    expect(screen.getByText(/Changed for this Summary/)).toBeTruthy()
  })

  test("with link previews on, a Part's first link shows the card Telegram draws", () => {
    renderPanel()
    expect(screen.queryByText("Link preview")).toBeNull()

    cleanup()
    renderPanel({
      publishing: {
        citationStyle: "numbered",
        linkPreviews: true,
        timeZone: "",
      },
    })

    // Only the first Part has a link.
    expect(screen.getAllByText("Link preview")).toHaveLength(1)
    expect(screen.getByText("t.me/news_ir/5")).toBeTruthy()
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

  test("a partial last Publication offers to send exactly its remaining Parts", () => {
    const { onPublish } = renderPanel({
      bots: [],
      plan: { ...plan, partial: { id: "log-1", partsSent: 2, partsTotal: 5 } },
    })
    expect(
      screen.getByText("Last Publication was partial: 2 of 5 Parts sent"),
    ).toBeTruthy()

    fireEvent.click(
      screen.getByRole("button", { name: "Send the remaining 3" }),
    )

    expect(onPublish).toHaveBeenCalledWith({ publicationId: "log-1" })
  })

  test("with no partial Publication there is nothing to finish", () => {
    renderPanel()
    expect(screen.queryByText(/Last Publication was partial/)).toBeNull()
    expect(
      screen.queryByRole("button", { name: /Send the remaining/ }),
    ).toBeNull()
  })

  test("a lone bot and destination are chosen, even when they load after the panel", () => {
    const props = {
      destinations: [dests[0]],
      plan,
      options: { includeMetadata: false, metadataInFirstPart: false },
      metadataText: "",
      publishing: {
        citationStyle: "asWritten" as const,
        linkPreviews: false,
        timeZone: "",
      },
      publishingCustomized: false,
      onPublishingChange: mock(),
      onPublishingReset: mock(),
      onOptionsChange: mock(),
      onSaveMetadataText: mock(async () => {}),
      onSaveOmittedRows: mock(async () => {}),
      onOpenSettings: mock(),
      onPublish: mock(async () => {}),
    }
    const { rerender } = render(<PublishPanel {...props} bots={[]} />)

    rerender(<PublishPanel {...props} bots={bots} />)

    const publish = screen.getByRole("button", { name: /^Publish($| \d)/ })
    expect(publish.textContent).toBe("Publish 2 messages to News Desk")
    expect((publish as HTMLButtonElement).disabled).toBe(false)
  })

  test("with no bot or destination it says where to add one", () => {
    renderPanel({ bots: [] })
    expect(screen.getByText(/Add a bot and a destination/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Publish($| \d)/ })).toBeNull()
  })
})
