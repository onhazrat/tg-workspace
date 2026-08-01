import type { CommandContext } from "@/lib/commands/types"
import type { Channel, Post, Summary } from "@/types"

export const DATA_TRANSFER_SCHEMA_VERSION = 1

export type DataEntityKind = "channel" | "post" | "summary"

export type ExportFilter = "all" | "selected" | "frozen"

export interface JsonlHeader {
  type: "header"
  entity: DataEntityKind
  schemaVersion: number
  exportedAt: number
  filter: ExportFilter
}

export interface JsonlRecord<T = unknown> {
  type: "record"
  entity: DataEntityKind
  data: T
}

export interface LegacyStoreLine {
  type: "store"
  storeName: string
  data: unknown
}

export type JsonlLine<T = unknown> =
  | JsonlHeader
  | JsonlRecord<T>
  | LegacyStoreLine

export const ENTITY_STORE_MAP: Record<DataEntityKind, string> = {
  channel: "channels",
  post: "posts",
  summary: "summaries",
}

export type EntityRecordMap = {
  channel: Channel
  post: Post
  summary: Summary
}

export interface ImportResult {
  imported: number
  failed: number
  skipped: number
}

export interface DataEntityDef<T extends DataEntityKind> {
  entity: T
  singularLabel: string
  pluralLabel: string
  /** Which export/import/copy filters apply (channels include frozen). */
  filters: ExportFilter[]
  /**
   * Whether copy/export need the server (A2).
   *
   * Only posts do. Channels and summaries fall back to React state when
   * offline, which is a view of server data rather than a second store; posts
   * used to fall back to the IndexedDB mirror, and that reader is gone.
   */
  requiresServer?: boolean
  listForFilter: (
    filter: ExportFilter,
    ctx: CommandContext,
  ) => Promise<EntityRecordMap[T][]>
  toCopyLine: (item: EntityRecordMap[T]) => string
  filterImportRecords: (
    records: EntityRecordMap[T][],
    filter: ExportFilter,
    ctx: CommandContext,
  ) => EntityRecordMap[T][]
  upsertRecords: (
    records: EntityRecordMap[T][],
    filter: ExportFilter,
    ctx: CommandContext,
  ) => Promise<ImportResult>
}
