import {
  AUTO_SYNC_INTERVAL_MAX_MINUTES,
  AUTO_SYNC_INTERVAL_MIN_MINUTES,
  LANGUAGES,
  MODELS,
} from "@/constants"
import { JOB_LABELS, SERVER_JOB_IDS } from "@/hooks/useJobToggles"
import type {
  CommandContext,
  CommandDef,
  CommandSettingsSlice,
} from "@/lib/commands/types"

type BooleanSettingDef = {
  key: keyof CommandSettingsSlice
  label: string
  getter: (settings: CommandSettingsSlice) => boolean
  setter: (settings: CommandSettingsSlice, value: boolean) => void
  keywords?: string[]
  advancedOnly?: boolean
}

const BOOLEAN_SETTINGS: BooleanSettingDef[] = [
  {
    key: "showChannelBio",
    label: "Show Channel Bio",
    getter: (s) => s.showChannelBio,
    setter: (s, v) => s.setShowChannelBio(v),
    keywords: ["appearance", "channel", "bio"],
  },
  {
    key: "showChannelSubscribers",
    label: "Show Channel Subscribers",
    getter: (s) => s.showChannelSubscribers,
    setter: (s, v) => s.setShowChannelSubscribers(v),
    keywords: ["appearance", "channel", "subscribers"],
  },
  {
    key: "showChannelPhotos",
    label: "Show Channel Photos",
    getter: (s) => s.showChannelPhotos,
    setter: (s, v) => s.setShowChannelPhotos(v),
    keywords: ["appearance", "channel", "photos"],
  },
  {
    key: "showChannelVideos",
    label: "Show Channel Videos",
    getter: (s) => s.showChannelVideos,
    setter: (s, v) => s.setShowChannelVideos(v),
    keywords: ["appearance", "channel", "videos"],
  },
  {
    key: "showChannelFiles",
    label: "Show Channel Files",
    getter: (s) => s.showChannelFiles,
    setter: (s, v) => s.setShowChannelFiles(v),
    keywords: ["appearance", "channel", "files"],
  },
  {
    key: "showChannelLinks",
    label: "Show Channel Links",
    getter: (s) => s.showChannelLinks,
    setter: (s, v) => s.setShowChannelLinks(v),
    keywords: ["appearance", "channel", "links"],
  },
  {
    key: "showChannelStartId",
    label: "Show Channel Start ID",
    getter: (s) => s.showChannelStartId,
    setter: (s, v) => s.setShowChannelStartId(v),
    keywords: ["appearance", "channel", "start", "id", "advanced"],
  },
  {
    key: "advancedMode",
    label: "Advanced Mode",
    getter: (s) => s.advancedMode,
    setter: (s, v) => s.setAdvancedMode(v),
    keywords: ["advanced", "settings"],
  },
  {
    key: "autoSyncEnabled",
    label: "Auto Sync",
    getter: (s) => s.autoSyncEnabled,
    setter: (s, v) => s.setAutoSyncEnabled(v),
    keywords: ["sync", "scheduler", "automation"],
  },
  {
    key: "proxyEnabled",
    label: "Proxy",
    getter: (s) => s.proxyEnabled,
    setter: (s, v) => s.setProxyEnabled(v),
    keywords: ["network", "proxy"],
    advancedOnly: true,
  },
  {
    key: "torEnabled",
    label: "Tor",
    getter: (s) => s.torEnabled,
    setter: (s, v) => s.setTorEnabled(v),
    keywords: ["network", "tor"],
    advancedOnly: true,
  },
  {
    key: "torControlEnabled",
    label: "Tor Control",
    getter: (s) => s.torControlEnabled,
    setter: (s, v) => s.setTorControlEnabled(v),
    keywords: ["network", "tor", "control"],
    advancedOnly: true,
  },
  {
    key: "torAutoRotate",
    label: "Tor Auto Rotate",
    getter: (s) => s.torAutoRotate,
    setter: (s, v) => s.setTorAutoRotate(v),
    keywords: ["network", "tor", "rotate"],
    advancedOnly: true,
  },
  {
    key: "embeddingsPaused",
    label: "Pause Embeddings",
    getter: (s) => s.embeddingsPaused,
    setter: (s, v) => s.setEmbeddingsPaused(v),
    keywords: ["embeddings", "pause", "ai"],
  },
  {
    key: "translationEnabled",
    label: "Translation",
    getter: (s) => s.translationEnabled,
    setter: (s, v) => s.setTranslationEnabled(v),
    keywords: ["translation", "language"],
  },
  {
    key: "autoTranslate",
    label: "Auto Translate",
    getter: (s) => s.autoTranslate,
    setter: (s, v) => s.setAutoTranslate(v),
    keywords: ["translation", "auto"],
  },
]

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-")
}

function maybeEnableAdvanced(ctx: CommandContext, advancedOnly?: boolean) {
  if (advancedOnly) ctx.settings.setAdvancedMode(true)
}

function buildBooleanCommands(): CommandDef[] {
  const commands: CommandDef[] = []

  for (const setting of BOOLEAN_SETTINGS) {
    const slug = slugify(setting.label)
    const baseKeywords = [
      setting.label,
      ...(setting.keywords ?? []),
      "toggle",
      "enable",
      "disable",
      "setting",
    ]

    commands.push(
      {
        id: `toggle-${slug}`,
        kind: "boolean",
        label: `Toggle ${setting.label}`,
        keywords: [...baseKeywords, "toggle"],
        group: "Settings",
        getBadge: (ctx) => (setting.getter(ctx.settings) ? "ON" : "OFF"),
        run: (ctx) => {
          maybeEnableAdvanced(ctx, setting.advancedOnly)
          setting.setter(ctx.settings, !setting.getter(ctx.settings))
        },
      },
      {
        id: `enable-${slug}`,
        kind: "boolean",
        label: `Enable ${setting.label}`,
        keywords: [...baseKeywords, "enable", "on"],
        group: "Settings",
        getBadge: (ctx) => (setting.getter(ctx.settings) ? "ON" : "OFF"),
        run: (ctx) => {
          maybeEnableAdvanced(ctx, setting.advancedOnly)
          setting.setter(ctx.settings, true)
        },
      },
      {
        id: `disable-${slug}`,
        kind: "boolean",
        label: `Disable ${setting.label}`,
        keywords: [...baseKeywords, "disable", "off"],
        group: "Settings",
        getBadge: (ctx) => (setting.getter(ctx.settings) ? "ON" : "OFF"),
        run: (ctx) => {
          maybeEnableAdvanced(ctx, setting.advancedOnly)
          setting.setter(ctx.settings, false)
        },
      },
    )
  }

  return commands
}

function formatRetentionBadge(days: number): string {
  return days === 0 ? "Never" : `${days}d`
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

type NumericEditorDef = {
  id: string
  label: string
  keywords: string[]
  fieldId: string
  fieldLabel: string
  min?: number
  max?: number
  step?: number | "any"
  integer?: boolean
  advancedOnly?: boolean
  getter: (settings: CommandSettingsSlice) => number
  setter: (settings: CommandSettingsSlice, value: number) => void
  formatBadge: (value: number) => string
}

const NUMERIC_EDITOR_DEFS: NumericEditorDef[] = [
  {
    id: "edit-auto-sync-interval",
    label: "Edit Auto Sync Interval",
    keywords: ["auto sync", "interval", "minutes"],
    fieldId: "autoSyncInterval",
    fieldLabel: "Auto Sync Interval (minutes)",
    min: AUTO_SYNC_INTERVAL_MIN_MINUTES,
    max: AUTO_SYNC_INTERVAL_MAX_MINUTES,
    integer: true,
    getter: (s) => s.autoSyncInterval,
    setter: (s, v) => s.setAutoSyncInterval(v),
    formatBadge: (v) => `${v}m`,
  },
  {
    id: "edit-ai-temperature",
    label: "Edit AI Temperature",
    keywords: ["ai", "temperature", "model"],
    fieldId: "aiTemperature",
    fieldLabel: "AI Temperature",
    min: 0,
    max: 1,
    step: "any",
    getter: (s) => s.aiTemperature,
    setter: (s, v) => s.setAiTemperature(v),
    formatBadge: (v) => v.toFixed(1),
  },
  {
    id: "edit-sync-concurrency",
    label: "Edit Sync Concurrency",
    keywords: ["sync", "concurrency", "parallel"],
    fieldId: "syncConcurrency",
    fieldLabel: "Sync Concurrency",
    min: 1,
    integer: true,
    getter: (s) => s.syncConcurrency,
    setter: (s, v) => s.setSyncConcurrency(v),
    formatBadge: (v) => String(v),
  },
  {
    id: "edit-proxy-default-concurrency",
    label: "Edit Proxy Default Concurrency",
    keywords: ["proxy", "concurrency", "network"],
    fieldId: "proxyDefaultConcurrency",
    fieldLabel: "Proxy Default Concurrency",
    min: 1,
    max: 20,
    integer: true,
    advancedOnly: true,
    getter: (s) => s.proxyDefaultConcurrency,
    setter: (s, v) => s.setProxyDefaultConcurrency(v),
    formatBadge: (v) => String(v),
  },
  {
    id: "edit-tor-control-port",
    label: "Edit Tor Control Port",
    keywords: ["tor", "control", "port", "network"],
    fieldId: "torControlPort",
    fieldLabel: "Tor Control Port",
    min: 1,
    integer: true,
    advancedOnly: true,
    getter: (s) => s.torControlPort,
    setter: (s, v) => s.setTorControlPort(v),
    formatBadge: (v) => String(v),
  },
  {
    id: "edit-tor-rotation-threshold",
    label: "Edit Tor Rotation Threshold",
    keywords: ["tor", "rotation", "threshold", "network"],
    fieldId: "torRotationThreshold",
    fieldLabel: "Tor Rotation Threshold",
    min: 5,
    max: 50,
    integer: true,
    advancedOnly: true,
    getter: (s) => s.torRotationThreshold,
    setter: (s, v) => s.setTorRotationThreshold(v),
    formatBadge: (v) => String(v),
  },
  {
    id: "edit-post-retention-days",
    label: "Edit Post Retention Days",
    keywords: ["retention", "posts", "days"],
    fieldId: "postRetentionDays",
    fieldLabel: "Post Retention (days)",
    min: 0,
    integer: true,
    getter: (s) => s.postRetentionDays,
    setter: (s, v) => s.setPostRetentionDays(v),
    formatBadge: formatRetentionBadge,
  },
  {
    id: "edit-log-retention-days",
    label: "Edit Log Retention Days",
    keywords: ["retention", "logs", "days"],
    fieldId: "logRetentionDays",
    fieldLabel: "Log Retention (days)",
    min: 0,
    integer: true,
    getter: (s) => s.logRetentionDays,
    setter: (s, v) => s.setLogRetentionDays(v),
    formatBadge: formatRetentionBadge,
  },
]

function buildNumericEditorCommands(): CommandDef[] {
  return NUMERIC_EDITOR_DEFS.map((def) => ({
    id: def.id,
    kind: "editor" as const,
    label: def.label,
    keywords: def.keywords,
    group: "Settings",
    getBadge: (ctx) => def.formatBadge(def.getter(ctx.settings)),
    editorField: {
      id: def.fieldId,
      label: def.fieldLabel,
      type: "number" as const,
      min: def.min,
      max: def.max,
      step: def.step,
      integer: def.integer,
      advancedOnly: def.advancedOnly,
      getValue: (ctx) => def.getter(ctx.settings),
      apply: (ctx, value) => {
        if (def.advancedOnly) ctx.settings.setAdvancedMode(true)
        if (def.step === "any") {
          const parsed = clampFloat(value, def.min ?? 0, def.max ?? 1)
          if (parsed !== null) def.setter(ctx.settings, parsed)
          return
        }
        const parsed = clampInt(value, def.min ?? 0, def.max)
        if (parsed !== null) def.setter(ctx.settings, parsed)
      },
    },
    run: () => {},
  }))
}

function buildEnumCommands(): CommandDef[] {
  const commands: CommandDef[] = []

  for (const theme of ["light", "dark"] as const) {
    commands.push({
      id: `set-theme-${theme}`,
      kind: "enum",
      label: `Set Theme → ${theme === "light" ? "Light" : "Dark"}`,
      keywords: ["theme", theme, "appearance"],
      group: "Settings",
      run: (ctx) => ctx.settings.setTheme(theme),
    })
  }

  for (const mode of ["retention", "relative", "absolute"] as const) {
    commands.push({
      id: `set-global-start-time-mode-${mode}`,
      kind: "enum",
      label: `Set Default Channel Start Time Mode → ${mode}`,
      keywords: ["global start time", "sync", mode, "retention"],
      group: "Settings",
      run: (ctx) => ctx.settings.setGlobalStartTimeMode(mode),
    })
  }

  for (const mode of ["auto", "custom"] as const) {
    commands.push({
      id: `set-tor-mode-${mode}`,
      kind: "enum",
      label: `Set Tor Mode → ${mode}`,
      keywords: ["tor", "mode", mode, "network"],
      group: "Settings",
      run: (ctx) => {
        ctx.settings.setAdvancedMode(true)
        ctx.settings.setTorMode(mode)
      },
    })
  }

  for (const strategy of ["sequential", "random"] as const) {
    commands.push({
      id: `set-tor-rotation-strategy-${strategy}`,
      kind: "enum",
      label: `Set Tor Rotation Strategy → ${strategy}`,
      keywords: ["tor", "rotation", strategy, "network"],
      group: "Settings",
      run: (ctx) => {
        ctx.settings.setAdvancedMode(true)
        ctx.settings.setTorRotationStrategy(strategy)
      },
    })
  }

  for (const language of LANGUAGES) {
    commands.push({
      id: `set-ai-language-${slugify(language)}`,
      kind: "enum",
      label: `Set AI Language → ${language}`,
      keywords: ["ai", "language", language],
      group: "Settings",
      run: (ctx) => ctx.settings.setAiLanguage(language),
    })
    commands.push({
      id: `set-translation-target-language-${slugify(language)}`,
      kind: "enum",
      label: `Set Translation Target Language → ${language}`,
      keywords: ["translation", "language", language],
      group: "Settings",
      run: (ctx) => ctx.settings.setTranslationTargetLanguage(language),
    })
  }

  for (const model of MODELS) {
    commands.push({
      id: `set-selected-model-${slugify(model.id)}`,
      kind: "enum",
      label: `Set AI Model → ${model.label}`,
      keywords: ["ai", "model", model.label, model.id],
      group: "Settings",
      run: (ctx) => ctx.settings.setSelectedModel(model.id),
    })
    commands.push({
      id: `set-translation-model-${slugify(model.id)}`,
      kind: "enum",
      label: `Set Translation Model → ${model.label}`,
      keywords: ["translation", "model", model.label, model.id],
      group: "Settings",
      run: (ctx) => ctx.settings.setTranslationModel(model.id),
    })
  }

  return commands
}

function buildEditorCommands(): CommandDef[] {
  const editors: CommandDef[] = [
    ...buildNumericEditorCommands(),
    {
      id: "edit-global-start-time-value",
      kind: "editor",
      label: "Edit Default Channel Start Time Value",
      keywords: ["global start time", "sync", "retention", "days", "date"],
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
        id: "globalStartTimeValue",
        label: "Default Channel Start Time Value",
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
            ctx.settings.setGlobalStartTimeValue(new Date(value).toISOString())
            return
          }
          const parsed = Number.parseInt(value, 10)
          if (!Number.isNaN(parsed) && parsed > 0) {
            ctx.settings.setGlobalStartTimeValue(parsed)
          }
        },
      },
      run: () => {},
    },
    {
      id: "edit-default-proxy-urls",
      kind: "editor",
      label: "Edit Default Proxy URLs",
      keywords: ["proxy", "urls", "network"],
      group: "Settings",
      editorField: {
        id: "defaultProxyUrls",
        label: "Default Proxy URLs",
        type: "textarea",
        advancedOnly: true,
        getValue: (ctx) => ctx.settings.defaultProxyUrls,
        apply: (ctx, value) => {
          ctx.settings.setAdvancedMode(true)
          ctx.settings.setDefaultProxyUrls(value)
        },
      },
      run: () => {},
    },
    {
      id: "edit-tor-proxy-urls",
      kind: "editor",
      label: "Edit Tor Proxy URLs",
      keywords: ["tor", "proxy", "urls", "network"],
      group: "Settings",
      editorField: {
        id: "torProxyUrls",
        label: "Tor Proxy URLs",
        type: "textarea",
        advancedOnly: true,
        getValue: (ctx) => ctx.settings.torProxyUrls,
        apply: (ctx, value) => {
          ctx.settings.setAdvancedMode(true)
          ctx.settings.setTorProxyUrls(value)
        },
      },
      run: () => {},
    },
  ]

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

function buildProxyOverrideCommands(): CommandDef[] {
  return [
    {
      id: "edit-proxy-concurrency-overrides",
      kind: "editor",
      label: "Edit Proxy Concurrency Overrides",
      keywords: ["proxy", "concurrency", "override", "network"],
      group: "Settings",
      editorField: {
        id: "proxyConcurrencyOverrides",
        label: "Proxy Concurrency Overrides (JSON)",
        type: "textarea",
        advancedOnly: true,
        getValue: (ctx) =>
          JSON.stringify(ctx.settings.proxyConcurrencyOverrides, null, 2),
        apply: (ctx, value) => {
          ctx.settings.setAdvancedMode(true)
          try {
            const parsed = JSON.parse(value) as Record<string, number>
            ctx.settings.setProxyConcurrencyOverrides(parsed)
          } catch {
            // ignore invalid JSON
          }
        },
      },
      run: () => {},
    },
  ]
}

export function buildSettingCommands(): CommandDef[] {
  return [
    ...buildBooleanCommands(),
    ...buildEnumCommands(),
    ...buildEditorCommands(),
    ...buildEmbeddingsCommands(),
    ...buildJobToggleCommands(),
    ...buildProxyOverrideCommands(),
  ]
}

export { BOOLEAN_SETTINGS, NUMERIC_EDITOR_DEFS }
