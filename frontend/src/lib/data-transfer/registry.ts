import { toast } from "sonner"

import type { CommandDef } from "@/lib/commands/types"
import { copyTextToClipboard, joinCopyLines } from "./clipboard"
import { buildTimestampedFilename, writeJsonlToFile } from "./download"
import { channelEntityDef } from "./entities/channel"
import { postEntityDef } from "./entities/post"
import { summaryEntityDef } from "./entities/summary"
import {
  buildJsonlContent,
  JsonlParseError,
  parseJsonlFile,
  summarizeImportResult,
} from "./jsonl"
import type { DataEntityDef, DataEntityKind, ExportFilter } from "./types"
import { triggerJsonlFilePicker } from "./upload"

const FILTER_LABELS: Record<ExportFilter, string> = {
  all: "All",
  selected: "Selected",
  frozen: "Frozen",
}

function filterKeywords(filter: ExportFilter): string[] {
  switch (filter) {
    case "all":
      return ["all"]
    case "selected":
      return ["selected", "selection"]
    case "frozen":
      return ["frozen", "freeze"]
    default:
      return []
  }
}

function buildDisabledForImport(
  ctx: Parameters<NonNullable<CommandDef["disabled"]>>[0],
) {
  if (ctx.isOffline) {
    return { disabled: true, reason: "Import requires server connection" }
  }
  return { disabled: false }
}

function buildDisabledForSelected(
  ctx: Parameters<NonNullable<CommandDef["disabled"]>>[0],
) {
  if (ctx.selectedChannels.size === 0) {
    return { disabled: true, reason: "No channels selected" }
  }
  return { disabled: false }
}

function buildDisabledForFrozen(
  ctx: Parameters<NonNullable<CommandDef["disabled"]>>[0],
) {
  const frozenCount = ctx.channels.filter((channel) => channel.isFrozen).length
  if (frozenCount === 0) {
    return { disabled: true, reason: "No frozen channels" }
  }
  return { disabled: false }
}

function buildCopyExportDisabled(
  filter: ExportFilter,
  ctx: Parameters<NonNullable<CommandDef["disabled"]>>[0],
  requiresServer = false,
) {
  // Posts set this (A2). Channels and summaries can still be listed offline
  // because their offline source is React state, not a second data store; the
  // post export's offline source was the IndexedDB mirror, which is gone. Same
  // treatment `buildDisabledForImport` already gives every import command.
  if (requiresServer && ctx.isOffline) {
    return { disabled: true, reason: "Requires server connection" }
  }
  if (filter === "selected") return buildDisabledForSelected(ctx)
  if (filter === "frozen") return buildDisabledForFrozen(ctx)
  return { disabled: false }
}

function buildConfirmDescription(
  entityLabel: string,
  filter: ExportFilter,
): string {
  const filterLabel = FILTER_LABELS[filter].toLowerCase()
  return `Import ${filterLabel} ${entityLabel} from JSONL — existing records with matching ids will be updated (merge, not replace).`
}

export function buildDataCommandsForEntity<T extends DataEntityKind>(
  def: DataEntityDef<T>,
): CommandDef[] {
  const commands: CommandDef[] = []
  const entityKeywords = [def.entity, def.pluralLabel, def.singularLabel]

  for (const filter of def.filters) {
    const filterLabel = FILTER_LABELS[filter]
    const filterSlug = filter
    const sharedKeywords = [
      ...entityKeywords,
      ...filterKeywords(filter),
      "jsonl",
      "backup",
      "data",
    ]

    commands.push({
      id: `copy-${def.entity}s-${filterSlug}`,
      kind: "action",
      label: `Copy List of ${filterLabel} ${def.pluralLabel}`,
      keywords: ["copy", "clipboard", ...sharedKeywords],
      group: "Copy",
      disabled: (ctx) =>
        buildCopyExportDisabled(filter, ctx, def.requiresServer),
      run: async (ctx) => {
        const items = await def.listForFilter(filter, ctx)
        if (items.length === 0) {
          toast.info(`No ${def.pluralLabel.toLowerCase()} to copy`)
          return
        }
        const lines = items
          .map(def.toCopyLine)
          .sort((a, b) => a.localeCompare(b))
        const offlineHint = ctx.isOffline
          ? " (from local cache — may not include latest server data)"
          : ""
        await copyTextToClipboard(
          joinCopyLines(lines),
          `Copied ${items.length} ${def.pluralLabel.toLowerCase()}${offlineHint}`,
        )
      },
    })

    commands.push({
      id: `export-${def.entity}s-${filterSlug}`,
      kind: "action",
      label: `Export List of ${filterLabel} ${def.pluralLabel}`,
      keywords: ["export", "download", ...sharedKeywords],
      group: "Export",
      disabled: (ctx) =>
        buildCopyExportDisabled(filter, ctx, def.requiresServer),
      run: async (ctx) => {
        const items = await def.listForFilter(filter, ctx)
        if (items.length === 0) {
          toast.info(`No ${def.pluralLabel.toLowerCase()} to export`)
          return
        }
        const content = buildJsonlContent(def.entity, filter, items)
        const filename = buildTimestampedFilename(
          `telegram-summarizer-${def.entity}s-${filterSlug}`,
        )
        try {
          await writeJsonlToFile(content, filename)
          const offlineHint = ctx.isOffline ? " (from local cache)" : ""
          toast.success(
            `Exported ${items.length} ${def.pluralLabel.toLowerCase()}${offlineHint}`,
          )
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") return
          throw err
        }
      },
    })

    commands.push({
      id: `import-${def.entity}s-${filterSlug}`,
      kind: "action",
      label: `Import List of ${filterLabel} ${def.pluralLabel}`,
      keywords: ["import", "upload", ...sharedKeywords],
      group: "Import",
      requiresConfirmation: true,
      confirmDescription: buildConfirmDescription(
        def.pluralLabel.toLowerCase(),
        filter,
      ),
      disabled: (ctx) => {
        const offline = buildDisabledForImport(ctx)
        if (offline.disabled) return offline
        if (filter === "selected") return buildDisabledForSelected(ctx)
        return { disabled: false }
      },
      run: async (ctx) => {
        const file = await triggerJsonlFilePicker()
        if (!file) return

        let rawRecords: Awaited<ReturnType<typeof parseJsonlFile<T>>>["records"]
        try {
          ;({ records: rawRecords } = await parseJsonlFile(file, def.entity))
        } catch (error) {
          const message =
            error instanceof JsonlParseError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Invalid JSONL file"
          toast.error(message)
          return
        }

        const filtered = def.filterImportRecords(rawRecords, filter, ctx)
        const skipped = rawRecords.length - filtered.length

        if (filtered.length === 0) {
          toast.info(
            skipped > 0
              ? `No matching ${def.pluralLabel.toLowerCase()} in file (${skipped} skipped)`
              : `No ${def.pluralLabel.toLowerCase()} found in file`,
          )
          return
        }

        const result = await def.upsertRecords(filtered, filter, ctx)
        result.skipped = skipped
        toast.success(summarizeImportResult(result))
      },
    })
  }

  return commands
}

export function buildDataCommands(): CommandDef[] {
  return [
    ...buildDataCommandsForEntity(channelEntityDef),
    ...buildDataCommandsForEntity(postEntityDef),
    ...buildDataCommandsForEntity(summaryEntityDef),
  ]
}
