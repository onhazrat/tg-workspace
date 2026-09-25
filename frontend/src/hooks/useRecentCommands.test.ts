/**
 * The palette's recent commands survive a reload through `scopedStorage`, and
 * what comes back from storage is untrusted: an older build, a hand edit or a
 * truncated write can leave anything under the key. A bad value must read as
 * "no recents", because this runs in a `useState` initialiser and a throw there
 * blanks the palette.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act, cleanup, renderHook } from "@testing-library/react"

import { useRecentCommands } from "@/hooks/useRecentCommands"
import type { CommandDef } from "@/lib/commands/types"
import { scopedStorage } from "@/lib/storage/scoped"

const KEY = "commandPaletteRecents"
const commands = ["open", "sync", "copy"].map((id) => ({ id }) as CommandDef)
const ids = (list: CommandDef[]) => list.map((command) => command.id)

function mount() {
  return renderHook(() => useRecentCommands(commands)).result
}

beforeEach(() => scopedStorage.removeItem(KEY))
afterEach(cleanup)

describe("useRecentCommands", () => {
  test("restores stored recents in order, dropping commands that no longer exist", () => {
    scopedStorage.setItem(
      KEY,
      JSON.stringify([
        { commandId: "sync", lastUsedAt: 2 },
        { commandId: "retired", lastUsedAt: 1 },
        { commandId: "open", lastUsedAt: 0 },
      ]),
    )
    expect(ids(mount().current.recentCommands)).toEqual(["sync", "open"])
  })

  test.each([
    ["corrupt JSON", "{not json"],
    ["a non-array value", JSON.stringify({ commandId: "open" })],
  ])("reads %s as no recents", (_label, raw) => {
    scopedStorage.setItem(KEY, raw)
    expect(mount().current.recentCommands).toEqual([])
  })

  test("recording moves the command to the front and persists it", () => {
    scopedStorage.setItem(
      KEY,
      JSON.stringify([
        { commandId: "open", lastUsedAt: 1 },
        { commandId: "sync", lastUsedAt: 0 },
      ]),
    )
    const result = mount()
    act(() => result.current.recordRecent("sync"))
    expect(ids(result.current.recentCommands)).toEqual(["sync", "open"])

    // A fresh mount is a reload: it reads back what the first one wrote.
    expect(ids(mount().current.recentCommands)).toEqual(["sync", "open"])
  })
})
