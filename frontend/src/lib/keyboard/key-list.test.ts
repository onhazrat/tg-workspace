/**
 * The one key list (ADR-034): one key per action, never two actions on one
 * key, and `x` in each list's own word.
 */
import { describe, expect, test } from "bun:test"
import { ACTIONS, actionLabel, GO, listKeys } from "./key-list"

describe("the key list", () => {
  test("no two actions share a key", () => {
    const keys = Object.values(ACTIONS).map((a) => a.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test("x says Tick in the Directory, select on Channels, Pick in Posts", () => {
    expect(actionLabel("directory", "tick")).toBe("tick or untick")
    expect(actionLabel("channels", "tick")).toBe("select or deselect")
    expect(actionLabel("posts", "tick")).toBe("pick or unpick")
  })

  test("a list shows only the actions its items carry, when told", () => {
    const keys = listKeys("channels", ["tick", "sync"]).map(([k]) => k)
    expect(keys).toContain("x")
    expect(keys).toContain("s")
    expect(keys).not.toContain("z")
  })

  test("g's letters never take the strip's t, T, x or X", () => {
    for (const strip of ["t", "T", "x", "X", "g"])
      expect(GO[strip]).toBeUndefined()
  })
})
