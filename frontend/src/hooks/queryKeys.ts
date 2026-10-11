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
  /**
   * The account's AI Keys (BYOK-01). Separate from `bots` because an AI Key
   * is not half of a publish pair, and the Action tab reads it without
   * needing either bot credentials or chat destinations.
   */
  aiKeys: ["aiKeys"] as const,
  /**
   * The models one Key's provider offers (BYOK-02). Keyed by the Key, because
   * two Keys reach two different catalogues — and `null` is a real key here,
   * standing for "whichever Key the server picks for me".
   */
  aiModels: (aiKeyId: string | null) => ["aiModels", aiKeyId] as const,
  summaries: ["summaries"] as const,
  summary: (id: string) => ["summary", id] as const,
  /** The server's plan for one Summary's Publication, per option set (SUMTAB-09). */
  publicationPlan: (id: string, options: unknown) =>
    ["publicationPlan", id, options] as const,
  /** A Summary's Cited Posts as they are now, keyed by the refs (SUMTAB-04). */
  citedPosts: (refs: readonly { channelName: string; postId: number }[]) =>
    ["citedPosts", refs] as const,
  /** One Channel's uncited Covered Posts, paged (SUMTAB-06). */
  coveredPosts: (refs: readonly { channelName: string; postId: number }[]) =>
    ["coveredPosts", refs] as const,
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
  /** Under `artifacts`, so a History delete re-runs tab reconcile too. */
  artifactTabs: (keys: readonly string[]) =>
    ["artifacts", "tabs", ...keys] as const,
  tagRuns: ["tagRuns"] as const,
  tagRun: (id: string) => ["tagRun", id] as const,
  discoverCandidates: (scope: unknown) =>
    ["discoverCandidates", scope] as const,
  discoverReports: ["discoverReports"] as const,
  /**
   * The Directory tab's reads (DIR-02), under one prefix so a Follow
   * refetches every one of them. Keyed by the request body itself.
   */
  directory: ["directory"] as const,
  directoryRead: (
    read:
      | "list"
      | "size"
      | "count"
      | "distribution"
      | "entry"
      | "why"
      | "neighbours",
    body: unknown,
  ) => ["directory", read, body] as const,
  discoverIgnored: ["discoverIgnored"] as const,
  /** Server-side probe queue counts. Polled while work is outstanding. */
  discoverProbeQueue: ["discoverProbeQueue"] as const,
  discoverReport: (id: string) => ["discoverReport", id] as const,
  /** The Directory's sample Posts for one handle — corpus-wide, not a report's. */
  directoryPosts: (handle: string) => ["directoryPosts", handle] as const,
  postsCounts: (scope: unknown) => ["postsCounts", scope] as const,
  /** The curve and settings an Estimated View count reads through (PFB-03). */
  viewEstimate: ["viewEstimate"] as const,
  /** Per-value counts for the Type, Media and Language dropdowns (PTR-03). */
  postsFacets: (scope: unknown) => ["postsFacets", scope] as const,
  /** The infinite Posts feed, keyed on scope + filters + cap + sort. */
  postsFeed: (scope: unknown) => ["postsFeed", scope] as const,
  /**
   * The scheduler's job table. Gated on `JOBS_MANAGE`, which is what lets it
   * double as this client's reading of that permission (`useCanManageJobs`).
   */
  jobsStatus: ["jobsStatus"] as const,
  configurationCatalog: ["configurationCatalog"] as const,
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

/**
 * The Settling curve is refitted daily and the reach settings change by hand,
 * so an hour-old copy is as good as a fresh one (PFB-03).
 */
export const VIEW_ESTIMATE_STALE_TIME = 60 * 60 * 1000
