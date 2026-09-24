import { describe, expect, it } from "bun:test"
import type {
  Channel,
  ChannelSettingGroup,
  Post,
  SummaryListItem,
} from "@/types"
import { type PickSources, resolvePick } from "./entity-pick"
import type { EntityFlowType } from "./types"

/**
 * One row per flow family. `handlePick` used to answer all of these in one
 * 130-line function nothing could reach; the answer is data now, so each rule
 * is one assertion. The ones worth guarding hardest are the confirmation
 * gates: a destructive flow that skips its confirm runs on a single click.
 */

const channel = { id: "c1", name: "durov" } as Channel
const summary = { id: "s1" } as SummaryListItem
const post = { channelName: "durov", id: 7 } as Post
const sources: PickSources = {
  channels: [channel],
  summaries: [summary],
  settingGroups: [{ id: "g1" } as ChannelSettingGroup],
  posts: [post],
  payload: undefined,
}
const pick = (
  flow: EntityFlowType,
  value: string,
  confirm = false,
  over: Partial<PickSources> = {},
) => resolvePick(flow, value, confirm, { ...sources, ...over })

describe("resolvePick", () => {
  it("removes the picked tag from the channel the previous step chose", () => {
    expect(
      pick("remove-tag-pick", "news", false, { payload: channel }),
    ).toEqual({ kind: "remove-tag", channel, tag: "news" })
    expect(pick("remove-tag-pick", "news").kind).toBe("ignore")
  })

  it("deletes a summary that exists, asking first when told to", () => {
    expect(pick("delete-summary", "s1")).toEqual({
      kind: "run-then-finish",
      payload: summary,
    })
    expect(pick("delete-summary", "s1", true)).toEqual({
      kind: "confirm",
      payload: summary,
    })
    expect(pick("delete-summary", "gone").kind).toBe("ignore")
  })

  it("opens a post from the fetched pool and closes", () => {
    expect(pick("pick-post", "durov_7")).toEqual({
      kind: "run-then-close",
      payload: post,
    })
    expect(pick("pick-post", "durov_8").kind).toBe("ignore")
  })

  it("clears a table by name, asking first when told to", () => {
    expect(pick("clear-db-table", "tg_posts")).toEqual({
      kind: "run-then-finish",
      payload: "tg_posts",
    })
    expect(pick("clear-db-table", "tg_posts", true).kind).toBe("confirm")
  })

  it("hands the configuration id straight to the finish", () => {
    expect(pick("open-configuration", "proxy")).toEqual({
      kind: "finish-with",
      value: "proxy",
    })
  })

  it("runs a setting-group flow only for a group that exists, and never asks", () => {
    for (const flow of [
      "filter-by-setting-group",
      "move-to-setting-group",
      "open-setting-group",
    ] as const) {
      expect(pick(flow, "g1", true)).toEqual({
        kind: "run-then-finish",
        payload: "g1",
      })
      expect(pick(flow, "gone").kind).toBe("ignore")
    }
  })

  it("asks before the three destructive channel flows, and only when told to", () => {
    for (const flow of [
      "delete-channel",
      "reset-sync-channel",
      "fix-partial-history-channel",
    ] as const) {
      expect(pick(flow, "durov", true)).toEqual({
        kind: "confirm",
        payload: channel,
      })
      expect(pick(flow, "durov").kind).toBe("channel")
    }
  })

  it("never asks for an ordinary channel flow, and ignores an unknown channel", () => {
    expect(pick("sync-channel", "durov", true)).toEqual({
      kind: "channel",
      channel,
    })
    expect(pick("sync-channel", "nobody").kind).toBe("ignore")
  })
})
