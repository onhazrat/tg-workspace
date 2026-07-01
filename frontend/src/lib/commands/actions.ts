import { toast } from "sonner"

import { api } from "@/api"
import { getNextTheme } from "@/components/theme-provider"
import { clearAllData, exportDBMetadata, getTableSizes } from "@/lib/cache"
import type { CommandDef } from "@/lib/commands/types"
import {
  buildTimestampedFilename,
  downloadBlob,
  pickSaveFile,
} from "@/lib/data-transfer/download"
import { triggerJsonlFilePicker } from "@/lib/data-transfer/upload"

async function runDatabaseExport(): Promise<void> {
  let fileHandle: FileSystemFileHandle | undefined
  let useOPFS = false

  try {
    const saveResult = await pickSaveFile(
      buildTimestampedFilename("telegram-summarizer-db"),
    )
    fileHandle = saveResult.fileHandle
    useOPFS = saveResult.useBlobFallback
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") return
    useOPFS = true
  }

  const metadata = await exportDBMetadata()
  const sizes = await getTableSizes()
  const selectedTables = sizes.map((entry) => entry.name)

  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(
      new URL("../../workers/dbWorker.ts", import.meta.url),
      { type: "module" },
    )

    worker.onmessage = (event) => {
      if (event.data.type === "PROGRESS") {
        toast.info(event.data.message, { id: "export-progress" })
        return
      }
      if (event.data.type === "SUCCESS") {
        if (event.data.file) {
          downloadBlob(
            event.data.file,
            buildTimestampedFilename("telegram-summarizer-db"),
          )
        }
        toast.success("Database exported successfully", {
          id: "export-progress",
        })
        worker.terminate()
        resolve()
        return
      }
      if (event.data.type === "ERROR") {
        toast.error(`Export failed: ${event.data.error}`, {
          id: "export-progress",
        })
        worker.terminate()
        reject(new Error(event.data.error))
      }
    }

    worker.postMessage({
      type: "EXPORT",
      fileHandle,
      useOPFS,
      metadata,
      selectedTables,
    })
  })
}

async function runDatabaseImport(file: File): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(
      new URL("../../workers/dbWorker.ts", import.meta.url),
      { type: "module" },
    )

    worker.onmessage = (event) => {
      if (event.data.type === "PROGRESS") {
        toast.info(event.data.message, { id: "import-progress" })
        return
      }
      if (event.data.type === "METADATA") {
        const meta = event.data.data
        if (meta?.localStorage) {
          localStorage.clear()
          for (const [key, value] of Object.entries(meta.localStorage)) {
            localStorage.setItem(key, value as string)
          }
        }
        return
      }
      if (event.data.type === "SUCCESS") {
        toast.success(event.data.message, { id: "import-progress" })
        worker.terminate()
        resolve()
        return
      }
      if (event.data.type === "ERROR") {
        toast.error(`Import failed: ${event.data.error}`, {
          id: "import-progress",
        })
        worker.terminate()
        reject(new Error(event.data.error))
      }
    }

    worker.postMessage({ type: "IMPORT", file, clear: true })
  })

  setTimeout(() => {
    window.location.reload()
  }, 1500)
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
        const active = ctx.channels.filter(
          (channel) =>
            ctx.selectedChannels.has(channel.name) && !channel.isFrozen,
        )
        if (active.length === 0) {
          return { disabled: true, reason: "Selected channels are frozen" }
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
        const active = ctx.channels.filter((channel) => !channel.isFrozen)
        if (active.length === 0) {
          return { disabled: true, reason: "All channels are frozen" }
        }
        return { disabled: false }
      },
      run: async (ctx) => {
        await ctx.handleScrapeAll()
      },
    },
    {
      id: "clear-cache",
      kind: "action",
      label: "Clear Cache",
      keywords: ["clear", "cache", "data", "wipe", "indexeddb"],
      group: "Data",
      requiresConfirmation: true,
      confirmDescription:
        "This clears all local IndexedDB tables and localStorage. Server data is untouched.",
      run: async () => {
        await clearAllData()
        toast.success("Local cache cleared")
        window.location.reload()
      },
    },
    {
      id: "export-database",
      kind: "action",
      label: "Export Database",
      keywords: ["export", "database", "backup", "jsonl", "download"],
      group: "Data",
      requiresConfirmation: true,
      confirmDescription:
        "Export all local database tables to a JSONL file on disk.",
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
        "Import a JSONL backup file. This replaces local IndexedDB data and reloads the app.",
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
