/**
 * Which image the logo draws. Rendered without a link, because `<Link>` needs a
 * router and the variant choice is the part with decisions in it. Outside a
 * `ThemeProvider` the resolved theme is light.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render } from "@testing-library/react"

import { Logo } from "./Logo"

afterEach(cleanup)

const images = (container: HTMLElement) =>
  [...container.querySelectorAll("img")].map((img) => ({
    src: img.getAttribute("src"),
    className: img.className,
  }))

describe("Logo", () => {
  test("full draws the wordmark and icon draws the mark", () => {
    const full = render(<Logo asLink={false} />)
    const [wordmark] = images(full.container)
    expect(wordmark.src).toContain("fastapi-logo.svg")
    expect(wordmark.className).toBe("h-6 w-auto")
    cleanup()

    const icon = render(<Logo variant="icon" asLink={false} className="x" />)
    const [mark] = images(icon.container)
    expect(mark.src).toContain("fastapi-icon.svg")
    expect(mark.className).toBe("size-5 x")
  })

  test("responsive draws both and lets the collapsed sidebar pick", () => {
    const { container } = render(<Logo variant="responsive" asLink={false} />)
    const [wordmark, mark] = images(container)
    expect(wordmark.src).toContain("fastapi-logo.svg")
    expect(wordmark.className).toContain("group-data-[collapsible=icon]:hidden")
    expect(mark.src).toContain("fastapi-icon.svg")
    expect(mark.className).toContain("group-data-[collapsible=icon]:block")
  })
})
