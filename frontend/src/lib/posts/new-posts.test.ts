import { describe, expect, test } from "bun:test"
import { holdNewPosts } from "./new-posts"

const hold = (posts: string[], seen: string[]) =>
  holdNewPosts(posts, new Set(seen), (p) => p)

describe("holdNewPosts", () => {
  test("holds a Post that arrives above what is shown", () => {
    expect(hold(["new", "a", "b"], ["a", "b"])).toEqual({
      shown: ["a", "b"],
      held: ["new"],
    })
  })

  test("holds one that lands between shown Posts, as a views sort puts it", () => {
    expect(hold(["a", "new", "b"], ["a", "b"]).held).toEqual(["new"])
  })

  test("shows a loaded page below the last shown Post at once", () => {
    expect(hold(["a", "b", "c", "d"], ["a", "b"])).toEqual({
      shown: ["a", "b", "c", "d"],
      held: [],
    })
  })

  test("shows everything on a first load, when nothing is seen yet", () => {
    expect(hold(["a", "b"], []).held).toEqual([])
  })
})
