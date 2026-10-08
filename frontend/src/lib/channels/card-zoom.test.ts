import { describe, expect, test } from "bun:test"
import {
  CARD_ZOOM_LEVELS,
  type CardFace,
  type CardFieldSettings,
  type CardZoom,
  cardFace,
} from "./card-zoom"

const allOff: CardFieldSettings = {
  showChannelBio: false,
  showChannelSubscribers: false,
  showChannelTelegramChatId: false,
  showChannelPhotos: false,
  showChannelVideos: false,
  showChannelFiles: false,
  showChannelLinks: false,
  showChannelStartId: false,
}

const allOn = Object.fromEntries(
  Object.keys(allOff).map((key) => [key, true]),
) as unknown as CardFieldSettings

describe("cardFace", () => {
  test("zoom 0 shows exactly the fields the settings turn on", () => {
    const face = cardFace(0, {
      ...allOff,
      showChannelBio: true,
      showChannelVideos: true,
    })
    expect(face.layout).toBe("card")
    expect(face.bio).toBe(true)
    expect(face.startId).toBe(false)
    expect(face.meta).toEqual({
      subscribers: false,
      telegramChatId: false,
      photos: false,
      videos: true,
      files: false,
      links: false,
    })
    expect(face.checkbox).toBe(true)
    expect(face.bodySelects).toBe(false)
  })

  test("zoom +1 shows every optional field with every setting off", () => {
    const face = cardFace(1, allOff)
    expect(face.layout).toBe("card")
    expect(face.bio).toBe(true)
    expect(face.startId).toBe(true)
    expect(face.meta).toEqual({
      subscribers: true,
      telegramChatId: true,
      photos: true,
      videos: true,
      files: true,
      links: true,
    })
    expect(face.checkbox).toBe(true)
    expect(face.bodySelects).toBe(false)
  })

  test("zoom -1 keeps the header and Sync, and the body selects", () => {
    expect(cardFace(-1, allOn)).toEqual({
      layout: "card",
      bio: false,
      startId: false,
      meta: null,
      tags: false,
      syncStatus: false,
      hoverActions: false,
      detailBadges: false,
      checkbox: false,
      bodySelects: true,
      detailed: false,
      statTiles: [],
      keys: ["x", "s", "o", "p"],
    })
  })

  test("zooms 0 and +1 keep tags, status, hover actions and every badge", () => {
    for (const zoom of [0, 1] as const) {
      const face = cardFace(zoom, allOff)
      expect(face.meta).not.toBeNull()
      expect(face.tags).toBe(true)
      expect(face.syncStatus).toBe(true)
      expect(face.hoverActions).toBe(true)
      expect(face.detailBadges).toBe(true)
    }
  })

  test("zoom -2 is an avatar tile whose body selects", () => {
    expect(cardFace(-2, allOn)).toEqual({
      ...cardFace(-1, allOn),
      layout: "tile",
    })
  })

  test("each size says whether it is detailed, its stat tiles and its keys", () => {
    const settings = {
      ...allOff,
      showChannelSubscribers: true,
      showChannelVideos: true,
    }
    const describeSize = (zoom: CardZoom) => {
      const { detailed, statTiles, keys } = cardFace(zoom, settings)
      return { detailed, statTiles, keys }
    }
    expect(CARD_ZOOM_LEVELS.map(describeSize)).toEqual([
      { detailed: false, statTiles: [], keys: ["x", "s", "o", "p"] },
      { detailed: false, statTiles: [], keys: ["x", "s", "o", "p"] },
      {
        detailed: false,
        statTiles: [
          "posts",
          "inScope",
          "reach",
          "perHour",
          "subscribers",
          "videos",
        ],
        keys: ["x", "s", "t", "f", "o", "b", "p"],
      },
      {
        detailed: true,
        statTiles: [
          "posts",
          "inScope",
          "reach",
          "perHour",
          "subscribers",
          "photos",
          "videos",
          "files",
          "links",
        ],
        keys: ["x", "s", "t", "f", "o", "b", "p"],
      },
    ])
  })

  test("zoom 0 ties each setting to its own field and no other", () => {
    const fieldOf: Record<keyof CardFieldSettings, (f: CardFace) => boolean> = {
      showChannelBio: (f) => f.bio,
      showChannelStartId: (f) => f.startId,
      showChannelSubscribers: (f) => f.meta?.subscribers ?? false,
      showChannelTelegramChatId: (f) => f.meta?.telegramChatId ?? false,
      showChannelPhotos: (f) => f.meta?.photos ?? false,
      showChannelVideos: (f) => f.meta?.videos ?? false,
      showChannelFiles: (f) => f.meta?.files ?? false,
      showChannelLinks: (f) => f.meta?.links ?? false,
    }
    const keys = Object.keys(fieldOf) as (keyof CardFieldSettings)[]
    for (const on of keys) {
      const face = cardFace(0, { ...allOff, [on]: true })
      for (const key of keys) {
        expect([on, key, fieldOf[key](face)]).toEqual([on, key, key === on])
      }
    }
  })
})
