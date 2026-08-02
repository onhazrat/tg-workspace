import type { CommandContext } from "@/lib/commands/types"
import { listSummaries, saveSummary } from "@/lib/summaries/store"
import type { Summary } from "@/types"
import type { DataEntityDef, ExportFilter, ImportResult } from "../types"

export function filterSummariesSelected(
  summaries: Summary[],
  selectedChannels: Set<string>,
): Summary[] {
  return summaries.filter((summary) =>
    summary.channels.some((name) => selectedChannels.has(name)),
  )
}

export function applySummaryFilter(
  summaries: Summary[],
  filter: ExportFilter,
  ctx: CommandContext,
): Summary[] {
  if (filter === "selected") {
    return filterSummariesSelected(summaries, ctx.selectedChannels)
  }
  return summaries
}

export async function listSummariesForFilter(
  filter: ExportFilter,
  ctx: CommandContext,
): Promise<Summary[]> {
  const source = ctx.isOffline
    ? (ctx.summariesHistory ?? [])
    : await listSummaries()
  return applySummaryFilter(source, filter, ctx)
}

export function summaryToCopyLine(summary: Summary): string {
  return summary.id
}

export function filterSummaryImportRecords(
  records: Summary[],
  filter: ExportFilter,
  ctx: CommandContext,
): Summary[] {
  if (filter === "selected") {
    return filterSummariesSelected(records, ctx.selectedChannels)
  }
  return records
}

export async function upsertSummaryRecords(
  records: Summary[],
): Promise<ImportResult> {
  let imported = 0
  let failed = 0

  for (const record of records) {
    try {
      await saveSummary(record)
      imported++
    } catch {
      failed++
    }
  }

  return { imported, failed, skipped: 0 }
}

export const summaryEntityDef: DataEntityDef<"summary"> = {
  entity: "summary",
  singularLabel: "summary",
  pluralLabel: "Summaries",
  filters: ["all", "selected"],
  listForFilter: listSummariesForFilter,
  toCopyLine: summaryToCopyLine,
  filterImportRecords: filterSummaryImportRecords,
  upsertRecords: (records) => upsertSummaryRecords(records),
}
