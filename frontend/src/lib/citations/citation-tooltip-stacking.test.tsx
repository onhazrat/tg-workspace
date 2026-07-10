import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { CitationHover } from "@/components/CitationHover"
import { TOOLTIP_POSITIONER_Z_CLASS } from "@/components/ui/tg-tooltip"

describe("citation tooltip stacking", () => {
  test("citation badges do not create a positive z-index stacking context", () => {
    const html = renderToStaticMarkup(
      <CitationHover channelName="news_channel" postId={452} />,
    )

    expect(html).not.toContain("z-10")
    expect(html).not.toContain("z-")
  })

  test("tooltip positioner uses an explicit z-index above citation badges", () => {
    expect(TOOLTIP_POSITIONER_Z_CLASS).toBe("z-50")
  })
})
