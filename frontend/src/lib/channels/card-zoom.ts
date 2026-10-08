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

/**
 * The stat tiles a card can show, in display order. The first four are on
 * every card; the rest follow the card settings, or all show when detailed.
 */
export type StatTileKey =
  | "posts"
  | "inScope"
  | "reach"
  | "perHour"
  | "subscribers"
  | "photos"
  | "videos"
  | "files"
  | "links"

/**
 * Keyboard mode's action letters: select, sync, tag field, freeze, open in
 * Telegram, bio, photo. A size lists only the letters its cards carry a
 * control for, so the key legend reads them from here and cannot drift.
 */
export type CardKey = "x" | "s" | "t" | "f" | "o" | "b" | "p"

const SMALL_CARD_KEYS: CardKey[] = ["x", "s", "o", "p"]
const CARD_KEYS: CardKey[] = ["x", "s", "t", "f", "o", "b", "p"]

/** What a channel card renders at one zoom level. */
export interface CardFace {
  layout: "card" | "tile"
  bio: boolean
  startId: boolean
  /** The optional fields shown, or null on the compact sizes. */
  meta: ChannelMetaVisibility | null
  tags: boolean
  /** The footer's status and schedule block; off on the compact card. */
  syncStatus: boolean
  /** The hover freeze/reset/remove bar. */
  hoverActions: boolean
  /** Language, partial-history and sort-rank badges. */
  detailBadges: boolean
  checkbox: boolean
  /** Clicking the card body toggles selection. */
  bodySelects: boolean
  /** The +1 size: every field whatever the settings, and both schedules. */
  detailed: boolean
  statTiles: StatTileKey[]
  keys: CardKey[]
}

export function cardFace(
  zoom: CardZoom,
  settings: CardFieldSettings,
): CardFace {
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
      detailed: false,
      statTiles: [],
      keys: SMALL_CARD_KEYS,
    }
  }
  // +1 overrides the settings for display only; nothing is written back.
  const detailed = zoom === 1
  const s = settings
  const meta: ChannelMetaVisibility = {
    subscribers: detailed || s.showChannelSubscribers,
    telegramChatId: detailed || s.showChannelTelegramChatId,
    photos: detailed || s.showChannelPhotos,
    videos: detailed || s.showChannelVideos,
    files: detailed || s.showChannelFiles,
    links: detailed || s.showChannelLinks,
  }
  const optionalTiles = (
    ["subscribers", "photos", "videos", "files", "links"] as const
  ).filter((key) => meta[key])
  return {
    layout: "card",
    bio: detailed || s.showChannelBio,
    startId: detailed || s.showChannelStartId,
    meta,
    tags: true,
    syncStatus: true,
    hoverActions: true,
    detailBadges: true,
    checkbox: true,
    bodySelects: false,
    detailed,
    statTiles: ["posts", "inScope", "reach", "perHour", ...optionalTiles],
    keys: CARD_KEYS,
  }
}
