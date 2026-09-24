/**
 * The pieces a History card is assembled from. Each takes props only; the
 * Analysis window line stays in `ArtifactCard`, because restoring a Scope
 * needs the workspace contexts.
 *
 * What is pinned is what a person scanning the list reads: which kind, which
 * channels, whether it is still out, and which toggles a click flips.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ArtifactListItem } from "@/types"
import {
  ArtifactCardActions,
  ArtifactCardHeading,
  ArtifactCardNotes,
} from "./ArtifactCardParts"
import { artifactChannelsLine } from "./artifact-presentation"

afterEach(cleanup)

const summary = {
  kind: "summary",
  id: "s1",
  title: "",
  timestamp: 1,
  isStarred: false,
  status: "done",
  postCount: 12,
  scope: { channels: ["alpha", "beta"] },
} as unknown as ArtifactListItem

const chat = {
  kind: "chat",
  id: "c1",
  title: "My chat",
  timestamp: 1,
  isStarred: true,
  messageCount: 2,
  note: "keep",
} as unknown as ArtifactListItem

const handlers = () => ({
  onToggleStar: mock(),
  onEditNote: mock(),
  onDelete: mock(),
  onToggleAutoRegenerate: mock(),
  onToggleAutoPublish: mock(),
})

describe("artifactChannelsLine", () => {
  test("joins the scope's channels, and says so when there are none", () => {
    expect(artifactChannelsLine(summary)).toBe("alpha, beta")
    expect(artifactChannelsLine(chat)).toBe("No channels")
    expect(
      artifactChannelsLine({
        ...summary,
        scope: { channels: [] },
      } as unknown as ArtifactListItem),
    ).toBe("No channels")
  })
})

describe("ArtifactCardHeading", () => {
  test("an untitled row falls back to its detail, and a click opens it", () => {
    const onOpen = mock()
    render(
      <ArtifactCardHeading
        artifact={summary}
        pending={false}
        onOpen={onOpen}
      />,
    )
    expect(screen.getByText("Summary")).toBeTruthy()
    expect(screen.getByText("alpha, beta")).toBeTruthy()
    expect(screen.getByText("12 posts")).toBeTruthy()
    expect(screen.queryByText("Awaiting response")).toBeNull()
    fireEvent.click(screen.getByRole("button"))
    expect(onOpen).toHaveBeenCalledWith(summary)
  })

  test("a pending row carries the badge and keeps its own title", () => {
    render(<ArtifactCardHeading artifact={chat} pending onOpen={() => {}} />)
    expect(screen.getByText("Awaiting response")).toBeTruthy()
    expect(screen.getByText("My chat")).toBeTruthy()
  })
})

describe("ArtifactCardNotes", () => {
  test("shows who acted and the note only when there is one", () => {
    render(
      <ArtifactCardNotes
        artifact={{ ...chat, actedByEmail: "owner@example.com" }}
      />,
    )
    expect(screen.getByTestId("artifact-acted-by").textContent).toContain(
      "owner@example.com",
    )
    expect(screen.getByText("keep")).toBeTruthy()
    cleanup()
    const { container } = render(<ArtifactCardNotes artifact={summary} />)
    expect(container.textContent).toBe("")
  })
})

describe("ArtifactCardActions", () => {
  test("labels name the next state, and a click reaches its handler", () => {
    const h = handlers()
    render(<ArtifactCardActions artifact={chat} pending={false} {...h} />)
    const star = screen.getByLabelText("Unstar item")
    expect(star.getAttribute("data-active")).toBe("true")
    fireEvent.click(star)
    expect(h.onToggleStar).toHaveBeenCalledWith(chat)
    fireEvent.click(screen.getByLabelText("Edit note"))
    expect(h.onEditNote).toHaveBeenCalledWith(chat)
    fireEvent.click(screen.getByLabelText("Delete item"))
    expect(h.onDelete).toHaveBeenCalledWith(chat)
    // The schedule toggles are summary-only.
    expect(screen.queryByLabelText(/auto-regenerate/)).toBeNull()
  })

  test("a summary gets the schedule toggles, off while it is pending", () => {
    const h = handlers()
    const scheduled = {
      ...summary,
      autoRegenerate: true,
    } as unknown as ArtifactListItem
    render(<ArtifactCardActions artifact={scheduled} pending={false} {...h} />)
    expect(
      screen.getByLabelText("Star item").getAttribute("data-active"),
    ).toBeNull()
    expect(screen.getByLabelText("Add note")).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Disable auto-regenerate"))
    expect(h.onToggleAutoRegenerate).toHaveBeenCalledWith(scheduled)
    fireEvent.click(screen.getByLabelText("Enable auto-publish"))
    expect(h.onToggleAutoPublish).toHaveBeenCalledWith(scheduled)
    cleanup()
    render(<ArtifactCardActions artifact={scheduled} pending {...h} />)
    expect(
      (screen.getByLabelText("Disable auto-regenerate") as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      (screen.getByLabelText("Enable auto-publish") as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})
