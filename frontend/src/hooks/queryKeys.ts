import { env } from "@/lib/env"

/** React Query keys for summarizer server state. */
export const queryKeys = {
  channels: ["channels"] as const,
  /**
   * Separate from `channels` so the grid paints without waiting on it — the
   * aggregates behind these cost 2.36s against the list's 0.78s.
   */
  channelStats: ["channelStats"] as const,
  /** Also separate: 40% of the list's bytes, for two clamped lines on a card. */
  channelBios: ["channelBios"] as const,
  settingGroups: ["settingGroups"] as const,
  bots: ["bots"] as const,
  summaries: ["summaries"] as const,
  summary: (id: string) => ["summary", id] as const,
  dbStats: ["dbStats"] as const,
  health: ["health"] as const,
  torStatus: ["torStatus"] as const,
  chatSessions: ["chatSessions"] as const,
  chatSession: (id: string) => ["chatSession", id] as const,
  /**
   * The unified History list. Keyed on kind + search because the server does
   * both — filtering client-side would defeat the paging.
   */
  artifacts: (kind: string | null, search: string, starred: boolean) =>
    ["artifacts", kind ?? "all", search, starred] as const,
  tagRuns: ["tagRuns"] as const,
  tagRun: (id: string) => ["tagRun", id] as const,
  discoverCandidates: (scope: unknown) =>
    ["discoverCandidates", scope] as const,
  discoverReports: ["discoverReports"] as const,
  discoverIgnored: ["discoverIgnored"] as const,
  /** Server-side probe queue counts. Polled while work is outstanding. */
  discoverProbeQueue: ["discoverProbeQueue"] as const,
  discoverReport: (id: string) => ["discoverReport", id] as const,
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
  /**
   * One expanded log row, with the bodies the list no longer carries. Keyed
   * per row so expanding a second one does not refetch the first.
   */
  logDetail: (type: string, id: string) => ["logDetail", type, id] as const,
  /**
   * Admin Request usage for one UTC day. Keyed on the day because the ledger
   * for a past day is immutable — yesterday cached forever is correct.
   */
  quotaUsage: (day: string) => ["quotaUsage", day] as const,
  /**
   * The signed-in account's own Budgets (ticket 24). Not keyed on a day: it
   * always answers for today, and a key holding a date would go stale across a
   * UTC midnight while the cache still thought it was fresh.
   */
  myQuota: () => ["myQuota"] as const,
  /** The deployment's Budget defaults and every per-account override. */
  quotaLimits: () => ["quotaLimits"] as const,
} as const

export const SUMMARIZER_STALE_TIME = env.queryStaleTimeMs
