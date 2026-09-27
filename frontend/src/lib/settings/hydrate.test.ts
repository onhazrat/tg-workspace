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
})

describe("refusalMessage", () => {
  it("is the server's detail for a refused value and nothing else", () => {
    const refused = new ApiError(422, "The estimation floor must be below.")
    expect(refusalMessage(refused)).toBe("The estimation floor must be below.")
    expect(refusalMessage(new ApiError(403, "Forbidden"))).toBeNull()
    expect(refusalMessage(new Error("network"))).toBeNull()
  })
})
