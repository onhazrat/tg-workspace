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
  extractCitedPosts,
  openedSuccessor,
  parseCitationRefs,
  successorSummary,
} from "./summary-model"

/**
 * The rules `generateBackgroundSummary` used to hold inline, where no test
 * could reach them.
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
      metadataOmittedRows: ["aiModel"],
      publishing: { citationStyle: "numbered" },
    }
    const run = {
      id: "s2",
      text: "new",
      citedPosts: {},
      selectedAiKeyId: "live-key",
      now: 1234,
    }
    const next = successorSummary(previous, run)
    expect(next).toMatchObject({
      id: "s2",
      text: "new",
      timestamp: 1234,
      autoRegenerate: true,
      aiKeyId: "live-key",
      publishBotId: "b",
      postSearch: "q",
      // Row choices are keys, so the successor's metadata is generated afresh.
      metadataOmittedRows: ["aiModel"],
      publishing: { citationStyle: "numbered" },
      // Off unless the Summary it follows had it on (SUMTAB-09).
      sendMetadata: false,
    })
    expect(
      successorSummary(previous, { ...run, selectedAiKeyId: null }).aiKeyId,
    ).toBe("old-key")
    expect(
      successorSummary({ ...previous, sendMetadata: true }, run).sendMetadata,
    ).toBe(true)
  })

  it("opens a successor Failed until its Attempt ends, with no Post count", () => {
    const opened = openedSuccessor(summary, {
      id: "s2",
      selectedAiKeyId: null,
      now: 5,
    })
    expect(opened).toMatchObject({ id: "s2", text: "", status: "failed" })
    expect(opened.citedPosts).toEqual({})
    // The server records the refs' count; the browser never submits one.
    expect("postCount" in opened).toBe(false)
  })

  it("auto-publishes only when enabled and both ends still exist", () => {
    const bots = [{ id: "b", name: "Bot" }] as BotCredential[]
    const dests = [{ id: "d", name: "Dest", chatId: "-1" }] as ChatDestination[]
    const s = {
      ...summary,
      autoPublish: true,
      publishBotId: "b",
      publishChatId: "d",
    }
    expect(autoPublishTarget(s, bots, dests)).toEqual({
      bot: bots[0],
      dest: dests[0],
    })
    expect(
      autoPublishTarget({ ...s, autoPublish: false }, bots, dests),
    ).toBeNull()
    expect(autoPublishTarget(s, [], dests)).toBeNull()
    expect(
      autoPublishTarget({ ...s, publishChatId: "gone" }, bots, dests),
    ).toBeNull()
  })
})
