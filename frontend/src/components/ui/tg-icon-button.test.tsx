import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TgIconButton, tgIconButtonVariants } from "./tg-icon-button"

describe("TgIconButton", () => {
  test("renders each variant", () => {
    for (const variant of ["ghost", "frosted", "danger", "soft"] as const) {
      const html = renderToStaticMarkup(
        <TgIconButton variant={variant} aria-label={variant}>
          <span>*</span>
        </TgIconButton>,
      )
      expect(html).toContain(`data-variant="${variant}"`)
      expect(html).toContain(`aria-label="${variant}"`)
    }
  })

  test("loading disables and shows spinner", () => {
    const html = renderToStaticMarkup(
      <TgIconButton aria-label="Sync" loading>
        <span>icon</span>
      </TgIconButton>,
    )
    expect(html).toContain("animate-spin")
    expect(html).toContain("disabled")
    expect(html).toContain('aria-busy="true"')
  })

  test("tooltip wraps trigger without dropping aria-label", () => {
    // Tooltip content portals out of static markup; assert trigger wiring.
    const html = renderToStaticMarkup(
      <TgIconButton aria-label="Star" tooltip="Star post">
        <span>★</span>
      </TgIconButton>,
    )
    expect(html).toContain('aria-label="Star"')
    expect(html).toContain("data-base-ui-tooltip-trigger")
    expect(html).toContain("★")
  })

  test("ghost hover class exists for theme asserts", () => {
    expect(tgIconButtonVariants({ variant: "ghost" })).toContain(
      "hover:bg-app-ink/5",
    )
  })
})
