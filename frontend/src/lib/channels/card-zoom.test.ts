import { describe, expect, test } from "bun:test"
import { type CardFieldSettings, cardFace } from "./card-zoom"

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
    const allOn = Object.fromEntries(
      Object.keys(allOff).map((key) => [key, true]),
    ) as unknown as CardFieldSettings
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
    const face = cardFace(-2, allOff)
    expect(face.layout).toBe("tile")
    expect(face.bodySelects).toBe(true)
    expect(face.checkbox).toBe(false)
  })
})
