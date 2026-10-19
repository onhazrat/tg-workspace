import { describe, expect, test } from "bun:test"

import { visibleTools } from "./tools-model"

const ids = (access: Parameters<typeof visibleTools>[0]) =>
  visibleTools(access).map((t) => t.id)

describe("the Tools tab", () => {
  test("every Account gets Logs and Quick message", () => {
    expect(
      ids({ canAdministerData: false, canReadNetworkLogs: false }),
    ).toEqual(["logs", "quick-message"])
  })

  test("network telemetry needs the network-log read, nothing else", () => {
    expect(ids({ canAdministerData: false, canReadNetworkLogs: true })).toEqual(
      ["logs", "quick-message", "network-telemetry"],
    )
  })

  test("the database tools need data administration, nothing else", () => {
    expect(ids({ canAdministerData: true, canReadNetworkLogs: false })).toEqual(
      ["logs", "quick-message", "database"],
    )
  })
})
