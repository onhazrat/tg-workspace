import { describe, expect, it } from "bun:test"

import { applySetStateAction } from "@/lib/applySetStateAction"

describe("applySetStateAction", () => {
  it("returns a plain value action as-is, ignoring the previous value", () => {
    expect(applySetStateAction([3, 4], [1, 2])).toEqual([3, 4])
    expect(applySetStateAction("next", "prev")).toBe("next")
    expect(applySetStateAction(null as string | null, "prev")).toBeNull()
  })

  it("applies an updater function to the previous value", () => {
    expect(
      applySetStateAction((prev: number[]) => [...prev, 3], [1, 2]),
    ).toEqual([1, 2, 3])
    expect(applySetStateAction((n: number) => n + 1, 41)).toBe(42)
  })

  it("passes the exact previous reference to the updater", () => {
    const prev = { a: 1 }
    let seen: unknown
    applySetStateAction((p: { a: number }) => {
      seen = p
      return p
    }, prev)
    expect(seen).toBe(prev)
  })

  it("supports updaters over object maps", () => {
    const prev: Record<string, number> = { a: 1 }
    const next = applySetStateAction(
      (p: Record<string, number>) => ({ ...p, b: 2 }),
      prev,
    )
    expect(next).toEqual({ a: 1, b: 2 })
    expect(prev).toEqual({ a: 1 })
  })
})
