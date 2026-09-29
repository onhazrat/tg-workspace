import { describe, expect, it } from "bun:test"

import { VALID_TABS, WORKSPACE_TABS } from "@/constants"
import type { ArtifactListItem } from "@/types"

import {
  close,
  create,
  emptyTabSet,
  findTabArtifacts,
  goTo,
  move,
  open,
  reconcile,
  reopenLast,
  strip,
  type Tab,
  type TabSet,
  tabSearch,
  visit,
} from "./workspace-tabs"

const ACTION: Tab = { kind: "action" }
const POSTS: Tab = { kind: "posts" }

/** The strip as `kind:id` strings, which reads better in a failure than objects. */
function names(set: TabSet): string[] {
  return strip(set).map((tab) => (tab.id ? `${tab.kind}:${tab.id}` : tab.kind))
}

function withTabs(...tabs: Tab[]): TabSet {
  return { ...emptyTabSet(), tabs }
}

const FIXED = ["channels", "posts", "action"]

describe("open", () => {
  it("appends a tab for an Artifact that has none, and focuses it", () => {
    const step = open(emptyTabSet(), "summary", "a")
    expect(names(step.set)).toEqual([...FIXED, "summary:a"])
    expect(step.active).toEqual({ kind: "summary", id: "a" })
  })

  it("focuses the tab an Artifact already has instead of opening a second", () => {
    const set = withTabs(
      { kind: "summary", id: "a" },
      { kind: "chat", id: "b" },
    )
    const step = open(set, "summary", "a")
    expect(names(step.set)).toEqual(names(set))
    expect(step.active).toEqual({ kind: "summary", id: "a" })
  })

  it("focuses a kind's empty tab instead of piling up a second one", () => {
    const set = withTabs({ kind: "summary" }, { kind: "chat" })
    const step = open(set, "summary")
    expect(names(step.set)).toEqual(names(set))
    expect(step.active).toEqual({ kind: "summary" })
  })

  it("keeps a filled tab and an empty tab of one kind apart", () => {
    const step = open(withTabs({ kind: "summary", id: "a" }), "summary")
    expect(names(step.set)).toEqual([...FIXED, "summary:a", "summary"])
  })

  it("focuses a Fixed tab without adding it to the strip twice", () => {
    const step = open(emptyTabSet(), "posts")
    expect(names(step.set)).toEqual(FIXED)
    expect(step.active).toEqual(POSTS)
  })

  it("drops an id handed to a kind that holds no Artifact", () => {
    expect(open(emptyTabSet(), "history", "x").active).toEqual({
      kind: "history",
    })
  })
})

describe("create", () => {
  it("fills the kind's empty tab in place", () => {
    const set = withTabs({ kind: "summary" }, { kind: "chat", id: "c" })
    const step = create(set, { kind: "summary" }, "summary", "new")
    expect(names(step.set)).toEqual([...FIXED, "summary:new", "chat:c"])
    expect(step.active).toEqual({ kind: "summary", id: "new" })
  })

  it("appends when the kind has no empty tab", () => {
    const set = withTabs({ kind: "summary", id: "old" })
    const step = create(set, ACTION, "summary", "new")
    expect(names(step.set)).toEqual([...FIXED, "summary:old", "summary:new"])
  })

  it("focuses the tab an Artifact already has", () => {
    const set = withTabs({ kind: "summary", id: "a" }, { kind: "summary" })
    const step = create(set, ACTION, "summary", "a")
    expect(names(step.set)).toEqual(names(set))
    expect(step.active).toEqual({ kind: "summary", id: "a" })
  })

  it("shows the result when it was started from Action", () => {
    expect(create(emptyTabSet(), ACTION, "tag", "t").active).toEqual({
      kind: "tag",
      id: "t",
    })
  })

  it("leaves the user where they went while the run was finishing", () => {
    const step = create(withTabs({ kind: "chat" }), POSTS, "chat", "c")
    expect(names(step.set)).toEqual([...FIXED, "chat:c"])
    expect(step.active).toEqual(POSTS)
  })
})

describe("close", () => {
  const a: Tab = { kind: "summary", id: "a" }
  const b: Tab = { kind: "summary", id: "b" }
  const c: Tab = { kind: "chat", id: "c" }

  it("activates the tab to the right of the active tab", () => {
    expect(close(withTabs(a, b, c), b, b).active).toEqual(c)
  })

  it("activates the tab to the left when the active tab was last", () => {
    expect(close(withTabs(a, b, c), c, c).active).toEqual(b)
  })

  it("falls back to the last Fixed tab when nothing Closable is left", () => {
    expect(close(withTabs(a), a, a).active).toEqual(ACTION)
  })

  it("keeps the active tab when another one closes", () => {
    const step = close(withTabs(a, b, c), a, c)
    expect(step.active).toEqual(a)
    expect(names(step.set)).toEqual([...FIXED, "summary:a", "summary:b"])
  })

  it("refuses to close a Fixed tab", () => {
    const set = withTabs(a)
    const step = close(set, POSTS, POSTS)
    expect(names(step.set)).toEqual(names(set))
    expect(step.active).toEqual(POSTS)
  })
})

describe("move", () => {
  const a: Tab = { kind: "summary", id: "a" }
  const b: Tab = { kind: "summary", id: "b" }
  const c: Tab = { kind: "chat", id: "c" }

  it("moves a tab rightwards onto another's place", () => {
    expect(names(move(withTabs(a, b, c), a, c))).toEqual([
      ...FIXED,
      "summary:b",
      "chat:c",
      "summary:a",
    ])
  })

  it("moves a tab leftwards onto another's place", () => {
    expect(names(move(withTabs(a, b, c), c, a))).toEqual([
      ...FIXED,
      "chat:c",
      "summary:a",
      "summary:b",
    ])
  })

  it("clamps a drop onto a Fixed tab to the first Closable place", () => {
    expect(names(move(withTabs(a, b, c), c, POSTS))).toEqual([
      ...FIXED,
      "chat:c",
      "summary:a",
      "summary:b",
    ])
  })

  it("never moves a Fixed tab", () => {
    const set = withTabs(a, b)
    expect(names(move(set, ACTION, b))).toEqual(names(set))
  })

  it("ignores a tab that is not open", () => {
    const set = withTabs(a, b)
    expect(move(set, c, a)).toBe(set)
  })
})

describe("reopenLast", () => {
  it("restores the last closed tab with its Artifact, and walks back", () => {
    const a: Tab = { kind: "summary", id: "a" }
    const c: Tab = { kind: "chat", id: "c" }
    let set = withTabs(a, c)
    set = close(set, ACTION, a).set
    set = close(set, ACTION, c).set

    const first = reopenLast(set, ACTION)
    expect(first.active).toEqual(c)
    const second = reopenLast(first.set, first.active)
    expect(second.active).toEqual(a)
    expect(names(second.set)).toEqual([...FIXED, "chat:c", "summary:a"])

    const third = reopenLast(second.set, second.active)
    expect(third.active).toEqual(a)
    expect(names(third.set)).toEqual(names(second.set))
  })

  it("is not persisted with the open set", () => {
    // The stack is session memory; a fresh set has nothing to reopen.
    const step = reopenLast(emptyTabSet(), POSTS)
    expect(step.active).toEqual(POSTS)
  })
})

describe("reconcile", () => {
  it("drops tabs whose Artifact is gone, and moves off a dropped active tab", () => {
    const a: Tab = { kind: "summary", id: "a" }
    const b: Tab = { kind: "tag", id: "b" }
    const step = reconcile(withTabs(a, b), a, {
      known: new Set(["tag:b"]),
      hasArtifacts: true,
    })
    expect(names(step.set)).toEqual([...FIXED, "history", "tag:b"])
    expect(step.active).toEqual(b)
  })

  it("leaves an active tab it has not been asked about where it is", () => {
    // A URL can name a tab `visit` has not opened yet; that is not a drop.
    const step = reconcile(
      emptyTabSet(),
      { kind: "summary", id: "new" },
      {
        known: new Set(),
        hasArtifacts: false,
      },
    )
    expect(step.active).toEqual({ kind: "summary", id: "new" })
  })

  it("keeps empty tabs, History and Settings", () => {
    const set = withTabs({ kind: "settings" }, { kind: "chat" })
    const step = reconcile(set, POSTS, {
      known: new Set(),
      hasArtifacts: false,
    })
    expect(names(step.set)).toEqual(names(set))
  })
})

describe("the default set", () => {
  it("is the Fixed tabs alone for an account with no Artifact", () => {
    const step = reconcile(emptyTabSet(), POSTS, {
      known: new Set(),
      hasArtifacts: false,
    })
    expect(names(step.set)).toEqual(FIXED)
  })

  it("gains History once the account has an Artifact", () => {
    const step = reconcile(emptyTabSet(), POSTS, {
      known: new Set(),
      hasArtifacts: true,
    })
    expect(names(step.set)).toEqual([...FIXED, "history"])
  })

  it("never brings History back after the user closed it", () => {
    const withHistory = withTabs({ kind: "history" })
    const closed = close(withHistory, POSTS, { kind: "history" }).set
    const step = reconcile(closed, POSTS, {
      known: new Set(),
      hasArtifacts: true,
    })
    expect(names(step.set)).toEqual(FIXED)
  })

  it("lets the user reopen History, and then keeps it", () => {
    const closed = close(withTabs({ kind: "history" }), POSTS, {
      kind: "history",
    }).set
    const reopened = open(closed, "history").set
    expect(reopened.historyClosed).toBe(false)
  })

  it("starts with Settings closed", () => {
    expect(names(emptyTabSet())).not.toContain("settings")
  })
})

describe("visit", () => {
  it("opens a tab for a URL naming an Artifact that has none", () => {
    const set = visit(emptyTabSet(), { kind: "chat", id: "x" })
    expect(names(set)).toEqual([...FIXED, "chat:x"])
  })

  it("opens Settings when a URL goes there", () => {
    expect(names(visit(emptyTabSet(), { kind: "settings" }))).toContain(
      "settings",
    )
  })
})

describe("goTo", () => {
  it("focuses the most recently active tab of the kind", () => {
    let set = withTabs(
      { kind: "summary", id: "a" },
      { kind: "summary", id: "b" },
    )
    set = visit(set, { kind: "summary", id: "b" })
    set = visit(set, { kind: "summary", id: "a" })
    set = visit(set, POSTS)
    expect(goTo(set, "summary").active).toEqual({ kind: "summary", id: "a" })
  })

  it("ignores a recent tab that has since closed", () => {
    let set = withTabs(
      { kind: "summary", id: "a" },
      { kind: "summary", id: "b" },
    )
    set = visit(set, { kind: "summary", id: "b" })
    set = close(set, POSTS, { kind: "summary", id: "b" }).set
    expect(goTo(set, "summary").active).toEqual({ kind: "summary" })
  })

  it("opens an empty tab when the kind has none open", () => {
    const step = goTo(emptyTabSet(), "discover")
    expect(step.active).toEqual({ kind: "discover" })
    expect(names(step.set)).toEqual([...FIXED, "discover"])
  })
})

describe("tabSearch", () => {
  it("names only the target tab's Artifact", () => {
    const prev = { tab: "summary" as const, summary: "old", channelGroup: "g" }
    expect(tabSearch(prev, { kind: "summary" })).toEqual({
      tab: "summary",
      channelGroup: "g",
    })
    expect(tabSearch(prev, { kind: "chat", id: "c" })).toEqual({
      tab: "chat",
      chatSession: "c",
      channelGroup: "g",
    })
  })
})

it("never narrows what the router accepts", () => {
  // A closed tab is still reachable by URL.
  for (const tab of WORKSPACE_TABS) expect(VALID_TABS).toContain(tab.id)
})

describe("findTabArtifacts", () => {
  const rows = (ids: string[]) =>
    ids.map((id) => ({ kind: "summary", id })) as unknown as ArtifactListItem[]
  const pages = [rows(["a", "b"]), rows(["c", "d"]), rows(["e"])]

  it("walks pages only until every key is found", async () => {
    const asked: number[] = []
    const result = await findTabArtifacts(["summary:c"], 2, async (offset) => {
      asked.push(offset)
      return pages[offset / 2] ?? []
    })
    expect(asked).toEqual([0, 2])
    expect([...result.found.keys()]).toEqual(["summary:c"])
    expect(result.any).toBe(true)
  })

  it("walks to the end for a key that is gone", async () => {
    const asked: number[] = []
    const result = await findTabArtifacts(["summary:x"], 2, async (offset) => {
      asked.push(offset)
      return pages[offset / 2] ?? []
    })
    expect(asked).toEqual([0, 2, 4])
    expect(result.found.size).toBe(0)
  })

  it("answers whether the account has any Artifact", async () => {
    const empty = await findTabArtifacts([], 2, async () => [])
    expect(empty.any).toBe(false)
  })

  it("keys a Discover report by its tab kind", async () => {
    const report = [{ kind: "discovery", id: "r" }] as ArtifactListItem[]
    const result = await findTabArtifacts(["discover:r"], 2, async () => report)
    expect(result.found.has("discover:r")).toBe(true)
  })
})
