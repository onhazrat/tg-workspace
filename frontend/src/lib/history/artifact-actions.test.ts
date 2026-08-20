import { describe, expect, it } from "bun:test"

import type { ArtifactListItem } from "@/types"

import { setArtifactStarred } from "./artifact-actions"

/**
 * The dispatcher must reach a different endpoint per kind.
 *
 * The failure this guards against is a `default:` branch, or three kinds
 * silently routed to the summary endpoint — which would 404 quietly on the
 * others and make starring look like it works everywhere while persisting
 * nowhere.
 */
describe("setArtifactStarred", () => {
  const kinds = ["summary", "chat", "tag", "discovery"] as const

  it("routes every kind to its own aggregate", async () => {
    const calls: string[] = []
    const { api } = await import("@/api")
    const originals = {
      upsertSummary: api.upsertSummary,
      upsertChatSession: api.upsertChatSession,
      upsertTagRun: api.upsertTagRun,
      updateDiscoverReportFlags: api.updateDiscoverReportFlags,
    }
    api.upsertSummary = (async () => void calls.push("summary")) as never
    api.upsertChatSession = (async () => void calls.push("chat")) as never
    api.upsertTagRun = (async () => void calls.push("tag")) as never
    api.updateDiscoverReportFlags = (async () =>
      void calls.push("discovery")) as never

    try {
      for (const kind of kinds) {
        await setArtifactStarred({ id: "x", kind } as ArtifactListItem, true)
      }
    } finally {
      Object.assign(api, originals)
    }

    expect(calls).toEqual([...kinds])
  })
})
