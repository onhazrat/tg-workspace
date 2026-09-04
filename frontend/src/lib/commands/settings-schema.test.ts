import { describe, expect, test } from "bun:test"
import type { CommandContext } from "@/lib/commands/types"
import {
  buildSettingCommands,
  LEGACY_SETTING_COMMAND_IDS,
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

  test("numeric editor commands include the retention editors", () => {
    // Asserted against the built commands rather than a parallel export: the
    // catalog is the single source, so a test reading a second list could pass
    // while the palette itself was missing the command.
    const ids = commands.filter((c) => c.kind === "editor").map((c) => c.id)
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
    const booleans = commands.filter((c) => c.kind === "boolean")
    expect(booleans.length).toBeGreaterThan(0)
    for (const cmd of booleans) {
      expect(cmd.getBadge).toBeDefined()
    }
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

describe("the catalog→settings binding actually fires", () => {
  // These exist because the binding was entirely untested. Every test above
  // asserts a command's *shape* — id, label, badge — and none of them ran one.
  // Breaking `catalogSetter`'s name derivation left all 90 passing, so a
  // refactor of the binding had no safety net at all.

  function spyContext(): {
    ctx: CommandContext
    calls: Array<[string, unknown]>
  } {
    const calls: Array<[string, unknown]> = []
    const base = makeContext()
    const settings = new Proxy(base.settings, {
      get(target, prop: string) {
        const value = Reflect.get(target, prop)
        if (typeof value === "function" && prop.startsWith("set")) {
          return (arg: unknown) => {
            calls.push([prop, arg])
          }
        }
        return value
      },
    }) as CommandContext["settings"]
    return { ctx: { ...base, settings }, calls }
  }

  test("a boolean enable command calls its setter with true", () => {
    const commands = buildSettingCommands()
    const cmd = commands.find((c) => c.id === "enable-proxy")
    expect(cmd).toBeDefined()

    const { ctx, calls } = spyContext()
    cmd?.run?.(ctx)
    expect(calls).toEqual([["setProxyEnabled", true]])
  })

  test("a boolean disable command calls its setter with false", () => {
    const commands = buildSettingCommands()
    const { ctx, calls } = spyContext()
    commands.find((c) => c.id === "disable-proxy")?.run?.(ctx)
    expect(calls).toEqual([["setProxyEnabled", false]])
  })

  test("a toggle command inverts the current value", () => {
    const commands = buildSettingCommands()
    const { ctx, calls } = spyContext()
    // makeContext starts with proxyEnabled: false
    commands.find((c) => c.id === "toggle-proxy")?.run?.(ctx)
    expect(calls).toEqual([["setProxyEnabled", true]])
  })

  test("an enum command calls its setter with the option value", () => {
    const commands = buildSettingCommands()
    const cmd = commands.find((c) => c.id.startsWith("set-tor-mode-"))
    expect(cmd).toBeDefined()

    const { ctx, calls } = spyContext()
    cmd?.run?.(ctx)
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe("setTorMode")
  })

  test("a numeric editor clamps to the catalog's max", () => {
    // `proxyDefaultConcurrency` is min 1 / max 20. Only 4 of the 12 numeric
    // controls declare a max at all, which is why the clamp helper treats an
    // absent bound as unbounded rather than defaulting it.
    const commands = buildSettingCommands()
    const cmd = commands.find((c) => c.id === "edit-proxy-default-concurrency")
    expect(cmd?.editorField?.max).toBe(20)

    const { ctx, calls } = spyContext()
    cmd?.editorField?.apply?.(ctx, "500")
    expect(calls).toEqual([["setProxyDefaultConcurrency", 20]])
  })

  test("a numeric editor leaves an unbounded control unbounded", () => {
    // `syncFailureBackoffMinutes` declares min but no max. Before G3 the
    // clamp read `control.max ?? undefined`, so this already passed through —
    // the point is that removing the `?? 0` / `?? 1` fallbacks did not change
    // it. It was `syncConcurrency` until ADR-012 deleted that setting; the
    // example has to be *some* unbounded number editor and this is the nearest
    // one, in the same section with the same control shape.
    const commands = buildSettingCommands()
    const cmd = commands.find(
      (c) => c.id === "edit-sync-failure-backoff-minutes",
    )
    expect(cmd?.editorField?.max).toBeUndefined()

    const { ctx, calls } = spyContext()
    cmd?.editorField?.apply?.(ctx, "9999")
    expect(calls).toEqual([["setSyncFailureBackoffMinutes", 9999]])
  })

  test("a numeric editor rejects input below the catalog's min", () => {
    const commands = buildSettingCommands()
    const cmd = commands.find(
      (c) => c.id === "edit-sync-failure-backoff-minutes",
    )

    const { ctx, calls } = spyContext()
    cmd?.editorField?.apply?.(ctx, "-5")
    expect(calls).toEqual([])
  })

  test("a numeric editor ignores non-numeric input", () => {
    const commands = buildSettingCommands()
    const cmd = commands.find(
      (c) => c.id === "edit-sync-failure-backoff-minutes",
    )

    const { ctx, calls } = spyContext()
    cmd?.editorField?.apply?.(ctx, "not a number")
    expect(calls).toEqual([])
  })

  test("the float editor clamps within the catalog's bounds", () => {
    const commands = buildSettingCommands()
    const cmd = commands.find((c) => c.id === "edit-ai-temperature")
    expect(cmd?.editorField).toBeDefined()

    const { ctx, calls } = spyContext()
    cmd?.editorField?.apply?.(ctx, "99")
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe("setAiTemperature")
    expect(calls[0][1]).toBe(cmd?.editorField?.max)
  })
})
