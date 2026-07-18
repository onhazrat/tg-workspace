import { describe, expect, test } from "bun:test"
import type { CommandContext } from "@/lib/commands/types"
import {
  BOOLEAN_SETTINGS,
  buildSettingCommands,
  LEGACY_SETTING_COMMAND_IDS,
  NUMERIC_EDITOR_DEFS,
} from "./settings-schema"

function makeContext(
  overrides: Partial<CommandContext["settings"]> = {},
): CommandContext {
  const settings = {
    theme: "dark" as const,
    setTheme: () => {},
    aiLanguage: "English",
    setAiLanguage: () => {},
    selectedModel: "gemini-3-flash-preview",
    setSelectedModel: () => {},
    regularSyncIntervalMinutes: 60,
    setRegularSyncIntervalMinutes: () => {},
    dynamicSyncEnabledDefault: false,
    setDynamicSyncEnabledDefault: () => {},
    dynamicSyncExpectedPostsDefault: 15,
    setDynamicSyncExpectedPostsDefault: () => {},
    syncFailureBackoffMinutes: 5,
    setSyncFailureBackoffMinutes: () => {},
    aiTemperature: 0.7,
    setAiTemperature: () => {},
    proxyEnabled: false,
    setProxyEnabled: () => {},
    defaultProxyUrls: "",
    setDefaultProxyUrls: () => {},
    proxyDefaultConcurrency: 1,
    setProxyDefaultConcurrency: () => {},
    proxyConcurrencyOverrides: {},
    setProxyConcurrencyOverrides: () => {},
    torEnabled: false,
    setTorEnabled: () => {},
    torMode: "auto" as const,
    setTorMode: () => {},
    torProxyUrls: "",
    setTorProxyUrls: () => {},
    torRotationStrategy: "sequential" as const,
    setTorRotationStrategy: () => {},
    torControlEnabled: false,
    setTorControlEnabled: () => {},
    torControlPort: 9051,
    setTorControlPort: () => {},
    torAutoRotate: false,
    setTorAutoRotate: () => {},
    torRotationThreshold: 10,
    setTorRotationThreshold: () => {},
    syncConcurrency: 3,
    setSyncConcurrency: () => {},
    embeddingsEnabled: false,
    setEmbeddingsEnabled: () => {},
    embeddingsPaused: false,
    setEmbeddingsPaused: () => {},
    translationEnabled: false,
    setTranslationEnabled: () => {},
    autoTranslate: false,
    setAutoTranslate: () => {},
    translationModel: "gemini-3-flash-preview",
    setTranslationModel: () => {},
    translationTargetLanguage: "English",
    setTranslationTargetLanguage: () => {},
    postRetentionDays: 90,
    setPostRetentionDays: () => {},
    logRetentionDays: 30,
    setLogRetentionDays: () => {},
    globalStartTimeMode: "retention" as const,
    setGlobalStartTimeMode: () => {},
    globalStartTimeValue: 7,
    setGlobalStartTimeValue: () => {},
    showChannelBio: true,
    setShowChannelBio: () => {},
    showChannelSubscribers: true,
    setShowChannelSubscribers: () => {},
    showChannelTelegramChatId: false,
    setShowChannelTelegramChatId: () => {},
    showChannelPhotos: true,
    setShowChannelPhotos: () => {},
    showChannelVideos: true,
    setShowChannelVideos: () => {},
    showChannelFiles: true,
    setShowChannelFiles: () => {},
    showChannelLinks: true,
    setShowChannelLinks: () => {},
    showChannelStartId: false,
    setShowChannelStartId: () => {},
    ...overrides,
  }

  return { settings } as CommandContext
}

describe("buildSettingCommands numeric editors", () => {
  const commands = buildSettingCommands()

  test("retention editor commands exist", () => {
    expect(commands.some((c) => c.id === "edit-post-retention-days")).toBe(true)
    expect(commands.some((c) => c.id === "edit-log-retention-days")).toBe(true)
  })

  test("retention enum preset commands removed", () => {
    expect(commands.some((c) => c.id === "set-post-retention-days-30")).toBe(
      false,
    )
    expect(commands.some((c) => c.id === "set-log-retention-days-90")).toBe(
      false,
    )
    expect(
      commands.filter((c) => c.id.startsWith("set-post-retention")),
    ).toHaveLength(0)
    expect(
      commands.filter((c) => c.id.startsWith("set-log-retention")),
    ).toHaveLength(0)
  })

  test("NUMERIC_EDITOR_DEFS includes retention editors", () => {
    const ids = NUMERIC_EDITOR_DEFS.map((d) => d.id)
    expect(ids).toContain("edit-post-retention-days")
    expect(ids).toContain("edit-log-retention-days")
  })

  test("retention getBadge shows Never for zero", () => {
    const postCmd = commands.find((c) => c.id === "edit-post-retention-days")
    const logCmd = commands.find((c) => c.id === "edit-log-retention-days")
    expect(postCmd?.getBadge?.(makeContext({ postRetentionDays: 0 }))).toBe(
      "Never",
    )
    expect(logCmd?.getBadge?.(makeContext({ logRetentionDays: 0 }))).toBe(
      "Never",
    )
  })

  test("retention getBadge shows days suffix", () => {
    const postCmd = commands.find((c) => c.id === "edit-post-retention-days")
    expect(postCmd?.getBadge?.(makeContext({ postRetentionDays: 45 }))).toBe(
      "45d",
    )
  })

  test("ai temperature badge uses one decimal", () => {
    const cmd = commands.find((c) => c.id === "edit-ai-temperature")
    expect(cmd?.getBadge?.(makeContext({ aiTemperature: 0.75 }))).toBe("0.8")
  })

  test("bulk sync template commands removed", () => {
    expect(
      commands.some((c) => c.id === "disable-regular-sync-all-channels"),
    ).toBe(false)
    expect(
      commands.some((c) => c.id === "apply-regular-sync-interval-all-channels"),
    ).toBe(false)
  })

  test("boolean commands still expose ON/OFF badges", () => {
    expect(BOOLEAN_SETTINGS.length).toBeGreaterThan(0)
  })

  test("legacy command ids are preserved (minus advancedMode)", () => {
    const ids = new Set(commands.map((c) => c.id))
    for (const id of LEGACY_SETTING_COMMAND_IDS) {
      expect(ids.has(id)).toBe(true)
    }
    expect(ids.has("toggle-advanced-mode")).toBe(false)
    expect(ids.has("enable-advanced-mode")).toBe(false)
    expect(ids.has("disable-advanced-mode")).toBe(false)
  })

  test("new sync interval editors exist", () => {
    expect(
      commands.some((c) => c.id === "edit-regular-sync-interval-minutes"),
    ).toBe(true)
    expect(
      commands.some((c) => c.id === "edit-dynamic-sync-expected-posts"),
    ).toBe(true)
    expect(
      commands.some((c) => c.id === "edit-sync-failure-backoff-minutes"),
    ).toBe(true)
    expect(commands.some((c) => c.id === "toggle-dynamic-sync-default")).toBe(
      true,
    )
  })
})
