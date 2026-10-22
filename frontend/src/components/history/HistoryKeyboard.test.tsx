/**
 * History's Artifacts on keyboard mode's engine (KM-03, ADR-034): j / k,
 * counts and gg / G move the Highlight, Enter opens the Artifact in its tab,
 * * stars or unstars, n adds or edits the note, / goes to the search box, no
 * key deletes, and each move is announced with the Artifact's name. Keys are
 * typed as a browser sends them, Shift first.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Toaster } from "sonner"
import { KeyboardMode } from "@/components/keyboard/KeyboardMode"
import { keydowns } from "@/lib/keyboard/keydowns"
import {
  announcement,
  lastHighlight,
  setKeyboardMode,
} from "@/lib/keyboard/mode"
import type { ArtifactListItem } from "@/types"
import { useHistoryKeys } from "./HistoryKeyboard"
import { HistoryList } from "./HistoryList"
import { toggleStar } from "./history-view-model"

const T = Date.UTC(2026, 9, 1)
/** A recorded hour-long window, as the card's window line reads it. */
const hourTo = (channels: string[]) => ({
  channels,
  start: T - 3_600_000,
  end: T,
  durationMinutes: 60,
})

const ARTIFACTS = [
  {
    kind: "summary",
    id: "s1",
    title: "Morning news",
    timestamp: T,
    status: "done",
    scope: hourTo(["alpha"]),
  },
  {
    kind: "chat",
    id: "c1",
    title: "",
    timestamp: T,
    scope: hourTo(["beta", "gamma"]),
  },
  { kind: "tag", id: "t1", title: "Tagged", timestamp: T, status: "done" },
] as unknown as ArtifactListItem[]

const OPS = {
  go: () => {},
  step: () => {},
  goToNth: () => {},
  close: () => {},
  reopen: () => {},
}

type Spy = ReturnType<typeof mock<(a: ArtifactListItem) => void>>
let spies: Record<"open" | "star" | "remove", Spy>
/** The star's write, as `setArtifactStarred` is called. */
let starred: [string, boolean][]

function History() {
  const highlight = useHistoryKeys({
    artifacts: ARTIFACTS,
    onOpen: (a) => spies.open(a),
  })
  return (
    <>
      <input aria-label="Search history" />
      <HistoryList
        rows={ARTIFACTS}
        actions={{
          open: (x) => spies.open(x),
          // HistoryView's own handler, with the write and refetch faked.
          star: (x) => {
            spies.star(x)
            void toggleStar(x, {
              setStarred: async (a, on) => {
                starred.push([a.id, on])
              },
              refresh: async () => {},
            })
          },
          saveNote: () => {},
          remove: (x) => spies.remove(x),
          autoRegenerate: () => {},
          autoPublish: () => {},
          useScope: () => {},
        }}
        search=""
        compact={false}
        days={false}
        highlight={highlight}
      />
    </>
  )
}

const tab = () => (
  <>
    <Toaster />
    <KeyboardMode ops={OPS} />
    <History />
  </>
)

const highlighted = () =>
  Array.from(document.querySelectorAll("[data-highlight]")).map((el) =>
    el.getAttribute("data-artifact-id"),
  )
const ids = (spy: Spy) => spy.mock.calls.map(([a]) => a.id)
const type = (...keys: string[]) => {
  for (const init of keydowns(...keys))
    fireEvent.keyDown(document.activeElement ?? document.body, init)
}

beforeEach(() => {
  spies = { open: mock(), star: mock(), remove: mock() }
  starred = []
  lastHighlight.clear()
  announcement.set("")
  setKeyboardMode(true)
})
afterEach(() => {
  cleanup()
  setKeyboardMode(false)
})

describe("History's keyboard mode", () => {
  test("j and k move the Highlight, a count, G and gg jump", () => {
    render(tab())
    type("j")
    expect(highlighted()).toEqual(["s1"])
    type("2", "j")
    expect(highlighted()).toEqual(["t1"])
    type("g", "g", "j")
    expect(highlighted()).toEqual(["c1"])
    type("G")
    expect(highlighted()).toEqual(["t1"])
  })

  test("each move is announced with the Artifact's kind and title, or its Channels", () => {
    render(tab())
    type("j")
    expect(screen.getByTestId("keyboard-announcer").textContent).toBe(
      "Summary: Morning news, 1 of 3",
    )
    type("j")
    expect(screen.getByTestId("keyboard-announcer").textContent).toBe(
      "Chat: beta, gamma, 2 of 3",
    )
  })

  test("Enter opens the Artifact in its tab", () => {
    render(tab())
    type("j", "j", "Enter")
    expect(ids(spies.open)).toEqual(["c1"])
  })

  test("* stars the highlighted Artifact only", () => {
    render(tab())
    type("j", "j", "*")
    expect(ids(spies.star)).toEqual(["c1"])
  })

  test("n opens the highlighted Artifact's note beside its card", async () => {
    render(tab())
    type("j", "j", "n")
    expect(await screen.findByLabelText("Note on Chat")).toBeTruthy()
    expect(screen.queryByLabelText("Note on Summary")).toBeNull()
  })

  test("* adds no toast of its own: History's star says what it did, with Undo", async () => {
    render(tab())
    type("j", "*")
    expect(ids(spies.star)).toEqual(["s1"])
    expect(
      await screen.findByText("Starred Summary: Morning news"),
    ).toBeTruthy()
    expect(document.querySelectorAll("[data-sonner-toast]").length).toBe(1)
  })

  test("the star's Undo sets the star back, whether or not the card is still shown", async () => {
    render(tab())
    type("j", "*")
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }))
    expect(starred).toEqual([
      ["s1", true],
      ["s1", false],
    ])
  })

  test("J, K, F and D do nothing in History, which ticks nothing", async () => {
    render(tab())
    type("j", "J")
    expect(highlighted()).toEqual(["s1"])
    type("j", "K", "F", "D")
    expect(highlighted()).toEqual(["c1"])
    await new Promise((r) => setTimeout(r, 50))
    expect(document.querySelector("[data-sonner-toast]")).toBeNull()
  })

  test("no key deletes", () => {
    render(tab())
    type("j")
    for (const key of "abcdefghijklmnopqrstuvwxyz-+[],")
      type(key, key.toUpperCase())
    type("Delete", "Backspace")
    expect(spies.remove).not.toHaveBeenCalled()
  })

  test("/ goes to the search box", () => {
    render(tab())
    type("/")
    expect(document.activeElement).toBe(screen.getByLabelText("Search history"))
  })
})
