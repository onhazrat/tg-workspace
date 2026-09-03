import { api } from "@/api"

/**
 * Whole-database export and import, against PostgreSQL.
 *
 * ## What A4 changed, and why it was a bug
 *
 * These used to run in `workers/dbWorker.ts` against IndexedDB. Export produced
 * a dump of the *browser mirror*, and import wrote the file back into
 * IndexedDB and `localStorage` and then reloaded the page — **it never reached
 * the server**. So "Import DB" silently did nothing durable: the next sync
 * overwrote whatever it had written. A2 found this; A4 fixes it.
 *
 * Both now go through `GET /data/export` and `POST /data/import`, which is the
 * same document shape the worker produced (`{version, timestamp, data}`), so
 * **existing backup files still import**.
 *
 * ## Why the table filter is applied client-side
 *
 * `GET /data/export` streams the whole corpus and takes no table filter.
 * Rather than add one server-side — and lose streaming, or grow the endpoint
 * for a UI affordance — the selection is applied to the downloaded document.
 * The transfer is larger than strictly needed for a partial export, which is a
 * fair trade to keep the export path a single, always-complete, streamed read.
 *
 * ## The subject is not a filter, and is not applied here
 *
 * Ticket 28 gave the endpoint a `subject`, and it stays server-side for the
 * reason the table selection does not: which account a document is about is an
 * authorisation question, and narrowing it in the browser would mean the
 * server had already sent the rows.
 */

export interface ExportDocument {
  version?: number
  timestamp?: number
  data: Record<string, unknown>
}

/** `data` keys that are metadata rather than exportable tables. */
const NON_TABLE_KEYS = new Set(["localStorage"])

/**
 * Fetch the export, optionally narrowed to `selectedTables`.
 *
 * An empty or omitted selection means everything — the same thing the worker
 * did when no checkbox was ticked.
 */
export async function fetchExportDocument(
  selectedTables?: readonly string[],
  fetchExport: (
    subject?: string,
  ) => Promise<Record<string, unknown>> = api.exportData,
): Promise<ExportDocument> {
  const doc = (await fetchExport()) as unknown as ExportDocument
  if (!selectedTables || selectedTables.length === 0) return doc

  const keep = new Set(selectedTables)
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc.data ?? {})) {
    if (keep.has(key) || NON_TABLE_KEYS.has(key)) data[key] = value
  }
  return { ...doc, data }
}

/** The export as a downloadable blob. */
export async function exportDatabaseBlob(
  selectedTables?: readonly string[],
  fetchExport?: () => Promise<Record<string, unknown>>,
): Promise<Blob> {
  const doc = await fetchExportDocument(selectedTables, fetchExport)
  return new Blob([JSON.stringify(doc)], { type: "application/json" })
}

/**
 * One account's whole export as a downloadable blob (ticket 28).
 *
 * No table selection: this is the Admin answering "give me everything about
 * this person", and a partial answer to that is a worse artifact than a large
 * one. `subject` is a user id, or the literal `"all"`.
 *
 * Takes the response as a Blob rather than parsing it. `exportDatabaseBlob`
 * above has to parse, because it filters the document by table; this one never
 * looks inside, and parsing a whole account's export only to serialise it again
 * holds it two or three times over in the tab — for a payload the server
 * streams precisely so that it never holds it once.
 */
export async function exportAccountBlob(
  subject: string,
  fetchExport: (subject?: string) => Promise<Blob> = api.exportDataBlob,
): Promise<Blob> {
  return fetchExport(subject)
}

/** Table names present in an export, in document order. */
export function tablesInExport(doc: ExportDocument): string[] {
  return Object.keys(doc.data ?? {}).filter((k) => !NON_TABLE_KEYS.has(k))
}

/**
 * Parse a legacy worker export.
 *
 * `workers/dbWorker.ts` wrote **JSONL**: one `{type:"metadata"|"store", …}`
 * object per line, a row at a time, because it streamed straight out of
 * IndexedDB. Any backup an operator already has is in that shape, so A4 must
 * keep reading it even though nothing writes it any more. Returns `null` when
 * the text is not JSONL, so the caller can fall through to the JSON document
 * form.
 */
export function parseLegacyJsonl(text: string): ExportDocument | null {
  const data: Record<string, unknown[]> = {}
  let sawStoreLine = false

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let record: { type?: string; storeName?: string; data?: unknown }
    try {
      record = JSON.parse(trimmed)
    } catch {
      return null
    }
    if (record.type === "store" && typeof record.storeName === "string") {
      sawStoreLine = true
      ;(data[record.storeName] ??= []).push(record.data)
    }
    // `{type:"metadata"}` carried localStorage and a schema version. Neither
    // belongs on the server, so it is read and dropped.
  }

  return sawStoreLine ? { version: 1, data } : null
}

/**
 * Import a previously exported file into PostgreSQL.
 *
 * Accepts both shapes: the JSON document `GET /data/export` produces, and the
 * **legacy JSONL** the old IndexedDB worker wrote. Returns the server's
 * per-table counts, and throws on a file that is neither rather than posting
 * something the server rejects with a less legible error.
 */
export async function importDatabaseFile(
  file: File,
  post: typeof api.importData = api.importData,
): Promise<Record<string, number>> {
  const text = await file.text()

  let doc: ExportDocument | null = null
  try {
    const parsed: unknown = JSON.parse(text)
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as ExportDocument).data === "object" &&
      (parsed as ExportDocument).data !== null &&
      // A legacy JSONL *line* also has an object `data`, so `data` alone does
      // not identify a document. The `type` discriminator does: a document has
      // none, a legacy line is always `"store"` or `"metadata"`. Without this a
      // single-row backup imports as a document whose one "table" is that row's
      // fields.
      !("type" in parsed)
    ) {
      doc = parsed as ExportDocument
    }
  } catch {
    /* not a single JSON document — fall through to JSONL below */
  }

  // Also fall through when the file *parsed* but is not a document: a legacy
  // export holding a single row is one valid JSON object per file, so it parses
  // cleanly and is rejected above.
  doc ??= parseLegacyJsonl(text)

  if (!doc) {
    throw new Error(
      "That file is not a database export — expected a JSON document with a " +
        "`data` object, or the older line-per-row JSONL format.",
    )
  }

  const result = await post(doc as unknown as Record<string, unknown>)
  return result.imported
}
