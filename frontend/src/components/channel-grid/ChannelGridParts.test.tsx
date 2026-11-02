import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import type React from "react"
import { renderToStaticMarkup } from "react-dom/server"

import {
  type CardFieldSettings,
  type CardZoom,
  cardFace,
} from "@/lib/channels/card-zoom"
import type { Channel } from "@/types"
import { ChannelGridBody } from "./ChannelGridBody"
import { ChannelGridDialogs } from "./ChannelGridDialogs"

const noop = () => {}

afterEach(cleanup)

/** Every optional field off but the bio. */
const SETTINGS: CardFieldSettings = {
  showChannelBio: true,
  showChannelSubscribers: false,
  showChannelTelegramChatId: false,
  showChannelPhotos: false,
  showChannelVideos: false,
  showChannelFiles: false,
  showChannelLinks: false,
  showChannelStartId: false,
}

describe("ChannelGridBody", () => {
  const props = (
    over: Partial<React.ComponentProps<typeof ChannelGridBody>>,
  ): React.ComponentProps<typeof ChannelGridBody> => ({
    isLoading: false,
    totalChannelCount: 0,
    filteredChannelCount: 0,
    channels: [],
    showSortRank: false,
    zoom: 0,
    selectedChannels: new Set(),
    selectedTrimRanks: new Map(),
    postsInScopeCounts: {},
    onFilterByTag: noop,
    onRemoveChannel: noop,
    onResetAndSync: noop,
    onSelectChannel: noop,
    hasMore: false,
    onLoadMore: noop,
    scrollContainerRef: { current: null },
    onZoomChange: noop,
    onSpotlight: noop,
    face: cardFace(0, SETTINGS),
    ...over,
  })
  const body = (over: Partial<React.ComponentProps<typeof ChannelGridBody>>) =>
    renderToStaticMarkup(<ChannelGridBody {...props(over)} />)

  /** The loading skeleton at one Card size, mounted. */
  const skeleton = (zoom: CardZoom, settings = SETTINGS) => {
    const { container } = render(
      <ChannelGridBody
        {...props({ isLoading: true, zoom, face: cardFace(zoom, settings) })}
      />,
    )
    const cards = [...container.querySelectorAll("[data-card-size]")]
    const parts = (part: string) =>
      container.querySelectorAll(`[data-skeleton-part="${part}"]`).length
    return { container, cards, parts }
  }

  test("shows skeletons while loading, whatever the counts say", () => {
    const html = body({ isLoading: true, totalChannelCount: 5 })
    expect(html).toContain('data-slot="skeleton"')
    expect(html).not.toContain("No Channels Found")
  })

  // CSK-01: the placeholders take the shape, columns and rough count of the
  // cards that will load at the stored Card size. happy-dom lays nothing out,
  // so the grid is given the width of a wide window to measure.
  const clientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  )
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 1280,
    })
  })
  afterAll(() => {
    if (clientWidth)
      Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidth)
  })

  test.each([
    [-2, "tiles", 14, 6],
    [-1, "compact", 5, 4],
    [0, "cards", 4, 2],
    [1, "detailed", 3, 2],
  ] as const)(
    "at Card size %i, fills the grid's columns with %s",
    (zoom, name, lanes, rows) => {
      const { container, cards } = skeleton(zoom)
      const grid = container.querySelector<HTMLElement>("#tour-channel-grid")
      expect(grid?.style.gridTemplateColumns).toBe(
        `repeat(${lanes}, minmax(0, 1fr))`,
      )
      expect(cards.length).toBe(lanes * rows)
      expect(
        new Set(cards.map((c) => c.getAttribute("data-card-size"))),
      ).toEqual(new Set([name]))
    },
  )

  test("a tile is a photo alone", () => {
    const { parts } = skeleton(-2)
    expect(["header", "stat", "tag", "bio", "about"].map(parts)).toEqual([
      0, 0, 0, 0, 0,
    ])
  })

  test("a compact card is a header and a sync button, no sections", () => {
    const { cards, parts } = skeleton(-1)
    expect(parts("header")).toBe(cards.length)
    expect(["stat", "tag", "bio", "about"].map(parts)).toEqual([0, 0, 0, 0])
  })

  test("cards follow the card settings: no bio lines with the bio off", () => {
    const { cards, parts } = skeleton(0, { ...SETTINGS, showChannelBio: false })
    expect(parts("bio")).toBe(0)
    expect(parts("about")).toBe(0)
    expect(parts("tag")).toBe(cards.length)
    // The four stat tiles every card shows, on each placeholder.
    expect(parts("stat")).toBe(cards.length * 4)
  })

  test("detailed cards show every section whatever the settings", () => {
    const off = { ...SETTINGS, showChannelBio: false }
    const { cards, parts } = skeleton(1, off)
    expect(parts("stat")).toBe(cards.length * 9)
    expect(parts("bio")).toBeGreaterThan(0)
    expect(parts("about")).toBeGreaterThan(0)
  })

  test("tells an empty account to add a channel", () => {
    expect(body({})).toContain("Start by adding a Telegram channel")
  })

  test("tells a filtered-out account its search matched nothing", () => {
    const html = body({ totalChannelCount: 4 })
    expect(html).toContain("No channels match your search.")
    expect(html).not.toContain("Start by adding")
  })
})

describe("ChannelGridDialogs", () => {
  test("renders nothing while nothing is pending", () => {
    const html = renderToStaticMarkup(
      <ChannelGridDialogs
        confirmResetModal={null}
        onCloseResetModal={noop}
        onConfirmResetAndSync={noop}
        confirmDeleteChannel={null}
        onCloseDeleteChannel={noop}
        onConfirmDeleteChannel={noop}
        confirmBulkDelete={false}
        onBulkDeleteOpenChange={noop}
        onConfirmBulkDelete={noop}
        actionCount={0}
        hiddenNote=""
        confirmBulkFreezeAction={null}
        onCloseBulkFreezeAction={noop}
        onConfirmBulkFreezeAction={noop}
      />,
    )
    expect(html).toBe("")
  })

  test("names the pending channel and count in each open dialog", () => {
    // Radix portals an open dialog, so this needs a DOM, not static markup.
    render(
      <ChannelGridDialogs
        confirmResetModal={{ name: "carrier", startId: 42 } as Channel}
        onCloseResetModal={noop}
        onConfirmResetAndSync={noop}
        confirmDeleteChannel={{ name: "gone" } as Channel}
        onCloseDeleteChannel={noop}
        onConfirmDeleteChannel={noop}
        confirmBulkDelete
        onBulkDeleteOpenChange={noop}
        onConfirmBulkDelete={noop}
        actionCount={3}
        hiddenNote="40 selected Channels hidden by filters are not affected."
        confirmBulkFreezeAction="freeze"
        onCloseBulkFreezeAction={noop}
        onConfirmBulkFreezeAction={noop}
      />,
    )
    expect(
      screen.getByText("Clear all posts for @carrier and re-sync from ID 42?"),
    ).toBeTruthy()
    expect(screen.getByText("@gone")).toBeTruthy()
    expect(screen.getByText("Remove 3 Channels")).toBeTruthy()
    expect(screen.getByText("Freeze Selected Channels?")).toBeTruthy()
    // CTB-04: both bulk confirmations name the Hidden selection they spare.
    expect(
      screen.getAllByText(/40 selected Channels hidden by filters/),
    ).toHaveLength(2)
    expect(screen.getByText(/^Freeze 3 selected channels\./)).toBeTruthy()
  })
})
