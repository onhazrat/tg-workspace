import {
  DATA_TRANSFER_SCHEMA_VERSION,
  type DataEntityKind,
  ENTITY_STORE_MAP,
  type EntityRecordMap,
  type ExportFilter,
  type ImportResult,
  type JsonlHeader,
  type JsonlLine,
  type JsonlRecord,
  type LegacyStoreLine,
} from "./types"

export class JsonlParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "JsonlParseError"
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isLegacyStoreLine(line: unknown): line is LegacyStoreLine {
  return (
    isObject(line) &&
    line.type === "store" &&
    typeof line.storeName === "string" &&
    "data" in line
  )
}

function isJsonlHeader(line: unknown): line is JsonlHeader {
  return (
    isObject(line) &&
    line.type === "header" &&
    typeof line.entity === "string" &&
    typeof line.schemaVersion === "number" &&
    typeof line.exportedAt === "number" &&
    typeof line.filter === "string"
  )
}

function isJsonlRecord(line: unknown): line is JsonlRecord {
  return (
    isObject(line) &&
    line.type === "record" &&
    typeof line.entity === "string" &&
    "data" in line
  )
}

export function buildJsonlContent<T extends DataEntityKind>(
  entity: T,
  filter: ExportFilter,
  records: EntityRecordMap[T][],
): string {
  const header: JsonlHeader = {
    type: "header",
    entity,
    schemaVersion: DATA_TRANSFER_SCHEMA_VERSION,
    exportedAt: Date.now(),
    filter,
  }
  const lines = [
    JSON.stringify(header),
    ...records.map((data) =>
      JSON.stringify({ type: "record", entity, data } satisfies JsonlRecord),
    ),
  ]
  return `${lines.join("\n")}\n`
}

export function parseJsonlText(text: string): JsonlLine[] {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new JsonlParseError("File is empty")
  }

  if (trimmed.startsWith("[")) {
    throw new JsonlParseError(
      "JSON array files are not supported — use JSONL (one JSON object per line)",
    )
  }

  const lines = trimmed.split(/\r?\n/)
  const parsed: JsonlLine[] = []

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (!raw) continue

    let line: unknown
    try {
      line = JSON.parse(raw)
    } catch {
      throw new JsonlParseError(`Invalid JSON on line ${i + 1}`)
    }

    if (
      !isJsonlHeader(line) &&
      !isJsonlRecord(line) &&
      !isLegacyStoreLine(line)
    ) {
      throw new JsonlParseError(`Unrecognized line format on line ${i + 1}`)
    }

    parsed.push(line)
  }

  if (parsed.length === 0) {
    throw new JsonlParseError("No valid JSONL lines found")
  }

  return parsed
}

export function extractRecordsForEntity<T extends DataEntityKind>(
  entity: T,
  lines: JsonlLine[],
): { header: JsonlHeader | null; records: EntityRecordMap[T][] } {
  const header = lines.find(isJsonlHeader) ?? null
  const records: EntityRecordMap[T][] = []

  for (const line of lines) {
    if (isJsonlRecord(line)) {
      if (line.entity !== entity) continue
      records.push(line.data as EntityRecordMap[T])
      continue
    }

    if (isLegacyStoreLine(line)) {
      const expectedStore = ENTITY_STORE_MAP[entity]
      if (line.storeName !== expectedStore) continue
      records.push(line.data as EntityRecordMap[T])
    }
  }

  if (records.length === 0 && !header) {
    throw new JsonlParseError(
      `No ${entity} records found — expected entity JSONL or legacy store lines for "${ENTITY_STORE_MAP[entity]}"`,
    )
  }

  return { header, records }
}

export async function parseJsonlFile<T extends DataEntityKind>(
  file: File,
  entity: T,
): Promise<{ header: JsonlHeader | null; records: EntityRecordMap[T][] }> {
  const text = await file.text()
  const lines = parseJsonlText(text)
  return extractRecordsForEntity(entity, lines)
}

export function summarizeImportResult(result: ImportResult): string {
  const parts = [`Imported ${result.imported}`]
  if (result.skipped > 0) parts.push(`skipped ${result.skipped}`)
  if (result.failed > 0) parts.push(`failed ${result.failed}`)
  return parts.join(", ")
}
