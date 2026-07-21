import { describe, expect, test } from "bun:test"
import {
  detectLanguageFromPosts,
  selectChannelsForLanguageDetection,
} from "@/lib/language"
import type { Channel, Post } from "@/types"

function channel(name: string, overrides: Partial<Channel> = {}): Channel {
  return { id: name, name, ...overrides }
}

function post(text: string, id = 1): Post {
  return { id, channelName: "c", text, timestamp: id } as Post
}

describe("selectChannelsForLanguageDetection", () => {
  test("selects channels with no language", () => {
    const selected = selectChannelsForLanguageDetection(
      [channel("a"), channel("b", { language: "English" })],
      new Set(),
    )
    expect(selected.map((c) => c.name)).toEqual(["a"])
  })

  test("skips channels unavailable on web view", () => {
    const selected = selectChannelsForLanguageDetection(
      [channel("a", { isUnavailableOnWebView: true })],
      new Set(),
    )
    expect(selected).toEqual([])
  })

  test("skips channels already attempted this session", () => {
    const selected = selectChannelsForLanguageDetection(
      [channel("a"), channel("b")],
      new Set(["a"]),
    )
    expect(selected.map((c) => c.name)).toEqual(["b"])
  })

  // The regression this guard exists for: detection returning `undefined`
  // leaves the channel without a language, so a name-only filter would keep
  // re-selecting it forever.
  test("a channel whose detection returned undefined is not retried", () => {
    const channels = [channel("a")]
    const attempted = new Set<string>()

    const first = selectChannelsForLanguageDetection(channels, attempted)
    expect(first.map((c) => c.name)).toEqual(["a"])

    // Simulate a detection pass that yielded no language: the channel is
    // marked attempted, and `channels` is unchanged because nothing was saved.
    for (const c of first) attempted.add(c.name)

    expect(selectChannelsForLanguageDetection(channels, attempted)).toEqual([])
  })

  test("newly added channels are still picked up after earlier attempts", () => {
    const attempted = new Set(["a"])
    const selected = selectChannelsForLanguageDetection(
      [channel("a"), channel("new")],
      attempted,
    )
    expect(selected.map((c) => c.name)).toEqual(["new"])
  })
})

describe("detectLanguageFromPosts", () => {
  test("returns undefined for an empty post list", () => {
    expect(detectLanguageFromPosts([])).toBeUndefined()
  })

  test("returns undefined when the sample is too short", () => {
    expect(detectLanguageFromPosts([post("hi")])).toBeUndefined()
  })

  test("detects a language from sufficient text", () => {
    const text =
      "The quick brown fox jumps over the lazy dog and keeps running through the field every single morning."
    expect(detectLanguageFromPosts([post(text)])).toBe("English")
  })
})
