import { describe, expect, it } from "bun:test"

import { formatChannelsForPrompt } from "@/lib/channels/format-channels-for-prompt"
import type { Channel } from "@/types"

const channels: Channel[] = [
  {
    id: "1",
    name: "alpha",
    bio: "Alpha bio",
    tags: ["Politics", "Tech"],
  },
  {
    id: "2",
    name: "beta",
    bio: "",
    tags: [],
  },
]

describe("formatChannelsForPrompt", () => {
  it("returns legacy comma format when both options are off", () => {
    const text = formatChannelsForPrompt(channels, ["alpha", "beta"], {
      includeBio: false,
      includeTags: false,
    })
    expect(text).toBe("alpha, beta")
  })

  it("includes only bio lines when bio option is on", () => {
    const text = formatChannelsForPrompt(channels, ["alpha", "beta"], {
      includeBio: true,
      includeTags: false,
    })
    expect(text).toContain("### alpha\nBio: Alpha bio")
    expect(text).not.toContain("Current tags:")
  })

  it("includes only current tags when tags option is on", () => {
    const text = formatChannelsForPrompt(channels, ["alpha", "beta"], {
      includeBio: false,
      includeTags: true,
    })
    expect(text).toContain("### alpha\nCurrent tags: Politics, Tech")
    expect(text).not.toContain("Bio:")
  })

  it("includes both lines when both options are on", () => {
    const text = formatChannelsForPrompt(channels, ["alpha"], {
      includeBio: true,
      includeTags: true,
    })
    expect(text).toBe("### alpha\nBio: Alpha bio\nCurrent tags: Politics, Tech")
  })
})
