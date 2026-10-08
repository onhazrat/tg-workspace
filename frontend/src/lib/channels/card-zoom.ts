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
  /** A detailed card: the whole bio, and (prototype D) both sync schedules. */
  detailed: boolean
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

export function cardFace(
  zoom: CardZoom,
  settings: CardFieldSettings,
): CardFace {
  if (zoom < 0) {
    return {
      layout: zoom === -2 ? "tile" : "card",
      bio: false,
      detailed: false,
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
  const detailed = zoom === 1
  const s = settings
  return {
    layout: "card",
    bio: detailed || s.showChannelBio,
    detailed,
    startId: detailed || s.showChannelStartId,
    meta: {
      subscribers: detailed || s.showChannelSubscribers,
      telegramChatId: detailed || s.showChannelTelegramChatId,
      photos: detailed || s.showChannelPhotos,
      videos: detailed || s.showChannelVideos,
      files: detailed || s.showChannelFiles,
      links: detailed || s.showChannelLinks,
    },
    tags: true,
    syncStatus: true,
    hoverActions: true,
    detailBadges: true,
    checkbox: true,
    bodySelects: false,
  }
}
