/**
 * A Discovery report's Candidates on keyboard mode's engine (KM-03, ADR-034):
 * j / k, counts and gg / G move the Highlight, x ticks a Candidate not yet
 * followed, f follows, d dismisses or restores, o opens it in Telegram, Enter
 * opens Details and Esc closes them (the moves wait while they are open), /
 * goes to the name filter, J / K tick while moving, F / D press the bulk
 * bar's buttons, and each move is announced. Keys are typed as a browser
 * sends them, Shift first.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { Toaster } from "sonner"
import { KeyboardMode } from "@/components/keyboard/KeyboardMode"
import { keydowns } from "@/lib/keyboard/keydowns"
import {
  announcement,
  lastHighlight,
  setKeyboardMode,
} from "@/lib/keyboard/mode"
import type { DiscoveryCandidate } from "@/lib/posts/discover-candidates"
import { DiscoverBulkBar } from "./DiscoverBulkBar"
import { DiscoverCandidatePanel } from "./DiscoverCandidatePanel"
import { DiscoverCandidateTable } from "./DiscoverCandidateTable"
import { useDiscoverKeys } from "./DiscoverKeyboard"

const candidate = (name: string, isFollowed = false) =>
  ({
    name,
    counts: { forward: 1, mention: 0, link: 0 },
    total: 1,
    seenIn: [],
    seenInCount: 0,
    lastSeen: 0,
    isFollowed,
    isIgnored: false,
    probe: null,
  }) as unknown as DiscoveryCandidate

const ROWS = [candidate("a"), candidate("b", true), candidate("c")]

const OPS = {
  go: () => {},
  step: () => {},
  goToNth: () => {},
  close: () => {},
  reopen: () => {},
}

type Calls = Record<"follow" | "ignore" | "bulkFollow" | "bulkDismiss", Spy>
type Spy = ReturnType<typeof mock<(...args: unknown[]) => void>>
let calls: Calls

function Report() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [inspecting, setInspecting] = useState<string | null>(null)
  const ring = useDiscoverKeys({
    names: ROWS.map((r) => r.name),
    onOpen: setInspecting,
    isIgnored: () => false,
    onSetIgnored: (name, ignored) => calls.ignore(name, ignored),
  })
  return (
    <>
      <input aria-label="Filter candidates by name" />
      {selected.size > 0 && (
        <DiscoverBulkBar
          selectedCount={selected.size}
          isOffline={false}
          isFollowJobRunning={false}
          followProgress={null}
          onFollowSelected={() => calls.bulkFollow([...selected])}
          onClearSelection={() => setSelected(new Set())}
          onDismissSelected={() => calls.bulkDismiss([...selected])}
          dismissMode="dismiss"
          isDismissPending={false}
          onRecheckSelected={() => {}}
          showRecheck={false}
          isRecheckPending={false}
        />
      )}
      <DiscoverCandidateTable
        candidates={ROWS}
        ring={ring}
        selectedForFollow={selected}
        setSelectedForFollow={setSelected}
        unfollowedCount={2}
        isOffline={false}
        isFollowJobRunning={false}
        activeFollowNames={[]}
        syncingNames={new Set()}
        resultStatusByName={new Map()}
        onFollow={(name) => calls.follow(name)}
        onInspect={(c) => setInspecting(c.name)}
        onSetIgnored={(name, ignored) => calls.ignore(name, ignored)}
        onRecheck={() => {}}
        isRecheckPending={false}
        weights={{ forward: 1, mention: 1, link: 1 }}
        showScore={false}
      />
      <DiscoverCandidatePanel
        candidate={ROWS.find((r) => r.name === inspecting) ?? null}
        onClose={() => setInspecting(null)}
        isOffline={false}
        activeFollowNames={[]}
        onFollow={() => {}}
        onRecheck={() => {}}
        isRecheckPending={false}
      />
    </>
  )
}

const tab = () => (
  <QueryClientProvider client={new QueryClient()}>
    <Toaster />
    <KeyboardMode ops={OPS} />
    <Report />
  </QueryClientProvider>
)

const ringed = () =>
  Array.from(document.querySelectorAll("tr[data-kbd-selected]")).map((el) =>
    el.getAttribute("data-discover-handle"),
  )
const ticked = () =>
  ROWS.map((r) => r.name).filter(
    (name) =>
      (screen.getByTestId(`discover-select-${name}`) as HTMLInputElement)
        .checked,
  )
const type = (...keys: string[]) => {
  for (const init of keydowns(...keys))
    fireEvent.keyDown(document.activeElement ?? document.body, init)
}
const panel = () => screen.queryByTestId("discover-candidate-panel")

beforeEach(() => {
  calls = {
    follow: mock(),
    ignore: mock(),
    bulkFollow: mock(),
    bulkDismiss: mock(),
  }
  lastHighlight.clear()
  announcement.set("")
  setKeyboardMode(true)
})
afterEach(() => {
  cleanup()
  setKeyboardMode(false)
})

describe("a Discovery report's keyboard mode", () => {
  test("j and k move the Highlight, a count, G and gg jump, and each move is announced", () => {
    render(tab())
    type("j")
    expect(ringed()).toEqual(["a"])
    type("2", "j")
    expect(ringed()).toEqual(["c"])
    type("g", "g")
    expect(ringed()).toEqual(["a"])
    type("G", "k")
    expect(ringed()).toEqual(["b"])
    expect(screen.getByTestId("keyboard-announcer").textContent).toBe(
      "@b, 2 of 3",
    )
  })

  test("x ticks a Candidate, and cannot tick a followed one", () => {
    render(tab())
    type("j", "x")
    expect(ticked()).toEqual(["a", "b"])
    type("j", "x")
    // The followed Candidate's box is checked and fixed, as with the mouse.
    expect(ticked()).toEqual(["a", "b"])
    type("j", "x", "x")
    expect(ticked()).toEqual(["a", "b"])
  })

  test("f follows, d dismisses, and o opens the Candidate in Telegram", () => {
    render(tab())
    const opened: string[] = []
    screen
      .getByTestId("discover-channel-link-a")
      .addEventListener("click", (e) => {
        e.preventDefault()
        opened.push("a")
      })
    type("j", "f", "d", "o")
    expect(calls.follow.mock.calls).toEqual([["a"]])
    expect(calls.ignore.mock.calls).toEqual([["a", true]])
    expect(opened).toEqual(["a"])
  })

  test("d says what it did and to whom, and Undo restores the Candidate's state", async () => {
    render(tab())
    type("j", "j", "d")
    expect(await screen.findByText("Dismiss · @b")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    // Undo sets the state the Candidate had, whether or not its row is
    // still on screen (a dismissed row leaves the default view).
    expect(calls.ignore.mock.calls).toEqual([
      ["b", true],
      ["b", false],
    ])
  })

  test("x and J show no toast", async () => {
    render(tab())
    type("j", "x", "J")
    await new Promise((r) => setTimeout(r, 50))
    expect(document.querySelector("[data-sonner-toast]")).toBeNull()
  })

  test("Enter opens Details, the moves wait while they are open, and Esc closes them", () => {
    render(tab())
    type("j", "Enter")
    expect(panel()).not.toBeNull()
    type("j")
    expect(ringed()).toEqual(["a"])
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
      code: "Escape",
    })
    expect(panel()).toBeNull()
    type("j")
    expect(ringed()).toEqual(["b"])
  })

  test("/ goes to the name filter", () => {
    render(tab())
    type("/")
    expect(document.activeElement).toBe(
      screen.getByLabelText("Filter candidates by name"),
    )
  })

  test("J ticks while moving, past a followed Candidate", () => {
    render(tab())
    type("j", "J", "J")
    expect(ticked()).toEqual(["a", "b", "c"])
    type("x", "K")
    expect(ticked()).toEqual(["a", "b"])
  })

  test("F and D press the bulk bar's buttons; with nothing ticked a toast says so", async () => {
    render(tab())
    type("F")
    expect(await screen.findByText("Nothing ticked to follow")).toBeTruthy()
    type("j", "x", "F", "D")
    expect(calls.bulkFollow.mock.calls).toEqual([[["a"]]])
    expect(calls.bulkDismiss.mock.calls).toEqual([[["a"]]])
  })
})
