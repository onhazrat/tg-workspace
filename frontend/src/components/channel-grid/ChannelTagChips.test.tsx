import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { ChannelTagChips } from "@/components/channel-grid/ChannelTagChips"
import {
  buildChannelPseudoTagChips,
  PARTIAL_HISTORY_TAG_ID,
  UNTAGGED_TAG_ID,
} from "@/lib/channels/channel-tags"
import type { Channel } from "@/types"

const channels: Channel[] = [
  {
    id: "tagged",
    name: "tagged",
    tags: ["tech"],
    lastUpdated: 0,
    followedAt: 0,
    historyCompleteToCutoff: true,
  },
  {
    id: "partial",
    name: "partial",
    tags: ["tech"],
    lastUpdated: 0,
    followedAt: 0,
    historyCompleteToCutoff: false,
  },
  {
    id: "bare",
    name: "bare",
    tags: [],
    lastUpdated: 0,
    followedAt: 0,
  },
]

function render(tagSearch = "", selected: string[] = []) {
  return renderToStaticMarkup(
    <ChannelTagChips
      channels={channels}
      selectedChannels={new Set(selected)}
      visibleTags={["tech"]}
      pseudoTagChips={buildChannelPseudoTagChips(channels, tagSearch)}
      onToggleTag={() => {}}
    />,
  )
}

describe("ChannelTagChips", () => {
  test("renders both pseudo-tag chips with their selection counts", () => {
    const html = render()

    expect(html).toContain('data-testid="channel-tag-untagged"')
    expect(html).toContain('data-testid="channel-tag-partial-history"')
    expect(html).toContain("Partial history")
    // One partial-history channel, none selected.
    expect(html).toContain("(0/1)")
  })

  test("partial-history chip reflects selection state like any tag chip", () => {
    const html = render("partial", ["partial"])

    expect(html).toContain('data-testid="channel-tag-partial-history"')
    expect(html).toContain('data-state="selected"')
    expect(html).not.toContain('data-testid="channel-tag-untagged"')
  })

  test("ids stay UI-only so they can never collide with a stored tag", () => {
    expect(UNTAGGED_TAG_ID.startsWith("__ui_")).toBe(true)
    expect(PARTIAL_HISTORY_TAG_ID.startsWith("__ui_")).toBe(true)
  })
})
