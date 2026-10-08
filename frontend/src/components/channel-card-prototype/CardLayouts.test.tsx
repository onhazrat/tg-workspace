import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import { type CardZoom, cardFace } from "@/lib/channels/card-zoom"
import type { Channel } from "@/types"
import { AltCardLayout } from "./CardLayouts"

afterEach(cleanup)

const settings = {
  showChannelBio: true,
  showChannelSubscribers: true,
  showChannelTelegramChatId: false,
  showChannelPhotos: false,
  showChannelVideos: false,
  showChannelFiles: false,
  showChannelLinks: false,
  showChannelStartId: false,
}

const channel: Channel = {
  id: "1",
  name: "durov",
  displayName: "Pavel",
  bio: "about",
  subscribers: 12_000,
  photos: 40,
  dynamicSyncEnabled: true,
}

const noop = () => {}

function mount(variant: "E", zoom: CardZoom) {
  render(
    <AltCardLayout
      variant={variant}
      channel={channel}
      stats={{ count: 1240, reach: 3200, reachEstimated: true, velocity: 4 }}
      face={cardFace(zoom, settings)}
      inScopeCount={0}
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
    />,
  )
}

describe("the card rethinks", () => {
  for (const variant of ["E"] as const) {
    test(`${variant} draws the card and the detailed card`, () => {
      mount(variant, 0)
      expect(screen.getByText("Pavel")).toBeTruthy()
      expect(screen.getByText("about")).toBeTruthy()
      expect(screen.getAllByText(/1\.24K/).length).toBeGreaterThan(0)
      expect(screen.getByRole("button", { name: /^Sync$/ })).toBeTruthy()
      cleanup()
      mount(variant, 1)
      // A detailed card names both schedules.
      expect(screen.getAllByText("Regular").length).toBeGreaterThan(0)
      expect(screen.getAllByText("Dynamic").length).toBeGreaterThan(0)
      // and every media counter, whatever the zoom-0 settings say.
      expect(screen.getAllByText(/Photos/i).length).toBeGreaterThan(0)
    })
  }
})
