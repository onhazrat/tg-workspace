import { JOB_LABELS, SERVER_JOB_IDS } from "@/hooks/useJobToggles"
import type {
  CommandContext,
  CommandDef,
  CommandSettingsSlice,
} from "@/lib/commands/types"
import { SETTINGS_CATALOG } from "@/lib/settings/catalog"
import type { SettingCatalogEntry } from "@/lib/settings/catalog-types"

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-")
}

function clampInt(value: string, min: number, max?: number): number | null {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < min) return null
  if (max !== undefined) return Math.min(max, parsed)
  return parsed
}

function clampFloat(value: string, min: number, max: number): number | null {
  const parsed = Number.parseFloat(value)
  if (Number.isNaN(parsed)) return null
  return Math.min(max, Math.max(min, parsed))
}

type SliceKey = keyof CommandSettingsSlice

function sliceGetter(
  key: SliceKey,
): (settings: CommandSettingsSlice) => unknown {
  return (settings) => settings[key]
}

function booleanSetter(
  key: SliceKey,
): (settings: CommandSettingsSlice, value: boolean) => void {
  return (settings, value) => {
    const setterName =
      `set${key.charAt(0).toUpperCase()}${key.slice(1)}` as keyof CommandSettingsSlice
    const setter = settings[setterName]
    if (typeof setter === "function") {
      ;(setter as (v: boolean) => void)(value)
    }
  }
}

function numberSetter(
  key: SliceKey,
): (settings: CommandSettingsSlice, value: number) => void {
  return (settings, value) => {
    const setterName =
      `set${key.charAt(0).toUpperCase()}${key.slice(1)}` as keyof CommandSettingsSlice
    const setter = settings[setterName]
    if (typeof setter === "function") {
      ;(setter as (v: number) => void)(value)
    }
  }
}

function stringSetter(
  key: SliceKey,
): (settings: CommandSettingsSlice, value: string) => void {
  return (settings, value) => {
    const setterName =
      `set${key.charAt(0).toUpperCase()}${key.slice(1)}` as keyof CommandSettingsSlice
    const setter = settings[setterName]
    if (typeof setter === "function") {
      ;(setter as (v: string) => void)(value)
    }
  }
}

function entrySliceKey(entry: SettingCatalogEntry): SliceKey {
  return (entry.sliceKey ?? entry.id) as SliceKey
}

/** @deprecated Prefer catalog — kept for tests that assert boolean defs exist. */
export const BOOLEAN_SETTINGS = SETTINGS_CATALOG.filter(
  (e) =>
    e.control.kind === "boolean" &&
    e.control.commandSlug !== "__embeddings_feature__",
).map((e) => ({
  key: entrySliceKey(e),
  label: e.label,
  keywords: e.keywords,
}))

/** @deprecated Prefer catalog — kept for tests that assert numeric editor defs. */
export const NUMERIC_EDITOR_DEFS = SETTINGS_CATALOG.filter(
  (e) => e.control.kind === "number" && e.editorCommandId,
).map((e) => ({
  id: e.editorCommandId as string,
  label: `Edit ${e.label}`,
  keywords: e.keywords,
  fieldId: e.editorFieldId ?? e.id,
  fieldLabel: e.editorFieldLabel ?? e.label,
  min: e.control.kind === "number" ? e.control.min : undefined,
  max: e.control.kind === "number" ? e.control.max : undefined,
  step: e.control.kind === "number" ? e.control.step : undefined,
  integer: e.control.kind === "number" ? e.control.integer : undefined,
}))

function buildBooleanCommands(): CommandDef[] {
  const commands: CommandDef[] = []

  for (const entry of SETTINGS_CATALOG) {
    if (entry.control.kind !== "boolean") continue
    if (entry.control.commandSlug === "__embeddings_feature__") continue

    const slug = entry.control.commandSlug
    const key = entrySliceKey(entry)
    const getter = (s: CommandSettingsSlice) => Boolean(sliceGetter(key)(s))
    const setter = booleanSetter(key)
    const baseKeywords = [
      entry.label,
      ...entry.keywords,
      "toggle",
      "enable",
      "disable",
      "setting",
    ]

    commands.push(
      {
        id: `toggle-${slug}`,
        kind: "boolean",
        label: `Toggle ${entry.label}`,
        keywords: [...baseKeywords, "toggle"],
        group: "Settings",
        getBadge: (ctx) => (getter(ctx.settings) ? "ON" : "OFF"),
        run: (ctx) => setter(ctx.settings, !getter(ctx.settings)),
      },
      {
        id: `enable-${slug}`,
        kind: "boolean",
        label: `Enable ${entry.label}`,
        keywords: [...baseKeywords, "enable", "on"],
        group: "Settings",
        getBadge: (ctx) => (getter(ctx.settings) ? "ON" : "OFF"),
        run: (ctx) => setter(ctx.settings, true),
      },
      {
        id: `disable-${slug}`,
        kind: "boolean",
        label: `Disable ${entry.label}`,
        keywords: [...baseKeywords, "disable", "off"],
        group: "Settings",
        getBadge: (ctx) => (getter(ctx.settings) ? "ON" : "OFF"),
        run: (ctx) => setter(ctx.settings, false),
      },
    )
  }

  return commands
}

function buildNumericEditorCommands(): CommandDef[] {
  return SETTINGS_CATALOG.filter(
    (e) => e.control.kind === "number" && e.editorCommandId,
  ).map((entry) => {
    const control = entry.control
    if (control.kind !== "number") throw new Error("unreachable")
    const key = entrySliceKey(entry)
    const getter = (s: CommandSettingsSlice) => Number(sliceGetter(key)(s))
    const setter = numberSetter(key)
    const formatBadge = control.formatBadge ?? ((v: number) => String(v))

    return {
      id: entry.editorCommandId as string,
      kind: "editor" as const,
      label: `Edit ${entry.label}`,
      keywords: entry.keywords,
      group: "Settings",
      getBadge: (ctx: CommandContext) => formatBadge(getter(ctx.settings)),
      editorField: {
        id: entry.editorFieldId ?? entry.id,
        label: entry.editorFieldLabel ?? entry.label,
        type: "number" as const,
        min: control.min,
        max: control.max,
        step: control.step,
        integer: control.integer,
        getValue: (ctx: CommandContext) => getter(ctx.settings),
        apply: (_ctx: CommandContext, value: string) => {
          if (control.step === "any") {
            const parsed = clampFloat(value, control.min ?? 0, control.max ?? 1)
            if (parsed !== null) setter(_ctx.settings, parsed)
            return
          }
          const parsed = clampInt(value, control.min ?? 0, control.max)
          if (parsed !== null) setter(_ctx.settings, parsed)
        },
      },
      run: () => {},
    }
  })
}

function buildEnumCommands(): CommandDef[] {
  const commands: CommandDef[] = []

  for (const entry of SETTINGS_CATALOG) {
    if (entry.control.kind !== "enum") continue
    const key = entrySliceKey(entry)
    const { commandPrefix, options } = entry.control

    for (const option of options) {
      const optionSlug = slugify(option.value)
      commands.push({
        id: `set-${commandPrefix}-${optionSlug}`,
        kind: "enum",
        label: `Set ${entry.label} → ${option.label}`,
        keywords: [...entry.keywords, option.value, option.label],
        group: "Settings",
        run: (ctx) => {
          // Theme uses setTheme; others use set{Key}
          if (key === "theme") {
            ctx.settings.setTheme(option.value as "light" | "dark" | "system")
            return
          }
          stringSetter(key)(ctx.settings, option.value)
        },
      })
    }
  }

  // Historical label: "Set Default Channel Start Time Mode → …"
  // Rebuild those exact labels for start-time mode.
  const startMode = commands.filter((c) =>
    c.id.startsWith("set-global-start-time-mode-"),
  )
  for (const cmd of startMode) {
    const mode = cmd.id.replace("set-global-start-time-mode-", "")
    cmd.label = `Set Default Channel Start Time Mode → ${mode}`
  }

  // Historical: "Set Theme → Light|Dark|System" (capitalized)
  for (const cmd of commands.filter((c) => c.id.startsWith("set-theme-"))) {
    const theme = cmd.id.replace("set-theme-", "")
    cmd.label = `Set Theme → ${
      theme === "light" ? "Light" : theme === "dark" ? "Dark" : "System"
    }`
  }

  // Historical: "Set AI Model → …" / "Set Translation Model → …"
  for (const cmd of commands.filter((c) =>
    c.id.startsWith("set-selected-model-"),
  )) {
    const opt = SETTINGS_CATALOG.find((e) => e.id === "selectedModel")?.control
    if (opt?.kind === "enum") {
      const value = cmd.id.replace("set-selected-model-", "")
      const match = opt.options.find((o) => slugify(o.value) === value)
      if (match) cmd.label = `Set AI Model → ${match.label}`
    }
  }

  return commands
}

function buildEditorCommands(): CommandDef[] {
  const editors: CommandDef[] = [...buildNumericEditorCommands()]

  for (const entry of SETTINGS_CATALOG) {
    if (entry.control.kind === "days") {
      editors.push({
        id: entry.control.commandId,
        kind: "editor",
        label: `Edit ${entry.label}`,
        keywords: entry.keywords,
        group: "Settings",
        getBadge: (ctx) => {
          if (ctx.settings.globalStartTimeMode === "absolute") {
            const raw = ctx.settings.globalStartTimeValue
            if (typeof raw === "string") return raw.slice(0, 10)
            return new Date().toISOString().slice(0, 10)
          }
          const days =
            typeof ctx.settings.globalStartTimeValue === "number"
              ? ctx.settings.globalStartTimeValue
              : 7
          return `${days}d`
        },
        editorField: {
          id: entry.control.fieldId,
          label: entry.label,
          type: "days",
          min: 1,
          getValue: (ctx) => {
            if (ctx.settings.globalStartTimeMode === "absolute") {
              const raw = ctx.settings.globalStartTimeValue
              if (typeof raw === "string") return raw.slice(0, 16)
              return new Date().toISOString().slice(0, 16)
            }
            const days =
              typeof ctx.settings.globalStartTimeValue === "number"
                ? ctx.settings.globalStartTimeValue
                : 7
            return days
          },
          apply: (ctx, value) => {
            if (ctx.settings.globalStartTimeMode === "absolute") {
              ctx.settings.setGlobalStartTimeValue(
                new Date(value).toISOString(),
              )
              return
            }
            const parsed = Number.parseInt(value, 10)
            if (!Number.isNaN(parsed) && parsed > 0) {
              ctx.settings.setGlobalStartTimeValue(parsed)
            }
          },
        },
        run: () => {},
      })
    }

    if (entry.control.kind === "textarea") {
      const key = entrySliceKey(entry)
      const isOverrides = entry.id === "proxyConcurrencyOverrides"
      editors.push({
        id: entry.control.commandId,
        kind: "editor",
        label: `Edit ${entry.label}`,
        keywords: entry.keywords,
        group: "Settings",
        editorField: {
          id: entry.control.fieldId,
          label: isOverrides
            ? "Proxy Concurrency Overrides (JSON)"
            : entry.label,
          type: "textarea",
          getValue: (ctx) => {
            if (isOverrides) {
              return JSON.stringify(
                ctx.settings.proxyConcurrencyOverrides,
                null,
                2,
              )
            }
            return String(sliceGetter(key)(ctx.settings) ?? "")
          },
          apply: (ctx, value) => {
            if (isOverrides) {
              try {
                const parsed = JSON.parse(value) as Record<string, number>
                ctx.settings.setProxyConcurrencyOverrides(parsed)
              } catch {
                // ignore invalid JSON
              }
              return
            }
            stringSetter(key)(ctx.settings, value)
          },
        },
        run: () => {},
      })
    }
  }

  return editors
}

function buildEmbeddingsCommands(): CommandDef[] {
  return [
    {
      id: "enable-embeddings-feature",
      kind: "boolean",
      label: "Enable Embeddings Feature",
      keywords: ["embeddings", "feature", "rag", "ai", "enable"],
      group: "Jobs",
      getBadge: (ctx) => (ctx.settings.embeddingsEnabled ? "ON" : "OFF"),
      run: (ctx) => ctx.settings.setEmbeddingsEnabled(true),
    },
    {
      id: "disable-embeddings-feature",
      kind: "boolean",
      label: "Disable Embeddings Feature",
      keywords: ["embeddings", "feature", "rag", "ai", "disable"],
      group: "Jobs",
      getBadge: (ctx) => (ctx.settings.embeddingsEnabled ? "ON" : "OFF"),
      run: (ctx) => ctx.settings.setEmbeddingsEnabled(false),
    },
    {
      id: "enable-embeddings-background-job",
      kind: "boolean",
      label: "Enable Embeddings Background Job",
      keywords: ["embeddings", "background", "job", "scheduler", "enable"],
      group: "Jobs",
      getBadge: (ctx) =>
        ctx.jobToggles.isJobEnabled("embeddings") ? "ON" : "OFF",
      run: async (ctx) => {
        await ctx.jobToggles.toggleJob("embeddings", true)
      },
    },
    {
      id: "disable-embeddings-background-job",
      kind: "boolean",
      label: "Disable Embeddings Background Job",
      keywords: ["embeddings", "background", "job", "scheduler", "disable"],
      group: "Jobs",
      getBadge: (ctx) =>
        ctx.jobToggles.isJobEnabled("embeddings") ? "ON" : "OFF",
      run: async (ctx) => {
        await ctx.jobToggles.toggleJob("embeddings", false)
      },
    },
  ]
}

function buildJobToggleCommands(): CommandDef[] {
  const commands: CommandDef[] = []

  for (const jobId of SERVER_JOB_IDS) {
    if (jobId === "embeddings") continue
    const label = JOB_LABELS[jobId] ?? jobId
    const slug = slugify(label)

    commands.push(
      {
        id: `enable-job-${slug}`,
        kind: "boolean",
        label: `Enable ${label} Job`,
        keywords: ["job", jobId, label, "enable", "scheduler"],
        group: "Jobs",
        getBadge: (ctx) => (ctx.jobToggles.isJobEnabled(jobId) ? "ON" : "OFF"),
        run: async (ctx) => {
          await ctx.jobToggles.toggleJob(jobId, true)
        },
      },
      {
        id: `disable-job-${slug}`,
        kind: "boolean",
        label: `Disable ${label} Job`,
        keywords: ["job", jobId, label, "disable", "scheduler"],
        group: "Jobs",
        getBadge: (ctx) => (ctx.jobToggles.isJobEnabled(jobId) ? "ON" : "OFF"),
        run: async (ctx) => {
          await ctx.jobToggles.toggleJob(jobId, false)
        },
      },
    )
  }

  return commands
}

export function buildSettingCommands(): CommandDef[] {
  return [
    ...buildBooleanCommands(),
    ...buildEnumCommands(),
    ...buildEditorCommands(),
    ...buildEmbeddingsCommands(),
    ...buildJobToggleCommands(),
  ]
}

/**
 * Command ids that existed before the catalog migration, minus Advanced Mode
 * (intentionally removed). New sync-interval editors are additive.
 */
export const LEGACY_SETTING_COMMAND_IDS = [
  "disable-auto-translate",
  "disable-embeddings-background-job",
  "disable-embeddings-feature",
  "disable-job-auto-summary",
  "disable-job-auto-sync",
  "disable-job-retention",
  "disable-job-translation-batch",
  "disable-pause-embeddings",
  "disable-proxy",
  "disable-show-channel-bio",
  "disable-show-channel-files",
  "disable-show-channel-links",
  "disable-show-channel-photos",
  "disable-show-channel-start-id",
  "disable-show-channel-subscribers",
  "disable-show-channel-telegram-chat-id",
  "disable-show-channel-videos",
  "disable-tor",
  "disable-tor-auto-rotate",
  "disable-tor-control",
  "disable-translation",
  "edit-ai-temperature",
  "edit-default-proxy-urls",
  "edit-global-start-time-value",
  "edit-log-retention-days",
  "edit-post-retention-days",
  "edit-proxy-concurrency-overrides",
  "edit-proxy-default-concurrency",
  "edit-sync-concurrency",
  "edit-tor-control-port",
  "edit-tor-proxy-urls",
  "edit-tor-rotation-threshold",
  "enable-auto-translate",
  "enable-embeddings-background-job",
  "enable-embeddings-feature",
  "enable-job-auto-summary",
  "enable-job-auto-sync",
  "enable-job-retention",
  "enable-job-translation-batch",
  "enable-pause-embeddings",
  "enable-proxy",
  "enable-show-channel-bio",
  "enable-show-channel-files",
  "enable-show-channel-links",
  "enable-show-channel-photos",
  "enable-show-channel-start-id",
  "enable-show-channel-subscribers",
  "enable-show-channel-telegram-chat-id",
  "enable-show-channel-videos",
  "enable-tor",
  "enable-tor-auto-rotate",
  "enable-tor-control",
  "enable-translation",
  "set-ai-language-arabic",
  "set-ai-language-chinese",
  "set-ai-language-english",
  "set-ai-language-french",
  "set-ai-language-german",
  "set-ai-language-italian",
  "set-ai-language-japanese",
  "set-ai-language-persian",
  "set-ai-language-portuguese",
  "set-ai-language-russian",
  "set-ai-language-spanish",
  "set-global-start-time-mode-absolute",
  "set-global-start-time-mode-relative",
  "set-global-start-time-mode-retention",
  "set-selected-model-gemini-3-1-flash-lite-preview",
  "set-selected-model-gemini-3-1-pro-preview",
  "set-selected-model-gemini-3-flash-preview",
  "set-theme-dark",
  "set-theme-light",
  "set-theme-system",
  "set-tor-mode-auto",
  "set-tor-mode-custom",
  "set-tor-rotation-strategy-random",
  "set-tor-rotation-strategy-sequential",
  "set-translation-model-gemini-3-1-flash-lite-preview",
  "set-translation-model-gemini-3-1-pro-preview",
  "set-translation-model-gemini-3-flash-preview",
  "set-translation-target-language-arabic",
  "set-translation-target-language-chinese",
  "set-translation-target-language-english",
  "set-translation-target-language-french",
  "set-translation-target-language-german",
  "set-translation-target-language-italian",
  "set-translation-target-language-japanese",
  "set-translation-target-language-persian",
  "set-translation-target-language-portuguese",
  "set-translation-target-language-russian",
  "set-translation-target-language-spanish",
  "toggle-auto-translate",
  "toggle-pause-embeddings",
  "toggle-proxy",
  "toggle-show-channel-bio",
  "toggle-show-channel-files",
  "toggle-show-channel-links",
  "toggle-show-channel-photos",
  "toggle-show-channel-start-id",
  "toggle-show-channel-subscribers",
  "toggle-show-channel-telegram-chat-id",
  "toggle-show-channel-videos",
  "toggle-tor",
  "toggle-tor-auto-rotate",
  "toggle-tor-control",
  "toggle-translation",
] as const
