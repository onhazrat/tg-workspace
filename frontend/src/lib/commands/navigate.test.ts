import { describe, expect, test } from "bun:test"
import { SETTINGS_TOC } from "@/lib/settings/toc"
import { buildNavigateCommands } from "./navigate"

describe("buildNavigateCommands settings TOC", () => {
  const commands = buildNavigateCommands()
  const ids = new Set(commands.map((c) => c.id))

  test("emits navigate-settings-* for every TOC node", () => {
    const walk = (nodes: typeof SETTINGS_TOC) => {
      for (const node of nodes) {
        expect(ids.has(`navigate-settings-${node.id}`)).toBe(true)
        if (node.children) walk(node.children)
      }
    }
    walk(SETTINGS_TOC)
  })

  test("preserves legacy sync/db navigate aliases", () => {
    expect(ids.has("navigate-settings-sync")).toBe(true)
    expect(ids.has("navigate-settings-db")).toBe(true)
  })

  test("includes Setting Groups and Network leaves", () => {
    expect(ids.has("navigate-settings-setting-groups")).toBe(true)
    expect(ids.has("navigate-settings-proxy")).toBe(true)
    expect(ids.has("navigate-settings-tor")).toBe(true)
    expect(ids.has("navigate-settings-retention")).toBe(true)
    expect(ids.has("navigate-settings-network-telemetry")).toBe(true)
  })
})
