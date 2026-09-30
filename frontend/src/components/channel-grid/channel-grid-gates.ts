/**
 * What the Channels toolbar allows right now. Every gate reads the same few
 * facts: whether the API is reachable, whether a sync or a summary is running,
 * and what is selected.
 */
export interface ChannelGridFacts {
  trimCount: string
  selectedCount: number
  summarizing: boolean
  scrapingCount: number
  isOffline: boolean
}

export interface ChannelGridGates {
  /** The trim input as a number; only meaningful while `isTrimDisabled` is false. */
  parsedTrimCount: number
  isTrimDisabled: boolean
  isScrapeSelectedDisabled: boolean
  isScrapeAllDisabled: boolean
}

export function channelGridGates(facts: ChannelGridFacts): ChannelGridGates {
  const parsedTrimCount = Number.parseInt(facts.trimCount, 10)
  const isTrimCountValid =
    Number.isFinite(parsedTrimCount) && parsedTrimCount >= 1
  const nothingSelected = facts.selectedCount === 0
  const working = facts.summarizing || facts.scrapingCount > 0
  const isScrapeAllDisabled = facts.isOffline || working
  return {
    parsedTrimCount,
    isTrimDisabled: nothingSelected || !isTrimCountValid || working,
    isScrapeSelectedDisabled: isScrapeAllDisabled || nothingSelected,
    isScrapeAllDisabled,
  }
}
