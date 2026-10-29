/**
 * The Channels grid's adapter on keyboard mode's engine (CARD-05, ADR-034).
 * The Highlight is a Channel name held in state, because the virtualised grid
 * unmounts cards scrolled out of range, and every move asks the grid to
 * centre the highlighted row. A key presses the highlighted card's own
 * control, every size carries a control for each action it lists, - and +
 * change the size and c shows the Channel alone in Posts. Keys are typed as a
 * browser sends them, Shift first.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { useState } from "react"
import { Toaster } from "sonner"
import { KeyboardMode } from "@/components/keyboard/KeyboardMode"
import { queryKeys } from "@/hooks/queryKeys"
import {
  type CardFieldSettings,
  type CardZoom,
  cardFace,
} from "@/lib/channels/card-zoom"
import { ACTIONS } from "@/lib/keyboard/key-list"
import { keydowns } from "@/lib/keyboard/keydowns"
import {
  announcement,
  lastHighlight,
  setKeyboardMode,
} from "@/lib/keyboard/mode"
import { queryClient } from "@/lib/queryClient"
import type { Channel } from "@/types"
import { ChannelCardFace } from "../channel-card/ChannelCardFace"
import { ChannelCardTile } from "../channel-card/ChannelCardTile"
import { REVEAL_CHANNEL } from "../post-card/PhotoViewer"
import { useChannelKeys, useRevealChannel } from "./ChannelGridKeyboard"

const settings: CardFieldSettings = {
  showChannelBio: true,
  showChannelSubscribers: false,
  showChannelTelegramChatId: false,
  showChannelPhotos: false,
  showChannelVideos: false,
  showChannelFiles: false,
  showChannelLinks: false,
  showChannelStartId: false,
}
const channel = (name: string): Channel => ({
  id: name,
  name,
  displayName: name.toUpperCase(),
  photoUrl: `https://example.test/${name}.jpg`,
  bio: "A bio long enough to be cut.",
  tags: [],
})
const NAMES = ["a", "b", "c", "d", "e"]

type Spy = ReturnType<typeof mock<(name: string) => void>>
type Spies = Record<"select" | "sync" | "freeze" | "spotlight", Spy>
const spies = (): Spies => ({
  select: mock(),
  sync: mock(),
  freeze: mock(),
  spotlight: mock(),
})

const OPS = {
  go: () => {},
  step: () => {},
  goToNth: () => {},
  close: () => {},
  reopen: () => {},
}

function Grid({
  zoom: startZoom = 0,
  names = NAMES,
  lanes = 2,
  firstVisibleRow = 0,
  scrollToRow = () => {},
  spies,
}: {
  zoom?: CardZoom
  names?: string[]
  lanes?: number
  firstVisibleRow?: number
  scrollToRow?: (row: number) => void
  spies?: Spies
}) {
  const [zoom, setZoom] = useState<CardZoom>(startZoom)
  const highlight = useChannelKeys({
    names,
    lanes,
    firstVisibleRow,
    scrollToRow,
    zoom,
    onZoomChange: setZoom,
    onSpotlight: (name) => spies?.spotlight(name),
  })
  const face = cardFace(zoom, settings)
  return (
    <>
      <KeyboardMode ops={OPS} />
      <output data-testid="zoom">{zoom}</output>
      <input aria-label="Search channels" />
      {names.map((name) =>
        face.layout === "tile" ? (
          <ChannelCardTile
            key={name}
            channel={channel(name)}
            isSelected={false}
            isScraping={false}
            busy={false}
            highlighted={highlight === name}
            onToggleSelected={() => spies?.select(name)}
            onSync={() => spies?.sync(name)}
          />
        ) : (
          <ChannelCardFace
            key={name}
            channel={channel(name)}
            stats={undefined}
            face={face}
            inScopeCount={0}
            accountChannels={[]}
            onFilterByTag={() => {}}
            isSelected={false}
            isScraping={false}
            busy={false}
            queuePosition={null}
            highlighted={highlight === name}
            onToggleSelected={() => spies?.select(name)}
            onToggleFreeze={() => spies?.freeze(name)}
            onResetAndSync={() => {}}
            onRemove={() => {}}
            onSaveChannel={() => {}}
            onSync={() => spies?.sync(name)}
          />
        ),
      )}
    </>
  )
}

const highlighted = () =>
  Array.from(document.querySelectorAll("[data-highlight]")).map((el) =>
    el.getAttribute("data-channel-name"),
  )
/** Typed as a browser sends them: a Shift keydown before a capital. */
const press = (...keys: string[]) => {
  for (const init of keydowns(...keys))
    fireEvent.keyDown(document.activeElement ?? document.body, init)
}
const card = (name: string) =>
  document.querySelector(`[data-channel-name="${name}"]`) as HTMLElement
// Photos resolve asynchronously before their buttons appear.
const settle = () => act(() => Promise.resolve())

const RealResizeObserver = globalThis.ResizeObserver
/**
 * Only `scrollHeight` is stubbed. Deleting a `clientHeight` stub afterwards
 * took the test DOM's own getter with it and broke a later file's tests.
 */
function stubLayout() {
  beforeEach(() => {
    lastHighlight.clear()
    announcement.set("")
    setKeyboardMode(true)
    // The test DOM does no layout: every bio overflows its two lines.
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 80,
    })
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })
  afterEach(() => {
    cleanup()
    setKeyboardMode(false)
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
    globalThis.ResizeObserver = RealResizeObserver
  })
}

describe("moving the Highlight", () => {
  stubLayout()
  test("j starts at the first row on screen, then j and k step in reading order", () => {
    const scrollToRow = mock()
    render(<Grid firstVisibleRow={1} scrollToRow={scrollToRow} />)
    expect(highlighted()).toEqual([])
    press("j")
    expect(highlighted()).toEqual(["c"])
    expect(scrollToRow).toHaveBeenLastCalledWith(1)
    press("j", "j")
    expect(highlighted()).toEqual(["e"])
    expect(scrollToRow).toHaveBeenLastCalledWith(2)
    press("j")
    expect(highlighted()).toEqual(["e"])
    press("k")
    expect(highlighted()).toEqual(["d"])
    expect(scrollToRow).toHaveBeenLastCalledWith(1)
  })

  test("k first also starts at the first row on screen, and stops at the top", () => {
    render(<Grid firstVisibleRow={0} />)
    press("k")
    expect(highlighted()).toEqual(["a"])
    press("k")
    expect(highlighted()).toEqual(["a"])
  })

  test("G goes to the last Channel and gg to the first, scrolling to each row", () => {
    const scrollToRow = mock()
    render(<Grid scrollToRow={scrollToRow} />)
    press("G")
    expect(highlighted()).toEqual(["e"])
    expect(scrollToRow).toHaveBeenLastCalledWith(2)
    press("g")
    expect(highlighted()).toEqual(["e"])
    press("g")
    expect(highlighted()).toEqual(["a"])
    expect(scrollToRow).toHaveBeenLastCalledWith(0)
  })

  test("a count moves that far, 4G goes to the fourth, and each move is announced", () => {
    const scrollToRow = mock()
    render(<Grid scrollToRow={scrollToRow} />)
    press("3", "j")
    expect(highlighted()).toEqual(["c"])
    press("4", "G")
    expect(highlighted()).toEqual(["d"])
    expect(scrollToRow).toHaveBeenLastCalledWith(1)
    expect(screen.getByTestId("keyboard-announcer").textContent).toBe(
      "@d, 4 of 5",
    )
  })

  test("Escape drops the Highlight, and turning keyboard mode off hides it", () => {
    render(<Grid />)
    press("j", "Escape")
    expect(highlighted()).toEqual([])
    press("j")
    act(() => setKeyboardMode(false))
    expect(highlighted()).toEqual([])
    press("j")
    expect(highlighted()).toEqual([])
  })

  test("the Highlight comes back when the tab is shown again", () => {
    const scrollToRow = mock()
    const view = render(<Grid />)
    press("j", "j", "j")
    view.unmount()
    render(<Grid scrollToRow={scrollToRow} />)
    expect(highlighted()).toEqual(["c"])
    expect(scrollToRow).toHaveBeenLastCalledWith(1)
  })

  test("an empty grid ignores every move", () => {
    const scrollToRow = mock()
    render(<Grid names={[]} scrollToRow={scrollToRow} />)
    press("j", "G")
    expect(scrollToRow).not.toHaveBeenCalled()
  })
})

describe("a key presses the highlighted card's own control", () => {
  stubLayout()

  test("x selects, s syncs and z freezes the highlighted Channel only", () => {
    const s = spies()
    render(<Grid spies={s} />)
    press("j", "j", "x", "s", "z")
    expect(s.select.mock.calls).toEqual([["b"]])
    expect(s.sync.mock.calls).toEqual([["b"]])
    expect(s.freeze.mock.calls).toEqual([["b"]])
  })

  test("with manual single off, s sends no sync and says why (RKD-02)", async () => {
    const off = "Manual single is disabled on this deployment"
    queryClient.setQueryData(queryKeys.runtimeConfig, {
      requestKinds: [{ kind: "single", enabled: false, refusal: off }],
    })
    try {
      const s = spies()
      render(
        <>
          <Toaster />
          <Grid spies={s} />
        </>,
      )
      press("j", "s")
      expect(s.sync).not.toHaveBeenCalled()
      expect(await screen.findByText(off)).toBeTruthy()
    } finally {
      queryClient.removeQueries({ queryKey: queryKeys.runtimeConfig })
    }
  })

  test("J selects while moving, from the Highlight on", () => {
    const s = spies()
    render(<Grid spies={s} />)
    press("j", "J")
    expect(s.select.mock.calls).toEqual([["a"], ["b"]])
    expect(highlighted()).toEqual(["b"])
  })

  test("t puts focus in the tag field, after which keys are typing", () => {
    const s = spies()
    render(<Grid spies={s} />)
    press("j", "t")
    expect(document.activeElement).toBe(
      card("a").querySelector('input[aria-label="Add tag"]'),
    )
    press("j", "x")
    expect(highlighted()).toEqual(["a"])
    expect(s.select).not.toHaveBeenCalled()
  })

  test("o opens the Channel in Telegram", () => {
    render(<Grid />)
    const opened: string[] = []
    const onClick = (e: MouseEvent) => {
      e.preventDefault()
      opened.push(
        (e.target as HTMLAnchorElement).getAttribute("aria-label") ?? "",
      )
    }
    document.addEventListener("click", onClick, true)
    try {
      press("j", "o")
    } finally {
      document.removeEventListener("click", onClick, true)
    }
    expect(opened).toEqual(["Open A in Telegram"])
  })

  test("m expands the bio and collapses it again", () => {
    render(<Grid />)
    press("j", "m")
    expect(screen.getAllByRole("button", { name: "Less" })).toHaveLength(1)
    press("m")
    expect(screen.queryByRole("button", { name: "Less" })).toBeNull()
  })

  test("p opens the photo, and no key moves the Highlight while it is open", async () => {
    const s = spies()
    render(<Grid spies={s} />)
    await settle()
    press("j", "p")
    expect(screen.getByRole("dialog", { name: "Channel photo" })).toBeTruthy()
    press("j", "x")
    expect(highlighted()).toEqual(["a"])
    expect(s.select).not.toHaveBeenCalled()
  })

  test("p again closes the photo, and an Esc the viewer took keeps the Highlight (KM-01)", async () => {
    render(<Grid />)
    await settle()
    press("j", "p")
    expect(screen.getByRole("dialog", { name: "Channel photo" })).toBeTruthy()
    press("p")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(highlighted()).toEqual(["a"])

    // In a browser the viewer is gone before the grid hears the Escape that
    // closed it; all the grid sees is a key already taken.
    const taken = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    })
    taken.preventDefault()
    act(() => {
      window.dispatchEvent(taken)
    })
    expect(highlighted()).toEqual(["a"])
  })

  test("a key with a modifier held, or with nothing highlighted, does nothing", () => {
    const s = spies()
    render(<Grid spies={s} />)
    press("x", "j")
    for (const mod of ["ctrlKey", "metaKey", "altKey"])
      for (const key of ["x", "j"])
        fireEvent.keyDown(document.body, {
          key,
          code: `Key${key.toUpperCase()}`,
          [mod]: true,
        })
    expect(s.select).not.toHaveBeenCalled()
    expect(highlighted()).toEqual(["a"])
  })

  test("a tile answers x and s from its own controls", async () => {
    const s = spies()
    render(<Grid zoom={-2} spies={s} />)
    await settle()
    press("j", "x", "s")
    expect(s.select.mock.calls).toEqual([["a"]])
    expect(s.sync.mock.calls).toEqual([["a"]])
  })
})

describe("the grid's own keys", () => {
  stubLayout()
  test("- and + make the cards smaller and larger, stopping at each end", () => {
    render(<Grid />)
    const zoom = () => screen.getByTestId("zoom").textContent
    press("-")
    expect(zoom()).toBe("-1")
    press("-", "-")
    expect(zoom()).toBe("-2")
    press("+", "+", "+", "+")
    expect(zoom()).toBe("1")
  })

  test("c shows the highlighted Channel alone in Posts", () => {
    const s = spies()
    render(<Grid spies={s} />)
    press("c")
    expect(s.spotlight).not.toHaveBeenCalled()
    press("j", "c")
    expect(s.spotlight.mock.calls).toEqual([["a"]])
  })

  test("/ puts the cursor in the search box", () => {
    render(<Grid />)
    press("/")
    expect(document.activeElement).toBe(
      screen.getByLabelText("Search channels"),
    )
  })
})

describe("every size carries a control for each action it lists", () => {
  stubLayout()
  test.each([-2, -1, 0, 1] as const)("at zoom %d", async (zoom) => {
    render(<Grid zoom={zoom} names={["a"]} />)
    await settle()
    const keys = cardFace(zoom, settings).keys.map((a) => ACTIONS[a].key)
    const carried = Array.from(
      card("a").querySelectorAll("[data-shortcut]"),
      (el) => el.getAttribute("data-shortcut"),
    )
    expect(new Set(carried)).toEqual(new Set<string>(keys))
  })

  test("in keyboard mode a keyed control names its key; off, it does not", async () => {
    render(<Grid names={["a"]} />)
    await settle()
    const titled = () =>
      Array.from(
        card("a").querySelectorAll<HTMLElement>("[data-shortcut][title]"),
        (el) => [el.dataset.shortcut, el.title],
      )
    expect(titled()).toEqual([
      ["x", "Select a (x)"],
      ["p", "View A's photo (p)"],
      ["m", "More bio (m)"],
      ["t", "Add tag (t)"],
    ])
    act(() => setKeyboardMode(false))
    expect(titled()).toEqual([])
  })

  test("Reset and Remove have no key", () => {
    render(<Grid names={["a"]} />)
    for (const label of [/^Reset/, /^Remove Channel/])
      expect(
        screen
          .getByRole("button", { name: label })
          .hasAttribute("data-shortcut"),
      ).toBe(false)
  })
})

describe("the photo viewer's close", () => {
  stubLayout()
  test("the photo viewer's reveal scrolls to that Channel's row, whether or not keyboard mode is on", () => {
    const scrollToRow = mock()
    function Reveal() {
      useRevealChannel({ names: NAMES, lanes: 2, scrollToRow })
      return null
    }
    render(<Reveal />)
    const reveal = (name: string) =>
      act(() => {
        window.dispatchEvent(new CustomEvent(REVEAL_CHANNEL, { detail: name }))
      })
    reveal("e")
    expect(scrollToRow.mock.calls).toEqual([[2]])
    reveal("not-in-the-grid")
    expect(scrollToRow.mock.calls).toEqual([[2]])
  })
})
