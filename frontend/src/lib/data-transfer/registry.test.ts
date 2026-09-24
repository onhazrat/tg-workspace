import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { toast } from "sonner"

import type { CommandContext } from "@/lib/commands/types"
import type { Channel } from "@/types"
import { buildJsonlContent } from "./jsonl"
import { buildDataCommandsForEntity, importJsonlFile } from "./registry"
import type { DataEntityDef } from "./types"

type SaveFilePicker = (options: unknown) => Promise<unknown>

const spies: Array<{ mockRestore: () => void }> = []
function spyToast(method: "success" | "error" | "info") {
  const s = spyOn(toast, method)
  spies.push(s)
  return s
}

const pickerHost = window as unknown as { showSaveFilePicker?: SaveFilePicker }

/**
 * happy-dom reports `navigator.webdriver` as true, which sends every export to
 * the blob download. Shadow it so the save picker is reachable.
 */
function offerSavePicker(picker: SaveFilePicker) {
  Object.defineProperty(navigator, "webdriver", {
    value: false,
    configurable: true,
  })
  pickerHost.showSaveFilePicker = picker
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore()
  delete pickerHost.showSaveFilePicker
  delete (navigator as { webdriver?: boolean }).webdriver
})

function channelDef(items: Channel[] = []) {
  const upserted: Channel[][] = []
  const def: DataEntityDef<"channel"> = {
    entity: "channel",
    singularLabel: "channel",
    pluralLabel: "Channels",
    filters: ["all"],
    listForFilter: async () => items,
    toCopyLine: (channel) => channel.name,
    filterImportRecords: (records) => records.filter((r) => r.name !== "skip"),
    upsertRecords: async (records) => {
      upserted.push(records)
      return { imported: records.length, failed: 0, skipped: 0 }
    },
  }
  return { def, upserted }
}

const ctx = { isOffline: false } as CommandContext

const jsonl = (records: Channel[]) =>
  new File([buildJsonlContent("channel", "all", records)], "c.jsonl")

describe("importJsonlFile", () => {
  test("a file that is not JSONL is refused with the parser's message", async () => {
    const { def, upserted } = channelDef()
    const error = spyToast("error")
    await importJsonlFile(def, "all", ctx, new File(["not json"], "c.jsonl"))
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0]?.[0])).toContain("line 1")
    expect(upserted).toEqual([])
  })

  test("says how many rows the filter skipped when it keeps none", async () => {
    const { def, upserted } = channelDef()
    const info = spyToast("info")
    await importJsonlFile(def, "all", ctx, jsonl([{ id: "1", name: "skip" }]))
    expect(info).toHaveBeenCalledWith(
      "No matching channels in file (1 skipped)",
    )
    expect(upserted).toEqual([])
  })

  test("says the file is empty when it has a header and no rows", async () => {
    const { def } = channelDef()
    const info = spyToast("info")
    await importJsonlFile(def, "all", ctx, jsonl([]))
    expect(info).toHaveBeenCalledWith("No channels found in file")
  })

  test("upserts what the filter keeps and reports the skipped rows too", async () => {
    const { def, upserted } = channelDef()
    const success = spyToast("success")
    await importJsonlFile(
      def,
      "all",
      ctx,
      jsonl([
        { id: "1", name: "alpha" },
        { id: "2", name: "skip" },
      ]),
    )
    expect(upserted).toEqual([[{ id: "1", name: "alpha" }]])
    expect(success).toHaveBeenCalledWith("Imported 1, skipped 1")
  })
})

describe("when copy and export are disabled", () => {
  const disabledFor = (id: string, requiresServer: boolean, over: object) => {
    const command = buildDataCommandsForEntity({
      ...channelDef().def,
      filters: ["all", "selected", "frozen"],
      requiresServer,
    }).find((c) => c.id === id)
    return command?.disabled?.({
      isOffline: false,
      selectedChannels: new Set<string>(),
      channels: [],
      ...over,
    } as unknown as CommandContext)
  }

  test("a server-only entity is disabled offline, whatever the filter", () => {
    expect(
      disabledFor("export-channels-all", true, { isOffline: true }),
    ).toEqual({ disabled: true, reason: "Requires server connection" })
    expect(
      disabledFor("export-channels-all", false, { isOffline: true }),
    ).toEqual({ disabled: false })
  })

  test("Selected needs a selection and Frozen needs a frozen channel", () => {
    expect(disabledFor("copy-channels-selected", false, {})).toEqual({
      disabled: true,
      reason: "No channels selected",
    })
    expect(
      disabledFor("copy-channels-selected", false, {
        selectedChannels: new Set(["a"]),
      }),
    ).toEqual({ disabled: false })
    expect(disabledFor("export-channels-frozen", false, {})).toEqual({
      disabled: true,
      reason: "No frozen channels",
    })
    expect(
      disabledFor("export-channels-frozen", false, {
        channels: [{ id: "1", name: "a", isFrozen: true }],
      }),
    ).toEqual({ disabled: false })
  })
})

describe("the export command", () => {
  const exportCommand = (items: Channel[]) => {
    const command = buildDataCommandsForEntity(channelDef(items).def).find(
      (c) => c.id === "export-channels-all",
    )
    if (!command?.run) throw new Error("export command missing")
    return command.run
  }

  test("an empty list exports nothing", async () => {
    const info = spyToast("info")
    await exportCommand([])(ctx)
    expect(info).toHaveBeenCalledWith("No channels to export")
  })

  test("writes the JSONL to the file the user picked", async () => {
    const written: string[] = []
    offerSavePicker(async () => ({
      createWritable: async () => ({
        write: async (content: string) => {
          written.push(content)
        },
        close: async () => {},
      }),
    }))
    const success = spyToast("success")

    await exportCommand([{ id: "1", name: "alpha" }])({
      ...ctx,
      isOffline: true,
    })

    expect(written[0]).toContain('"name":"alpha"')
    expect(success).toHaveBeenCalledWith(
      "Exported 1 channels (from local cache)",
    )
  })

  test("closing the save dialog is not an error and not a success", async () => {
    offerSavePicker(async () => {
      throw new DOMException("closed", "AbortError")
    })
    const success = spyToast("success")
    await exportCommand([{ id: "1", name: "alpha" }])(ctx)
    expect(success).not.toHaveBeenCalled()
  })

  function captureDownloads(): string[] {
    const clicked: string[] = []
    const click = spyOn(
      HTMLAnchorElement.prototype,
      "click",
    ).mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download)
    })
    spies.push(click)
    return clicked
  }

  test("a picker that fails otherwise falls back to a download", async () => {
    offerSavePicker(async () => {
      throw new Error("not allowed")
    })
    const clicked = captureDownloads()
    const success = spyToast("success")

    await exportCommand([{ id: "1", name: "alpha" }])(ctx)

    expect(clicked).toHaveLength(1)
    expect(clicked[0]).toMatch(/^telegram-summarizer-channels-all-.*\.jsonl$/)
    expect(success).toHaveBeenCalledWith("Exported 1 channels")
  })

  test("a picker that returns no file falls back to a download", async () => {
    offerSavePicker(async () => undefined)
    const clicked = captureDownloads()
    spyToast("success")
    await exportCommand([{ id: "1", name: "alpha" }])(ctx)
    expect(clicked).toHaveLength(1)
  })

  test("under automation the picker is never opened", async () => {
    let asked = 0
    pickerHost.showSaveFilePicker = async () => {
      asked++
    }
    const clicked = captureDownloads()
    spyToast("success")
    await exportCommand([{ id: "1", name: "alpha" }])(ctx)
    expect(asked).toBe(0)
    expect(clicked).toHaveLength(1)
  })
})
