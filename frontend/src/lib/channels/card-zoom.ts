/**
 * Channel card zoom levels on the Channels tab (ZOOM-01). 0 is the card as it
 * always was; +1 forces every optional field on; -1 is a compact card whose
 * body selects; -2 is an avatar tile.
 */
export const CARD_ZOOM_LEVELS = [-2, -1, 0, 1] as const
export type CardZoom = (typeof CARD_ZOOM_LEVELS)[number]

/** The `showChannel*` settings, which govern the card at zoom 0. */
export interface CardFieldSettings {
  showChannelBio: boolean
  showChannelSubscribers: boolean
  showChannelTelegramChatId: boolean
  showChannelPhotos: boolean
  showChannelVideos: boolean
  showChannelFiles: boolean
  showChannelLinks: boolean
  showChannelStartId: boolean
}

/** Which optional channel counters the card shows. */
export interface ChannelMetaVisibility {
  subscribers: boolean
  telegramChatId: boolean
  photos: boolean
  videos: boolean
  files: boolean
  links: boolean
}

/** What a channel card renders at one zoom level. */
export interface CardFace {
  layout: "card" | "tile"
  bio: boolean
  startId: boolean
  /** The stat chips, or null when the card shows none at all. */
  meta: ChannelMetaVisibility | null
  tags: boolean
  /** The footer's status and schedule line. */
  syncStatus: boolean
  /** The hover freeze/reset/remove bar. */
  hoverActions: boolean
  /** Language, partial-history and sort-rank badges. */
  detailBadges: boolean
  checkbox: boolean
  /** Clicking the card body toggles selection. */
  bodySelects: boolean
}

export function cardFace(zoom: CardZoom, s: CardFieldSettings): CardFace {
  if (zoom < 0) {
    return {
      layout: zoom === -2 ? "tile" : "card",
      bio: false,
      startId: false,
      meta: null,
      tags: false,
      syncStatus: false,
      hoverActions: false,
      detailBadges: false,
      checkbox: false,
      bodySelects: true,
    }
  }
  // +1 overrides the settings for display only; nothing is written back.
  const all = zoom === 1
  return {
    layout: "card",
    bio: all || s.showChannelBio,
    startId: all || s.showChannelStartId,
    meta: {
      subscribers: all || s.showChannelSubscribers,
      telegramChatId: all || s.showChannelTelegramChatId,
      photos: all || s.showChannelPhotos,
      videos: all || s.showChannelVideos,
      files: all || s.showChannelFiles,
      links: all || s.showChannelLinks,
    },
    tags: true,
    syncStatus: true,
    hoverActions: true,
    detailBadges: true,
    checkbox: true,
    bodySelects: false,
  }
}
