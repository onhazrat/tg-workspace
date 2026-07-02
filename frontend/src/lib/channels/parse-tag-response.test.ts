import { describe, expect, it } from "bun:test"

import { parseTagResponse } from "@/lib/channels/parse-tag-response"

describe("parseTagResponse", () => {
  it("parses valid channel->tags JSON", () => {
    const parsed = parseTagResponse(
      JSON.stringify({ alpha: ["Politics", "Tech"], beta: [] }),
    )
    expect(parsed).toEqual({ alpha: ["Politics", "Tech"], beta: [] })
  })

  it("deduplicates and trims tag names", () => {
    const parsed = parseTagResponse(
      JSON.stringify({ alpha: [" Tech ", "Tech", "AI"] }),
    )
    expect(parsed).toEqual({ alpha: ["Tech", "AI"] })
  })

  it("throws for non-object payloads", () => {
    expect(() => parseTagResponse(JSON.stringify(["bad"]))).toThrow()
  })

  it("parses JSON wrapped in markdown code fences", () => {
    const parsed = parseTagResponse('```json\n{"alpha":["Politics"]}\n```')
    expect(parsed).toEqual({ alpha: ["Politics"] })
  })
})
