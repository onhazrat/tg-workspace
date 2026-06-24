import { describe, expect, it } from "bun:test"

import { parseOpenPostInput } from "@/lib/commands/open-post"

describe("parseOpenPostInput", () => {
  it("parses channel and id separated by space", () => {
    expect(parseOpenPostInput("mychannel 12345")).toEqual({
      channelName: "mychannel",
      postId: 12345,
    })
  })

  it("parses channel:id format", () => {
    expect(parseOpenPostInput("@news:99")).toEqual({
      channelName: "news",
      postId: 99,
    })
  })

  it("returns null for invalid input", () => {
    expect(parseOpenPostInput("not-a-post")).toBeNull()
    expect(parseOpenPostInput("channel 0")).toBeNull()
  })
})
