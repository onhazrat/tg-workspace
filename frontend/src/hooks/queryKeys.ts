import { env } from "@/lib/env"

/** React Query keys for summarizer server state. */
export const queryKeys = {
  channels: ["channels"] as const,
  settingGroups: ["settingGroups"] as const,
  bots: ["bots"] as const,
  summaries: ["summaries"] as const,
  dbStats: ["dbStats"] as const,
  logs: {
    publish: ["logs", "publish"] as const,
    sync: ["logs", "sync"] as const,
    llm: ["logs", "llm"] as const,
    embedding: ["logs", "embedding"] as const,
    network: ["logs", "network"] as const,
  },
} as const

export const SUMMARIZER_STALE_TIME = env.queryStaleTimeMs
