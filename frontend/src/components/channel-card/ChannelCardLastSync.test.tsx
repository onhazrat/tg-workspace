/**
 * The Last sync and the schedules as the card face shows them (CARD-01). The
 * state rule is read through the face's `data-last-sync` attribute, never
 * through colour classes, and time is pinned so the 24-hour boundary is exact.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import {
  type CardFieldSettings,
  type CardZoom,
  cardFace,
} from "@/lib/channels/card-zoom"
import type { Channel, ChannelStats } from "@/types"
import { ChannelCardFace } from "./ChannelCardFace"
import { ChannelCardTile } from "./ChannelCardTile"

const NOW = Date.parse("2026-10-08T12:00:00Z")
const H = 3_600_000
const noop = () => {}
const stats = (maxId: number, latestId: number): ChannelStats => ({
  count: 1,
  maxId,
  latestId,
  reach: null,
  reachEstimated: false,
})

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

const synced: Channel = {
  id: "c1",
  name: "durov",
  tags: [],
  lastUpdated: NOW - 3 * H,
}

beforeEach(() => setSystemTime(NOW))
afterEach(() => {
  cleanup()
  setSystemTime()
})

function renderCard(
  channel: Channel,
  zoom: CardZoom = -1,
  overrides: Partial<ComponentProps<typeof ChannelCardFace>> = {},
) {
  return render(
    <ChannelCardFace
      channel={channel}
      stats={undefined}
      face={cardFace(zoom, settingsOff)}
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

/** The one Last sync mark on the card, or how many there were instead. */
function lastSync(): HTMLElement {
  const marks = document.querySelectorAll<HTMLElement>("[data-last-sync]")
  expect(marks.length).toBe(1)
  return marks[0]
}

function stateOf(channel: Channel, zoom: CardZoom = -1): string | null {
  renderCard(channel, zoom)
  const state = lastSync().getAttribute("data-last-sync")
  cleanup()
  return state
}

describe("the Last sync state", () => {
  test("each of the five states", () => {
    expect(stateOf({ ...synced, nextRegularSyncAt: NOW + H })).toBe(
      "on-schedule",
    )
    expect(stateOf({ ...synced, nextRegularSyncAt: NOW - 2 * H })).toBe("due")
    expect(stateOf({ ...synced, nextRegularSyncAt: NOW - 30 * H })).toBe("late")
    expect(
      stateOf({
        ...synced,
        lastUpdated: undefined,
        nextRegularSyncAt: NOW + H,
      }),
    ).toBe("never")
    expect(
      stateOf({ ...synced, isFrozen: true, nextRegularSyncAt: NOW - 30 * H }),
    ).toBe("idle")
    expect(
      stateOf({
        ...synced,
        regularSyncEnabled: false,
        nextRegularSyncAt: NOW - 30 * H,
      }),
    ).toBe("idle")
  })

  test("exactly 24 hours past due is late, a moment less is due", () => {
    expect(stateOf({ ...synced, nextRegularSyncAt: NOW - 24 * H })).toBe("late")
    expect(stateOf({ ...synced, nextRegularSyncAt: NOW - 24 * H + 1 })).toBe(
      "due",
    )
  })

  test("only an enabled schedule makes a channel due or late", () => {
    // Dynamic is off unless the channel says otherwise, whatever time it holds.
    expect(
      stateOf({
        ...synced,
        nextRegularSyncAt: NOW + H,
        nextDynamicSyncAt: NOW - 30 * H,
      }),
    ).toBe("on-schedule")
    expect(
      stateOf({
        ...synced,
        dynamicSyncEnabled: true,
        nextRegularSyncAt: NOW + H,
        nextDynamicSyncAt: NOW - 2 * H,
      }),
    ).toBe("due")
    // Regular off and Dynamic on: Regular's stored time is ignored.
    expect(
      stateOf({
        ...synced,
        regularSyncEnabled: false,
        dynamicSyncEnabled: true,
        nextRegularSyncAt: NOW - 30 * H,
        nextDynamicSyncAt: NOW + H,
      }),
    ).toBe("on-schedule")
  })

  test("every size that shows the Last sync carries its state; a tile shows none", () => {
    const late = { ...synced, nextRegularSyncAt: NOW - 30 * H }
    expect(([-1, 0, 1] as const).map((zoom) => stateOf(late, zoom))).toEqual([
      "late",
      "late",
      "late",
    ])
    render(
      <ChannelCardTile
        channel={late}
        isSelected={false}
        isScraping={false}
        onToggleSelected={noop}
      />,
    )
    expect(document.querySelector("[data-last-sync]")).toBeNull()
  })

  test("a Restricted channel keeps its Restricted label and shows its age as idle", () => {
    const restricted = {
      ...synced,
      isUnavailableOnWebView: true,
      nextRegularSyncAt: NOW - 30 * H,
    }
    expect(stateOf(restricted, -1)).toBe("idle")
    renderCard(restricted, 0)
    expect(lastSync().getAttribute("data-last-sync")).toBe("idle")
    expect(screen.getByText("Restricted")).toBeTruthy()
  })
})

describe("what each size says about syncing", () => {
  const scheduled: Channel = { ...synced, nextRegularSyncAt: NOW + H + 60_000 }

  test("a compact card shows the age, the next sync and exact times in its hint", () => {
    renderCard(scheduled, -1)
    const line = lastSync()
    expect(line.textContent).toBe("3h agonext in 1h")
    const hint = line.getAttribute("title") ?? ""
    expect(hint).toContain(
      `Last synced ${new Date(NOW - 3 * H).toLocaleString()}`,
    )
    expect(hint).toContain(
      `Regular ${new Date(NOW + H + 60_000).toLocaleString()}`,
    )
    expect(hint).toContain("Dynamic off")
  })

  test("a card says Synced and the next sync, and no status unless Restricted or Frozen", () => {
    renderCard(scheduled, 0)
    expect(lastSync().textContent).toBe("Synced 3h ago")
    expect(screen.getByText("next in 1h")).toBeTruthy()
    expect(screen.queryByText("Frozen")).toBeNull()
    expect(screen.queryByText("Restricted")).toBeNull()
    cleanup()
    renderCard({ ...scheduled, isFrozen: true }, 0)
    expect(screen.getByText("Frozen")).toBeTruthy()
  })

  test("a channel that never synced says so", () => {
    renderCard({ ...scheduled, lastUpdated: undefined }, 0)
    expect(lastSync().textContent).toBe("Never synced")
    cleanup()
    renderCard({ ...scheduled, lastUpdated: undefined }, -1)
    expect(lastSync().textContent).toBe("Nevernext in 1h")
  })

  test("Pending and Up to date appear on no card face", () => {
    // A local copy short of the newest post id used to read "Pending".
    for (const zoom of [-1, 0, 1] as const) {
      renderCard(scheduled, zoom, { stats: stats(5, 9) })
      expect(document.body.textContent).not.toMatch(/Pending|Up to date/i)
      cleanup()
    }
  })

  test("the syncing overlay still shows its progress", () => {
    renderCard(scheduled, 0, {
      stats: stats(5, 10),
      isScraping: true,
      busy: true,
    })
    expect(screen.getByText("Syncing 50%")).toBeTruthy()
  })

  test("cards show the earliest enabled schedule", () => {
    const both = {
      ...synced,
      nextRegularSyncAt: NOW + 5 * H + 60_000,
      nextDynamicSyncAt: NOW + 40 * 60_000 + 30_000,
    }
    renderCard({ ...both, dynamicSyncEnabled: true }, 0)
    expect(screen.getByText("next in 40m")).toBeTruthy()
    cleanup()
    renderCard(both, -1)
    expect(screen.getByText("next in 5h")).toBeTruthy()
    cleanup()
    renderCard({ ...synced, regularSyncEnabled: false }, -1)
    expect(screen.getByText("schedules off")).toBeTruthy()
    cleanup()
    renderCard(synced, -1)
    expect(screen.getByText("not scheduled")).toBeTruthy()
  })

  test("a detailed card lists Regular and Dynamic in one of four states each", () => {
    const schedule = (channel: Channel) => {
      renderCard(channel, 1)
      const lines = [
        ...document.querySelectorAll<HTMLElement>("[data-schedule]"),
      ].map((line) => line.textContent)
      cleanup()
      return lines
    }
    // Regular defaults to on, Dynamic to off.
    expect(schedule(synced)).toEqual(["Regularnot scheduled", "Dynamicoff"])
    expect(
      schedule({
        ...synced,
        dynamicSyncEnabled: true,
        nextRegularSyncAt: NOW + 3 * H + 60_000,
        nextDynamicSyncAt: NOW - 2 * H - 60_000,
      }),
    ).toEqual(["Regularin 3h", "Dynamicdue, 2h ago"])
    // Off wins over a stored time.
    expect(
      schedule({
        ...synced,
        regularSyncEnabled: false,
        nextRegularSyncAt: NOW + 3 * H,
      }),
    ).toEqual(["Regularoff", "Dynamicoff"])
  })

  test("a due schedule reads as due, apart from an upcoming one", () => {
    renderCard(
      {
        ...synced,
        dynamicSyncEnabled: true,
        nextRegularSyncAt: NOW + 3 * H,
        nextDynamicSyncAt: NOW - 2 * H,
      },
      1,
    )
    const states = [
      ...document.querySelectorAll<HTMLElement>("[data-schedule-state]"),
    ].map((line) => line.getAttribute("data-schedule-state"))
    expect(states).toEqual(["upcoming", "due"])
  })

  test("the card body has no Last sync chip; the footer is the one place", () => {
    for (const zoom of [0, 1] as const) {
      renderCard(scheduled, zoom)
      expect(screen.getAllByText("3h ago")).toHaveLength(1)
      cleanup()
    }
  })
})
