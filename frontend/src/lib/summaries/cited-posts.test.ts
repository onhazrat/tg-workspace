import { describe, expect, test } from "bun:test"
import type { Post } from "@/types"
import { citedPostResolver } from "./cited-posts"

const post = (channelName: string, id: number, text: string): Post => ({
  id,
  channelName,
  text,
  date: "2026-10-07T09:00:00Z",
  timestamp: 0,
})

describe("citedPostResolver", () => {
  test("a Post the lookup found is shown as it is now, not as the snapshot kept it", () => {
    const resolve = citedPostResolver({
      live: [{ ...post("news", 7, "edited"), viewsCount: 900 }],
      snapshot: {
        "news-7": { ...post("news", 7, "original"), viewsCount: 10 },
      },
      covered: null,
    })
    const cited = resolve("news", 7)
    expect(cited.source).toBe("live")
    expect(cited.post?.text).toBe("edited")
    expect(cited.post?.viewsCount).toBe(900)
  })

  test("a deleted or aged-out Post falls back to the snapshot", () => {
    const resolve = citedPostResolver({
      live: [],
      snapshot: { "news-7": post("news", 7, "original") },
      covered: null,
    })
    expect(resolve("news", 7)).toMatchObject({
      source: "snapshot",
      post: { text: "original" },
    })
  })

  test("a Post in neither is missing", () => {
    const resolve = citedPostResolver({ live: [], snapshot: {}, covered: null })
    expect(resolve("news", 7)).toEqual({
      channelName: "news",
      postId: 7,
      post: null,
      source: "missing",
      outsideScope: false,
    })
  })

  test("the AI's spelling of the handle still finds the stored Post", () => {
    const resolve = citedPostResolver({
      live: [post("News_IR", 7, "now")],
      snapshot: {},
      covered: [{ channelName: "News_IR", postId: 7 }],
    })
    expect(resolve("news_ir", 7)).toMatchObject({
      source: "live",
      outsideScope: false,
    })
  })

  test("outside the Scope only when Covered Posts are on record and this one is not among them", () => {
    const covered = [{ channelName: "news", postId: 1 }]
    const live = [post("news", 1, "a"), post("news", 2, "b")]
    const recorded = citedPostResolver({ live, snapshot: {}, covered })
    expect(recorded("news", 1).outsideScope).toBe(false)
    expect(recorded("news", 2).outsideScope).toBe(true)
    expect(recorded("other", 1).outsideScope).toBe(true)

    const unrecorded = citedPostResolver({ live, snapshot: {}, covered: null })
    expect(unrecorded("news", 2).outsideScope).toBe(false)
  })
})
