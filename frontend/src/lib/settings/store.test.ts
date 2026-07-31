import { describe, expect, it } from "bun:test"
import {
  AUTO_SYNC_INTERVAL_DEFAULT,
  DEFAULT_AI_LANGUAGE,
  DEFAULT_MODEL,
  RETENTION_POST_DAYS_DEFAULT,
} from "@/constants"
import { type AppSettings, appSettingKeys } from "./schema"
import {
  buildSectionPayload,
  createAppSettingSetters,
  decodeServerSection,
  loadAppSettings,
  loadSetting,
  persistAppSettings,
  readerFromRecord,
  type SettingsWriter,
} from "./store"

function recordWriter(): {
  record: Record<string, string>
  writer: SettingsWriter
} {
  const record: Record<string, string> = {}
  return { record, writer: { setItem: (key, value) => (record[key] = value) } }
}

describe("loadAppSettings", () => {
  it("returns schema defaults when storage is empty", () => {
    const settings = loadAppSettings(readerFromRecord({}))
    expect(settings.aiLanguage).toBe(DEFAULT_AI_LANGUAGE)
    expect(settings.selectedModel).toBe(DEFAULT_MODEL)
    expect(settings.aiTemperature).toBe(0.7)
    expect(settings.regularSyncIntervalMinutes).toBe(AUTO_SYNC_INTERVAL_DEFAULT)
    expect(settings.syncFailureBackoffMinutes).toBe(5)
    expect(settings.syncConcurrency).toBe(3)
    expect(settings.showChannelBio).toBe(true)
    expect(settings.showChannelSubscribers).toBe(true)
    expect(settings.showChannelPhotos).toBe(false)
    expect(settings.globalStartTimeMode).toBe("retention")
    expect(settings.globalStartTimeValue).toBeNull()
    expect(settings.postRetentionDays).toBe(RETENTION_POST_DAYS_DEFAULT)
  })

  it("decodes stored values using the historical formats", () => {
    const settings = loadAppSettings(
      readerFromRecord({
        aiLanguage: "Persian",
        aiTemperature: "0.3",
        regularSyncIntervalMinutes: "120",
        showChannelBio: "false",
        globalStartTimeMode: "absolute",
        globalStartTimeValue: '"2024-01-01T00:00:00Z"',
      }),
    )
    expect(settings.aiLanguage).toBe("Persian")
    expect(settings.aiTemperature).toBe(0.3)
    expect(settings.regularSyncIntervalMinutes).toBe(120)
    expect(settings.showChannelBio).toBe(false)
    expect(settings.globalStartTimeMode).toBe("absolute")
    expect(settings.globalStartTimeValue).toBe("2024-01-01T00:00:00Z")
  })
})

describe("legacy storage keys", () => {
  it("falls back to autoSyncInterval when the primary key is absent", () => {
    const storage = readerFromRecord({ autoSyncInterval: "45" })
    expect(loadSetting("regularSyncIntervalMinutes", storage)).toBe(45)
  })

  it("prefers the primary key over the legacy key", () => {
    const storage = readerFromRecord({
      regularSyncIntervalMinutes: "30",
      autoSyncInterval: "45",
    })
    expect(loadSetting("regularSyncIntervalMinutes", storage)).toBe(30)
  })
})

describe("invalid stored values", () => {
  it("falls back to the default for unparsable numbers", () => {
    expect(
      loadSetting(
        "aiTemperature",
        readerFromRecord({ aiTemperature: "banana" }),
      ),
    ).toBe(0.7)
    expect(
      loadSetting(
        "regularSyncIntervalMinutes",
        readerFromRecord({ regularSyncIntervalMinutes: "" }),
      ),
    ).toBe(AUTO_SYNC_INTERVAL_DEFAULT)
  })

  it("falls back to the default for unknown enum values and broken JSON", () => {
    expect(
      loadSetting(
        "globalStartTimeMode",
        readerFromRecord({ globalStartTimeMode: "banana" }),
      ),
    ).toBe("retention")
    expect(
      loadSetting(
        "globalStartTimeValue",
        readerFromRecord({ globalStartTimeValue: "{not json" }),
      ),
    ).toBeNull()
  })

  // A stale model id — one persisted before the model list changed — used to pass
  // validation (the spec was a bare non-empty string), restore as-is, match no
  // option in the segmented control, and render as nothing selected.
  it("falls back to the default for a model id no longer offered", () => {
    expect(
      loadSetting(
        "selectedModel",
        readerFromRecord({ selectedModel: "gemini-2.5-flash" }),
      ),
    ).toBe(DEFAULT_MODEL)
    expect(
      loadSetting(
        "translationModel",
        readerFromRecord({ translationModel: "gemini-1.5-pro" }),
      ),
    ).toBe(DEFAULT_MODEL)
  })

  it("keeps a model id that is still offered", () => {
    expect(
      loadSetting(
        "selectedModel",
        readerFromRecord({ selectedModel: "gemini-3.1-pro-preview" }),
      ),
    ).toBe("gemini-3.1-pro-preview")
  })

  it("falls back to the default for a language outside the option list", () => {
    expect(
      loadSetting("aiLanguage", readerFromRecord({ aiLanguage: "Klingon" })),
    ).toBe(DEFAULT_AI_LANGUAGE)
    expect(
      loadSetting(
        "translationTargetLanguage",
        readerFromRecord({ translationTargetLanguage: "Klingon" }),
      ),
    ).toBe(DEFAULT_AI_LANGUAGE)
  })

  it("treats empty strings as missing for string settings", () => {
    expect(
      loadSetting("aiLanguage", readerFromRecord({ aiLanguage: "" })),
    ).toBe(DEFAULT_AI_LANGUAGE)
  })
})

describe("persistAppSettings", () => {
  it("round-trips every setting through encode/decode", () => {
    const custom: AppSettings = {
      ...loadAppSettings(readerFromRecord({})),
      aiLanguage: "Persian",
      // Must be a real option id: `selectedModel` is membership-validated, so an
      // arbitrary string would be rejected on read and never round-trip.
      selectedModel: "gemini-3.1-pro-preview",
      aiTemperature: 0.25,
      embeddingsEnabled: true,
      showChannelBio: false,
      regularSyncIntervalMinutes: 90,
      dynamicSyncEnabledDefault: true,
      syncConcurrency: 7,
      globalStartTimeMode: "relative",
      globalStartTimeValue: 14,
      postRetentionDays: 45,
      translationEnabled: true,
      translationTargetLanguage: "German",
    }
    const { record, writer } = recordWriter()
    persistAppSettings(custom, writer)
    expect(loadAppSettings(readerFromRecord(record))).toEqual(custom)
  })

  it("writes only changed keys when prev is provided", () => {
    const base = loadAppSettings(readerFromRecord({}))
    const next = { ...base, aiTemperature: 0.9 }
    const { record, writer } = recordWriter()
    persistAppSettings(next, writer, base)
    expect(Object.keys(record)).toEqual(["aiTemperature"])
    expect(record.aiTemperature).toBe("0.9")
  })

  it("writes all keys when prev is omitted", () => {
    const base = loadAppSettings(readerFromRecord({}))
    const { record, writer } = recordWriter()
    persistAppSettings(base, writer)
    expect(Object.keys(record).length).toBe(appSettingKeys.length)
    expect(record.showChannelBio).toBe("true")
  })
})

describe("backend sections", () => {
  it("builds the exact sync payload shape", () => {
    const settings = loadAppSettings(readerFromRecord({}))
    expect(Object.keys(buildSectionPayload("sync", settings))).toEqual([
      "regularSyncIntervalMinutes",
      "dynamicSyncEnabledDefault",
      "dynamicSyncExpectedPostsDefault",
      "syncFailureBackoffMinutes",
      "syncConcurrency",
      "globalStartTimeMode",
      "globalStartTimeValue",
    ])
    expect(Object.keys(buildSectionPayload("retention", settings))).toEqual([
      "postRetentionDays",
      "logRetentionDays",
      "payloadRetentionDays",
      "reportRetentionDays",
      "reportRetentionMax",
    ])
    expect(Object.keys(buildSectionPayload("translation", settings))).toEqual([
      "translationEnabled",
      "autoTranslate",
      "translationModel",
      "translationTargetLanguage",
    ])
  })

  it("decodes valid server values and ignores malformed ones", () => {
    const updates = decodeServerSection("sync", {
      regularSyncIntervalMinutes: 15,
      dynamicSyncEnabledDefault: "yes",
      syncConcurrency: 4,
      globalStartTimeMode: "banana",
      globalStartTimeValue: 30,
    })
    expect(updates).toEqual({
      regularSyncIntervalMinutes: 15,
      syncConcurrency: 4,
      globalStartTimeValue: 30,
    })
  })

  it("honors the legacy autoSyncInterval server key", () => {
    expect(decodeServerSection("sync", { autoSyncInterval: 25 })).toEqual({
      regularSyncIntervalMinutes: 25,
    })
    expect(
      decodeServerSection("sync", {
        regularSyncIntervalMinutes: 10,
        autoSyncInterval: 25,
      }),
    ).toEqual({ regularSyncIntervalMinutes: 10 })
  })
})

describe("createAppSettingSetters", () => {
  it("creates one named setter per key that updates only that key", () => {
    let state = loadAppSettings(readerFromRecord({}))
    const setters = createAppSettingSetters((updater) => {
      state = updater(state)
    })
    setters.setAiLanguage("Persian")
    setters.setEmbeddingsEnabled(true)
    expect(state.aiLanguage).toBe("Persian")
    expect(state.embeddingsEnabled).toBe(true)
    expect(state.selectedModel).toBe(DEFAULT_MODEL)
  })

  it("returns the previous state object when the value is unchanged", () => {
    const initial = loadAppSettings(readerFromRecord({}))
    let state = initial
    const setters = createAppSettingSetters((updater) => {
      state = updater(state)
    })
    setters.setAiTemperature(initial.aiTemperature)
    expect(state).toBe(initial)
  })
})
