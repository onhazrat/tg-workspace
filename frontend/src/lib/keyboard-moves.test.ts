import { describe, expect, test } from "bun:test"
import { nextIndex, readMove } from "./keyboard-moves"

describe("nextIndex", () => {
  test("j and k step one card in reading order, across rows", () => {
    expect(nextIndex(3, "j", 10)).toBe(4)
    expect(nextIndex(4, "k", 10)).toBe(3)
  })

  test("nothing moves past either end", () => {
    expect(nextIndex(0, "k", 10)).toBe(0)
    expect(nextIndex(9, "j", 10)).toBe(9)
  })

  test("G is the last card and gg the first", () => {
    expect(nextIndex(4, "last", 10)).toBe(9)
    expect(nextIndex(4, "first", 10)).toBe(0)
  })
})

describe("readMove", () => {
  test("j, k and G move at once", () => {
    expect(readMove("j", 1000, 0).move).toBe("j")
    expect(readMove("k", 1000, 0).move).toBe("k")
    expect(readMove("G", 1000, 0).move).toBe("last")
  })

  test("gg is two presses within 600 ms; a slower second g starts again", () => {
    const first = readMove("g", 1000, 0)
    expect(first.move).toBeNull()
    expect(readMove("g", 1599, first.lastG).move).toBe("first")
    const slow = readMove("g", 1600, first.lastG)
    expect(slow.move).toBeNull()
    expect(readMove("g", 1700, slow.lastG).move).toBe("first")
  })

  test("another key between the two g presses is not gg", () => {
    const g = readMove("g", 1000, 0)
    const x = readMove("x", 1100, g.lastG)
    expect(x.move).toBeNull()
    expect(readMove("g", 1200, x.lastG).move).toBeNull()
  })

  test("a third g straight after gg is a fresh first press", () => {
    const g = readMove("g", 1000, 0)
    const gg = readMove("g", 1100, g.lastG)
    expect(readMove("g", 1200, gg.lastG).move).toBeNull()
  })
})
