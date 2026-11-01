/**
 * The live check's merge (WR-02): a Channel's new verdict replaces its row and
 * the Scope's totals follow, summed by the server's rules.
 */
import { describe, expect, test } from "bun:test"

import { type Change, listen, merged, touched } from "./live"
import { verdict, windowCheck } from "./verdict-fixtures"

const E = Date.UTC(2026, 10, 1, 9)
const late = (
  name: string,
  unprovenPosts: number,
  pacePerHour: number | null,
) =>
  verdict(name, {
    reasons: ["end"],
    reason: "end",
    unprovenPosts,
    pacePerHour,
    stretches: [{ kind: "end", from: E - 3_600_000, to: E }],
  })

describe("one Channel's new verdict", () => {
  // Mutation: keep the cached row, or the cached floor, and this goes red.
  test("replaces its row, and the totals follow", () => {
    const cached = windowCheck([late("a", 5, 1), late("b", 3, null)], {
      end: E,
      unprovenFloor: true,
    })
    expect(cached.unprovenPosts).toBe(8)

    const fresh = windowCheck([verdict("b", { heldPosts: 12 }), verdict("c")])
    const now = merged(cached, fresh)

    expect(now.channels.map((c) => [c.name, c.reason])).toEqual([
      ["a", "end"],
      ["b", null],
    ])
    expect([now.heldPosts, now.unprovenPosts, now.unprovenFloor]).toEqual([
      22,
      5,
      false,
    ])
    expect([now.frozenAt, now.start, now.end]).toEqual([
      cached.frozenAt,
      cached.start,
      cached.end,
    ])
  })
})

describe("which Channels a change asks about", () => {
  test("those it names among mine, or all of mine after a reconnect", () => {
    expect(touched(["b", "z"], ["a", "b"])).toEqual(["b"])
    expect(touched("all", ["a", "b"])).toEqual(["a", "b"])
  })
})

describe("the stream", () => {
  // Mutation: hear nothing on a reopened stream's first frame and this goes red.
  test("hears names after the open frame, and all after a reconnect", async () => {
    const stop = new AbortController()
    let connections = 0
    async function* connect() {
      connections++
      yield { names: [] }
      yield { names: [connections === 1 ? "a" : "b"] }
      if (connections === 1) throw new Error("dropped")
      stop.abort()
    }
    const heard: Change[] = []

    await listen(stop.signal, (change) => heard.push(change), connect, 0)

    expect(heard).toEqual([["a"], "all", ["b"]])
  })
})
