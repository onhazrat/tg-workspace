import { describe, expect, it } from "bun:test"
import {
  type ExportDocument,
  exportAccountBlob,
  exportDatabaseBlob,
  fetchExportDocument,
  importDatabaseFile,
  parseLegacyJsonl,
  tablesInExport,
} from "./database"

/**
 * Whole-database export and import, after A4 moved them off IndexedDB.
 *
 * Two things carry real risk here.
 *
 * **Import used to be a no-op.** The old `dbWorker` wrote the file into
 * IndexedDB and `localStorage` and reloaded — it never reached the server, so
 * the next sync erased it. A2 found that; the assertion that matters is simply
 * that the parsed document is *posted*.
 *
 * **Existing backups are JSONL.** The worker streamed one
 * `{type:"store", storeName, data}` object per line, straight out of IndexedDB.
 * Every backup an operator already holds is in that shape, so dropping support
 * would quietly make their files unimportable — with the browser copy gone,
 * that file may be the only copy left.
 */

const doc = (data: Record<string, unknown>): ExportDocument => ({
  version: 2,
  timestamp: 1,
  data,
})

const file = (text: string) => ({ text: async () => text }) as unknown as File

describe("fetchExportDocument", () => {
  it("returns the whole document when nothing is selected", async () => {
    const full = doc({ channels: [1], posts: [2] })

    const out = await fetchExportDocument(undefined, async () => full as never)

    expect(out).toEqual(full)
  })

  it("treats an empty selection as everything", async () => {
    const full = doc({ channels: [1], posts: [2] })

    const out = await fetchExportDocument([], async () => full as never)

    expect(tablesInExport(out)).toEqual(["channels", "posts"])
  })

  it("keeps only the selected tables", async () => {
    const full = doc({ channels: [1], posts: [2], summaries: [3] })

    const out = await fetchExportDocument(
      ["channels", "summaries"],
      async () => full as never,
    )

    expect(tablesInExport(out)).toEqual(["channels", "summaries"])
    expect(out.data.posts).toBeUndefined()
  })

  it("preserves version and timestamp when filtering", async () => {
    const out = await fetchExportDocument(
      ["channels"],
      async () => doc({ channels: [1], posts: [2] }) as never,
    )

    expect(out.version).toBe(2)
    expect(out.timestamp).toBe(1)
  })

  it("keeps localStorage metadata regardless of the table selection", async () => {
    const out = await fetchExportDocument(
      ["channels"],
      async () => doc({ channels: [1], localStorage: { a: "b" } }) as never,
    )

    // It is metadata, not a table — filtering it out would silently drop the
    // settings half of a backup.
    expect(out.data.localStorage).toEqual({ a: "b" })
    expect(tablesInExport(out)).toEqual(["channels"])
  })

  it("serialises to a JSON blob", async () => {
    const blob = await exportDatabaseBlob(
      undefined,
      async () => doc({ channels: [1] }) as never,
    )

    expect(blob.type).toBe("application/json")
    expect(JSON.parse(await blob.text()).data.channels).toEqual([1])
  })
})

describe("exportAccountBlob", () => {
  it("passes the subject through and never parses the document", async () => {
    const asked: (string | undefined)[] = []
    const body = JSON.stringify(doc({ channels: [1], summaries: [2] }))

    const blob = await exportAccountBlob("user-7", async (subject) => {
      asked.push(subject)
      return new Blob([body], { type: "application/json" })
    })

    // The subject is the server's question, not a shape the browser narrows:
    // filtering here would mean the rows had already been sent. And the bytes
    // come back untouched — a whole account's export is the one document this
    // app must not hold three copies of.
    expect(asked).toEqual(["user-7"])
    expect(await blob.text()).toBe(body)
  })
})

describe("parseLegacyJsonl", () => {
  it("groups store lines by store name", () => {
    const text = [
      JSON.stringify({ type: "metadata", data: { localStorage: {} } }),
      JSON.stringify({
        type: "store",
        storeName: "channels",
        data: { id: "a" },
      }),
      JSON.stringify({
        type: "store",
        storeName: "channels",
        data: { id: "b" },
      }),
      JSON.stringify({ type: "store", storeName: "posts", data: { id: 1 } }),
    ].join("\n")

    expect(parseLegacyJsonl(text)).toEqual({
      version: 1,
      data: { channels: [{ id: "a" }, { id: "b" }], posts: [{ id: 1 }] },
    })
  })

  it("tolerates trailing and blank lines", () => {
    const text = `\n${JSON.stringify({ type: "store", storeName: "posts", data: 1 })}\n\n`

    expect(parseLegacyJsonl(text)?.data.posts).toEqual([1])
  })

  it("returns null for text that is not JSONL", () => {
    expect(parseLegacyJsonl("not json at all")).toBeNull()
  })

  it("skips store lines with no usable store name", () => {
    const text = [
      JSON.stringify({ type: "store", data: { id: 1 } }),
      JSON.stringify({ type: "store", storeName: 42, data: { id: 2 } }),
      JSON.stringify({ type: "store", storeName: "posts", data: { id: 3 } }),
    ].join("\n")

    // Without the `typeof storeName === "string"` guard these land under an
    // `"undefined"`/`"42"` key and get posted as tables the server rejects.
    expect(parseLegacyJsonl(text)).toEqual({
      version: 1,
      data: { posts: [{ id: 3 }] },
    })
  })

  it("returns null when there are no store lines", () => {
    // Metadata alone is not a restorable export.
    expect(
      parseLegacyJsonl(JSON.stringify({ type: "metadata", data: {} })),
    ).toBeNull()
  })
})

describe("importDatabaseFile", () => {
  it("posts a JSON export document to the server", async () => {
    let posted: unknown
    const result = await importDatabaseFile(
      file(JSON.stringify(doc({ channels: [{ id: "a" }] }))),
      async (payload) => {
        posted = payload
        return { imported: { channels: 1 } }
      },
    )

    // The assertion A2 exists for: it reaches the server at all.
    expect((posted as ExportDocument).data.channels).toEqual([{ id: "a" }])
    expect(result).toEqual({ channels: 1 })
  })

  it("accepts a legacy JSONL backup", async () => {
    let posted: unknown
    const text = [
      JSON.stringify({
        type: "store",
        storeName: "channels",
        data: { id: "a" },
      }),
      JSON.stringify({ type: "store", storeName: "posts", data: { id: 1 } }),
    ].join("\n")

    await importDatabaseFile(file(text), async (payload) => {
      posted = payload
      return { imported: { channels: 1, posts: 1 } }
    })

    expect((posted as ExportDocument).data).toEqual({
      channels: [{ id: "a" }],
      posts: [{ id: 1 }],
    })
  })

  it("accepts a legacy backup holding a single row", async () => {
    let posted: unknown
    // One line is valid JSON on its own, so it parses as a document and fails
    // the `data` check — the importer has to fall through to JSONL anyway.
    const text = JSON.stringify({
      type: "store",
      storeName: "posts",
      data: { id: 1 },
    })

    await importDatabaseFile(file(text), async (payload) => {
      posted = payload
      return { imported: { posts: 1 } }
    })

    expect((posted as ExportDocument).data.posts).toEqual([{ id: 1 }])
  })

  it("rejects a file that is neither shape, without posting", async () => {
    let called = false

    await expect(
      importDatabaseFile(file("hello, not a backup"), async () => {
        called = true
        return { imported: {} }
      }),
    ).rejects.toThrow(/not a database export/)

    expect(called).toBe(false)
  })

  it("rejects JSON that has no data object, without posting", async () => {
    let called = false

    await expect(
      importDatabaseFile(file(JSON.stringify({ version: 2 })), async () => {
        called = true
        return { imported: {} }
      }),
    ).rejects.toThrow(/not a database export/)

    expect(called).toBe(false)
  })
})
