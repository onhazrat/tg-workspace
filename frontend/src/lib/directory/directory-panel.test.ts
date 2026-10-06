/**
 * The detail panel's pure rules (DIR-03): which Links a Post hides, when a
 * Post is media only or long, and the window "Why it's here" counts in.
 */
import { describe, expect, test } from "bun:test"
import { parseDirectoryFilter } from "./directory-filter"
import {
  hiddenLinks,
  isLongPost,
  isMediaOnly,
  mineWindow,
} from "./directory-panel"

const link = (channel: string, url = `https://t.me/${channel}`) => ({
  url,
  channel,
})

describe("hidden links", () => {
  test("a Link the text shows as a mention or an address is not listed", () => {
    expect(
      hiddenLinks("read @Durov and t.me/telegram/5 today", [
        link("durov"),
        link("telegram", "https://t.me/telegram/5"),
      ]),
    ).toEqual([])
  })

  test("a Link behind other words is listed once", () => {
    const behind = link("hidden_chan", "https://t.me/hidden_chan/9")
    expect(hiddenLinks("click here", [behind, behind])).toEqual([behind])
  })
})

describe("media only and long Posts", () => {
  test("no words, or only a media placeholder, is media only", () => {
    expect(isMediaOnly("")).toBe(true)
    expect(isMediaOnly("  [photo] ")).toBe(true)
    expect(isMediaOnly("[photo] caption")).toBe(false)
    expect(isMediaOnly("words")).toBe(false)
  })

  test("a Post is long past 280 characters or six lines", () => {
    expect(isLongPost("a".repeat(280))).toBe(false)
    expect(isLongPost("a".repeat(281))).toBe(true)
    expect(isLongPost("1\n2\n3\n4\n5\n6")).toBe(false)
    expect(isLongPost("1\n2\n3\n4\n5\n6\n7")).toBe(true)
  })
})

describe("the window of Why it's here", () => {
  const window = (text: string) =>
    mineWindow(parseDirectoryFilter(text) ?? undefined)

  test("is the Cited by your channels Condition's days", () => {
    expect(window("lang:fa and mine:14d")).toBe(14)
    expect(window("(lang:fa or mine:7d)")).toBe(7)
  })

  test("is every Post without one, or with no window", () => {
    expect(window("lang:fa")).toBeNull()
    expect(window("mine:all")).toBeNull()
    expect(mineWindow(undefined)).toBeNull()
  })
})
