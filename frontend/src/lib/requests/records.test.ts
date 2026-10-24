import { describe, expect, test } from "bun:test"
import { atText, causeText, rowQuery } from "./records"

describe("a Channel table row's Requests (RQS-10)", () => {
  test("a Channel's row asks by handle, an aggregate row by kind", () => {
    expect(rowQuery({ key: "durov", aggregate: false })).toEqual({
      channel: "durov",
    })
    expect(rowQuery({ key: "probe", aggregate: true })).toEqual({
      kind: "probe",
    })
  })

  test("a Request's time reads in UTC to the second, as the server sent it", () => {
    expect(atText("2026-10-23T09:05:07.123456")).toBe("2026-10-23 09:05:07")
  })

  test("a cause reads as words, one this build does not know as sent", () => {
    expect(causeText("turnedAway")).toBe("Turned away")
    expect(causeText("missingHandle")).toBe("Missing handle")
    expect(causeText("somethingNew")).toBe("somethingNew")
    expect(causeText(null)).toBe("")
  })
})
