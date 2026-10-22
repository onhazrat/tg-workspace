/**
 * One History card, rendered from props: what a person scanning the list
 * reads (kind, state, channels, title, window, note), and what each of Star,
 * Note, "⋯" and "Use this Scope" does.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import type { ArtifactListItem } from "@/types"
import { ArtifactCard } from "./ArtifactCard"
import type { ArtifactActions } from "./ArtifactCardParts"
import { artifactChannelsLine } from "./artifact-presentation"

afterEach(cleanup)

const DAY = 86_400_000
const scope = (channels: string[]) => ({
  channels,
  start: Date.UTC(2026, 9, 1),
  end: Date.UTC(2026, 9, 1) + DAY,
  durationMinutes: 1440,
})

const summary = (over: Record<string, unknown> = {}) =>
  ({
    kind: "summary",
    id: "s1",
    title: "## 📰 **Morning** brief",
    timestamp: Date.UTC(2026, 9, 2),
    isStarred: false,
    status: "complete",
    postCount: 12,
    autoRegenerate: false,
    autoPublish: false,
    scope: scope(["alpha", "bravo", "charlie", "delta", "echo_news"]),
    ...over,
  }) as unknown as ArtifactListItem

const actions = (): ArtifactActions => ({
  open: mock(),
  star: mock(),
  saveNote: mock(),
  remove: mock(),
  autoRegenerate: mock(),
  autoPublish: mock(),
  useScope: mock(),
})

function mount(
  artifact: ArtifactListItem,
  { search = "", compact = false } = {},
) {
  const a = actions()
  render(
    <ArtifactCard
      artifact={artifact}
      actions={a}
      search={search}
      compact={compact}
    />,
  )
  return a
}

const text = (testId: string) => screen.getByTestId(testId).textContent

describe("the header", () => {
  test("tints each kind's icon in its own colour", () => {
    mount(summary())
    expect(
      screen.getByTestId("artifact-kind-icon").getAttribute("class"),
    ).toContain("text-sky-500")
    cleanup()
    mount({ kind: "chat", id: "c", timestamp: 1 } as ArtifactListItem)
    expect(
      screen.getByTestId("artifact-kind-icon").getAttribute("class"),
    ).toContain("text-violet-500")
  })

  test("shows a Summary's flag chips only while they are on", () => {
    mount(summary())
    expect(screen.queryByText("Auto-regenerates")).toBeNull()
    expect(screen.queryByText("Auto-publishes")).toBeNull()
    cleanup()
    mount(summary({ autoRegenerate: true, autoPublish: true }))
    expect(screen.getByText("Auto-regenerates")).toBeTruthy()
    expect(screen.getByText("Auto-publishes")).toBeTruthy()
  })
})

describe("the channel line", () => {
  test("names the first three and counts the rest, the whole list on hover", () => {
    mount(summary())
    const line = screen.getByTestId("artifact-channels")
    expect(line.textContent).toBe("alpha, bravo, charlie+2")
    expect(line.getAttribute("title")).toBe(
      "alpha, bravo, charlie, delta, echo_news",
    )
  })

  test("moves a search's matching channels to the front", () => {
    mount(summary(), { search: "news" })
    expect(text("artifact-channels")).toBe("echo_news, alpha, bravo+2")
  })

  test("says so when the Scope names none", () => {
    mount(summary({ scope: null }))
    expect(screen.getByText("No channels")).toBeTruthy()
  })
})

describe("the title", () => {
  test("is plain text, without markdown marks or a leading emoji", () => {
    mount(summary())
    expect(text("artifact-title")).toBe("Morning brief")
  })

  test("a Failed card keeps its sentence, and its footer repeats nothing", () => {
    mount(summary({ status: "failed", failedAttempts: 2 }))
    expect(text("artifact-title")).toBe(
      "Generation failed. Open it to retry, keep a Partial response or paste a response.",
    )
    expect(screen.getByText("Failed ×2")).toBeTruthy()
    expect(text("artifact-detail")).toBe("")
  })

  test("a Pending card's footer repeats nothing either; a done one counts", () => {
    mount(summary({ status: "pending" }))
    expect(screen.getByText("Awaiting response")).toBeTruthy()
    expect(text("artifact-detail")).toBe("")
    cleanup()
    mount(summary())
    expect(text("artifact-detail")).toBe("12 posts")
  })

  test("reads in its own direction, and a click opens the Artifact", () => {
    const a = mount(summary())
    const title = screen.getByTestId("artifact-title")
    expect(title.getAttribute("dir")).toBe("auto")
    fireEvent.click(title)
    expect(a.open).toHaveBeenCalledTimes(1)
  })
})

describe("search marks", () => {
  test("mark the match in the channels, the title and the note", () => {
    mount(summary({ title: "Morning news", note: "news for Monday" }), {
      search: " NEWS ",
    })
    const marked = [...document.querySelectorAll("mark")].map(
      (m) => m.textContent,
    )
    expect(marked).toEqual(["news", "news", "news"])
  })

  test("mark nothing without a search", () => {
    mount(summary({ note: "news" }))
    expect(document.querySelectorAll("mark").length).toBe(0)
  })
})

describe("the window line", () => {
  test("ends in a Use this Scope icon that restores the frozen Scope", () => {
    const artifact = summary()
    const a = mount(artifact)
    const line = screen.getByTestId("artifact-scope-line")
    expect(line.textContent).toContain("· 1d")
    fireEvent.click(
      within(line).getByRole("button", { name: "Use this Scope" }),
    )
    expect(a.useScope).toHaveBeenCalledWith(artifact.scope)
  })

  test("says so when no window was recorded, with nothing to restore", () => {
    mount(summary({ scope: null }))
    expect(text("artifact-scope-line")).toBe("Analysis window: not recorded")
    expect(screen.queryByRole("button", { name: "Use this Scope" })).toBeNull()
  })
})

describe("the actions", () => {
  test("Star flips the star", () => {
    const a = mount(summary())
    fireEvent.click(screen.getByRole("button", { name: "Star item" }))
    expect(a.star).toHaveBeenCalledTimes(1)
  })

  test("the note is edited in a popover beside its button", () => {
    const artifact = summary({ note: "keep" })
    const a = mount(artifact)
    expect(text("artifact-note")).toBe("keep")
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }))
    const box = screen.getByLabelText("Note on Summary") as HTMLTextAreaElement
    expect(box.value).toBe("keep")
    fireEvent.change(box, { target: { value: "  keep this  " } })
    fireEvent.click(screen.getByText("Save note"))
    expect(a.saveNote).toHaveBeenCalledWith(artifact, "keep this")
  })

  test("saving a blank note deletes it", () => {
    const a = mount(summary({ note: "keep" }))
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }))
    fireEvent.change(screen.getByLabelText("Note on Summary"), {
      target: { value: "  " },
    })
    fireEvent.click(screen.getByText("Save note"))
    expect(a.saveNote).toHaveBeenCalledWith(expect.anything(), null)
  })

  const openMenu = () =>
    act(() => {
      fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), {
        key: "Enter",
      })
    })

  test("the ⋯ menu holds Auto-regenerate, Auto-publish and Delete", () => {
    const artifact = summary()
    const a = mount(artifact)
    openMenu()
    const items = [
      ...screen.getAllByRole("menuitemcheckbox"),
      ...screen.getAllByRole("menuitem"),
    ].map((item) => item.textContent?.trim())
    expect(items).toEqual(["Auto-regenerate", "Auto-publish", "Delete"])
    fireEvent.click(screen.getByText("Auto-publish"))
    expect(a.autoPublish).toHaveBeenCalledWith(artifact)
  })

  test("another kind's menu holds Delete alone", () => {
    const chat = { kind: "chat", id: "c", timestamp: 1 } as ArtifactListItem
    const a = mount(chat)
    openMenu()
    expect(screen.queryAllByRole("menuitemcheckbox").length).toBe(0)
    expect(screen.getAllByRole("menuitem").length).toBe(1)
    fireEvent.click(screen.getByText("Delete"))
    expect(a.remove).toHaveBeenCalledWith(chat)
  })
})

describe("the Compact grid's card", () => {
  test("drops the window, acted-by and note lines and keeps icon actions", () => {
    mount(summary({ note: "keep", actedByEmail: "owner@example.com" }), {
      compact: true,
    })
    expect(screen.queryByTestId("artifact-scope-line")).toBeNull()
    expect(screen.queryByTestId("artifact-acted-by")).toBeNull()
    expect(screen.queryByTestId("artifact-note")).toBeNull()
    const star = screen.getByRole("button", { name: "Star item" })
    expect(star.textContent).toBe("")
    expect(screen.getByRole("button", { name: "Edit note" }).textContent).toBe(
      "",
    )
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy()
  })

  test("the full card names them, and shows who acted on your behalf", () => {
    mount(summary({ note: "keep", actedByEmail: "owner@example.com" }))
    expect(text("artifact-acted-by")).toContain("owner@example.com")
    expect(screen.getByRole("button", { name: "Star item" }).textContent).toBe(
      "Star",
    )
  })
})

describe("artifactChannelsLine", () => {
  test("joins the scope's channels, and says so when there are none", () => {
    expect(artifactChannelsLine(summary({ scope: scope(["a", "b"]) }))).toBe(
      "a, b",
    )
    expect(artifactChannelsLine(summary({ scope: null }))).toBe("No channels")
  })
})
