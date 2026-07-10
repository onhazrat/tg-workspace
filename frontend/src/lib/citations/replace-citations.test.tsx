import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { replaceCitations } from "./replace-citations"

describe("replaceCitations", () => {
  test("replaces citation tokens with interactive badges", () => {
    const html = renderToStaticMarkup(
      <div>{replaceCitations("See [news_channel #452] for details.")}</div>,
    )

    expect(html).toContain("news_channel")
    expect(html).toContain("#452")
    expect(html).not.toContain("[news_channel #452]")
  })

  test("leaves plain text without citations unchanged", () => {
    const html = renderToStaticMarkup(
      <div>{replaceCitations("No citations in this sentence.")}</div>,
    )

    expect(html).toBe("<div>No citations in this sentence.</div>")
  })
})
