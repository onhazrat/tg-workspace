import { describe, expect, test } from "bun:test"
import { buildNavigateCommands } from "./navigate"

const goTo = (permissions: string[]) =>
  buildNavigateCommands(permissions)
    .map((c) => c.label)
    .filter((label) => label.startsWith("Go to"))

describe("the palette's Go to commands", () => {
  test("offer the Requests tab only to the Operator (RQS-03)", () => {
    expect(goTo([])).not.toContain("Go to Requests")
    expect(goTo([])).toContain("Go to Tools")
    expect(goTo(["quota:read_any"])).toContain("Go to Requests")
  })
})
