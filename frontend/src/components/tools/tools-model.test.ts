import { describe, expect, test } from "bun:test"

import { visibleTools } from "./tools-model"

const ids = (permissions: string[]) =>
  visibleTools(permissions).map((t) => t.id)

describe("the Tools tab", () => {
  test("every Account gets Logs and Quick message", () => {
    expect(ids([])).toEqual(["logs", "quick-message"])
  })

  test("network telemetry needs the network-log read, nothing else", () => {
    expect(ids(["logs:read_any"])).toEqual([
      "logs",
      "quick-message",
      "network-telemetry",
    ])
  })

  test("the database tools need data administration, nothing else", () => {
    expect(ids(["data:admin", "jobs:manage"])).toEqual([
      "logs",
      "quick-message",
      "database",
    ])
  })
})
