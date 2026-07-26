import { describe, expect, it } from "bun:test"
import { markdownPreview, stripMarkdown } from "./markdown"

describe("stripMarkdown", () => {
  // The exact strings the audit found leaking into every History preview row.
  it("strips the bold headers that leaked into History previews", () => {
    expect(stripMarkdown("**🔴 Executive Summary**")).toBe(
      "🔴 Executive Summary",
    )
    expect(stripMarkdown("**خلاصه مدیریتی (Executive Summary)**")).toBe(
      "خلاصه مدیریتی (Executive Summary)",
    )
  })

  it("strips headings, quotes and list markers", () => {
    expect(stripMarkdown("## Overview")).toBe("Overview")
    expect(stripMarkdown("> quoted line")).toBe("quoted line")
    expect(stripMarkdown("- first\n- second")).toBe("first second")
    expect(stripMarkdown("1. first\n2. second")).toBe("first second")
  })

  it("keeps link and image text, drops the target", () => {
    expect(stripMarkdown("see [the report](https://example.com/x)")).toBe(
      "see the report",
    )
    expect(stripMarkdown("![a chart](https://example.com/c.png)")).toBe(
      "a chart",
    )
  })

  it("strips emphasis, strikethrough and inline code", () => {
    expect(stripMarkdown("***loud*** and *soft* and ~~gone~~")).toBe(
      "loud and soft and gone",
    )
    expect(stripMarkdown("run `npm test` now")).toBe("run npm test now")
  })

  it("leaves snake_case identifiers alone", () => {
    expect(stripMarkdown("call some_function_name here")).toBe(
      "call some_function_name here",
    )
  })

  it("drops code fences but keeps the code", () => {
    expect(stripMarkdown("```python\nprint(1)\n```")).toBe("print(1)")
  })

  it("does not read a horizontal rule as emphasis", () => {
    expect(stripMarkdown("above\n\n---\n\nbelow")).toBe("above below")
  })

  it("collapses blank lines so a two-line clamp is not wasted", () => {
    expect(stripMarkdown("one\n\n\ntwo")).toBe("one two")
  })
})

describe("markdownPreview", () => {
  it("returns short text unchanged and unsuffixed", () => {
    expect(markdownPreview("**Short**")).toBe("Short")
  })

  it("clips on a word boundary and appends a real ellipsis", () => {
    const preview = markdownPreview("alpha beta gamma delta", 12)
    expect(preview).toBe("alpha beta…")
    expect(preview).not.toContain("...")
  })

  it("never exceeds the budget plus the ellipsis", () => {
    const long = "word ".repeat(200)
    expect(markdownPreview(long, 200).length).toBeLessThanOrEqual(201)
  })

  it("falls back to a hard cut when there is no space to break on", () => {
    // Scripts without inter-word spaces would otherwise return an empty preview.
    expect(markdownPreview("あ".repeat(50), 10)).toBe(`${"あ".repeat(10)}…`)
  })

  it("strips before measuring, so syntax does not eat the budget", () => {
    expect(markdownPreview("**bold** text", 100)).toBe("bold text")
  })
})
