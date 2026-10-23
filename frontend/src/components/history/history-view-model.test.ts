/**
 * The History tab's rules, with no React: when a schedule flag may be switched
 * on, what the empty list, the delete dialog and the footer say, how many
 * filters the phone's button counts, and how the list falls into days.
 */
import { describe, expect, mock, test } from "bun:test"
import {
  DEFAULT_HISTORY_PARAMS,
  type HistoryParams,
} from "@/lib/history/history-params"
import type { ArtifactListItem } from "@/types"
import {
  deleteDialogCopy,
  historyActiveFilters,
  historyDays,
  historyEmptyDescription,
  historyShowsEmpty,
  historySortWords,
  opensPublishTarget,
  publishPairs,
  publishTargetOf,
  starNotice,
  summaryFlagChange,
  switchSummaryFlag,
} from "./history-view-model"

const params = (over: Partial<HistoryParams> = {}) => ({
  ...DEFAULT_HISTORY_PARAMS,
  ...over,
})

const summary = (over: Record<string, unknown> = {}) =>
  ({
    kind: "summary",
    id: "s1",
    title: "",
    timestamp: 1,
    isStarred: false,
    status: "done",
    autoRegenerate: false,
    autoPublish: false,
    scope: { channels: ["alpha", "beta"], durationMinutes: 60 },
    ...over,
  }) as unknown as ArtifactListItem

const chat = {
  kind: "chat",
  id: "c1",
  title: "My chat",
  timestamp: 1,
  isStarred: true,
} as unknown as ArtifactListItem

describe("starNotice", () => {
  test("says which way the star went, and on which Artifact", () => {
    expect(starNotice(summary({ title: "Morning" }))).toBe(
      "Starred Summary: Morning",
    )
    expect(starNotice(chat)).toBe("Unstarred Chat: My chat")
  })
})

describe("summaryFlagChange", () => {
  test("only a Summary has schedule flags", () => {
    expect(summaryFlagChange(chat, "autoPublish")).toBeNull()
  })

  test("each flag flips to the opposite of what is stored", () => {
    expect(summaryFlagChange(summary(), "autoPublish")).toEqual({ next: true })
    expect(
      summaryFlagChange(summary({ autoPublish: true }), "autoPublish"),
    ).toEqual({ next: false })
    expect(summaryFlagChange(summary(), "autoRegenerate")).toEqual({
      next: true,
    })
  })

  test("auto-regenerate refuses a window under a minute, or none at all", () => {
    const refusal = {
      refusal:
        "Cannot auto-regenerate a summary whose range is under a minute.",
    }
    const short = summary({ scope: { channels: [], durationMinutes: 0.5 } })
    expect(summaryFlagChange(short, "autoRegenerate")).toEqual(refusal)
    expect(
      summaryFlagChange(summary({ scope: null }), "autoRegenerate"),
    ).toEqual(refusal)
    // Exactly one minute is enough.
    const minute = summary({ scope: { channels: [], durationMinutes: 1 } })
    expect(summaryFlagChange(minute, "autoRegenerate")).toEqual({ next: true })
  })

  test("switching a flag off is never refused, and a short window can still publish", () => {
    const short = { scope: { channels: [], durationMinutes: 0 } }
    expect(
      summaryFlagChange(
        summary({ ...short, autoRegenerate: true }),
        "autoRegenerate",
      ),
    ).toEqual({ next: false })
    expect(summaryFlagChange(summary(short), "autoPublish")).toEqual({
      next: true,
    })
  })
})

describe("historyEmptyDescription", () => {
  const nothingYet =
    "Summaries, chats, tag runs and discovery reports you create will appear here."
  const filtered = "No artifacts match these filters."

  test("any one filter makes the empty list a filtered one", () => {
    expect(historyEmptyDescription(params())).toBe(nothingYet)
    // The moment and the sort filter nothing.
    expect(
      historyEmptyDescription(params({ moment: "window", sort: "window" })),
    ).toBe(nothingYet)
    for (const over of [
      { search: "alpha" },
      { starred: true },
      { kind: "tag" as const },
      { status: "failed" as const },
      { bound: { mode: "live" as const, start: -60_000 } },
    ])
      expect(historyEmptyDescription(params(over))).toBe(filtered)
  })
})

describe("historyShowsEmpty", () => {
  test("only a settled, empty answer is empty", () => {
    expect(historyShowsEmpty(0, false)).toBe(true)
    expect(historyShowsEmpty(0, true)).toBe(false)
    expect(historyShowsEmpty(3, false)).toBe(false)
  })
})

describe("deleteDialogCopy", () => {
  test("names the kind and the channels", () => {
    expect(deleteDialogCopy(summary())).toEqual({
      title: "Delete this Summary?",
      description: "alpha, beta",
    })
  })

  test("falls back when there are no channels, or nothing is pending", () => {
    expect(deleteDialogCopy(chat)).toEqual({
      title: "Delete this Chat?",
      description: "This cannot be undone.",
    })
    expect(
      deleteDialogCopy(summary({ scope: { channels: [] } })).description,
    ).toBe("This cannot be undone.")
    expect(deleteDialogCopy(null).title).toBe("Delete this item?")
  })
})

describe("historyActiveFilters", () => {
  test("counts Kind, Status, Starred and the time filter, not the search", () => {
    expect(historyActiveFilters(params({ search: "x" }))).toBe(0)
    expect(
      historyActiveFilters(
        params({
          kind: "chat",
          status: "pending",
          starred: true,
          bound: { mode: "fixed", end: 1 },
        }),
      ),
    ).toBe(4)
  })
})

describe("historySortWords", () => {
  test("says the sort and its direction", () => {
    expect(historySortWords("written", true)).toBe(
      "Sorted by Written, newest first",
    )
    expect(historySortWords("window", false)).toBe(
      "Sorted by Window start, oldest first",
    )
  })
})

describe("historyDays", () => {
  const at = (y: number, m: number, d: number, h = 12) =>
    new Date(y, m, d, h).getTime()
  const row = (id: string, timestamp: number) =>
    ({ kind: "chat", id, timestamp }) as ArtifactListItem
  const now = at(2026, 9, 22, 9)

  test("groups by local calendar day: Today, Yesterday, then a short date", () => {
    const days = historyDays(
      [
        row("a", at(2026, 9, 22, 8)),
        row("b", at(2026, 9, 22, 0)),
        row("c", at(2026, 9, 21, 23)),
        row("d", at(2026, 9, 19)),
        row("e", at(2025, 11, 31)),
      ],
      now,
      "en-US",
    )
    expect(days.map((d) => [d.label, d.rows.map((r) => r.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["Yesterday", ["c"]],
      ["Mon, Oct 19", ["d"]],
      ["Wed, Dec 31, 2025", ["e"]],
    ])
  })

  test("a day that comes back later in the list starts a new group", () => {
    const days = historyDays(
      [
        row("a", at(2026, 9, 22)),
        row("b", at(2026, 9, 21)),
        row("c", at(2026, 9, 22)),
      ],
      now,
      "en-US",
    )
    expect(days.map((d) => d.rows.length)).toEqual([1, 1, 1])
    expect(new Set(days.map((d) => d.key)).size).toBe(3)
  })
})

const bots = [
  { id: "b1", name: "@newsbot" },
  { id: "b2", name: "@digestbot" },
]
const destinations = [
  { id: "d1", name: "IranDaily", chatId: "-1001" },
  { id: "d2", name: "Team chat", chatId: "-1002" },
]

describe("publishTargetOf", () => {
  test("is the saved bot and Destination when both still exist", () => {
    const target = publishTargetOf(
      summary({ publishBotId: "b2", publishChatId: "d1" }),
      bots,
      destinations,
    )
    expect([target?.bot.name, target?.destination.name]).toEqual([
      "@digestbot",
      "IranDaily",
    ])
  })

  test("is missing when either half is unset or was deleted", () => {
    for (const over of [
      {},
      { publishBotId: "b1" },
      { publishChatId: "d1" },
      { publishBotId: "gone", publishChatId: "d1" },
      { publishBotId: "b1", publishChatId: "gone" },
    ])
      expect(publishTargetOf(summary(over), bots, destinations)).toBeNull()
  })

  test("only a Summary has one", () => {
    expect(publishTargetOf(chat, bots, destinations)).toBeNull()
  })
})

describe("publishPairs", () => {
  const names = (query: string) =>
    publishPairs(bots, destinations, query).map(
      (p) => `${p.destination.name} via ${p.bot.name}`,
    )

  test("offers every Destination with every bot, Destination first", () => {
    expect(names("")).toEqual([
      "IranDaily via @newsbot",
      "IranDaily via @digestbot",
      "Team chat via @newsbot",
      "Team chat via @digestbot",
    ])
  })

  test("matches the Destination's name or chat id, or the bot's name", () => {
    expect(names("  daily ")).toEqual([
      "IranDaily via @newsbot",
      "IranDaily via @digestbot",
    ])
    expect(names("-1002")).toEqual([
      "Team chat via @newsbot",
      "Team chat via @digestbot",
    ])
    expect(names("DIGEST")).toEqual([
      "IranDaily via @digestbot",
      "Team chat via @digestbot",
    ])
  })
})

describe("opensPublishTarget", () => {
  test("turning Auto-publish on with no usable target opens the chooser", () => {
    for (const over of [{}, { publishBotId: "b1", publishChatId: "gone" }])
      expect(
        opensPublishTarget(
          summary(over),
          "autoPublish",
          true,
          bots,
          destinations,
        ),
      ).toBe(true)
    // Even with nothing saved to choose from: the chooser says where to add one.
    expect(opensPublishTarget(summary(), "autoPublish", true, [], [])).toBe(
      true,
    )
  })

  test("not when a target is saved, when turning off, or for the other flag", () => {
    const saved = summary({ publishBotId: "b1", publishChatId: "d1" })
    expect(
      opensPublishTarget(saved, "autoPublish", true, bots, destinations),
    ).toBe(false)
    expect(
      opensPublishTarget(summary(), "autoPublish", false, bots, destinations),
    ).toBe(false)
    expect(
      opensPublishTarget(summary(), "autoRegenerate", true, bots, destinations),
    ).toBe(false)
  })
})

describe("switchSummaryFlag", () => {
  const deps = () => ({
    save: mock(
      async (_a: ArtifactListItem, _flag: string, _next: boolean) => {},
    ),
    refresh: mock(async () => {}),
    refuse: mock(),
    openTarget: mock(),
    bots,
    destinations,
  })

  test("turning Auto-publish on with no target saves it and opens the chooser", async () => {
    const d = deps()
    await switchSummaryFlag(summary(), "autoPublish", d)
    expect(d.save.mock.calls).toEqual([[summary(), "autoPublish", true]])
    expect(d.openTarget).toHaveBeenCalledWith("summary:s1")
    expect(d.refresh).toHaveBeenCalled()
  })

  test("with a target saved it only saves", async () => {
    const d = deps()
    await switchSummaryFlag(
      summary({ publishBotId: "b1", publishChatId: "d1" }),
      "autoPublish",
      d,
    )
    expect(d.save).toHaveBeenCalled()
    expect(d.openTarget).not.toHaveBeenCalled()
  })

  test("a refusal saves nothing and says why", async () => {
    const d = deps()
    await switchSummaryFlag(
      summary({ scope: { durationMinutes: 0 } }),
      "autoRegenerate",
      d,
    )
    expect(d.save).not.toHaveBeenCalled()
    expect(d.refuse).toHaveBeenCalledWith(
      "Cannot auto-regenerate a summary whose range is under a minute.",
    )
  })
})
