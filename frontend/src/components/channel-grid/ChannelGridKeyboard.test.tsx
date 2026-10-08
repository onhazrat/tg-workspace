/**
 * Keyboard mode on the Channels grid (CARD-05). The highlight is a Channel
 * name held in state, because the virtualised grid unmounts cards scrolled
 * out of range, and every move asks the grid to centre the highlighted row.
 * A letter presses the highlighted card's own control, and the legend lists
 * exactly the letters the current size's cards carry a control for.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  type CardFieldSettings,
  type CardZoom,
  cardFace,
} from "@/lib/channels/card-zoom"
import type { Channel } from "@/types"
import { ChannelCardFace } from "../channel-card/ChannelCardFace"
import { ChannelCardTile } from "../channel-card/ChannelCardTile"
import { REVEAL_CHANNEL } from "../post-card/PhotoViewer"
import {
  ChannelKeyHelp,
  useChannelGridKeyboard,
  useRevealChannel,
} from "./ChannelGridKeyboard"

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

type Spies = Record<
  "select" | "sync" | "freeze",
  ReturnType<typeof mock<(name: string) => void>>
>

function Grid({
  zoom = 0,
  names = NAMES,
  lanes = 2,
  firstVisibleRow = 0,
  scrollToRow = () => {},
  on = true,
  spies,
}: {
  zoom?: CardZoom
  names?: string[]
  lanes?: number
  firstVisibleRow?: number
  scrollToRow?: (row: number) => void
  on?: boolean
  spies?: Spies
}) {
  const ring = useChannelGridKeyboard({
    on,
    names,
    lanes,
    firstVisibleRow,
    scrollToRow,
  })
  const face = cardFace(zoom, settings)
  return (
    <>
      <input aria-label="search" />
      {names.map((name) =>
        face.layout === "tile" ? (
          <ChannelCardTile
            key={name}
            channel={channel(name)}
            isSelected={false}
            isScraping={false}
            busy={false}
            highlighted={ring === name}
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
            highlighted={ring === name}
            onToggleSelected={() => spies?.select(name)}
            onToggleFreeze={() => spies?.freeze(name)}
            onResetAndSync={() => {}}
            onRemove={() => {}}
            onSaveChannel={() => {}}
            onSync={() => spies?.sync(name)}
          />
        ),
      )}
      <ChannelKeyHelp on={on} keys={face.keys} />
    </>
  )
}

const highlighted = () =>
  Array.from(document.querySelectorAll("[data-kbd-selected]")).map((el) =>
    el.getAttribute("data-channel-name"),
  )
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init })
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
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
    globalThis.ResizeObserver = RealResizeObserver
  })
}

describe("moving the highlight", () => {
  stubLayout()
  test("j starts at the first row on screen, then j and k step in reading order", () => {
    const scrollToRow = mock()
    render(<Grid firstVisibleRow={1} scrollToRow={scrollToRow} />)
    expect(highlighted()).toEqual([])
    press("j")
    expect(highlighted()).toEqual(["c"])
    expect(scrollToRow).toHaveBeenLastCalledWith(1)
    press("j")
    press("j")
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

  test("Escape drops the highlight, and turning keyboard mode off does too", () => {
    const { rerender } = render(<Grid />)
    press("j")
    press("Escape")
    expect(highlighted()).toEqual([])
    press("j")
    rerender(<Grid on={false} />)
    expect(highlighted()).toEqual([])
    press("j")
    expect(highlighted()).toEqual([])
  })

  test("an empty grid ignores every move", () => {
    const scrollToRow = mock()
    render(<Grid names={[]} scrollToRow={scrollToRow} />)
    press("j")
    press("G")
    expect(scrollToRow).not.toHaveBeenCalled()
  })
})

describe("a letter presses the highlighted card's own control", () => {
  stubLayout()
  const spies = (): Spies => ({ select: mock(), sync: mock(), freeze: mock() })

  test("x selects, s syncs and f freezes the highlighted Channel only", () => {
    const s = spies()
    render(<Grid spies={s} />)
    press("j")
    press("j")
    press("x")
    press("s")
    press("f")
    expect(s.select.mock.calls).toEqual([["b"]])
    expect(s.sync.mock.calls).toEqual([["b"]])
    expect(s.freeze.mock.calls).toEqual([["b"]])
  })

  test("t puts focus in the tag field, after which keys are typing", () => {
    const s = spies()
    render(<Grid spies={s} />)
    press("j")
    press("t")
    expect(document.activeElement).toBe(
      card("a").querySelector('input[aria-label="Add tag"]'),
    )
    press("j")
    press("x")
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
      press("j")
      press("o")
    } finally {
      document.removeEventListener("click", onClick, true)
    }
    expect(opened).toEqual(["Open A in Telegram"])
  })

  test("b expands the bio and collapses it again", () => {
    render(<Grid />)
    press("j")
    press("b")
    expect(screen.getAllByRole("button", { name: "Less" })).toHaveLength(1)
    press("b")
    expect(screen.queryByRole("button", { name: "Less" })).toBeNull()
  })

  test("p opens the photo, and no key moves the highlight while it is open", async () => {
    const s = spies()
    render(<Grid spies={s} />)
    await settle()
    press("j")
    press("p")
    expect(screen.getByRole("dialog", { name: "Channel photo" })).toBeTruthy()
    press("j")
    press("x")
    expect(highlighted()).toEqual(["a"])
    expect(s.select).not.toHaveBeenCalled()
  })

  test("a letter with a modifier held, or with nothing highlighted, does nothing", () => {
    const s = spies()
    render(<Grid spies={s} />)
    press("x")
    press("j")
    for (const mod of ["ctrlKey", "metaKey", "altKey"]) {
      press("x", { [mod]: true })
      press("j", { [mod]: true })
    }
    expect(s.select).not.toHaveBeenCalled()
    expect(highlighted()).toEqual(["a"])
  })

  test("a tile answers x and s from its own controls", async () => {
    const s = spies()
    render(<Grid zoom={-2} spies={s} />)
    await settle()
    press("j")
    press("x")
    press("s")
    expect(s.select.mock.calls).toEqual([["a"]])
    expect(s.sync.mock.calls).toEqual([["a"]])
  })
})

describe("every size carries a control for each letter its legend lists", () => {
  stubLayout()
  test.each([-2, -1, 0, 1] as const)("at zoom %d", async (zoom) => {
    render(<Grid zoom={zoom} names={["a"]} />)
    await settle()
    const keys = cardFace(zoom, settings).keys
    const carried = Array.from(
      card("a").querySelectorAll("[data-shortcut]"),
      (el) => el.getAttribute("data-shortcut"),
    )
    expect(new Set(carried)).toEqual(new Set<string>(keys))
    const legend = Array.from(
      document.querySelectorAll("kbd"),
      (k) => k.textContent,
    )
    expect(legend).toEqual(["j / k", "gg / G", ...keys, "esc"])
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
