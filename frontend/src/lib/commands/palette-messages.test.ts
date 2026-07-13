import { describe, expect, test } from "bun:test"
import {
  getEditorFooterHint,
  getEntityEmptyMessage,
  getEntityGroupHeading,
  getEntityInputPlaceholder,
  getSearchResultsEmptyMessage,
  getSearchResultsHeaderLabel,
  getStayOpenAnnouncement,
} from "./palette-messages"

describe("getStayOpenAnnouncement", () => {
  test("returns flow-specific announcements", () => {
    expect(getStayOpenAnnouncement("select-channel")).toBe(
      "Channel selected, palette open",
    )
    expect(getStayOpenAnnouncement("deselect-channel")).toBe(
      "Channel deselected, palette open",
    )
    expect(getStayOpenAnnouncement("freeze-channel")).toBe(
      "Channel frozen, palette open",
    )
    expect(getStayOpenAnnouncement("unfreeze-channel")).toBe(
      "Channel unfrozen, palette open",
    )
    expect(getStayOpenAnnouncement("toggle-auto-follow")).toBe(
      "Auto-follow toggled, palette open",
    )
    expect(getStayOpenAnnouncement("fix-partial-history-channel")).toBe(
      "Partial history fix queued, palette open",
    )
  })

  test("falls back to a generic announcement", () => {
    expect(getStayOpenAnnouncement("sync-channel")).toBe(
      "Selection updated, palette open",
    )
  })
})

describe("getEntityEmptyMessage", () => {
  test("query-dependent messages only show without a query", () => {
    expect(getEntityEmptyMessage("deselect-channel", false)).toBe(
      "No channels selected.",
    )
    expect(getEntityEmptyMessage("deselect-channel", true)).toBe(
      "No matches found.",
    )
    expect(getEntityEmptyMessage("fix-partial-history-channel", false)).toBe(
      "No channels with partial history.",
    )
    expect(getEntityEmptyMessage("fix-partial-history-channel", true)).toBe(
      "No matches found.",
    )
  })

  test("flow-specific messages show regardless of query", () => {
    expect(getEntityEmptyMessage("pick-post", true)).toBe(
      "No posts in current filter. Try widening the date range.",
    )
    expect(getEntityEmptyMessage("delete-summary", true)).toBe(
      "No summaries in history.",
    )
    expect(getEntityEmptyMessage("remove-tag-pick", false)).toBe(
      "No tags on this channel.",
    )
    expect(getEntityEmptyMessage("open-setting-group", false)).toBe(
      "No setting groups found.",
    )
  })

  test("channel flows fall back to generic message", () => {
    expect(getEntityEmptyMessage("search-channel", false)).toBe(
      "No matches found.",
    )
    expect(getEntityEmptyMessage("select-channel", true)).toBe(
      "No matches found.",
    )
  })
})

describe("getEntityGroupHeading", () => {
  test("channel flows show Channels", () => {
    expect(getEntityGroupHeading("search-channel")).toBe("Channels")
    expect(getEntityGroupHeading("freeze-channel")).toBe("Channels")
  })

  test("non-channel flows have specific headings", () => {
    expect(getEntityGroupHeading("delete-summary")).toBe("Summaries")
    expect(getEntityGroupHeading("pick-post")).toBe("Posts")
    expect(getEntityGroupHeading("clear-db-table")).toBe("Tables")
    expect(getEntityGroupHeading("move-to-setting-group")).toBe(
      "Setting Groups",
    )
    expect(getEntityGroupHeading("remove-tag-pick")).toBe("Tags")
  })
})

describe("getEntityInputPlaceholder", () => {
  test("non-channel flows use the plain filter placeholder", () => {
    expect(getEntityInputPlaceholder("pick-post")).toBe("Filter...")
    expect(getEntityInputPlaceholder("clear-db-table")).toBe("Filter...")
  })

  test("channel flows describe the search syntax", () => {
    expect(getEntityInputPlaceholder("search-channel")).toBe(
      "Name, display name, tag, #tag, or tag:tag...",
    )
  })
})

describe("getSearchResultsEmptyMessage", () => {
  test("with a query suggests refining it", () => {
    expect(getSearchResultsEmptyMessage("bitcoin")).toBe(
      "No matching results. Try a different query or widen the date range.",
    )
  })

  test("without a query mentions the date range", () => {
    expect(getSearchResultsEmptyMessage("")).toBe(
      "No results in the current date range or history.",
    )
    expect(getSearchResultsEmptyMessage("   ")).toBe(
      "No results in the current date range or history.",
    )
  })
})

describe("getSearchResultsHeaderLabel", () => {
  test("appends the query when present", () => {
    expect(getSearchResultsHeaderLabel("Search Posts", "btc")).toBe(
      'Search Posts — "btc"',
    )
  })

  test("omits the suffix for an empty query", () => {
    expect(getSearchResultsHeaderLabel("Search Posts", "")).toBe("Search Posts")
  })
})

describe("getEditorFooterHint", () => {
  test("textarea requires modifier enter", () => {
    expect(getEditorFooterHint(true)).toBe("⌃↵ apply · esc back · ⌫ parent")
  })

  test("single-line input applies on plain enter", () => {
    expect(getEditorFooterHint(false)).toBe("↵ apply · esc back · ⌫ parent")
  })
})
