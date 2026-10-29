/**
 * The one key list (ADR-034): one key per action, never two actions on one
 * key, and `x` in each list's own word.
 */
import { describe, expect, test } from "bun:test"
import { ACTIONS, actionLabel, GO, LIST_KEYS, listKeys } from "./key-list"

describe("the key list", () => {
  test("no two actions share a key, a list's own keys included", () => {
    const keys = [
      ...Object.values(ACTIONS).map((a) => a.key),
      ...Object.values(LIST_KEYS),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })

  test("x says select on Channels and in the Directory, Pick in Posts", () => {
    expect(actionLabel("directory", "tick")).toBe("select or deselect")
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
