import { describe, expect, it } from "bun:test"
import { tagPreviewScopeNote } from "./tag-preview-scope"

describe("tagPreviewScopeNote", () => {
  /** The exact pairing the audit found: header 43, preview 50. */
  it("explains the divergence the audit flagged", () => {
    expect(tagPreviewScopeNote(50, 43)).toBe(
      "Suggestions cover 50 channels; 43 channels currently selected.",
    )
  })

  it("stays quiet when the two counts agree", () => {
    expect(tagPreviewScopeNote(43, 43)).toBe(null)
  })

  it("stays quiet when there is no preview yet", () => {
    expect(tagPreviewScopeNote(0, 43)).toBe(null)
  })

  it("handles a preview narrower than the selection", () => {
    expect(tagPreviewScopeNote(5, 43)).toBe(
      "Suggestions cover 5 channels; 43 channels currently selected.",
    )
  })

  it("pluralizes both counts independently", () => {
    expect(tagPreviewScopeNote(1, 43)).toBe(
      "Suggestions cover 1 channel; 43 channels currently selected.",
    )
    expect(tagPreviewScopeNote(50, 1)).toBe(
      "Suggestions cover 50 channels; 1 channel currently selected.",
    )
  })
})
