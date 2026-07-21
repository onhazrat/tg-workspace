import { describe, expect, test } from "bun:test"
import type {
  CommandDef,
  EditorFieldDef,
  SearchResultsState,
} from "@/lib/commands/types"
import type { Channel, Post, SummaryListItem } from "@/types"
import {
  filterExtendedEntityCandidates,
  filterSearchResultItems,
  getEditorInputStep,
  getEditorInputType,
  getFirstEntityCandidateId,
  getFirstNavigableCommandId,
  getFirstSearchResultId,
  getGroupedPaletteCommands,
  getSearchResultItemId,
  groupPaletteCommands,
  resolveEntityPickId,
} from "./palette-view-model"

function makeCommand(id: string, group: string): CommandDef {
  return {
    id,
    kind: "action",
    label: id,
    keywords: [],
    group,
    run: () => {},
  }
}

function makeChannel(name: string): Channel {
  return { id: name, name }
}

function makePost(channelName: string, id: number, text: string): Post {
  return {
    id,
    channelName,
    text,
    date: "2026-01-01",
    timestamp: id,
  }
}

function makeSummary(
  id: string,
  overrides: Partial<SummaryListItem> = {},
): SummaryListItem {
  return {
    id,
    text: "",
    channels: [],
    startDate: 0,
    endDate: 1,
    language: "en",
    timestamp: 1,
    chatMessageCount: 0,
    ...overrides,
  }
}

const navCommands = [
  makeCommand("go-posts", "Navigation"),
  makeCommand("go-history", "Navigation"),
  makeCommand("toggle-theme", "Settings"),
]

describe("groupPaletteCommands", () => {
  test("groups by group field preserving insertion order", () => {
    const groups = groupPaletteCommands(navCommands)
    expect([...groups.keys()]).toEqual(["Navigation", "Settings"])
    expect(groups.get("Navigation")?.map((c) => c.id)).toEqual([
      "go-posts",
      "go-history",
    ])
    expect(groups.get("Settings")?.map((c) => c.id)).toEqual(["toggle-theme"])
  })

  test("returns an empty map for no commands", () => {
    expect(groupPaletteCommands([]).size).toBe(0)
  })
})

describe("getGroupedPaletteCommands", () => {
  test("uses ranked commands while searching", () => {
    const groups = getGroupedPaletteCommands({
      isEmptyQuery: false,
      commands: navCommands,
      rankedCommands: [navCommands[2]],
      displayedRecents: [navCommands[0]],
    })
    expect([...groups.keys()]).toEqual(["Settings"])
  })

  test("excludes recents from groups when query is empty", () => {
    const groups = getGroupedPaletteCommands({
      isEmptyQuery: true,
      commands: navCommands,
      rankedCommands: [],
      displayedRecents: [navCommands[0]],
    })
    expect(groups.get("Navigation")?.map((c) => c.id)).toEqual(["go-history"])
    expect(groups.get("Settings")?.map((c) => c.id)).toEqual(["toggle-theme"])
  })
})

describe("getFirstNavigableCommandId", () => {
  test("prefers first ranked command while searching", () => {
    expect(
      getFirstNavigableCommandId({
        isEmptyQuery: false,
        commands: navCommands,
        rankedCommands: [navCommands[1]],
        displayedRecents: [navCommands[0]],
      }),
    ).toBe("go-history")
  })

  test("returns empty string when search has no matches", () => {
    expect(
      getFirstNavigableCommandId({
        isEmptyQuery: false,
        commands: navCommands,
        rankedCommands: [],
        displayedRecents: [],
      }),
    ).toBe("")
  })

  test("prefers first recent when query is empty", () => {
    expect(
      getFirstNavigableCommandId({
        isEmptyQuery: true,
        commands: navCommands,
        rankedCommands: [],
        displayedRecents: [navCommands[2]],
      }),
    ).toBe("toggle-theme")
  })

  test("falls back to first non-recent command without recents match", () => {
    expect(
      getFirstNavigableCommandId({
        isEmptyQuery: true,
        commands: navCommands,
        rankedCommands: [],
        displayedRecents: [],
      }),
    ).toBe("go-posts")
  })
})

describe("filterExtendedEntityCandidates", () => {
  const items = [
    { id: "summaries", label: "Summaries Table" },
    { id: "posts", label: "Posts Table" },
  ]

  test("returns all items for an empty query", () => {
    expect(filterExtendedEntityCandidates(items, "")).toEqual(items)
    expect(filterExtendedEntityCandidates(items, "  ")).toEqual(items)
  })

  test("matches label or id case-insensitively", () => {
    expect(filterExtendedEntityCandidates(items, "SUMM")).toEqual([items[0]])
    expect(filterExtendedEntityCandidates(items, "posts")).toEqual([items[1]])
    expect(filterExtendedEntityCandidates(items, "table")).toEqual(items)
  })

  test("returns empty array when nothing matches", () => {
    expect(filterExtendedEntityCandidates(items, "zzz")).toEqual([])
  })
})

describe("getFirstEntityCandidateId", () => {
  test("uses channel name for channel flows", () => {
    expect(
      getFirstEntityCandidateId([makeChannel("alpha")], "select-channel"),
    ).toBe("alpha")
  })

  test("uses candidate id for non-channel flows", () => {
    expect(
      getFirstEntityCandidateId(
        [{ id: "s1", label: "Summary 1" }],
        "delete-summary",
      ),
    ).toBe("s1")
  })

  test("returns empty string with no candidates", () => {
    expect(getFirstEntityCandidateId([], "select-channel")).toBe("")
  })
})

describe("resolveEntityPickId", () => {
  const channels = [
    makeChannel("crypto"),
    makeChannel("cryptonews"),
    makeChannel("tech"),
  ]

  test("channel flow prefers exact name match over prefix", () => {
    expect(
      resolveEntityPickId({
        flow: "select-channel",
        entityQuery: "crypto",
        candidates: channels,
        selectedEntityId: "tech",
      }),
    ).toBe("crypto")
  })

  test("channel flow falls back to prefix match", () => {
    expect(
      resolveEntityPickId({
        flow: "select-channel",
        entityQuery: "crypton",
        candidates: channels,
        selectedEntityId: "tech",
      }),
    ).toBe("cryptonews")
  })

  test("channel flow falls back to highlighted row", () => {
    expect(
      resolveEntityPickId({
        flow: "select-channel",
        entityQuery: "zzz",
        candidates: channels,
        selectedEntityId: "tech",
      }),
    ).toBe("tech")
  })

  test("channel flow query matching is case-insensitive and trimmed", () => {
    expect(
      resolveEntityPickId({
        flow: "select-channel",
        entityQuery: "  CRYPTO ",
        candidates: channels,
        selectedEntityId: "",
      }),
    ).toBe("crypto")
  })

  test("non-channel flow prefers highlighted row then first candidate", () => {
    const items = [
      { id: "s1", label: "One" },
      { id: "s2", label: "Two" },
    ]
    expect(
      resolveEntityPickId({
        flow: "delete-summary",
        entityQuery: "",
        candidates: items,
        selectedEntityId: "s2",
      }),
    ).toBe("s2")
    expect(
      resolveEntityPickId({
        flow: "delete-summary",
        entityQuery: "",
        candidates: items,
        selectedEntityId: "",
      }),
    ).toBe("s1")
  })

  test("non-channel flow returns empty string with no candidates", () => {
    expect(
      resolveEntityPickId({
        flow: "delete-summary",
        entityQuery: "",
        candidates: [],
        selectedEntityId: "",
      }),
    ).toBe("")
  })
})

describe("filterSearchResultItems", () => {
  const posts = [
    makePost("cryptonews", 1, "bitcoin hits new high"),
    makePost("techdigest", 2, "new framework released"),
  ]
  const postsState: SearchResultsState = {
    kind: "posts",
    query: "news",
    items: posts,
  }
  const summaries = [
    makeSummary("s1", { channels: ["cryptonews"], text: "market wrap" }),
    makeSummary("s2", {
      channels: ["techdigest"],
      text: "weekly digest",
      promptExcerpt: "summarize tech",
      model: "gemini",
      note: "starred",
    }),
  ]
  const summariesState: SearchResultsState = {
    kind: "summaries",
    query: "digest",
    items: summaries,
  }

  test("returns empty array for null state", () => {
    expect(filterSearchResultItems(null, "anything")).toEqual([])
  })

  test("returns all items for an empty filter query", () => {
    expect(filterSearchResultItems(postsState, "  ")).toEqual(posts)
  })

  test("filters posts by channel, text, or date", () => {
    expect(filterSearchResultItems(postsState, "BITCOIN")).toEqual([posts[0]])
    expect(filterSearchResultItems(postsState, "techdigest")).toEqual([
      posts[1],
    ])
    expect(filterSearchResultItems(postsState, "2026-01")).toEqual(posts)
  })

  test("filters summaries by channels, text, prompt excerpt, model, and note", () => {
    expect(filterSearchResultItems(summariesState, "market")).toEqual([
      summaries[0],
    ])
    expect(filterSearchResultItems(summariesState, "summarize")).toEqual([
      summaries[1],
    ])
    expect(filterSearchResultItems(summariesState, "gemini")).toEqual([
      summaries[1],
    ])
    expect(filterSearchResultItems(summariesState, "starred")).toEqual([
      summaries[1],
    ])
    expect(filterSearchResultItems(summariesState, "cryptonews")).toEqual([
      summaries[0],
    ])
  })
})

describe("search result ids", () => {
  const post = makePost("cryptonews", 7, "hello")
  const summary = makeSummary("sum-1")

  test("getSearchResultItemId composes post key and passes summary id", () => {
    expect(getSearchResultItemId(post, "posts")).toBe("cryptonews_7")
    expect(getSearchResultItemId(summary, "summaries")).toBe("sum-1")
  })

  test("getFirstSearchResultId handles both kinds and empty lists", () => {
    expect(getFirstSearchResultId([post], "posts")).toBe("cryptonews_7")
    expect(getFirstSearchResultId([summary], "summaries")).toBe("sum-1")
    expect(getFirstSearchResultId([], "posts")).toBe("")
    expect(getFirstSearchResultId([], undefined)).toBe("")
  })
})

describe("editor input helpers", () => {
  function makeField(overrides: Partial<EditorFieldDef>): EditorFieldDef {
    return {
      id: "field",
      label: "Field",
      type: "text",
      getValue: () => "",
      apply: () => {},
      ...overrides,
    }
  }

  test("getEditorInputType defaults to text without a field", () => {
    expect(getEditorInputType(undefined, "retention")).toBe("text")
  })

  test("getEditorInputType switches for globalStartTimeValue by mode", () => {
    const field = makeField({ id: "globalStartTimeValue", type: "number" })
    expect(getEditorInputType(field, "absolute")).toBe("datetime-local")
    expect(getEditorInputType(field, "relative")).toBe("number")
    expect(getEditorInputType(field, "retention")).toBe("number")
  })

  test("getEditorInputType maps number fields, others to text", () => {
    expect(getEditorInputType(makeField({ type: "number" }), "retention")).toBe(
      "number",
    )
    expect(getEditorInputType(makeField({ type: "days" }), "retention")).toBe(
      "text",
    )
  })

  test("getEditorInputStep passes any, integer, and explicit steps", () => {
    expect(getEditorInputStep(makeField({ step: "any" }))).toBe("any")
    expect(getEditorInputStep(makeField({ integer: true, step: 5 }))).toBe(1)
    expect(getEditorInputStep(makeField({ step: 0.5 }))).toBe(0.5)
    expect(getEditorInputStep(makeField({}))).toBeUndefined()
    expect(getEditorInputStep(undefined)).toBeUndefined()
  })
})
