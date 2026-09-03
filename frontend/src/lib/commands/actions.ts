import { toast } from "sonner"

import { api } from "@/api"
import { getNextTheme } from "@/components/theme-provider"
import { filterChannelsForOperation } from "@/lib/channels/sync-permissions"
import type { CommandDef } from "@/lib/commands/types"
import {
  exportDatabaseBlob,
  importDatabaseFile,
} from "@/lib/data-transfer/database"
import {
  buildTimestampedFilename,
  downloadBlob,
} from "@/lib/data-transfer/download"
import { triggerJsonlFilePicker } from "@/lib/data-transfer/upload"

/**
 * Whole-database export, to the server's streamed export.
 *
 * This ran in `workers/dbWorker.ts` against IndexedDB until A4. The command
 * exports everything — the per-table selection lives in the Data settings
 * panel, which is where the table list is visible.
 */
async function runDatabaseExport(): Promise<void> {
  toast.info("Exporting database…", { id: "export-progress" })
  try {
    const blob = await exportDatabaseBlob()
    downloadBlob(blob, buildTimestampedFilename("telegram-summarizer-db"))
    toast.success("Database exported", { id: "export-progress" })
  } catch (err: unknown) {
    toast.error(
      `Export failed: ${err instanceof Error ? err.message : String(err)}`,
      { id: "export-progress" },
    )
  }
}

/** Whole-database import, to `POST /data/import`. Reads legacy JSONL too. */
async function runDatabaseImport(file: File): Promise<void> {
  toast.info("Importing database…", { id: "import-progress" })
  try {
    const imported = await importDatabaseFile(file)
    const summary = Object.entries(imported)
      .map(([table, count]) => `${table}: ${count}`)
      .join(", ")
    toast.success(`Import complete (${summary || "no records"})`, {
      id: "import-progress",
    })
  } catch (err: unknown) {
    toast.error(
      `Import failed: ${err instanceof Error ? err.message : String(err)}`,
      { id: "import-progress" },
    )
  }
}

export function buildActionCommands(): CommandDef[] {
  return [
    {
      id: "toggle-theme",
      kind: "action",
      label: "Toggle Theme",
      keywords: ["theme", "dark", "light", "appearance", "mode"],
      group: "Actions",
      run: (ctx) => {
        ctx.settings.setTheme(getNextTheme(ctx.settings.theme))
      },
    },
    {
      id: "start-guided-tour",
      kind: "action",
      label: "Start Guided Tour",
      keywords: ["tour", "help", "onboarding", "guide"],
      group: "Actions",
      run: (ctx) => {
        ctx.startTour()
      },
    },
    {
      id: "resume-auto-sync",
      kind: "action",
      label: "Resume Auto-Sync",
      keywords: ["auto-sync", "resume", "pause", "sync"],
      group: "Actions",
      when: (ctx) =>
        Boolean(ctx.autoSyncPauseUntil && Date.now() < ctx.autoSyncPauseUntil),
      run: async (ctx) => {
        await api.putSetting("sync", {
          autoSyncPauseUntil: null,
          consecutiveFailures: 0,
        })
        ctx.setAutoSyncPauseUntil(null)
        toast.success("Auto-sync resumed")
      },
    },
    {
      id: "sync-selected",
      kind: "action",
      label: "Sync Selected",
      keywords: ["sync", "scrape", "selected", "channels"],
      group: "Sync",
      disabled: (ctx) => {
        if (ctx.isOffline) {
          return { disabled: true, reason: "Server offline" }
        }
        if (ctx.selectedChannels.size === 0) {
          return { disabled: true, reason: "No channels selected" }
        }
        const active = filterChannelsForOperation(
          ctx.channels.filter((channel) =>
            ctx.selectedChannels.has(channel.name),
          ),
          "bulk",
        )
        if (active.length === 0) {
          return {
            disabled: true,
            reason: "No selected channels eligible for bulk sync",
          }
        }
        return { disabled: false }
      },
      run: async (ctx) => {
        await ctx.handleScrapeSelected()
      },
    },
    {
      id: "sync-all",
      kind: "action",
      label: "Sync All",
      keywords: ["sync", "scrape", "all", "channels"],
      group: "Sync",
      disabled: (ctx) => {
        if (ctx.isOffline) {
          return { disabled: true, reason: "Server offline" }
        }
        if (ctx.channels.length === 0) {
          return { disabled: true, reason: "No channels added" }
        }
        const active = filterChannelsForOperation(ctx.channels, "sync_all")
        if (active.length === 0) {
          return {
            disabled: true,
            reason: "No channels eligible for Sync All",
          }
        }
        return { disabled: false }
      },
      run: async (ctx) => {
        await ctx.handleScrapeAll()
      },
    },
    {
      id: "recheck-restricted-channels",
      kind: "action",
      label: "Recheck Restricted Channels",
      keywords: ["sync", "recheck", "restricted", "unavailable", "channels"],
      group: "Sync",
      disabled: (ctx) => {
        if (ctx.isOffline) {
          return { disabled: true, reason: "Server offline" }
        }
        if (!ctx.channels.some((channel) => channel.isUnavailableOnWebView)) {
          return { disabled: true, reason: "No restricted channels" }
        }
        return { disabled: false }
      },
      run: async (ctx) => {
        await ctx.handleRecheckRestricted()
      },
    },
    {
      id: "export-database",
      kind: "action",
      label: "Export Database",
      keywords: ["export", "database", "backup", "jsonl", "download"],
      group: "Data",
      requiresConfirmation: true,
      // Ticket 28: this asks for the caller's own rows, not the deployment's.
      // The old copy said "the server database" and was true when there was
      // one account; an Admin exporting somebody else does it from the user
      // menu, and everybody's at once is a deliberate `subject=all` call.
      confirmDescription: "Download a full backup of your own data.",
      run: async () => {
        await runDatabaseExport()
      },
    },
    {
      id: "import-database",
      kind: "action",
      label: "Import Database",
      keywords: ["import", "database", "restore", "jsonl", "upload"],
      group: "Data",
      requiresConfirmation: true,
      confirmDescription:
        "Upload a backup file into the server database. Matching records are updated.",
      run: async () => {
        const file = await triggerJsonlFilePicker()
        if (!file) return
        await runDatabaseImport(file)
      },
    },
    {
      id: "assistant-stub",
      kind: "assistant",
      label: "Natural Language Commands",
      keywords: ["assistant", "natural language", "ai", "nl"],
      group: "Assistant",
      run: (ctx) => {
        ctx.palette.pushMode("assistant")
      },
    },
  ]
}
