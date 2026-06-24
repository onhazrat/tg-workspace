import { describe, expect, test } from "bun:test"
import type { Channel } from "@/types"
import {
  buildJsonlContent,
  extractRecordsForEntity,
  JsonlParseError,
  parseJsonlText,
} from "./jsonl"

const sampleChannel: Channel = {
  id: "ch-1",
  name: "alphachannel",
  displayName: "Alpha Channel",
  isFrozen: false,
}

describe("buildJsonlContent", () => {
  test("round-trips header and records", () => {
    const content = buildJsonlContent("channel", "all", [sampleChannel])
    const lines = parseJsonlText(content)
    const { header, records } = extractRecordsForEntity("channel", lines)

    expect(header?.entity).toBe("channel")
    expect(header?.filter).toBe("all")
    expect(header?.schemaVersion).toBe(1)
    expect(records).toHaveLength(1)
    expect(records[0].name).toBe("alphachannel")
  })
})

describe("parseJsonlText", () => {
  test("parses legacy store lines for channels", () => {
    const text = `${JSON.stringify({ type: "store", storeName: "channels", data: sampleChannel })}\n`
    const lines = parseJsonlText(text)
    const { records } = extractRecordsForEntity("channel", lines)
    expect(records[0].name).toBe("alphachannel")
  })

  test("rejects JSON array files", () => {
    expect(() => parseJsonlText('[{"id":"1"}]')).toThrow(JsonlParseError)
  })

  test("throws on malformed JSON line", () => {
    expect(() => parseJsonlText("{not json")).toThrow(JsonlParseError)
  })

  test("throws on unrecognized line type", () => {
    expect(() => parseJsonlText('{"type":"unknown"}')).toThrow(JsonlParseError)
  })
})
