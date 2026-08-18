import { env } from "@/lib/env"

/** React Query keys for summarizer server state. */
export const queryKeys = {
  channels: ["channels"] as const,
  /**
   * Separate from `channels` so the grid paints without waiting on it — the
   * aggregates behind these cost 2.36s against the list's 0.78s.
   */
  channelStats: ["channelStats"] as const,
  settingGroups: ["settingGroups"] as const,
  bots: ["bots"] as const,
  summaries: ["summaries"] as const,
  summary: (id: string) => ["summary", id] as const,
  dbStats: ["dbStats"] as const,
  health: ["health"] as const,
  torStatus: ["torStatus"] as const,
  tagRuns: ["tagRuns"] as const,
  tagRun: (id: string) => ["tagRun", id] as const,
  discoverCandidates: (scope: unknown) =>
    ["discoverCandidates", scope] as const,
  discoverReports: ["discoverReports"] as const,
  discoverIgnored: ["discoverIgnored"] as const,
  /** Server-side probe queue counts. Polled while work is outstanding. */
  discoverProbeQueue: ["discoverProbeQueue"] as const,
  discoverReport: (id: string) => ["discoverReport", id] as const,
  /**
   * The report Discover opens on. Kept separate from `discoverReport(id)`
   * because "the newest report" is a moving target: generating one must
   * invalidate this, but must not invalidate any report fetched by id.
   */
  latestDiscoverReport: ["discoverReport", "latest"] as const,
  postsCounts: (scope: unknown) => ["postsCounts", scope] as const,
  /** The infinite Posts feed, keyed on scope + filters + cap + sort. */
  postsFeed: (scope: unknown) => ["postsFeed", scope] as const,
  logs: {
    publish: ["logs", "publish"] as const,
    sync: ["logs", "sync"] as const,
    llm: ["logs", "llm"] as const,
    embedding: ["logs", "embedding"] as const,
    network: ["logs", "network"] as const,
  },
} as const

export const SUMMARIZER_STALE_TIME = env.queryStaleTimeMs
