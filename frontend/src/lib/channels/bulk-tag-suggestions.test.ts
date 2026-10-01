import { describe, expect, it } from "bun:test"
import type { Channel } from "@/types"

import { bulkTagSuggestions, completeTag } from "./bulk-tag-suggestions"

const channel = (name: string, tags: string[]): Channel =>
  ({ id: name, name, tags }) as unknown as Channel

// tech on 3 (a, b, c), news on 2 (a, d), art on 1 (d), all on 4.
const channels = [
  channel("a", ["tech", "news", "all"]),
  channel("b", ["tech", "all"]),
  channel("c", ["tech", "all"]),
  channel("d", ["news", "art", "all"]),
]

const tags = (list: { tag: string }[]) => list.map((s) => s.tag)

describe("bulkTagSuggestions", () => {
  it("offers to add every tag, most used first, ties by name", () => {
    const { add } = bulkTagSuggestions(channels, new Set(["d"]))
    // `all`, `news` and `art` are already on d, the whole action set.
    expect(tags(add)).toEqual(["tech"])
    expect(tags(bulkTagSuggestions(channels, new Set(["b", "d"])).add)).toEqual(
      ["tech", "news", "art"],
    )
  })

  it("skips only the tags every Channel in the action set has", () => {
    const { add } = bulkTagSuggestions(channels, new Set(["a", "b"]))
    expect(tags(add)).toEqual(["news", "art"])
  })

  it("offers to remove only tags on the action set, most common there first", () => {
    const { remove } = bulkTagSuggestions(channels, new Set(["a", "d"]))
    expect(remove).toEqual([
      { tag: "all", total: 4, inTargets: 2 },
      { tag: "news", total: 2, inTargets: 2 },
      { tag: "art", total: 1, inTargets: 1 },
      { tag: "tech", total: 3, inTargets: 1 },
    ])
  })

  it("never offers to remove a tag the action set does not carry", () => {
    expect(tags(bulkTagSuggestions(channels, new Set(["b"])).remove)).toEqual([
      "all",
      "tech",
    ])
  })

  it("counts every Channel and the action set's share", () => {
    const { add } = bulkTagSuggestions(channels, new Set(["b", "d"]))
    expect(add[1]).toEqual({ tag: "news", total: 2, inTargets: 1 })
  })
})

describe("completeTag", () => {
  const { add } = bulkTagSuggestions(channels, new Set(["b", "d"]))

  it("is the best suggestion starting with what was typed, any case", () => {
    expect(completeTag(add, "T")?.tag).toBe("tech")
    expect(completeTag(add, "a")?.tag).toBe("art")
  })

  it("matches the whole tag too, so its count still shows", () => {
    expect(completeTag(add, "NEWS")?.tag).toBe("news")
  })

  it("is nothing for an empty field or a tag nobody uses", () => {
    expect(completeTag(add, "")).toBeUndefined()
    expect(completeTag(add, "x")).toBeUndefined()
  })
})
