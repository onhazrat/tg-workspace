import { describe, expect, test } from "bun:test"

import {
  isVirtualGroupTag,
  toVirtualGroupTagName,
} from "@/lib/channels/virtual-group-tags"

describe("virtual group tags", () => {
  test("formats and detects group tag prefix", () => {
    expect(toVirtualGroupTagName("Slow feed")).toBe("group:Slow feed")
    expect(isVirtualGroupTag("group:default")).toBe(true)
    expect(isVirtualGroupTag("GROUP:High velocity")).toBe(true)
    expect(isVirtualGroupTag("news")).toBe(false)
  })
})
