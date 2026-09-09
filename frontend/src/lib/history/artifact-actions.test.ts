import { describe, expect, it } from "bun:test"

import type { ArtifactListItem } from "@/types"

import { setArtifactStarred, setSummaryFlag } from "./artifact-actions"

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

/**
 * Turning a schedule on is the moment the Key choice has to be persisted.
 *
 * The scheduler runs with nobody present, and the live selection lives in
 * browser storage, which the server cannot read. Without this the Summary
 * regenerates on whichever Key `resolve_ai_key` finds newest — a different
 * credential from the one the Account was using when they turned it on, and
 * nothing anywhere says so.
 *
 * Mutation evidence: dropping the `aiKeyId` line turns the first case red;
 * stamping unconditionally turns the other two red, and those are the pair that
 * keeps a *disable* from overwriting the stored choice with the live selection.
 */
describe("setSummaryFlag records which Key pays", () => {
  const summary = { id: "s1", kind: "summary" } as ArtifactListItem

  const capture = async (
    run: () => Promise<void>,
  ): Promise<Record<string, unknown>> => {
    const { api } = await import("@/api")
    const original = api.upsertSummary
    let body: Record<string, unknown> = {}
    api.upsertSummary = (async (_id: string, sent: Record<string, unknown>) => {
      body = sent
    }) as never
    try {
      await run()
    } finally {
      api.upsertSummary = original
    }
    return body
  }

  const withSelection = async (
    id: string,
    run: () => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> => {
    const { rememberAiKeyId } = await import("@/lib/aiKeys/selection")
    rememberAiKeyId(id)
    try {
      return await run()
    } finally {
      rememberAiKeyId(null)
    }
  }

  it("stamps the selected Key when auto-regenerate is switched on", async () => {
    const body = await withSelection("k7", () =>
      capture(() => setSummaryFlag(summary, "autoRegenerate", true)),
    )

    expect(body).toEqual({ autoRegenerate: true, aiKeyId: "k7" })
  })

  it("leaves the stored choice alone when switching it off", async () => {
    const body = await withSelection("k7", () =>
      capture(() => setSummaryFlag(summary, "autoRegenerate", false)),
    )

    expect(body).toEqual({ autoRegenerate: false })
  })

  it("does not stamp a Key onto the publish flag", async () => {
    const body = await withSelection("k7", () =>
      capture(() => setSummaryFlag(summary, "autoPublish", true)),
    )

    expect(body).toEqual({ autoPublish: true })
  })
})
