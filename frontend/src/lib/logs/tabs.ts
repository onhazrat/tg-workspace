export type LogTab = "publish" | "sync" | "llm" | "network" | "embedding"

export interface LogTabMeta {
  /** Capitalized name used in tab titles, buttons and toasts, e.g. "Publish". */
  label: string
  /** Name as written mid-sentence (confirm prompts, empty states), e.g. "publish". */
  noun: string
  /** Description shown under the view title while the tab is active. */
  description: string
}

export const LOG_TABS: LogTab[] = [
  "publish",
  "sync",
  "llm",
  "network",
  "embedding",
]

export const LOG_TAB_META: Record<LogTab, LogTabMeta> = {
  publish: {
    label: "Publish",
    noun: "publish",
    description: "Track all messages sent to Telegram bots.",
  },
  sync: {
    label: "Sync",
    noun: "sync",
    description: "Track all channel synchronization attempts.",
  },
  llm: {
    label: "LLM",
    noun: "LLM",
    description: "Track all interactions with Large Language Models.",
  },
  network: {
    label: "Network",
    noun: "network",
    description: "Track all network requests and proxy/TOR usage.",
  },
  embedding: {
    label: "Embedding",
    noun: "embedding",
    description: "Track all embedding generations.",
  },
}
