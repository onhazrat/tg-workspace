import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  TgFilterChip,
  TgMetaChip,
  tgFilterChipVariants,
  tgMetaChipVariants,
} from "./tg-chips"

describe("TG chips", () => {
  test("filter chips stay uppercase", () => {
    // Filter chips label fixed UI vocabulary, where the caps are just style.
    expect(tgFilterChipVariants({ selected: false })).toContain("uppercase")
  })

  test("meta chip sizes", () => {
    expect(tgMetaChipVariants({ size: "card" })).toContain("text-[10px]")
    expect(tgMetaChipVariants({ size: "history" })).toContain("font-mono")
    const html = renderToStaticMarkup(
      <TgMetaChip size="history">3 posts</TgMetaChip>,
    )
    expect(html).toContain("3 posts")
    expect(html).toContain('data-size="history"')
  })

  test("filter chip selected/idle", () => {
    const selected = renderToStaticMarkup(
      <TgFilterChip selected>Lang</TgFilterChip>,
    )
    expect(selected).toContain('data-selected="true"')
    expect(selected).toContain('aria-pressed="true"')
    expect(tgFilterChipVariants({ selected: true })).toContain("bg-app-ink")
    expect(tgFilterChipVariants({ selected: false })).toContain(
      "hover:bg-app-ink/5",
    )
  })
})
