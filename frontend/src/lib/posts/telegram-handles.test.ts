import { describe, expect, test } from "bun:test"

import {
  channelFromTelegramPath,
  extractMentions,
  extractPostLinkChannels,
  extractTextLinks,
  isValidChannelHandle,
  normalizeHandle,
} from "@/lib/posts/telegram-handles"
import type { Post } from "@/types"

function makePost(overrides: Partial<Post>): Post {
  return {
    id: 1,
    channelName: "carrier",
    text: "",
    date: new Date(1000).toISOString(),
    timestamp: 1000,
    ...overrides,
  }
}

describe("normalizeHandle", () => {
  test("strips @ and lowercases", () => {
    expect(normalizeHandle("@Foo_Bar")).toBe("foo_bar")
    expect(normalizeHandle("  Baz  ")).toBe("baz")
  })
})

describe("isValidChannelHandle", () => {
  test("accepts well-formed handles with or without @", () => {
    expect(isValidChannelHandle("news_channel")).toBe(true)
    expect(isValidChannelHandle("@news_channel")).toBe(true)
  })

  test("rejects too-short, digit-leading, and over-long handles", () => {
    expect(isValidChannelHandle("abcd")).toBe(false)
    expect(isValidChannelHandle("1abcde")).toBe(false)
    expect(isValidChannelHandle(`a${"b".repeat(32)}`)).toBe(false)
  })

  test("rejects reserved paths", () => {
    expect(isValidChannelHandle("joinchat")).toBe(false)
    expect(isValidChannelHandle("addstickers")).toBe(false)
    expect(isValidChannelHandle("setlanguage")).toBe(false)
  })
})

describe("extractMentions", () => {
  test("finds plain @mentions", () => {
    expect(extractMentions("read @alpha_news and @beta_wire today")).toEqual([
      "alpha_news",
      "beta_wire",
    ])
  })

  test("ignores email addresses", () => {
    expect(extractMentions("contact user@domain.com for info")).toEqual([])
  })

  test("dedupes case-insensitively within one post", () => {
    expect(extractMentions("@AlphaNews and @alphanews")).toEqual(["alphanews"])
  })

  test("ignores handles that are too short or reserved", () => {
    expect(extractMentions("@abc @joinchat")).toEqual([])
  })
})

describe("channelFromTelegramPath", () => {
  test("resolves bare handle, web view, and permalink", () => {
    expect(channelFromTelegramPath("alpha_news")).toBe("alpha_news")
    expect(channelFromTelegramPath("s/alpha_news")).toBe("alpha_news")
    expect(channelFromTelegramPath("alpha_news/123")).toBe("alpha_news")
  })

  test("strips query and hash", () => {
    expect(channelFromTelegramPath("alpha_news?before=5")).toBe("alpha_news")
  })

  test("rejects invite, private, and reserved paths", () => {
    expect(channelFromTelegramPath("+AbCdEf")).toBeNull()
    expect(channelFromTelegramPath("joinchat/AbCdEf")).toBeNull()
    expect(channelFromTelegramPath("c/1234567")).toBeNull()
    expect(channelFromTelegramPath("")).toBeNull()
  })
})

describe("extractTextLinks", () => {
  test("finds t.me links with and without scheme", () => {
    expect(extractTextLinks("join https://t.me/alpha_news now")).toEqual([
      "alpha_news",
    ])
    expect(extractTextLinks("join t.me/beta_wire now")).toEqual(["beta_wire"])
  })

  test("resolves permalinks and web-view links to the channel", () => {
    expect(extractTextLinks("https://t.me/s/alpha_news/42")).toEqual([
      "alpha_news",
    ])
  })

  test("skips invite links", () => {
    expect(extractTextLinks("https://t.me/+SecretInvite")).toEqual([])
    expect(extractTextLinks("https://t.me/joinchat/SecretInvite")).toEqual([])
  })

  test("ignores non-telegram hosts", () => {
    expect(extractTextLinks("https://example.com/alpha_news")).toEqual([])
  })
})

describe("extractPostLinkChannels", () => {
  test("unions text links with masked hrefs", () => {
    const post = makePost({
      text: "see t.me/alpha_news",
      links: [{ url: "https://t.me/beta_wire", channel: "beta_wire" }],
    })
    expect(extractPostLinkChannels(post).sort()).toEqual([
      "alpha_news",
      "beta_wire",
    ])
  })

  test("dedupes a link present in both text and the links column", () => {
    const post = makePost({
      text: "join https://t.me/alpha_news",
      links: [{ url: "https://t.me/alpha_news", channel: "alpha_news" }],
    })
    expect(extractPostLinkChannels(post)).toEqual(["alpha_news"])
  })

  test("falls back to parsing url when channel is absent", () => {
    const post = makePost({
      text: "",
      links: [{ url: "https://t.me/gamma_feed/99" }],
    })
    expect(extractPostLinkChannels(post)).toEqual(["gamma_feed"])
  })

  test("handles missing links column", () => {
    expect(extractPostLinkChannels(makePost({ text: "nothing here" }))).toEqual(
      [],
    )
  })
})
