import { describe, expect, it } from "bun:test"

import type { Channel, ChannelSettingGroup, SummaryListItem } from "@/types"

import { getExtendedEntityCandidates } from "./entity-candidates"
import type { CommandContext, EntityFlowType } from "./types"

const channels = [
  { id: "1", name: "news", tags: ["World", "tech"] },
  { id: "2", name: "quiet" },
] as Channel[]

const ctx = {
  channels,
  summariesHistory: [
    {
      id: "s1",
      scope: { channels: ["news", "quiet"], start: 0, end: 1 },
      promptExcerpt: "What happened in the world this week, briefly please",
      text: "ignored when an excerpt exists",
    },
    { id: "s2", text: "Short text" },
    { id: "s3" },
  ] as SummaryListItem[],
  databaseTables: ["tg_posts", "tg_logs"],
  settingGroups: [
    { id: "g1", name: "Fast", isDefault: false, channelCount: 1 },
  ] as ChannelSettingGroup[],
} as unknown as CommandContext

const candidates = (
  flow: EntityFlowType,
  context: CommandContext = ctx,
  payload?: unknown,
) => getExtendedEntityCandidates(flow, context, payload)

describe("getExtendedEntityCandidates", () => {
  it("labels summaries by scope channels and a 40-char preview", () => {
    expect(candidates("delete-summary")).toEqual([
      {
        id: "s1",
        label: "news, quiet — What happened in the world this week, br",
      },
      { id: "s2", label: "Summary — Short text" },
      { id: "s3", label: "Summary — " },
    ])
  })

  it("lists database tables, or nothing when none are loaded", () => {
    expect(candidates("clear-db-table")).toEqual([
      { id: "tg_posts", label: "tg_posts" },
      { id: "tg_logs", label: "tg_logs" },
    ])
    expect(
      candidates("clear-db-table", { ...ctx, databaseTables: undefined }),
    ).toEqual([])
  })

  it("offers the tags of the channel picked in the previous step", () => {
    expect(candidates("remove-tag-pick", ctx, channels[0])).toEqual([
      { id: "World", label: "World" },
      { id: "tech", label: "tech" },
    ])
    expect(candidates("remove-tag-pick", ctx, channels[1])).toEqual([])
    expect(candidates("remove-tag-pick")).toEqual([])
  })

  it("offers only channels that carry a tag for remove-tag-channel", () => {
    expect(candidates("remove-tag-channel")).toEqual([
      { id: "news", label: "@news" },
    ])
  })

  it.each<EntityFlowType>([
    "filter-by-setting-group",
    "move-to-setting-group",
    "open-setting-group",
  ])("%s lists every setting group", (flow) => {
    expect(candidates(flow).map((item) => item.id)).toEqual(["g1"])
  })

  it("answers nothing for a flow it does not own", () => {
    expect(candidates("pick-post")).toEqual([])
    expect(candidates("select-channel")).toEqual([])
  })
})
