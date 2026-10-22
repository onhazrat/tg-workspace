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
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
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

const candidate = (name: string, isFollowed = false, isIgnored = false) =>
  ({
    name,
    counts: { forward: 1, mention: 0, link: 0 },
    total: 1,
    seenIn: [],
    seenInCount: 0,
    lastSeen: 0,
    isFollowed,
    isIgnored,
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

type Calls = Record<
  "follow" | "ignore" | "setIgnored" | "bulkFollow" | "bulkDismiss",
  Spy
>
type Spy = ReturnType<typeof mock<(...args: unknown[]) => void>>
let calls: Calls

function Report({
  report = null,
  rows = ROWS,
}: {
  report?: string | null
  rows?: DiscoveryCandidate[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [inspecting, setInspecting] = useState<string | null>(null)
  const highlight = useDiscoverKeys({
    report,
    names: rows.map((r) => r.name),
    onOpen: setInspecting,
    // As DiscoverView passes them: the whole report, and the mutation's mutate.
    candidates: rows,
    setIgnored: (change) => calls.setIgnored(change),
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
        candidates={rows}
        highlight={highlight}
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

const tab = (report: string | null = null, rows = ROWS) => (
  <QueryClientProvider client={new QueryClient()}>
    <Toaster />
    <KeyboardMode ops={OPS} />
    <Report report={report} rows={rows} />
  </QueryClientProvider>
)

const highlighted = () =>
  Array.from(document.querySelectorAll("tr[data-highlight]")).map((el) =>
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
    setIgnored: mock(),
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
    expect(highlighted()).toEqual(["a"])
    type("2", "j")
    expect(highlighted()).toEqual(["c"])
    type("g", "g")
    expect(highlighted()).toEqual(["a"])
    type("G", "k")
    expect(highlighted()).toEqual(["b"])
    expect(screen.getByTestId("keyboard-announcer").textContent).toBe(
      "@b, 2 of 3",
    )
  })

  test("each report tab remembers its own Highlight across a tab switch", () => {
    // From one report tab to another the view stays mounted; only the
    // report changes.
    const view = render(tab("r1"))
    type("j", "j")
    expect(highlighted()).toEqual(["b"])
    view.rerender(tab("r2"))
    expect(highlighted()).toEqual([])
    type("j")
    expect(highlighted()).toEqual(["a"])
    view.rerender(tab("r1"))
    expect(highlighted()).toEqual(["b"])
    view.rerender(tab("r2"))
    expect(highlighted()).toEqual(["a"])
    view.rerender(tab("r1"))
    expect(highlighted()).toEqual(["b"])
    // Through another kind of tab the view unmounts.
    cleanup()
    render(tab("r2"))
    expect(highlighted()).toEqual(["a"])
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
    expect(calls.ignore.mock.calls).toEqual([["b", true]])
    expect(calls.setIgnored.mock.calls).toEqual([
      [{ handles: ["b"], ignored: false }],
    ])
  })

  test("Undo after d on a dismissed Candidate dismisses it again", async () => {
    const rows = [candidate("a"), candidate("c", false, true)]
    render(tab(null, rows))
    type("j", "j", "d")
    expect(calls.ignore.mock.calls).toEqual([["c", false]])
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }))
    expect(calls.setIgnored.mock.calls).toEqual([
      [{ handles: ["c"], ignored: true }],
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
    expect(highlighted()).toEqual(["a"])
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
      code: "Escape",
    })
    expect(panel()).toBeNull()
    type("j")
    expect(highlighted()).toEqual(["b"])
  })

  test("in keyboard mode each row control names its key; off, it does not", () => {
    render(tab())
    const title = (testId: string) =>
      screen.getByTestId(testId).getAttribute("title")
    expect(title("discover-select-a")).toBe("Shift-click to select a range (x)")
    expect(title("discover-follow-a")).toBe("Follow @a (f)")
    expect(title("discover-ignore-a")).toBe(
      "Hide this channel from future reports (d)",
    )
    expect(title("discover-channel-link-a")).toBe("Open @a in Telegram (o)")
    act(() => setKeyboardMode(false))
    expect(title("discover-select-a")).toBe("Shift-click to select a range")
    expect(title("discover-follow-a")).toBeNull()
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
