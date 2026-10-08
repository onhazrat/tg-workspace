/**
 * Stat tiles, the About line and the bio as the card face shows them
 * (CARD-02). Tiles are read through their `data-stat` key, the shown number
 * and label through text, and the exact value through the hover hint.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import {
  type CardFieldSettings,
  type CardZoom,
  cardFace,
} from "@/lib/channels/card-zoom"
import type { Channel, ChannelStats } from "@/types"
import { ChannelCardFace } from "./ChannelCardFace"

const noop = () => {}

const settingsOff: CardFieldSettings = {
  showChannelBio: false,
  showChannelSubscribers: false,
  showChannelTelegramChatId: false,
  showChannelPhotos: false,
  showChannelVideos: false,
  showChannelFiles: false,
  showChannelLinks: false,
  showChannelStartId: false,
}

const channel: Channel = { id: "c1", name: "durov", tags: [] }

const stats: ChannelStats = {
  count: 1234,
  velocity: 2.4,
  reach: 12300,
  reachEstimated: false,
}

afterEach(cleanup)

function renderCard(
  zoom: CardZoom,
  overrides: Partial<ComponentProps<typeof ChannelCardFace>> = {},
  settings: Partial<CardFieldSettings> = {},
) {
  return render(
    <ChannelCardFace
      channel={channel}
      stats={stats}
      face={cardFace(zoom, { ...settingsOff, ...settings })}
      inScopeCount={0}
      accountChannels={[]}
      onFilterByTag={noop}
      isSelected={false}
      isScraping={false}
      busy={false}
      queuePosition={null}
      onToggleSelected={noop}
      onToggleFreeze={noop}
      onResetAndSync={noop}
      onRemove={noop}
      onSaveChannel={noop}
      onSync={noop}
      {...overrides}
    />,
  )
}

/** Each tile as "label=value", in the order the card draws them. */
function tiles(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-stat]")].map(
    (tile) =>
      `${tile.querySelector("[data-stat-label]")?.textContent}=${
        tile.querySelector("[data-stat-value]")?.textContent
      }`,
  )
}

function tile(key: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-stat="${key}"]`)
  if (!found) throw new Error(`no ${key} tile`)
  return found
}

describe("which stat tiles a size shows", () => {
  test("a card shows the four fixed tiles with every setting off", () => {
    renderCard(0)
    expect(tiles()).toEqual([
      "Posts=1.23K",
      "In scope=—",
      "Reach=12.3K",
      "Per hour=2",
    ])
  })

  test("a card adds Subscribers and the media tiles its settings show", () => {
    renderCard(
      0,
      { channel: { ...channel, subscribers: 1500, videos: 3 } },
      { showChannelSubscribers: true, showChannelVideos: true },
    )
    expect(tiles()).toEqual([
      "Posts=1.23K",
      "In scope=—",
      "Reach=12.3K",
      "Per hour=2",
      "Subscribers=1.5K",
      "Videos=3",
    ])
  })

  test("a detailed card shows every tile whatever the settings", () => {
    renderCard(1, {
      channel: {
        ...channel,
        subscribers: 1500,
        photos: 2,
        videos: 3,
        files: 4,
        links: 5,
      },
    })
    expect(tiles()).toEqual([
      "Posts=1.23K",
      "In scope=—",
      "Reach=12.3K",
      "Per hour=2",
      "Subscribers=1.5K",
      "Photos=2",
      "Videos=3",
      "Files=4",
      "Links=5",
    ])
  })

  test("compact cards show no tiles", () => {
    renderCard(-1)
    expect(tiles()).toEqual([])
  })
})

describe("what a tile says", () => {
  test("a shown tile with no value is a dash, never a missing tile", () => {
    renderCard(1, { stats: undefined })
    expect(tiles()).toEqual([
      "Posts=—",
      "In scope=—",
      "Reach=—",
      "Per hour=—",
      "Subscribers=—",
      "Photos=—",
      "Videos=—",
      "Files=—",
      "Links=—",
    ])
  })

  test("the hover hint carries the exact value", () => {
    renderCard(1, { channel: { ...channel, subscribers: 1_234_567 } })
    expect(tile("posts").title).toContain("1,234")
    expect(tile("subscribers").title).toContain("1,234,567")
    expect(tile("perHour").title).toContain("2.400")
  })

  test("In scope counts a selected Channel, zero included", () => {
    renderCard(0, { isSelected: true, inScopeCount: 0 })
    expect(tiles()[1]).toBe("In scope=0")
    cleanup()
    renderCard(0, { isSelected: true, inScopeCount: 4321 })
    expect(tiles()[1]).toBe("In scope=4.32K")
    expect(tile("inScope").title).toContain("4,321")
  })

  test("In scope is a dash saying not selected outside the selection", () => {
    renderCard(0, { isSelected: false, inScopeCount: 12 })
    expect(tiles()[1]).toBe("In scope=—")
    expect(tile("inScope").title).toContain("not selected")
  })

  test("Reach reads measured, estimated with a tilde, or a dash not measured", () => {
    const reach = (r: number | null, reachEstimated: boolean) => {
      renderCard(0, { stats: { ...stats, reach: r, reachEstimated } })
      const shown = tiles()[2]
      const hint = tile("reach").title
      cleanup()
      return { shown, hint }
    }
    expect(reach(12300, false).shown).toBe("Reach=12.3K")
    expect(reach(12300, true).shown).toBe("Reach=~12.3K")
    expect(reach(12300, true).hint).toContain("estimated")
    expect(reach(null, false)).toEqual({
      shown: "Reach=—",
      hint: expect.stringContaining("not measured"),
    })
    // Zero is a measurement, not an absence.
    expect(reach(0, false).shown).toBe("Reach=0")
  })

  test("a slow Channel posts under one an hour; a silent one posts zero", () => {
    renderCard(0, { stats: { ...stats, velocity: 0.4 } })
    expect(tiles()[3]).toBe("Per hour=<1")
    cleanup()
    renderCard(0, { stats: { ...stats, velocity: 0 } })
    expect(tiles()[3]).toBe("Per hour=0")
  })
})

describe("the detailed card's About line", () => {
  const known: Channel = {
    ...channel,
    telegramChatId: 777,
    followedAt: Date.parse("2026-03-04T12:00:00Z"),
    discoveredVia: { channelName: "source", postId: 1, timestamp: 0 },
  }
  const about = () => document.querySelector("[data-card-about]")?.textContent

  test("names the chat id, the follow date and the source Channel", () => {
    renderCard(1, { channel: known })
    const line = about() ?? ""
    expect(line).toContain("Chat ID 777")
    expect(line).toContain(
      `Followed ${new Date(known.followedAt ?? 0).toLocaleDateString()}`,
    )
    expect(line).toContain("Auto-followed from @source")
  })

  test("leaves out what is not known", () => {
    renderCard(1, { channel: { ...channel, telegramChatId: 777 } })
    expect(about()).toBe("Chat ID 777")
    cleanup()
    renderCard(1)
    expect(document.querySelector("[data-card-about]")).toBeNull()
  })

  test("a card and a compact card have none", () => {
    renderCard(0, { channel: known }, { showChannelTelegramChatId: true })
    expect(about()).toBeFalsy()
    cleanup()
    renderCard(-1, { channel: known })
    expect(about()).toBeFalsy()
  })
})

describe("the bio", () => {
  const bio = "A long bio that runs past the lines the card gives it."
  const withBio = { ...channel, bio }
  let overflowing = false
  const resized: (() => void)[] = []
  const RealResizeObserver = globalThis.ResizeObserver

  // The test DOM does no layout, so the measured heights are stubbed: the
  // text overflows when its scroll height passes its clamped height.
  beforeEach(() => {
    overflowing = false
    resized.length = 0
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => (overflowing ? 80 : 20),
    })
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 20,
    })
    globalThis.ResizeObserver = class {
      constructor(private callback: () => void) {}
      observe() {
        resized.push(this.callback)
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })
  afterEach(() => {
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
    globalThis.ResizeObserver = RealResizeObserver
  })

  const text = () => screen.getByText(bio)
  const toggle = () => screen.queryByRole("button", { name: /^(More|Less)$/ })

  test("a card cuts it at two lines and a detailed card at four", () => {
    renderCard(0, { channel: withBio }, { showChannelBio: true })
    expect(text().getAttribute("data-lines")).toBe("2")
    cleanup()
    renderCard(1, { channel: withBio })
    expect(text().getAttribute("data-lines")).toBe("4")
  })

  test("More and Less appear only when text is hidden, at both lengths", () => {
    for (const zoom of [0, 1] as const) {
      overflowing = false
      renderCard(zoom, { channel: withBio }, { showChannelBio: true })
      expect(toggle()).toBeNull()
      cleanup()
      overflowing = true
      renderCard(zoom, { channel: withBio }, { showChannelBio: true })
      fireEvent.click(toggle() as HTMLElement)
      expect(toggle()?.textContent).toBe("Less")
      expect(toggle()?.getAttribute("aria-expanded")).toBe("true")
      expect(text().getAttribute("data-lines")).toBeNull()
      fireEvent.click(toggle() as HTMLElement)
      expect(toggle()?.textContent).toBe("More")
      cleanup()
    }
  })

  test("is measured again when the card's width changes", () => {
    renderCard(0, { channel: withBio }, { showChannelBio: true })
    expect(toggle()).toBeNull()
    overflowing = true
    act(() => {
      for (const callback of resized) callback()
    })
    expect(toggle()?.textContent).toBe("More")
  })

  test("is absent when the settings hide it or there is none", () => {
    renderCard(0, { channel: withBio })
    expect(screen.queryByText(bio)).toBeNull()
    cleanup()
    renderCard(1)
    expect(document.querySelector("[data-lines]")).toBeNull()
  })
})
