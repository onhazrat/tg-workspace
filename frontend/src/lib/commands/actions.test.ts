import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { toast } from "sonner"

import { api } from "@/api"
import type { CommandContext } from "@/lib/commands/types"
import type { Channel } from "@/types"

import { buildActionCommands } from "./actions"

const commands = buildActionCommands()
const command = (id: string) => {
  const found = commands.find((c) => c.id === id)
  if (!found) throw new Error(`no command ${id}`)
  return found
}

const channels: Channel[] = [
  { id: "c1", name: "alpha" },
  // A group can take a channel out of bulk sync and Sync All.
  { id: "c2", name: "beta", includeInBulkSync: false, includeInSyncAll: false },
]

const ctx = (overrides: Partial<CommandContext> = {}) =>
  ({
    isOffline: false,
    channels,
    selectedChannels: new Set(["alpha"]),
    ...overrides,
  }) as CommandContext

describe("sync-selected availability", () => {
  const disabled = command("sync-selected").disabled

  test.each([
    ["offline", { isOffline: true }, "Server offline"],
    [
      "nothing selected",
      { selectedChannels: new Set<string>() },
      "No channels selected",
    ],
    [
      "only channels excluded from bulk sync selected",
      { selectedChannels: new Set(["beta"]) },
      "No selected channels eligible for bulk sync",
    ],
  ] as const)("is disabled when %s", (_label, overrides, reason) => {
    expect(disabled?.(ctx(overrides))).toEqual({ disabled: true, reason })
  })

  test("is enabled when one selected channel allows bulk sync", () => {
    expect(
      disabled?.(ctx({ selectedChannels: new Set(["alpha", "beta"]) })),
    ).toEqual({ disabled: false })
  })
})

describe("sync-all availability", () => {
  const disabled = command("sync-all").disabled

  test.each([
    ["offline", { isOffline: true }, "Server offline"],
    ["there are no channels", { channels: [] }, "No channels added"],
    [
      "every channel is excluded from Sync All",
      { channels: [channels[1]] },
      "No channels eligible for Sync All",
    ],
  ] as const)("is disabled when %s", (_label, overrides, reason) => {
    expect(disabled?.(ctx(overrides as Partial<CommandContext>))).toEqual({
      disabled: true,
      reason,
    })
  })

  test("ignores the selection and is enabled when any channel is eligible", () => {
    expect(disabled?.(ctx({ selectedChannels: new Set<string>() }))).toEqual({
      disabled: false,
    })
  })
})

/**
 * The import command: pick a file, post it, and report per-table counts. The
 * file picker is a hidden `<input type=file>`, so the test answers its click
 * with a chosen file (or none, as a cancelled dialog does).
 */
describe("import-database", () => {
  const restore: Array<() => void> = []
  afterEach(() => {
    for (const undo of restore.splice(0)) undo()
  })

  function pick(file: File | null) {
    const click = spyOn(HTMLInputElement.prototype, "click").mockImplementation(
      function (this: HTMLInputElement) {
        Object.defineProperty(this, "files", { value: file ? [file] : [] })
        this.onchange?.(new Event("change"))
      },
    )
    restore.push(() => click.mockRestore())
  }

  function importReturns(answer: Record<string, number> | Error) {
    const original = api.importData
    const posted: unknown[] = []
    api.importData = (async (doc: unknown) => {
      posted.push(doc)
      if (answer instanceof Error) throw answer
      return { imported: answer }
    }) as never
    restore.push(() => {
      api.importData = original
    })
    return posted
  }

  function toasts() {
    const spies = {
      success: spyOn(toast, "success"),
      error: spyOn(toast, "error"),
      info: spyOn(toast, "info"),
    }
    restore.push(() => {
      for (const s of Object.values(spies)) s.mockRestore()
    })
    return spies
  }

  const backup = () =>
    new File(
      [JSON.stringify({ version: 2, timestamp: 1, data: { channels: [] } })],
      "backup.json",
    )

  test("posts the picked file and lists what each table took", async () => {
    pick(backup())
    const posted = importReturns({ channels: 3, posts: 10 })
    const t = toasts()
    await command("import-database").run(ctx())
    expect(posted).toHaveLength(1)
    expect(t.success.mock.calls[0][0]).toBe(
      "Import complete (channels: 3, posts: 10)",
    )
  })

  test("says so when the server imported nothing", async () => {
    pick(backup())
    importReturns({})
    const t = toasts()
    await command("import-database").run(ctx())
    expect(t.success.mock.calls[0][0]).toBe("Import complete (no records)")
  })

  test("reports a failed import instead of throwing", async () => {
    pick(backup())
    importReturns(new Error("413 too large"))
    const t = toasts()
    await command("import-database").run(ctx())
    expect(t.success).not.toHaveBeenCalled()
    expect(t.error.mock.calls[0][0]).toBe("Import failed: 413 too large")
  })

  test("does nothing when the dialog is cancelled", async () => {
    pick(null)
    const posted = importReturns({})
    const t = toasts()
    await command("import-database").run(ctx())
    expect(posted).toEqual([])
    expect(t.info).not.toHaveBeenCalled()
  })
})
