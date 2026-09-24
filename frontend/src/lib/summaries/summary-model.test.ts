import { describe, expect, it } from "bun:test"
import type {
  BotCredential,
  Channel,
  ChatDestination,
  Post,
  Summary,
} from "@/types"
import {
  autoPublishTarget,
  channelsNeedingSync,
  classifyAiError,
  extractCitedPosts,
  generateDefaultMetadataText,
  parseCitationRefs,
  publishedText,
  successorSummary,
  summaryMetadataText,
} from "./summary-model"

/**
 * The rules `generateBackgroundSummary` used to hold inline, where no test
 * could reach them. The one worth guarding hardest is `classifyAiError`: a
 * quota refusal it misses keeps auto-regeneration retrying into the same wall
 * on every tick, and one it invents switches a healthy schedule off.
 */

const summary: Summary = {
  id: "s1",
  text: "old",
  language: "English",
  model: "gemini-x",
  postCount: 3,
  timestamp: 0,
}

describe("citations", () => {
  it("parses distinct references in order, trimming the channel", () => {
    expect(
      parseCitationRefs("a [chan #1] b [ chan  #1] c [other #22] [chan #1]"),
    ).toEqual([
      { channelName: "chan", postId: 1 },
      { channelName: "other", postId: 22 },
    ])
  })

  it("resolves only the citations it has a post for", () => {
    const post = { channelName: "chan", id: 1 } as Post
    // Strict: `toEqual` would accept a `"chan-2": undefined` key.
    expect(extractCitedPosts("[chan #1] [chan #2]", [post])).toStrictEqual({
      "chan-1": post,
    })
  })
})

describe("metadata and the published text", () => {
  it("the saved metadata wins over the generated default", () => {
    expect(summaryMetadataText({ ...summary, metadataText: "mine" })).toBe(
      "mine",
    )
    expect(summaryMetadataText(summary)).toBe(
      generateDefaultMetadataText(summary),
    )
  })

  it("the default says the window is not recorded rather than inventing one", () => {
    const text = generateDefaultMetadataText(summary)
    expect(text).toContain("*Time Range:* not recorded")
    expect(text).toContain("*Posts Analyzed:* 3")
  })

  it("metadata goes first, separated by a blank line, only when sent", () => {
    expect(publishedText("meta", "body")).toBe("meta\n\nbody")
    expect(publishedText(null, "body")).toBe("body")
  })
})

describe("regeneration", () => {
  it("syncs only summary channels not already synced past the new end", () => {
    const channels = [
      { name: "stale", lastUpdated: 50 },
      { name: "fresh", lastUpdated: 200 },
      { name: "exactly", lastUpdated: 100 },
      { name: "never" },
      { name: "elsewhere", lastUpdated: 0 },
    ] as Channel[]
    expect(
      channelsNeedingSync(
        channels,
        ["stale", "fresh", "exactly", "never"],
        100,
      ).map((c) => c.name),
    ).toEqual(["stale", "never"])
  })

  it("the successor carries the settings and pays with the live Key", () => {
    const previous: Summary = {
      ...summary,
      aiKeyId: "old-key",
      autoPublish: true,
      publishBotId: "b",
      publishChatId: "d",
      postSearch: "q",
    }
    const run = {
      id: "s2",
      text: "new",
      postCount: 9,
      citedPosts: {},
      selectedAiKeyId: "live-key",
      now: 1234,
    }
    const next = successorSummary(previous, run)
    expect(next).toMatchObject({
      id: "s2",
      text: "new",
      postCount: 9,
      timestamp: 1234,
      autoRegenerate: true,
      aiKeyId: "live-key",
      publishBotId: "b",
      postSearch: "q",
      sendMetadata: true,
    })
    expect(
      successorSummary(previous, { ...run, selectedAiKeyId: null }).aiKeyId,
    ).toBe("old-key")
    expect(
      successorSummary({ ...previous, sendMetadata: false }, run).sendMetadata,
    ).toBe(false)
  })

  it("auto-publishes only when enabled, non-empty, and both ends still exist", () => {
    const bots = [{ id: "b", name: "Bot" }] as BotCredential[]
    const dests = [{ id: "d", name: "Dest", chatId: "-1" }] as ChatDestination[]
    const s = {
      ...summary,
      autoPublish: true,
      publishBotId: "b",
      publishChatId: "d",
    }
    expect(autoPublishTarget(s, 5, bots, dests)).toEqual({
      bot: bots[0],
      dest: dests[0],
    })
    expect(autoPublishTarget(s, 0, bots, dests)).toBeNull()
    expect(
      autoPublishTarget({ ...s, autoPublish: false }, 5, bots, dests),
    ).toBeNull()
    expect(autoPublishTarget(s, 5, [], dests)).toBeNull()
    expect(
      autoPublishTarget({ ...s, publishChatId: "gone" }, 5, bots, dests),
    ).toBeNull()
  })
})

describe("classifyAiError", () => {
  const err = (message: string) => new Error(message)

  it("unwraps a provider's JSON error and trusts only its code for quota", () => {
    expect(
      classifyAiError(err('{"error":{"code":429,"message":"Slow down"}}')),
    ).toEqual({ message: "Slow down", quotaExceeded: true })
    expect(
      classifyAiError(
        err('{"error":{"code":400,"message":"quota field is invalid"}}'),
      ),
    ).toEqual({ message: "quota field is invalid", quotaExceeded: false })
  })

  it("keeps a JSON-shaped message it cannot use as it is", () => {
    expect(classifyAiError(err("{not json}"))).toEqual({
      message: "{not json}",
      quotaExceeded: false,
    })
    // JSON-shaped, so the plain-text markers do not apply even though it says "quota".
    expect(classifyAiError(err('{"detail":"quota"}'))).toEqual({
      message: '{"detail":"quota"}',
      quotaExceeded: false,
    })
  })

  it("spots a quota refusal in plain text", () => {
    for (const m of [
      "HTTP 429",
      "RESOURCE_EXHAUSTED",
      "Quota exceeded",
      "Rate limit hit",
    ])
      expect(classifyAiError(err(m)).quotaExceeded).toBe(true)
    expect(classifyAiError(err("Network down")).quotaExceeded).toBe(false)
  })

  it("names an error that is not an Error", () => {
    expect(classifyAiError("boom")).toEqual({
      message: "Unknown error",
      quotaExceeded: false,
    })
  })
})
