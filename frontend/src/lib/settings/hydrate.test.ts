import { describe, expect, it } from "bun:test"
import { ApiError } from "@/api/base"
import { RETENTION_LOG_DAYS_DEFAULT } from "@/constants"
import { hydrateAppSettings } from "./hydrate"
import { readerFromRecord, refusalMessage } from "./store"

const empty = {
  sync: {},
  retention: {},
  translation: {},
  reach: {},
  jobsStatus: null,
}

describe("hydrateAppSettings", () => {
  it("takes legacy stored values the server lacks and asks for a write-back", () => {
    const { updates, writeBack } = hydrateAppSettings(
      { ...empty, sync: { other: 1 } },
      readerFromRecord({ autoSyncInterval: "45", postRetentionDays: "9" }),
    )
    expect(updates.regularSyncIntervalMinutes).toBe(45)
    expect(updates.postRetentionDays).toBe(9)
    expect(updates.logRetentionDays).toBe(RETENTION_LOG_DAYS_DEFAULT)
    expect(writeBack).toEqual({
      sync: { other: 1, regularSyncIntervalMinutes: 45 },
      retention: { postRetentionDays: 9 },
    })
  })

  it("lets the server win and writes nothing back", () => {
    const { updates, writeBack } = hydrateAppSettings(
      {
        ...empty,
        sync: { regularSyncIntervalMinutes: 30 },
        retention: { postRetentionDays: 5 },
      },
      readerFromRecord({ autoSyncInterval: "45", postRetentionDays: "9" }),
    )
    expect(updates.regularSyncIntervalMinutes).toBe(30)
    expect(updates.postRetentionDays).toBe(5)
    expect(writeBack).toBeNull()
  })

  it("tolerates null rows and reads the embeddings toggle only when boolean", () => {
    const rows = { sync: null, retention: null, translation: null, reach: null }
    const on = hydrateAppSettings(
      { ...rows, jobsStatus: { embeddings: { enabled: true } } },
      readerFromRecord({}),
    )
    expect(on.updates.embeddingsEnabled).toBe(true)
    expect(on.writeBack).toBeNull()
    const off = hydrateAppSettings(
      { ...rows, jobsStatus: null },
      readerFromRecord({}),
    )
    expect("embeddingsEnabled" in off.updates).toBe(false)
  })

  it("takes the four Reach settings from the server's reach row", () => {
    const { updates } = hydrateAppSettings(
      {
        ...empty,
        reach: {
          settlingAgeHours: 48,
          estimationFloorHours: 6,
          reachSampleSize: 50,
          curveRefitIntervalHours: 6,
        },
      },
      readerFromRecord({}),
    )
    expect(updates.settlingAgeHours).toBe(48)
    expect(updates.estimationFloorHours).toBe(6)
    expect(updates.reachSampleSize).toBe(50)
    expect(updates.curveRefitIntervalHours).toBe(6)
  })

  it("takes the Publishing settings from the server's publishing row", () => {
    const { updates } = hydrateAppSettings(
      {
        ...empty,
        publishing: {
          citationStyle: "numbered",
          linkPreviews: true,
          timeZone: "Europe/Berlin",
        },
      },
      readerFromRecord({}),
      "Asia/Tehran",
    )
    expect(updates.citationStyle).toBe("numbered")
    expect(updates.linkPreviews).toBe(true)
    expect(updates.timeZone).toBe("Europe/Berlin")
  })

  it("fills the time zone from the browser only until the account saves one", () => {
    const fresh = hydrateAppSettings(
      { ...empty, publishing: {} },
      readerFromRecord({}),
      "Asia/Tehran",
    )
    const cleared = hydrateAppSettings(
      { ...empty, publishing: { timeZone: "" } },
      readerFromRecord({}),
      "Asia/Tehran",
    )
    expect(fresh.updates.timeZone).toBe("Asia/Tehran")
    // Saved empty is the Account's choice (UTC), not a gap to fill again.
    expect(cleared.updates.timeZone).toBe("")
  })
})

describe("AI preferences (SET-05)", () => {
  const stored = readerFromRecord({
    selectedModel: "anthropic/claude-x",
    aiLanguage: "Persian",
    aiTemperature: "0.3",
  })

  // The deployment's, which the server sends beside what the Account stored.
  const defaults = {
    selectedModel: "operator/model",
    aiLanguage: "German",
    aiTemperature: 0.5,
  }

  it("uploads what this browser stored when the Account has none", () => {
    const { updates, aiUpload } = hydrateAppSettings(
      { ...empty, ai_prefs: { defaults } },
      stored,
    )
    expect(aiUpload).toEqual({
      selectedModel: "anthropic/claude-x",
      aiLanguage: "Persian",
      aiTemperature: 0.3,
    })
    expect(updates.selectedModel).toBe("anthropic/claude-x")
    expect(updates.aiTemperature).toBe(0.3)
  })

  it("never overwrites what the Account already has", () => {
    const { updates, aiUpload } = hydrateAppSettings(
      { ...empty, ai_prefs: { selectedModel: "gemini-x", defaults } },
      stored,
    )
    expect(aiUpload).toBeNull()
    expect(updates.selectedModel).toBe("gemini-x")
    // A field the Account lacks is the deployment's, not this browser's.
    expect(updates.aiLanguage).toBe("German")
    expect(updates.aiTemperature).toBe(0.5)
  })

  it("falls back to the deployment's defaults, not the build's, when neither side has a value", () => {
    const { updates, aiUpload } = hydrateAppSettings(
      { ...empty, ai_prefs: { defaults } },
      readerFromRecord({ aiTemperature: "banana" }),
    )
    expect(aiUpload).toBeNull()
    expect(updates.selectedModel).toBe("operator/model")
    expect(updates.aiLanguage).toBe("German")
    expect(updates.aiTemperature).toBe(0.5)
  })
})

describe("refusalMessage", () => {
  it("is the server's detail for a refused value and nothing else", () => {
    const refused = new ApiError(422, "The estimation floor must be below.")
    expect(refusalMessage(refused)).toBe("The estimation floor must be below.")
    expect(refusalMessage(new ApiError(403, "Forbidden"))).toBeNull()
    expect(refusalMessage(new Error("network"))).toBeNull()
  })
})
